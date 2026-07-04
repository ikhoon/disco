import { describe, expect, test } from "bun:test";
import { parseRef, parseTime, permalink, snowflakeToDate, dateToSnowflake } from "../src/util.ts";

describe("parseRef", () => {
  test("parses a message URL into guild/channel/message", () => {
    const ref = parseRef("https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333");
    expect(ref).toEqual({
      guildId: "111111111111111111",
      channelId: "222222222222222222",
      messageId: "333333333333333333",
    });
  });

  test("parses a channel URL (no message part)", () => {
    const ref = parseRef("https://discord.com/channels/111111111111111111/222222222222222222");
    expect(ref).toEqual({
      guildId: "111111111111111111",
      channelId: "222222222222222222",
      messageId: undefined,
    });
  });

  test("maps the @me pseudo-guild (DMs) to a null guild", () => {
    const ref = parseRef("https://discord.com/channels/@me/222222222222222222/333333333333333333");
    expect(ref?.guildId).toBeNull();
    expect(ref?.channelId).toBe("222222222222222222");
  });

  test("accepts a bare snowflake as a channel id", () => {
    expect(parseRef("222222222222222222")).toEqual({ guildId: null, channelId: "222222222222222222" });
  });

  test("rejects non-snowflake, non-URL input", () => {
    expect(parseRef("hello")).toBeNull();
    expect(parseRef("1234")).toBeNull(); // too short for a snowflake
  });
});

describe("parseTime", () => {
  test("parses relative windows (10m/2h/3d/1w)", () => {
    const cases: [string, number][] = [
      ["10m", 10 * 60_000],
      ["2h", 2 * 3_600_000],
      ["3d", 3 * 86_400_000],
      ["1w", 604_800_000],
    ];
    for (const [input, ms] of cases) {
      const got = parseTime(input).getTime();
      expect(Math.abs(Date.now() - ms - got)).toBeLessThan(2_000);
    }
  });

  test("parses an ISO date", () => {
    expect(parseTime("2026-06-01T09:00").getFullYear()).toBe(2026);
  });

  test("throws on garbage", () => {
    expect(() => parseTime("soon")).toThrow(/invalid time/);
  });
});

describe("snowflakes", () => {
  test("snowflake → date → snowflake round-trips to the same instant", () => {
    const id = "1102682965986258944";
    const date = snowflakeToDate(id);
    const back = snowflakeToDate(dateToSnowflake(date));
    expect(back.getTime()).toBe(date.getTime());
  });
});

describe("permalink", () => {
  test("uses @me for null guilds", () => {
    expect(permalink(null, "2", "3")).toBe("https://discord.com/channels/@me/2/3");
    expect(permalink("1", "2", "3")).toBe("https://discord.com/channels/1/2/3");
  });
});
