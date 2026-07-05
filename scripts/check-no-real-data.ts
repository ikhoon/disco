#!/usr/bin/env bun
// Privacy guard: fail if real Discord data — snowflake ids or non-example emails —
// has snuck into the repo. Fixtures and examples must use FABRICATED values.
// Runs in CI via tests/no-real-data.test.ts, and can back a git pre-commit hook
// (`bun run hooks:install`). Exits non-zero and prints every offender.

import { $ } from "bun";

// A snowflake is fabricated (allowed) when it starts with five repeated digits
// (111…, 222…, 999…), starts with "955" (our placeholder prefix), or is one of
// the classic literals. Anything else that looks like a 17–19 digit id is flagged.
const isFakeSnowflake = (s: string): boolean =>
  /^(\d)\1{4}/.test(s) || s.startsWith("955") || s === "123456789012345678" || s === "1000000000000000000";

const SNOWFLAKE = /\b\d{17,19}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]*[\w]\b/g;
const isAllowedEmail = (s: string): boolean => /@(?:example\.(?:com|org|net)|anthropic\.com)$/i.test(s);

const SELF = "scripts/check-no-real-data.ts";
const files = (await $`git ls-files -- src tests demo completions scripts README.md`.text())
  .split("\n")
  .filter((f) => f && f !== SELF);

// Optional LOCAL denylist of real names/substrings that must never appear in
// tracked files (case-insensitive). It is gitignored, so the names themselves are
// never committed; when absent (e.g. in CI) the name check is skipped and the
// id/email checks still run. The pre-commit / Claude hooks run where it exists.
const denyFile = Bun.file(".privacy-denylist.txt");
const denyTerms = (await denyFile.exists())
  ? (await denyFile.text()).split("\n").map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith("#"))
  : [];

const problems: string[] = [];
for (const f of files) {
  const lines = (await Bun.file(f).text()).split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(SNOWFLAKE)) {
      if (!isFakeSnowflake(m[0])) problems.push(`${f}:${i + 1}  possible real Discord id: ${m[0]}`);
    }
    for (const m of line.matchAll(EMAIL)) {
      if (!isAllowedEmail(m[0])) problems.push(`${f}:${i + 1}  non-example email: ${m[0]}`);
    }
    if (denyTerms.length) {
      const lower = line.toLowerCase();
      // Don't echo the matched term — keeps the real name out of any CI/terminal
      // log; the file:line is enough to find and fix it.
      for (const term of denyTerms) {
        if (lower.includes(term)) problems.push(`${f}:${i + 1}  matches a forbidden name (see .privacy-denylist.txt)`);
      }
    }
  });
}

if (problems.length) {
  console.error(
    `\n✗ real-data guard FAILED — use fabricated placeholders (ids like 955…/111…, emails @example.com):\n\n` +
      problems.map((p) => `  ${p}`).join("\n") +
      `\n`,
  );
  process.exit(1);
}
console.log("✓ real-data guard: clean (no real Discord ids or non-example emails)");
