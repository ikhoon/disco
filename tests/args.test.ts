import { describe, expect, test } from "bun:test";
import { parseArgs, posInt, str } from "../src/args.ts";

describe("parseArgs", () => {
  test("splits positionals and flags", () => {
    const a = parseArgs(["channel", "123", "--days", "7"]);
    expect(a._).toEqual(["channel", "123"]);
    expect(a.flags.days).toBe("7");
  });

  test("boolean flags never consume the next argument", () => {
    // Regression guard: `completions --install zsh` must keep "zsh" positional.
    const a = parseArgs(["completions", "--install", "zsh"]);
    expect(a.flags.install).toBe(true);
    expect(a._).toEqual(["completions", "zsh"]);
    const b = parseArgs(["search", "--json", "deploy failed"]);
    expect(b.flags.json).toBe(true);
    expect(b._).toEqual(["search", "deploy failed"]);
  });

  test("--no-color is boolean and never consumes the next argument", () => {
    const a = parseArgs(["channel", "--no-color", "123"]);
    expect(a.flags["no-color"]).toBe(true);
    expect(a._).toEqual(["channel", "123"]);
  });

  test("value flags take the next argument (--shell zsh)", () => {
    const a = parseArgs(["completions", "--shell", "zsh"]);
    expect(a.flags.shell).toBe("zsh");
    expect(a._).toEqual(["completions"]);
  });

  test("--key=value works for value and boolean flags", () => {
    const a = parseArgs(["--sort=relevance", "--json=false", "--bot=1"]);
    expect(a.flags.sort).toBe("relevance");
    expect(a.flags.json).toBe(false);
    expect(a.flags.bot).toBe(true);
  });

  test("short flags map to their long names", () => {
    const a = parseArgs(["-v", "-q", "mention"]);
    expect(a.flags.verbose).toBe(true);
    expect(a.flags.quiet).toBe(true);
    expect(a._).toEqual(["mention"]);
  });

  test("`--` ends flag parsing", () => {
    const a = parseArgs(["search", "--", "--not-a-flag"]);
    expect(a._).toEqual(["search", "--not-a-flag"]);
    expect(a.flags["not-a-flag"]).toBeUndefined();
  });

  test("negative numbers are positionals, not short flags", () => {
    const a = parseArgs(["message", "-123"]);
    expect(a._).toEqual(["message", "-123"]);
  });

  test("a trailing value flag without a value becomes true", () => {
    const a = parseArgs(["mention", "--guild"]);
    expect(a.flags.guild).toBe(true); // posInt/str() then reject/ignore it downstream
  });

  test("value flags never swallow a following flag (--shell -h)", () => {
    const a = parseArgs(["completions", "--shell", "-h"]);
    expect(a.flags.shell).toBe(true);
    expect(a.flags.help).toBe(true);
    const b = parseArgs(["mention", "--guild", "--json"]);
    expect(b.flags.guild).toBe(true);
    expect(b.flags.json).toBe(true);
  });

  test("negative numbers and the bare stdin marker still count as values", () => {
    expect(parseArgs(["--offset", "-1"]).flags.offset).toBe("-1");
    expect(parseArgs(["--token", "-"]).flags.token).toBe("-");
  });
});

describe("posInt", () => {
  test("passes through undefined and parses positives", () => {
    expect(posInt(undefined, "days")).toBeUndefined();
    expect(posInt("7", "days")).toBe(7);
  });

  test.each(["0", "-3", "1.5", "abc", true])("rejects %p", (v) => {
    expect(() => posInt(v as any, "limit")).toThrow(/--limit must be a positive integer/);
  });
});

describe("str", () => {
  test("returns only real string values", () => {
    expect(str("x")).toBe("x");
    expect(str(true)).toBeUndefined();
    expect(str(undefined)).toBeUndefined();
  });
});
