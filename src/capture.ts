// User-token acquisition for `disco auth login`.
//
// Primary path: assisted browser capture via the Chrome DevTools Protocol. We
// launch a Chromium-family browser (isolated throwaway profile) to Discord's
// login page; the user logs in THEMSELVES and we passively observe the
// `authorization` header the browser sends to discord.com/api — i.e. we automate
// the documented "DevTools → copy the header" step, never a programmatic login.
// Fallbacks: a guided manual paste and reading the clipboard (pbpaste).
//
// The token is never logged (not even under --verbose) — it goes straight to the
// caller, which validates it via /users/@me and stores it in the Keychain.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { DiscordError } from "./client.ts";
import { info } from "./log.ts";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const AUTH_GUIDE = [
  "Log in to Discord in the browser, then:",
  "  1. open DevTools (⌥⌘I) → Network tab",
  "  2. click any channel to trigger a request",
  "  3. pick a request to discord.com/api and copy the `authorization` request-header value",
].join("\n");

// ---- pure token extraction (unit-tested) ------------------------------------

/**
 * Given a request URL and its headers, return the raw Discord USER token if this
 * is a discord.com/api request carrying an `authorization` header that is a bare
 * user token (not a `Bot …` or OAuth `Bearer …` credential); else null.
 */
export function extractUserToken(url: string, headers: Record<string, unknown>): string | null {
  if (!url.startsWith("https://discord.com/api/")) return null;
  let auth: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization" && typeof v === "string") {
      auth = v;
      break;
    }
  }
  const token = auth?.trim();
  if (!token) return null;
  if (/^Bot\s/i.test(token) || /^Bearer\s/i.test(token)) return null;
  return token;
}

function lowerKeys(h: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/**
 * Merges CDP `Network.requestWillBeSent` (carries the URL + request headers) and
 * `Network.requestWillBeSentExtraInfo` (carries headers that sometimes arrive
 * separately) by requestId, in any arrival order. Returns the token the first
 * time a merged entry yields one.
 */
export class RequestHeaderCollector {
  private byId = new Map<string, { url?: string; headers: Record<string, unknown> }>();

  feed(msg: { method?: string; params?: any }): string | null {
    if (msg.method !== "Network.requestWillBeSent" && msg.method !== "Network.requestWillBeSentExtraInfo") {
      return null;
    }
    const p = msg.params ?? {};
    const id = p.requestId;
    if (typeof id !== "string") return null;

    const entry = this.byId.get(id) ?? { headers: {} };
    if (msg.method === "Network.requestWillBeSent") {
      if (typeof p.request?.url === "string") entry.url = p.request.url;
      Object.assign(entry.headers, lowerKeys(p.request?.headers ?? {}));
    } else {
      Object.assign(entry.headers, lowerKeys(p.headers ?? {}));
    }
    this.byId.set(id, entry);

    return entry.url ? extractUserToken(entry.url, entry.headers) : null;
  }
}

// ---- browser discovery (unit-tested) ----------------------------------------

export class BrowserNotFoundError extends Error {}

export interface BrowserCandidate {
  name: string;
  path: string;
}

// Chromium-family browsers with reliable --remote-debugging-port + --user-data-dir
// on macOS. Arc is excluded (flaky with those flags) but reachable via --browser-path.
export const BROWSER_CANDIDATES: BrowserCandidate[] = [
  { name: "Google Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { name: "Chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
  { name: "Brave Browser", path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
  { name: "Microsoft Edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
];

/** Explicit path wins (errors if missing); else the first installed candidate; else throw. */
export function findBrowser(
  explicitPath?: string,
  candidates: BrowserCandidate[] = BROWSER_CANDIDATES,
): BrowserCandidate {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new DiscordError(0, undefined, `no browser found at --browser-path "${explicitPath}".`);
    }
    return { name: basename(explicitPath), path: explicitPath };
  }
  for (const c of candidates) if (existsSync(c.path)) return c;
  throw new BrowserNotFoundError("no supported browser found (Google Chrome, Chromium, Brave, or Microsoft Edge).");
}

// ---- CDP capture ------------------------------------------------------------

/** Poll the DevToolsActivePort file the browser writes into its profile dir. */
async function readDevToolsPort(profileDir: string): Promise<number> {
  const file = join(profileDir, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    try {
      const first = readFileSync(file, "utf8").split("\n")[0]?.trim();
      const port = first ? Number(first) : NaN;
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      /* not written yet */
    }
    await sleep(100);
  }
  throw new DiscordError(0, undefined, "the browser did not expose a debugging port.");
}

/** Find the page target's WebSocket debugger URL (127.0.0.1 passes CDP's Host check). */
async function findPageTarget(port: number): Promise<string> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      if (res.ok) {
        const targets = (await res.json()) as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
        const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
        const page = pages.find((t) => (t.url ?? "").includes("discord.com")) ?? pages[0];
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      /* endpoint not ready */
    }
    await sleep(100);
  }
  throw new DiscordError(0, undefined, "could not find the Discord tab in the browser.");
}

