import { describe, expect, test } from "bun:test";
import { normalizeMessage, printMessages, printDms, printJson } from "../src/format.ts";
import { displayName, CHANNEL_TYPE, type DiscordMessage, type DiscordChannel } from "../src/types.ts";
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
    expect(out).toContain("    hello");
    expect(out).toContain("https://discord.com/channels/111/222/333");
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

  test("human mode marks group DMs and includes channel ids", async () => {
    const out = await captureStdout(() => printDms(channels, false));
    expect(out).toContain("@ alice  1");
    expect(out).toContain("👥 project  2");
  });
});

describe("printJson", () => {
  test("always emits the { data } envelope", async () => {
    const out = await captureStdout(() => printJson({ a: 1 }));
    expect(JSON.parse(out)).toEqual({ data: { a: 1 } });
  });
});
