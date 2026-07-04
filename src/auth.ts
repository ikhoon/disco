// Credential resolution: environment variable takes precedence, then the Keychain.

import { keychainGet, keychainSet, keychainClear } from "./keychain.ts";

export interface Credential {
  token: string;
  /** true → send "Bot <token>"; false → send the raw user token. */
  bot: boolean;
}

function envBot(): boolean {
  const v = (Bun.env.DISCORD_BOT || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Resolve the active credential.
 *   DISCORD_TOKEN (env) → Keychain.
 * `optBot` (from a --bot flag) overrides the stored/env bot-ness when provided.
 */
export async function resolveCredential(optBot?: boolean): Promise<Credential | null> {
  const envToken = Bun.env.DISCORD_TOKEN;
  if (envToken && envToken.trim()) {
    return { token: envToken.trim(), bot: optBot ?? envBot() };
  }

  const stored = await keychainGet();
  if (!stored) return null;

  // Stored as JSON {token, bot}; fall back to a bare token string for forward compat.
  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed.token === "string") {
      return { token: parsed.token, bot: optBot ?? !!parsed.bot };
    }
  } catch {
    /* not JSON — treat the whole value as a raw token */
  }
  return { token: stored, bot: optBot ?? false };
}

export async function storeCredential(cred: Credential): Promise<void> {
  await keychainSet(JSON.stringify(cred));
}

export async function clearCredential(): Promise<void> {
  await keychainClear();
}
