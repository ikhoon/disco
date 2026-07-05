// Demo renderer: feeds FICTIONAL fixture data through disco's real formatters
// (src/format.ts + src/color.ts), so the recorded gif always matches what the
// real binary prints — colors, layout, and --json schema included — without
// ever touching the Discord API. Invoked via demo/bin/disco (on PATH during
// `bun run demo`); see demo/demo.tape.

import { setColorEnabled } from "../src/color.ts";
import { printMessages, printChannels } from "../src/format.ts";
import { info } from "../src/log.ts";
import type { DiscordMessage, DiscordChannel } from "../src/types.ts";

setColorEnabled(true); // vhs records in a pty; force color for a stable gif

const GUILD = "111111111111111111";
const CHAN = "222222222222222222";

function msg(
  id: string,
  ts: string,
  name: string,
  username: string,
  content: string,
  bot = false,
): DiscordMessage {
  return {
    id,
    channel_id: CHAN,
    timestamp: ts,
    content,
    type: 0,
    attachments: [],
    mentions: [],
    author: { id: `9000000000000000${bot ? "2" : "1"}`, username, global_name: name, bot },
  };
}

// Timestamps carry +09:00 so the gif shows the same clock times regardless of
// the recording machine's locale drift (fmtTime renders local time).
const MENTIONS = [
  msg(
    "333333333333333333",
    "2026-07-04T08:41:12+09:00",
    "Jane Doe",
    "jane",
    "@ikhoon deploy failed on main — can you take a look?",
  ),
  msg(
    "333333333333333444",
    "2026-07-04T08:55:03+09:00",
    "CI Bot",
    "cibot",
    "build #1242 fixed by @ikhoon",
    true,
  ),
];

const SEARCH = [
  MENTIONS[0],
  msg(
    "333333333333333222",
    "2026-07-03T17:20:41+09:00",
    "Alex Kim",
    "alexk",
    "deploy failed twice on staging — rollback went out, postmortem doc in the thread",
  ),
];

const CHANNELS: DiscordChannel[] = [
  { id: "222222222222222200", name: "welcome", type: 0, position: 0 },
  { id: "222222222222222299", name: "ENGINEERING", type: 4, position: 1 },
  { id: CHAN, name: "deploys", type: 0, parent_id: "222222222222222299", position: 0 },
  { id: "222222222222222223", name: "backend", type: 0, parent_id: "222222222222222299", position: 1 },
  { id: "222222222222222224", name: "release-1-42", type: 11, parent_id: "222222222222222299", position: 2 },
];

const argv = Bun.argv.slice(2);
const json = argv.includes("--json");

switch (argv[0]) {
  case "mention":
    info("2 mention(s) since 2026-07-04T07:00:00.000Z");
    printMessages(MENTIONS, { json, guildId: GUILD });
    break;
  case "search":
    info(`2 of 2 result(s) in guild ${GUILD}`);
    printMessages(SEARCH, { json, guildId: GUILD });
    break;
  case "channels":
    info(`5 channel(s) in guild ${GUILD}`);
    printChannels(CHANNELS, json);
    break;
  default:
    console.error(`disco: (demo mock) unhandled command: ${argv.join(" ")}`);
    process.exit(1);
}
