import { describe, expect, test, afterEach } from "bun:test";
import { normalizeMessage, printMessages, printDms, printChannels, printGuilds, printJson } from "../src/format.ts";
import { displayName, CHANNEL_TYPE, type DiscordMessage, type DiscordChannel } from "../src/types.ts";
import { setColorEnabled } from "../src/color.ts";
import { captureStdout, parseEnvelope } from "./helpers/capture.ts";

const base: DiscordMessage = {
  id: "333",
  channel_id: "222",
  author: { id: "u1", username: "jane", global_name: "Jane Doe" },
  content: "hello",
  timestamp: "2026-07-04T00:00:00.000Z",
  type: 0,
  attachments: [],
  mentions: [],
};

describe("normalizeMessage", () => {
  test("projects the stable JSON shape with a permalink", () => {
    const n = normalizeMessage(base, "111");
    expect(n.author).toEqual({ id: "u1", name: "Jane Doe", username: "jane", bot: false });
    expect(n.permalink).toBe("https://discord.com/channels/111/222/333");
    expect(n.edited).toBe(false);
  });

  test("null guild produces an @me (DM) permalink", () => {
    expect(normalizeMessage(base, null).permalink).toBe("https://discord.com/channels/@me/222/333");
  });

  test("survives a missing author (webhook/system edge cases)", () => {
    const n = normalizeMessage({ ...base, author: undefined as any });
    expect(n.author.name).toBe("(unknown)");
    expect(n.author.bot).toBe(false);
  });

  test("prefers a server nickname over the display name when provided", () => {
    const n = normalizeMessage(base, "111", { u1: "Janey" });
    expect(n.author.name).toBe("Janey"); // nick wins
    expect(n.author.username).toBe("jane"); // handle still the real username
  });

  test("falls back to the display name when the author has no nickname", () => {
    const n = normalizeMessage(base, "111", { someoneElse: "X" });
    expect(n.author.name).toBe("Jane Doe");
  });

  test("truncates reply excerpts at 120 chars and embed descriptions at 200", () => {
    const long = "x".repeat(500);
    const n = normalizeMessage({
      ...base,
      embeds: [{ title: "t", description: long }],
      referenced_message: { ...base, id: "999", content: long },
    });
    expect(n.embeds[0].description!.length).toBe(200);
    expect(n.embeds[0].description!.endsWith("…")).toBe(true);
    expect(n.reply_to!.excerpt.length).toBe(120);
  });
});

describe("displayName / CHANNEL_TYPE", () => {
  test("prefers global_name, falls back to username then id", () => {
    expect(displayName({ id: "1", username: "u", global_name: "G" })).toBe("G");
    expect(displayName({ id: "1", username: "u", global_name: null })).toBe("u");
    expect(displayName({ id: "1", username: "" } as any)).toBe("1");
  });

  test("maps the DM channel types used by dms", () => {
    expect(CHANNEL_TYPE[1]).toBe("dm");
    expect(CHANNEL_TYPE[3]).toBe("group-dm");
  });
});

describe("printMessages", () => {
  test("--json wraps normalized messages in the { data } envelope", async () => {
    const out = await captureStdout(() => printMessages([base], { json: true, guildId: "111" }));
    const data = parseEnvelope(out);
    expect(data[0].id).toBe("333");
    expect(data[0].permalink).toContain("/111/222/333");
  });

  test("human mode renders author, body, and permalink", async () => {
    const out = await captureStdout(() => printMessages([base], { json: false, guildId: "111" }));
    expect(out).toContain("Jane Doe");
    expect(out).toContain("│ hello"); // body sits under a vertical-bar gutter
    expect(out).toContain("https://discord.com/channels/111/222/333");
  });

  test("shows the display name and the @username when they differ", async () => {
    const out = await captureStdout(() => printMessages([base], { json: false, guildId: "111" }));
    expect(out).toContain("Jane Doe (@jane)"); // global_name + handle
  });

  test("omits the @username when it equals the display name", async () => {
    const noGlobal = { ...base, author: { id: "u1", username: "jane" } };
    const out = await captureStdout(() => printMessages([noGlobal], { json: false, guildId: "111" }));
    expect(out).toContain("jane");
    expect(out).not.toContain("(@jane)");
  });
});

describe("printDms", () => {
  const channels: DiscordChannel[] = [
    { id: "1", type: 1, recipients: [{ id: "u", username: "alice" }], last_message_id: "9" },
    { id: "2", type: 3, name: "project", recipients: [], last_message_id: "8" },
  ];

  test("json shape carries id/type_name/name/recipients", async () => {
    const out = await captureStdout(() => printDms(channels, true));
    const data = parseEnvelope(out);
    expect(data[0]).toMatchObject({ id: "1", type_name: "dm", name: "alice" });
    expect(data[1]).toMatchObject({ id: "2", type_name: "group-dm", name: "project" });
  });

  test("human mode marks group DMs, includes ids, and aligns the id column", async () => {
    const out = await captureStdout(() => printDms(channels, false));
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toMatch(/@ alice\s+1$/);
    expect(lines[1]).toMatch(/👥 project\s+2$/);
    // The id column lines up: the visible width before each id is identical.
    const beforeId = (l: string, id: string) => Bun.stringWidth(l.slice(0, l.lastIndexOf(id)));
    expect(beforeId(lines[0], "1")).toBe(beforeId(lines[1], "2"));
  });
});

