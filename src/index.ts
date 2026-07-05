#!/usr/bin/env bun
// disco — Discord activity CLI. Entry point: arg parsing + dispatch.

import { DiscordClient, DiscordError } from "./client.ts";
import { resolveCredential, storeCredential, clearCredential, type Credential } from "./auth.ts";
import { loadConfig, saveConfig, configPath } from "./config.ts";
import { configureLog, warn, info } from "./log.ts";
import { configureColor, stderrRed } from "./color.ts";
import { parseRef, parseTime } from "./util.ts";
import { resolveChannelRef, resolveGuild } from "./resolve.ts";
import { runCompletions } from "./completions.ts";
import { parseArgs, str, posInt, type Args } from "./args.ts";
import { VERSION } from "./version.ts";
import {
  cmdWhoami,
  cmdGuilds,
  cmdChannels,
  cmdChannel,
  cmdThread,
  cmdMessage,
  cmdMention,
  cmdSearch,
  cmdDms,
  cmdAuthLogin,
} from "./commands.ts";

// ---- help -------------------------------------------------------------------

const HELP = `disco ${VERSION} — Discord activity CLI

Usage: disco <command> [options]

Examples:
  Sign in (opens the browser, stores the token in the Keychain):
    $ disco auth login

  Read a channel by name or URL (names are cached after the first lookup):
    $ disco read general
    $ disco read "Team/general"
    $ disco read https://discord.com/channels/<guild>/<channel>

  Last N messages, or a time window:
    $ disco channel general --limit 50
    $ disco channel general --since 2h

  One message, or a whole thread:
    $ disco message <messageUrl>
    $ disco thread <threadUrl>

  Your mentions and search (user token):
    $ disco mention --after 1d
    $ disco search "deploy failed" --guild <guildId>

  Discover ids, and pipe JSON to jq:
    $ disco guilds
    $ disco channels <guildId>
    $ disco channel general --json | jq '.data[].content'

Read commands:
  read <url|id|name>  Auto-dispatch a URL/ID, or a channel name ("general", "Server/general")
  channel <url|id|name>  Channel history      [--days N | --limit N] [--since T]
  thread <url|id>     Thread messages         [--limit N]
  message <url>       Single message by link  (or: message <channelId> <messageId>)
  mention             Your recent mentions    [--after T | --since T] [--guild ID] [--limit N]  (user token)
  search <query>      Search messages         [--guild ID | --channel ID] [--count N] [--sort timestamp|relevance]  (user token)
  guilds              List servers you're in
  channels <server|id>  List a server's channels (by name or id)
  dms                 List your DM / group-DM channels  (user token)
  whoami              Show the authenticated account

Auth & config:
  auth [status]       Show auth status (verifies the token)
  auth login          Sign in via the browser (assisted capture)  (user token)
                      [--manual | --clipboard | --browser-path <bin>]
  auth set            Store a token (--token <t> | via stdin) [--bot]
  auth clear          Remove the stored token
  config              Show config file + path
  config set-guild <server|id>   Set the default server (by name or id)
  completions         Print shell completion script  [--shell zsh|bash] [--install]
                      (brew installs completions automatically; --install is for manual setups)

Global options:
  --json              Machine-readable JSON: { "data": ... }  (for jq)
  --no-color          Disable colored output (also honors the NO_COLOR env var)
  --no-nicks          Don't resolve server nicknames for authors (faster reads)
  -v, --verbose       Verbose request logging (stderr)
  -q, --quiet         Suppress info logs
  --bot               Treat the token as a bot token ("Bot " prefix)
  -h, --help          Show help
  -V, --version       Show version

Time (T) accepts: 10m, 2h, 3d, 1w, or an ISO date (2026-06-01T09:00).

Channel names (read/channel): "general" or "Server/general". The first lookup
scans your servers; the result is cached to ~/.config/disco/channel-cache.json,
so it's instant next time. Use --refresh to re-resolve (e.g. after a rename).

Token — disco reads it from the macOS Keychain or the DISCORD_TOKEN env var.
  Get one:
    disco auth login     Sign in through the browser; saved to the Keychain (easiest)
    disco auth set       Store a token you already have                      [--bot]
    DISCORD_TOKEN=<t>    Use one for a single command, via the environment

  User token  →  search, mentions, DMs      ⚠️  self-bot use violates Discord ToS
  Bot token   →  only channels/threads/messages the bot is a member of        [--bot]

  It's your own account's token: stored encrypted, read-only — disco never posts.

Config file: ${configPath()}
`;

// ---- credential helper ------------------------------------------------------

