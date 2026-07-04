// macOS Keychain token storage via the `security` CLI.
// The token is stored as a generic password under the service name below.

const SERVICE = "disco";

function account(): string {
  return Bun.env.USER || "disco";
}

const UNAVAILABLE = "keychain unavailable on this platform (macOS `security` not found) — use the DISCORD_TOKEN env var instead.";

/** Distinguishes an intentional failure (non-zero exit) from a synchronous spawn error. */
class KeychainError extends Error {}

/** Read the stored secret, or null if none / not on macOS. */
export async function keychainGet(): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", SERVICE, "-a", account(), "-w"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    const trimmed = out.trim();
    return trimmed.length ? trimmed : null;
  } catch {
    // `security` binary absent (non-macOS): honor the "null if not on macOS" contract.
    return null;
  }
}

/** Store (or overwrite) the secret. */
export async function keychainSet(value: string): Promise<void> {
  try {
    const proc = Bun.spawn(
      ["security", "add-generic-password", "-s", SERVICE, "-a", account(), "-w", value, "-U"],
      { stdout: "ignore", stderr: "pipe" },
    );
    const code = await proc.exited;
    if (code !== 0) {
      const err = (await new Response(proc.stderr).text()).trim();
      throw new KeychainError(`keychain store failed: ${err || `exit ${code}`}`);
    }
  } catch (e) {
    if (e instanceof KeychainError) throw e;
    // Bun.spawn throws synchronously (ENOENT) when `security` is absent.
    throw new Error(UNAVAILABLE);
  }
}

/** Delete the stored secret (no-op if absent). */
export async function keychainClear(): Promise<void> {
  try {
    const proc = Bun.spawn(
      ["security", "delete-generic-password", "-s", SERVICE, "-a", account()],
      { stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
  } catch {
    /* nothing to clear on a platform without `security` */
  }
}
