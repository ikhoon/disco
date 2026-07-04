// Tiny arg parser for the CLI entry — extracted from index.ts for testability.

import { DiscordError } from "./client.ts";

export interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

export const BOOL_FLAGS = new Set(["json", "verbose", "quiet", "bot", "help", "version", "simple", "install"]);
export const SHORT: Record<string, string> = { v: "verbose", q: "quiet", h: "help", V: "version" };

function coerceBool(v: string): boolean {
  const s = v.trim().toLowerCase();
  return !(s === "false" || s === "0" || s === "no" || s === "");
}

export function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let endOfFlags = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (endOfFlags) {
      _.push(a);
      continue;
    }
    if (a === "--") {
      endOfFlags = true; // everything after a bare `--` is a positional
      continue;
    }

    if (a.startsWith("--")) {
      let key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) {
        const val = key.slice(eq + 1);
        key = key.slice(0, eq);
        flags[key] = BOOL_FLAGS.has(key) ? coerceBool(val) : val;
      } else if (BOOL_FLAGS.has(key)) {
        flags[key] = true;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else if (a.length > 1 && a[0] === "-" && !/^-\d/.test(a)) {
      const short = a.slice(1);
      const key = SHORT[short] ?? short;
      if (BOOL_FLAGS.has(key)) {
        flags[key] = true;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

export function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Parse a positive-integer flag value; throws a clear error on 0, negatives, or non-numbers. */
export function posInt(v: string | boolean | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new DiscordError(0, undefined, `--${name} must be a positive integer (got "${String(v)}").`);
  }
  return n;
}
