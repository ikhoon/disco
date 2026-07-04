# disco

A small CLI for reading your Discord **activity** from the terminal — channel
history, threads, single messages, your recent mentions, and keyword search.
JSON output on every command for piping into `jq`.

> ⚠️ **Read this first.** `disco` talks to Discord's REST API. To do the useful
> things (search, mentions, DMs, every server you're in) it needs a **user
> account token**, and automating a user account ("self-bot") **violates
> Discord's Terms of Service** and can get your account permanently banned —
> Discord enforces this more aggressively than Slack does. This is a personal,
> read-only tool for *your own* account; use it at your own risk. A **bot
> token** (`--bot`) is ToS-safe but can only read channels/threads/messages in
> servers where the bot is a member, and cannot search or list mentions
> (Discord doesn't expose those to bots).

## Install

Requires [Bun](https://bun.sh).

```bash
bun run install-local     # builds a single binary → ~/.local/bin/disco
# or run from source without installing:
bun run src/index.ts --help
```

## Auth

`disco` reads a token from `DISCORD_TOKEN` (env) or the macOS Keychain.

```bash
disco auth set --token "<your-token>"     # stores in the Keychain (validates first)
echo "<your-token>" | disco auth set      # or via stdin
DISCORD_TOKEN="<token>" disco whoami       # or one-off via env
disco auth                                 # show status (who am I?)
disco auth clear                           # forget the token
disco auth set --token "<bot-token>" --bot # store a bot token instead
```

### Getting a user token

1. Open Discord in your **browser** (not the desktop app) and log in.
2. Open DevTools (`Cmd+Opt+I`) → **Network** tab.
3. Do anything that triggers a request (click a channel), pick any request to
   `discord.com/api`, and copy the value of the **`authorization`** request
   header. That raw value *is* your token (no `Bot ` prefix).

Tokens rotate on password change / logout — re-extract if you start getting 401s.

## Usage

```bash
disco read <url>                 # auto: message URL → single message, else channel
disco channel <url|id> --days 7  # last 7 days of a channel (default)
disco channel <url|id> --limit 50
disco thread <url|id>            # all messages in a thread
disco message <messageUrl>       # one message  (also: message <channelId> <messageId>)

disco mention                    # your mentions in the last 10 minutes   (user token)
disco mention --after 1d --json
disco mention --since 2026-06-01T09:00 --guild <guildId>

disco search "deploy failed"                       # across all your servers (user token)
disco search "release" --guild <guildId> --count 25
disco search "invoice" --channel <dmChannelId>     # search a DM
disco search "bug" --sort relevance --json

disco guilds                     # list servers (to get guild IDs)
disco channels <guildId>         # list a server's channels (grouped by category)
disco whoami
```

### URLs and IDs

- Message: `https://discord.com/channels/<guild>/<channel>/<message>`
- Channel/thread: `https://discord.com/channels/<guild>/<channel>`
- Bare snowflake IDs work too (guild context for permalinks won't be known).
- DMs use the `@me` pseudo-guild.

### Time expressions (`--after` / `--since`)

`10m`, `2h`, `3d`, `1w`, or an ISO date like `2026-06-01T09:00`.

### JSON

Every command takes `--json` and emits `{ "data": ... }`:

```bash
disco channel <id> --days 3 --json | jq '.data[] | {ts, author: .author.name, content}'
disco mention --after 2h --json | jq '.data[].permalink'
```

Logs go to **stderr**, data to **stdout**, so pipes stay clean. Use `-q` to
silence info logs, `-v` for verbose request tracing.

## Notes & limits

- **Rate limits** are honored automatically (429 `retry_after`, and 202 while a
  server's search index is still building). `disco` never retries 401/403 to
  avoid tripping Discord's invalid-request IP ban.
- **`mention`** only reaches back ~7 days (Discord's server-side inbox window).
- **`search`** returns ≤25 hits per page and has no cross-server endpoint — with
  no `--guild`, `disco` fans out across every server you're in and merges the
  results. Set a `default_guild` (below) or pass `--guild` to keep it fast.
- Bot tokens: `mention` and DM `search` are user-only and will error clearly.

## Config

`~/.config/disco/config.json` (optional):

```json
{
  "default_guild": "111111111111111111",
  "exclude_user_ids": []
}
```

```bash
disco config                       # show current config + path
disco config set-guild <guildId>   # set default_guild
```
