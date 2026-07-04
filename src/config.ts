// User config, stored at ~/.config/disco/config.json (optional; sane defaults without it).

import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Default guild (server) ID used by `search` / `mention` when --guild is omitted. */
  default_guild?: string;
  /** Cached ID of the authenticated user (filled in by `auth`). */
  user_id?: string;
  /** Author IDs to drop from mention/search results (bots, noisy integrations). */
  exclude_user_ids?: string[];
}

export function configDir(): string {
  return join(homedir(), ".config", "disco");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export async function loadConfig(): Promise<Config> {
  const file = Bun.file(configPath());
  if (!(await file.exists())) return {};
  try {
    const data = (await file.json()) as Config;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  await Bun.write(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}
