import { describe, expect, test } from "bun:test";

// Runs the privacy guard as part of `bun test` (and therefore CI), so a real
// Discord id or non-example email can never land in the repo unnoticed again.
describe("privacy guard", () => {
  test("no real Discord ids or non-example emails in tracked files", async () => {
    const proc = Bun.spawn(["bun", "run", "scripts/check-no-real-data.ts"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    const err = await new Response(proc.stderr).text();
    if (code !== 0) throw new Error(err.trim());
    expect(code).toBe(0);
  });
});
