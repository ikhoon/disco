// Discord REST API v10 client: auth header by token type, 429 + 202 retry, defensive parsing.

import type { Credential } from "./auth.ts";
import { debug } from "./log.ts";
import { VERSION } from "./version.ts";

const API_BASE = "https://discord.com/api/v10";

// Discord's Cloudflare edge blocks requests without a valid User-Agent.
// User tokens must look like a real browser; bot tokens use the mandated format.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BOT_UA = `DiscordBot (https://github.com/ikhoon/disco, ${VERSION})`;

export class DiscordError extends Error {
  constructor(
    public status: number,
    public code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

export interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Max automatic retries for 429 (rate limit) and 202 (search index building). */
  maxRetries?: number;
}

export class DiscordClient {
  constructor(public cred: Credential) {}

  get isBot(): boolean {
    return this.cred.bot;
  }

  private headers(hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: this.cred.bot ? `Bot ${this.cred.token}` : this.cred.token,
      "User-Agent": this.cred.bot ? BOT_UA : BROWSER_UA,
      Accept: "application/json",
    };
    if (hasBody) h["Content-Type"] = "application/json";
    return h;
  }

  async request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(API_BASE + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    const method = opts.method ?? "GET";
    const hasBody = opts.body !== undefined;
    const maxRetries = opts.maxRetries ?? 5;

    let attempt = 0;
    while (true) {
      attempt++;
      debug(`→ ${method} ${url.pathname}${url.search}`);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: this.headers(hasBody),
          body: hasBody ? JSON.stringify(opts.body) : undefined,
        });
      } catch (e) {
        throw new DiscordError(0, undefined, `network error: ${(e as Error).message}`);
      }

      // Retryable: 429 rate limit, and 202 "search index not yet available".
      if (res.status === 429 || res.status === 202) {
        const data = await this.readBody(res);
        const hasRetryHint = data && typeof data.retry_after === "number";
        if (res.status === 202 && !hasRetryHint) {
          // A 202 with no retry hint: treat the body as the payload.
          return (data ?? {}) as T;
        }
        if (attempt > maxRetries) {
          const what = res.status === 429 ? "rate limited" : "search index not ready";
          throw new DiscordError(res.status, data?.code, `${what} — gave up after ${attempt} attempts`);
        }
        const wait = this.retryAfterSeconds(res, data);
        const kind =
          res.status === 429 ? (data?.global ? "global rate limit" : "rate limit") : "index building";
        debug(`  ${res.status} ${kind}; waiting ${wait}s (attempt ${attempt}/${maxRetries})`);
        await Bun.sleep(Math.ceil(wait * 1000) + 50);
        continue;
      }

      if (res.ok) {
        return (await this.readBody(res)) as T;
      }

      // Non-retryable. 401/403 are NOT retried — repeated invalid requests risk a Cloudflare IP ban.
      throw await this.toError(res);
    }
  }

  private retryAfterSeconds(res: Response, data: any): number {
    if (data && typeof data.retry_after === "number" && data.retry_after >= 0) {
      return data.retry_after || 1;
    }
    const header = res.headers.get("retry-after");
    const n = header ? Number(header) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** Read+parse a response body once. Non-JSON bodies (Cloudflare pages) return a marker. */
  private async readBody(res: Response): Promise<any> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { __nonjson: text.slice(0, 200) };
    }
  }

  private async toError(res: Response): Promise<DiscordError> {
    const data = await this.readBody(res);
    if (data && data.__nonjson !== undefined) {
      return new DiscordError(
        res.status,
        undefined,
        `HTTP ${res.status}: non-JSON response — likely a Cloudflare block (bad token or User-Agent). Body: ${data.__nonjson}`,
      );
    }
    const code: number | undefined = data?.code;
    const apiMsg: string = data?.message ?? `HTTP ${res.status}`;
    switch (res.status) {
      case 401:
        return new DiscordError(401, code, `unauthorized (401) — token missing/invalid/expired. Run \`disco auth set\`. (${apiMsg})`);
      case 403:
        return new DiscordError(403, code, `forbidden (403) — no access, or a user-only endpoint called with a bot token. (${apiMsg})`);
      case 404:
        return new DiscordError(404, code, `not found (404) — check the channel/message/guild ID. (${apiMsg})`);
      default:
        return new DiscordError(res.status, code, `HTTP ${res.status}: ${apiMsg}${code ? ` (code ${code})` : ""}`);
    }
  }
}