describe("colored output", () => {
  afterEach(() => setColorEnabled(false));

  test("styles timestamp/author/permalink when color is on", async () => {
    setColorEnabled(true);
    const out = await captureStdout(() => printMessages([base], { json: false, guildId: "111" }));
    // fmtTime renders in local time, so match the shape, not the TZ-dependent value.
    expect(out).toMatch(/\x1b\[92m\d{4}-\d{2}-\d{2} \d{2}:\d{2}\x1b\[0m/); // green timestamp
    expect(out).toContain("\x1b[96mJane Doe\x1b[0m"); // cyan author
    expect(out).toContain("\x1b[90mhttps://discord.com/channels/111/222/333\x1b[0m"); // dim permalink
  });

  test("plain text when color is off (pipes stay clean)", async () => {
    const out = await captureStdout(() => printMessages([base], { json: false, guildId: "111" }));
    expect(out).not.toContain("\x1b[");
  });

  test("--json output never carries ANSI codes even with color forced on", async () => {
    setColorEnabled(true);
    const out = await captureStdout(() => printMessages([base], { json: true, guildId: "111" }));
    expect(out).not.toContain("\x1b[");
    expect(parseEnvelope(out)[0].author.name).toBe("Jane Doe");
  });

  test("dm labels are cyan and ids recede to dim gray", async () => {
    setColorEnabled(true);
    const out = await captureStdout(() =>
      printDms([{ id: "1", type: 1, recipients: [{ id: "u", username: "alice" }] }], false),
    );
    expect(out).toContain("\x1b[96malice\x1b[0m"); // cyan label (the person)
    expect(out).toContain("\x1b[90m1\x1b[0m"); // dim id (technical, recedes)
  });

  test("channels (human): ▸ category + #names only — ids go to --json", async () => {
    setColorEnabled(true);
    const rows = [
      { id: "9", name: "ENGINEERING", type: 4, position: 0 },
      { id: "10", name: "deploys", type: 0, parent_id: "9", position: 0 },
    ];
    const out = await captureStdout(() => printChannels(rows, false));
    expect(out).toContain("\x1b[96m▸\x1b[0m"); // cyan section marker
    expect(out).toContain("\x1b[1mENGINEERING\x1b[0m"); // bold category title
    expect(out).toContain("#deploys"); // # shares the name's color
    expect(out).not.toContain("10"); // no snowflake id clutter in the human list

    const jsonOut = await captureStdout(() => printChannels(rows, true));
    expect(parseEnvelope(jsonOut).find((c: any) => c.name === "deploys").id).toBe("10"); // id still in --json
  });

  test("channels: topics align into a column within a group, and appear in --json", async () => {
    const rows = [
      { id: "9", name: "ENG", type: 4, position: 0 },
      { id: "10", name: "deploys", type: 0, parent_id: "9", position: 0, topic: "release coordination" },
      { id: "11", name: "a", type: 0, parent_id: "9", position: 1, topic: "short name" },
    ];
    const out = await captureStdout(() => printChannels(rows, false));
    const lines = out.split("\n").filter((l) => l.includes("release coordination") || l.includes("short name"));
    // Both topics start at the same visible column (aligned to the widest name).
    const col = (l: string, t: string) => Bun.stringWidth(l.slice(0, l.indexOf(t)));
    expect(col(lines[0], "release coordination")).toBe(col(lines[1], "short name"));

    const jsonOut = await captureStdout(() => printChannels(rows, true));
    expect(parseEnvelope(jsonOut).find((c: any) => c.name === "deploys").topic).toBe("release coordination");
  });
});

describe("printGuilds", () => {
  const guilds = [
    { id: "1", name: "Acme", owner: true, approximate_member_count: 1234 },
    { id: "2", name: "Globex", approximate_member_count: 88 },
  ];

  test("human: name + 👑 owner + compact member count, no id", async () => {
    const out = await captureStdout(() => printGuilds(guilds, false));
    expect(out).toContain("Acme 👑");
    expect(out).toContain("1.2k members");
    expect(out).toContain("88 members");
    expect(out).not.toContain("👑\n  Globex"); // Globex isn't owned → no crown
    expect(out).not.toContain(" 1\n"); // no snowflake id column
  });

  test("--json carries id, owner, and member_count", async () => {
    const out = await captureStdout(() => printGuilds(guilds, true));
    const data = parseEnvelope(out);
    expect(data[0]).toEqual({ id: "1", name: "Acme", owner: true, member_count: 1234 });
    expect(data[1]).toEqual({ id: "2", name: "Globex", owner: false, member_count: 88 });
  });
});

describe("printJson", () => {
  test("always emits the { data } envelope", async () => {
    const out = await captureStdout(() => printJson({ a: 1 }));
    expect(JSON.parse(out)).toEqual({ data: { a: 1 } });
  });
});
