import { describe, expect, test, afterEach } from "bun:test";
import { DiscordClient, DiscordError } from "../src/client.ts";

// Mock the global fetch with a scripted sequence of responses and record every
// request, so the retry/backoff/no-retry invariants are pinned down without
// touching the network.

interface Scripted {
  status: number;
  body?: unknown;
  text?: string; // raw non-JSON body
  headers?: Record<string, string>;
}

const originalFetch = globalThis.fetch;

function scriptFetch(responses: Scripted[]): { requests: { url: URL; init: RequestInit }[] } {
  const requests: { url: URL; init: RequestInit }[] = [];
  let i = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    requests.push({ url: new URL(String(input)), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    const text = r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return new Response(text, { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { requests };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const user = () => new DiscordClient({ token: "user-token", bot: false });
const bot = () => new DiscordClient({ token: "bot-token", bot: true });

describe("DiscordClient auth headers", () => {
  test("user tokens are sent raw with a browser User-Agent", async () => {
    const { requests } = scriptFetch([{ status: 200, body: { id: "1" } }]);
    await user().request("/users/@me");
    const h = requests[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("user-token");
    expect(h["User-Agent"]).toContain("Mozilla/5.0");
  });

  test("bot tokens get the Bot prefix and the DiscordBot User-Agent", async () => {
    const { requests } = scriptFetch([{ status: 200, body: { id: "1" } }]);
    await bot().request("/users/@me");
    const h = requests[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bot bot-token");
    expect(h["User-Agent"]).toMatch(/^DiscordBot \(https:\/\/github\.com\/ikhoon\/disco, \d+\.\d+\.\d+\)$/);
  });
});

describe("DiscordClient query building", () => {
  test("drops undefined/null/empty params and stringifies the rest", async () => {
    const { requests } = scriptFetch([{ status: 200, body: [] }]);
    await user().request("/x", { query: { limit: 100, before: undefined, guild_id: null, q: "", keep: "y" } });
    expect(requests[0].url.search).toBe("?limit=100&keep=y");
  });
});

describe("DiscordClient retries", () => {
  test("429 waits retry_after then retries to success", async () => {
    const { requests } = scriptFetch([
      { status: 429, body: { retry_after: 0.01 } },
      { status: 200, body: { ok: true } },
    ]);
    const out = await user().request<{ ok: boolean }>("/c");
    expect(out.ok).toBe(true);
    expect(requests.length).toBe(2);
  });

  test("202 with retry_after (search index building) retries", async () => {
    const { requests } = scriptFetch([
      { status: 202, body: { retry_after: 0.01 } },
      { status: 200, body: { total_results: 0, messages: [] } },
    ]);
    const out = await user().request<any>("/guilds/1/messages/search");
    expect(out.total_results).toBe(0);
    expect(requests.length).toBe(2);
  });

  test("202 without a retry hint is returned as the payload", async () => {
    const { requests } = scriptFetch([{ status: 202, body: { messages: [] } }]);
    const out = await user().request<any>("/g");
    expect(out.messages).toEqual([]);
    expect(requests.length).toBe(1);
  });

  test("gives up after maxRetries with a clear error", async () => {
    const { requests } = scriptFetch([{ status: 429, body: { retry_after: 0.01 } }]);
    await expect(user().request("/c", { maxRetries: 2 })).rejects.toThrow(/rate limited — gave up/);
    expect(requests.length).toBe(3); // initial + 2 retries
  });
});

describe("DiscordClient non-retryable errors", () => {
  // Repeated invalid requests risk Discord's Cloudflare IP ban — 401/403 must
  // fail on the FIRST attempt, never retry.
  test.each([401, 403])("%i is never retried", async (status) => {
    const { requests } = scriptFetch([{ status, body: { message: "nope", code: 0 } }]);
    const err = await user().request("/c").catch((e) => e);
    expect(err).toBeInstanceOf(DiscordError);
    expect(err.status).toBe(status);
    expect(requests.length).toBe(1);
  });

  test("401 message points at `disco auth set`", async () => {
    scriptFetch([{ status: 401, body: { message: "401: Unauthorized" } }]);
    await expect(user().request("/c")).rejects.toThrow(/disco auth set/);
  });

  test("404 includes guidance about IDs", async () => {
    scriptFetch([{ status: 404, body: { message: "Unknown Channel", code: 10003 } }]);
    await expect(user().request("/c")).rejects.toThrow(/not found \(404\)/);
  });

  test("non-JSON body (Cloudflare block page) surfaces a helpful marker", async () => {
    scriptFetch([{ status: 403, text: "<html>blocked</html>" }]);
    await expect(user().request("/c")).rejects.toThrow(/non-JSON response — likely a Cloudflare block/);
  });

  test("network failure wraps into a DiscordError", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(user().request("/c")).rejects.toThrow(/network error: connect ECONNREFUSED/);
  });
});