async function needClient(flags: Args["flags"]): Promise<DiscordClient> {
  const optBot = flags.bot === true ? true : undefined;
  const cred = await resolveCredential(optBot);
  if (!cred) {
    throw new DiscordError(
      0,
      undefined,
      "no token found. Set DISCORD_TOKEN or run `disco auth set` (see `disco --help`).",
    );
  }
  return new DiscordClient(cred);
}

function refOrThrow(input: string | undefined, what: string) {
  if (!input) throw new DiscordError(0, undefined, `missing ${what}. See \`disco --help\`.`);
  const ref = parseRef(input);
  if (!ref) throw new DiscordError(0, undefined, `could not parse "${input}" as a Discord URL or ID.`);
  return ref;
}

// ---- auth / config subcommands ---------------------------------------------

async function runAuth(args: Args): Promise<void> {
  const sub = args._[1] ?? "status";
  const json = args.flags.json === true;

  if (sub === "clear") {
    await clearCredential();
    info("token cleared from the Keychain.");
    return;
  }

  if (sub === "login") {
    return cmdAuthLogin({
      json,
      manual: args.flags.manual === true,
      clipboard: args.flags.clipboard === true,
      browserPath: str(args.flags["browser-path"]),
      bot: args.flags.bot === true,
    });
  }

  if (sub === "set") {
    let token = str(args.flags.token);
    if (!token && !process.stdin.isTTY) {
      token = (await Bun.stdin.text()).trim();
    }
    if (!token) {
      throw new DiscordError(0, undefined, "provide a token: `disco auth set --token <t>` or `echo <t> | disco auth set`.");
    }
    const bot = args.flags.bot === true;
    const cred: Credential = { token, bot };
    // Validate before storing.
    const client = new DiscordClient(cred);
    await cmdWhoami(client, false);
    await storeCredential(cred);
    info(`token stored (${bot ? "bot" : "user"}).`);
    return;
  }

  // status (default)
  const cred = await resolveCredential(args.flags.bot === true ? true : undefined);
  if (!cred) {
    info("not authenticated — no token in DISCORD_TOKEN or the Keychain.");
    process.exitCode = 1;
    return;
  }
  const client = new DiscordClient(cred);
  await cmdWhoami(client, json);
}

async function runConfig(args: Args): Promise<void> {
  const sub = args._[1];
  const cfg = await loadConfig();

  if (sub === "set-guild") {
    const arg = args._.slice(2).join(" ").trim(); // join so a server name with spaces works
    if (!arg) throw new DiscordError(0, undefined, "usage: disco config set-guild <server-name|id>");
    const guildId = await resolveGuild(arg, await needClient(args.flags)); // id, URL, or name
    cfg.default_guild = guildId;
    await saveConfig(cfg);
    info(`default_guild set to ${guildId}`);
    return;
  }
  if (sub === "path") {
    process.stdout.write(configPath() + "\n");
    return;
  }
  // show
  info(`config: ${configPath()}`);
  process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
}