/**
 * Launch a browser, wait for the user to log in, and resolve the raw user token
 * captured from the first discord.com/api request. Always cleans up the browser
 * process and the throwaway profile dir.
 */
export async function captureUserToken(opts: { browserPath?: string; timeoutMs?: number } = {}): Promise<string> {
  const browser = findBrowser(opts.browserPath);
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const profileDir = mkdtempSync(join(tmpdir(), "disco-cdp-"));

  let proc: Bun.Subprocess | undefined;
  let ws: WebSocket | undefined;
  let onSigint: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (onSigint) process.off("SIGINT", onSigint);
    onSigint = undefined;
    try {
      ws?.close();
    } catch {
      /* already closing */
    }
    ws = undefined;
    try {
      proc?.kill();
    } catch {
      /* already gone */
    }
    proc = undefined;
    // Removing the throwaway profile also wipes its on-disk copy of the session/token.
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  try {
    info(`Opening ${browser.name} — log in to Discord. Waiting for the token… (Ctrl-C to cancel)`);
    // Isolated profile → a separate instance even if the user's browser is open,
    // so kill()/cleanup never touches their real session.
    proc = Bun.spawn(
      [
        browser.path,
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "https://discord.com/login",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );

    const port = await readDevToolsPort(profileDir);
    const wsUrl = await findPageTarget(port);

    return await new Promise<string>((resolve, reject) => {
      onSigint = () => reject(new DiscordError(0, undefined, "cancelled."));
      process.once("SIGINT", onSigint);
      timer = setTimeout(
        () => reject(new DiscordError(0, undefined, "timed out waiting for login (3 min).")),
        timeoutMs,
      );
      proc!.exited.then(() =>
        reject(new DiscordError(0, undefined, "the browser closed before a token was captured.")),
      );

      const collector = new RequestHeaderCollector();
      ws = new WebSocket(wsUrl);
      ws.addEventListener("open", () => ws!.send(JSON.stringify({ id: 1, method: "Network.enable" })));
      ws.addEventListener("message", (ev: MessageEvent) => {
        let msg: any;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        const token = collector.feed(msg);
        if (token) resolve(token);
      });
      ws.addEventListener("error", () =>
        reject(new DiscordError(0, undefined, "lost the debugging connection to the browser.")),
      );
    });
  } finally {
    cleanup();
  }
}

// ---- manual / clipboard fallbacks -------------------------------------------

/** Open Discord in the default browser, print the DevTools steps, read one pasted line. */
export async function manualPasteToken(): Promise<string> {
  if (process.stderr.isTTY) {
    try {
      Bun.spawn(["open", "https://discord.com/app"], { stdout: "ignore", stderr: "ignore" });
    } catch {
      /* `open` unavailable — the printed URL still guides the user */
    }
  }
  info(AUTH_GUIDE);

  if (!process.stdin.isTTY) {
    throw new DiscordError(
      0,
      undefined,
      "no terminal to read from — run `disco auth login` interactively, use --clipboard, or `disco auth set --token <t>`.",
    );
  }
  process.stderr.write("Paste the authorization header value, then press Enter: ");
  const rl = createInterface({ input: process.stdin });
  try {
    const line = await new Promise<string>((resolve) => rl.once("line", resolve));
    return line.trim();
  } finally {
    rl.close();
  }
}

/** Read the token from the macOS clipboard. */
export async function clipboardToken(): Promise<string> {
  try {
    const proc = Bun.spawn(["pbpaste"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) {
      throw new DiscordError(0, undefined, "could not read the clipboard (pbpaste failed).");
    }
    const token = out.trim();
    if (!token) throw new DiscordError(0, undefined, "the clipboard is empty.");
    return token;
  } catch (e) {
    if (e instanceof DiscordError) throw e;
    throw new DiscordError(0, undefined, "could not read the clipboard (pbpaste unavailable).");
  }
}
