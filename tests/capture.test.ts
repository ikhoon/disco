import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractUserToken,
  RequestHeaderCollector,
  findBrowser,
  BrowserNotFoundError,
  type BrowserCandidate,
} from "../src/capture.ts";

const API = "https://discord.com/api/v9/users/@me";
const USER_TOKEN = "MTAxMjM0NTY3ODkw.Gg1234.abcdefghijklmnopqrstuvwxyz0123";

describe("extractUserToken", () => {
  test("returns the raw token from a discord.com/api request", () => {
    expect(extractUserToken(API, { authorization: USER_TOKEN })).toBe(USER_TOKEN);
  });

  test("matches the header case-insensitively", () => {
    expect(extractUserToken(API, { Authorization: USER_TOKEN })).toBe(USER_TOKEN);
  });

  test("ignores bot and bearer credentials", () => {
    expect(extractUserToken(API, { authorization: `Bot ${USER_TOKEN}` })).toBeNull();
    expect(extractUserToken(API, { authorization: `Bearer ${USER_TOKEN}` })).toBeNull();
  });

  test("ignores non-/api/ requests (assets, cdn) and missing headers", () => {
    expect(extractUserToken("https://discord.com/assets/x.js", { authorization: USER_TOKEN })).toBeNull();
    expect(extractUserToken("https://cdn.discordapp.com/x.png", { authorization: USER_TOKEN })).toBeNull();
    expect(extractUserToken(API, {})).toBeNull();
    expect(extractUserToken(API, { authorization: "   " })).toBeNull();
  });
});

describe("RequestHeaderCollector", () => {
  const willBeSent = (requestId: string, url: string, headers: Record<string, unknown>) => ({
    method: "Network.requestWillBeSent",
    params: { requestId, request: { url, headers } },
  });
  const extraInfo = (requestId: string, headers: Record<string, unknown>) => ({
    method: "Network.requestWillBeSentExtraInfo",
    params: { requestId, headers },
  });

  test("resolves when the URL and the header arrive in the main event", () => {
    const c = new RequestHeaderCollector();
    expect(c.feed(willBeSent("1", API, { authorization: USER_TOKEN }))).toBe(USER_TOKEN);
  });

  test("merges a header that only arrives in extraInfo, even before the URL event", () => {
    const c = new RequestHeaderCollector();
    expect(c.feed(extraInfo("7", { authorization: USER_TOKEN }))).toBeNull(); // no URL yet
    expect(c.feed(willBeSent("7", API, {}))).toBe(USER_TOKEN); // URL completes the match
  });

  test("never resolves for unrelated requests or bearer tokens", () => {
    const c = new RequestHeaderCollector();
    expect(c.feed(willBeSent("2", "https://discord.com/assets/app.js", { authorization: USER_TOKEN }))).toBeNull();
    expect(c.feed(willBeSent("3", API, { authorization: `Bearer ${USER_TOKEN}` }))).toBeNull();
    expect(c.feed({ method: "Network.responseReceived", params: { requestId: "2" } })).toBeNull();
  });
});

describe("findBrowser", () => {
  test("returns the first installed candidate", () => {
    const dir = mkdtempSync(join(tmpdir(), "disco-fb-"));
    try {
      const path = join(dir, "Brave");
      writeFileSync(path, "");
      const candidates: BrowserCandidate[] = [
        { name: "Missing", path: join(dir, "nope") },
        { name: "Brave", path },
      ];
      expect(findBrowser(undefined, candidates)).toEqual({ name: "Brave", path });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an explicit path wins when it exists and errors when it doesn't", () => {
    const dir = mkdtempSync(join(tmpdir(), "disco-fb-"));
    try {
      const path = join(dir, "MyChrome");
      writeFileSync(path, "");
      expect(findBrowser(path, [])).toEqual({ name: "MyChrome", path });
      expect(() => findBrowser(join(dir, "ghost"), [])).toThrow(/--browser-path/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws BrowserNotFoundError when nothing is installed", () => {
    expect(() => findBrowser(undefined, [{ name: "X", path: "/nope/x" }])).toThrow(BrowserNotFoundError);
  });
});