// ---- main -------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  configureLog({ verbose: args.flags.verbose === true, quiet: args.flags.quiet === true });
  configureColor({ noColor: args.flags["no-color"] === true, json: args.flags.json === true });

  if (args.flags.version === true) {
    process.stdout.write(VERSION + "\n");
    return;
  }
  const command = args._[0];
  if (!command || args.flags.help === true || command === "help") {
    process.stdout.write(HELP);
    return;
  }

  const json = args.flags.json === true;
  const nicks = args.flags["no-nicks"] !== true; // resolve server nicknames unless opted out

  switch (command) {
    case "auth":
      return runAuth(args);
    case "config":
      return runConfig(args);
    case "completions":
      process.stdout.write(
        runCompletions({ shell: str(args.flags.shell) ?? args._[1], install: args.flags.install === true }),
      );
      return;

    case "whoami":
      return cmdWhoami(await needClient(args.flags), json);
    case "guilds":
      await cmdGuilds(await needClient(args.flags), json);
      return;
    case "dms":
      return cmdDms(await needClient(args.flags), json);

    case "channels": {
      const arg = args._.slice(1).join(" ").trim(); // join so a server name with spaces works
      const client = await needClient(args.flags);
      let guildId: string;
      if (arg) {
        guildId = await resolveGuild(arg, client); // id, URL, or server name
      } else {
        const dg = (await loadConfig()).default_guild;
        if (!dg) {
          throw new DiscordError(0, undefined, "usage: disco channels <server-name|id>  (or set a default with `disco config set-guild`)");
        }
        guildId = dg;
      }
      return cmdChannels(client, guildId, json);
    }

    case "read": {
      const input = args._.slice(1).join(" ").trim(); // join so unquoted "Server/channel" with spaces works
      if (!input) throw new DiscordError(0, undefined, "missing a URL, channel ID, or name. See `disco --help`.");
      // Validate flags before any network call so bad flags fail fast.
      const sinceR = str(args.flags.since);
      const opts = {
        days: posInt(args.flags.days, "days"),
        limit: posInt(args.flags.limit, "limit"),
        since: sinceR ? parseTime(sinceR) : undefined,
      };
      const client = await needClient(args.flags);
      const ref = await resolveChannelRef(input, client, {
        defaultGuild: (await loadConfig()).default_guild,
        refresh: args.flags.refresh === true,
      });
      if (ref.messageId) {
        return cmdMessage(client, ref.channelId, ref.messageId, { json, guildId: ref.guildId, nicks });
      }
      return cmdChannel(client, ref.channelId, { ...opts, json, guildId: ref.guildId, nicks });
    }

    case "channel": {
      const input = args._.slice(1).join(" ").trim();
      if (!input) throw new DiscordError(0, undefined, "missing a channel URL, ID, or name. See `disco --help`.");
      const since = str(args.flags.since);
      const opts = {
        days: posInt(args.flags.days, "days"),
        limit: posInt(args.flags.limit, "limit"),
        since: since ? parseTime(since) : undefined,
      };
      const client = await needClient(args.flags);
      const ref = await resolveChannelRef(input, client, {
        defaultGuild: (await loadConfig()).default_guild,
        refresh: args.flags.refresh === true,
      });
      return cmdChannel(client, ref.channelId, { ...opts, json, guildId: ref.guildId, nicks });
    }

    case "thread": {
      const ref = refOrThrow(args._[1], "thread URL or ID");
      const limit = posInt(args.flags.limit, "limit");
      return cmdThread(await needClient(args.flags), ref.channelId, { limit, json, guildId: ref.guildId, nicks });
    }

    case "message": {
      // Accept a URL, or two positionals: message <channelId> <messageId>.
      let channelId: string;
      let messageId: string | undefined;
      let guildId: string | null = null;
      if (args._[2]) {
        channelId = args._[1];
        messageId = args._[2];
      } else {
        const ref = refOrThrow(args._[1], "message URL");
        channelId = ref.channelId;
        messageId = ref.messageId;
        guildId = ref.guildId;
      }
      if (!messageId) {
        throw new DiscordError(0, undefined, "need a message: pass a message URL, or `message <channelId> <messageId>`.");
      }
      return cmdMessage(await needClient(args.flags), channelId, messageId, { json, guildId, nicks });
    }

    case "mention": {
      const afterStr = str(args.flags.after) ?? str(args.flags.since);
      const guildFlag = str(args.flags.guild);
      const client = await needClient(args.flags);
      const opts = {
        after: afterStr ? parseTime(afterStr) : undefined,
        guildId: guildFlag ? await resolveGuild(guildFlag, client) : undefined, // id or server name
        limit: posInt(args.flags.limit, "limit"),
        json,
      };
      return cmdMention(client, opts);
    }

    case "search": {
      const query = args._.slice(1).join(" ").trim();
      if (!query) throw new DiscordError(0, undefined, 'usage: disco search "<query>" [--guild ID]');
      const cfg = await loadConfig();
      const sortRaw = str(args.flags.sort);
      const sort = sortRaw === "relevance" ? "relevance" : sortRaw === "timestamp" ? "timestamp" : undefined;
      const client = await needClient(args.flags);
      const guildFlag = str(args.flags.guild);
      return cmdSearch(
        client,
        query,
        {
          guildId: guildFlag ? await resolveGuild(guildFlag, client) : undefined, // id or server name
          channelId: str(args.flags.channel),
          count: posInt(args.flags.count, "count"),
          sort,
          json,
        },
        cfg.default_guild,
      );
    }

    default:
      warn(`unknown command: ${command}\n`);
      process.stdout.write(HELP);
      process.exitCode = 2;
  }
}

main(Bun.argv.slice(2)).catch((err) => {
  // Just the "error:" label in red — not the whole line (Bun's console.error
  // full-line red reads as alarming). stderrRed gates on stderr's own TTY, so a
  // redirected 2>file stays free of escape codes.
  const message = err instanceof DiscordError ? err.message : (err?.message ?? String(err));
  warn(`${stderrRed("error:")} ${message}`);
  process.exitCode = 1;
});
