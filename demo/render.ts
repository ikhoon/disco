// Demo renderer: feeds FICTIONAL fixture data through disco's real formatters
// (src/format.ts + src/commands.ts + src/color.ts), so the recorded gif always
// matches what the real binary prints — colors, gutter, embed cards, nicknames,
// the --json schema — without ever touching the Discord API. Invoked via
// demo/bin/disco (on PATH during `bun run demo`); see demo/demo.tape.

import { setColorEnabled } from "../src/color.ts";
import { printMessages, printChannels } from "../src/format.ts";
import { cmdWhoami } from "../src/commands.ts";
import { info } from "../src/log.ts";
import type { DiscordClient } from "../src/client.ts";
import type { DiscordMessage, DiscordChannel } from "../src/types.ts";

setColorEnabled(true); // vhs records in a pty; force color for a stable gif

const GUILD = "111111111111111111";
const CHAN = "222222222222222222";

interface MsgOpts {
  bot?: boolean;
  embeds?: DiscordMessage["embeds"];
}
function msg(
  id: string,
  ts: string,
  username: string,
  globalName: string | null,
  content: string,
  opts: MsgOpts = {},
): DiscordMessage {
  return {
    id,
    channel_id: CHAN,
    timestamp: ts,
    content,
    type: 0,
    attachments: [],
    mentions: [],
    embeds: opts.embeds,
    author: { id: `u_${username}`, username, global_name: globalName, bot: !!opts.bot },
  };
}

// A channel conversation: shows the gutter, server nicknames, an @handle, a bot
// tag, and a link-preview embed rendered as a dim 🔗 card. Timestamps carry
// +09:00 so the clock reads the same regardless of the recording machine's locale.
const CONVERSATION: DiscordMessage[] = [
  msg("1", "2026-07-04T08:41:12+09:00", "annie_dev", null, "morning — anyone looking at the flaky retry test on main?"),
  msg("2", "2026-07-04T08:43:05+09:00", "jkim", null, "yep, filed it with a repro:", {
    embeds: [
      {
        title: "Flaky: RetryTest times out under load",
        url: "https://example.com/issues/482",
        description:
          "The retry test intermittently exceeds the 5s deadline when the CI runner is busy; raising the timeout hides it rather than fixing the race.",
      },
    ],
  }),
  msg("3", "2026-07-04T08:55:03+09:00", "ci", "CI", "build #1242 is green again", { bot: true }),
];
// Server nicknames (what the Discord app shows) — keyed by author id.
const NICKS: Record<string, string> = { u_annie_dev: "annie", u_jkim: "jaykim" };

const CHANNELS: DiscordChannel[] = [
  { id: "222222222222222200", name: "welcome", type: 0, position: 0, topic: "Start here — introductions and rules" },
  { id: "222222222222222299", name: "ENGINEERING", type: 4, position: 1 },
  { id: CHAN, name: "general", type: 0, parent_id: "222222222222222299", position: 0, topic: "Team-wide chat" },
  { id: "222222222222222223", name: "backend", type: 0, parent_id: "222222222222222299", position: 1, topic: "API and services" },
  { id: "222222222222222224", name: "release-1-42", type: 11, parent_id: "222222222222222299", position: 2 },
  { id: "222222222222222225", name: "standup", type: 2, parent_id: "222222222222222299", position: 3, topic: "Daily voice standup, 10:00" },
];

/** A fake client so the real cmdWhoami formatter runs without touching the API. */
const whoamiClient = {
  isBot: false,
  request: async () => ({ id: "710681237492203571", username: "you", global_name: "you", email: "you@example.com" }),
} as unknown as DiscordClient;

const argv = Bun.argv.slice(2);
const json = argv.includes("--json");

switch (argv[0]) {
  case "read":
    info("3 message(s)");
    printMessages(CONVERSATION, { json, guildId: GUILD, nicks: json ? undefined : NICKS });
    break;
  case "channels":
    info(`${CHANNELS.length} channels`);
    printChannels(CHANNELS, json);
    break;
  case "whoami":
    await cmdWhoami(whoamiClient, json);
    break;
  default:
    console.error(`disco: (demo mock) unhandled command: ${argv.join(" ")}`);
    process.exit(1);
}
