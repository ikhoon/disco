// Resolve a channel reference from a URL, a bare snowflake, or a human name:
//   "general"            → a channel named "general" (in the default guild, else any)
//   "Acme/general"       → "general" in a server whose name matches "Acme"
//   "My Team/general"    → spaces are fine (quote it, or leave it unquoted)
// A URL or snowflake resolves with no network calls; a name lists your servers
// and their channels to find the match.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DiscordClient, DiscordError } from "./client.ts";
import type { DiscordGuild, DiscordChannel } from "./types.ts";
import { parseRef, type DiscordRef } from "./util.ts";
import { debug, info } from "./log.ts";

// Name→channel resolutions are cached to a local file: channels change rarely, so
// a bare name that fanned out across every server the first time is instant after.
const DEFAULT_CACHE_PATH = join(homedir(), ".config", "disco", "channel-cache.json");

type CacheEntry = { guildId: string | null; channelId: string };

function loadCache(path: string): Record<string, CacheEntry> {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveCache(path: string, cache: Record<string, CacheEntry>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2) + "\n");
  } catch {
    /* best effort — a missing cache just means the next lookup re-fetches */
  }
}

export interface ResolveOpts {
  defaultGuild?: string;
  /** Ignore (and overwrite) any cached entry for this name. */
  refresh?: boolean;
  /** Override the cache file location (tests). */
  cachePath?: string;
}

/** Resolve `input` to a channel ref, looking it up by name when it isn't a URL/ID. */
export async function resolveChannelRef(
  input: string,
  client: DiscordClient,
  opts: ResolveOpts = {},
): Promise<DiscordRef> {
  const { defaultGuild, refresh = false, cachePath = DEFAULT_CACHE_PATH } = opts;

  // 1. A URL or bare snowflake resolves directly — no lookup.
  const direct = parseRef(input);
  if (direct) return direct;

  // A URL-looking input that parseRef couldn't handle is a malformed link, not a
  // channel name — say so instead of trying to look up a "server" like the host.
  if (/^https?:\/\//i.test(input) || input.includes("discord.com/")) {
    throw new DiscordError(
      0,
      undefined,
      `could not parse "${input}" as a Discord URL — expected .../channels/<guild>/<channel>[/<message>].`,
    );
  }

  // 2. Name lookup lists your servers, so it needs a user token — reject bots
  //    before touching the cache (a bot never does name resolution at all).
  if (client.isBot) {
    throw new DiscordError(
      0,
      undefined,
      `name lookup ("${input}") needs a user token (it lists your servers). Use a channel ID or URL with a bot token.`,
    );
  }

  // 3. A previously-resolved name returns instantly from the local cache.
  const cacheKey = input.trim().toLowerCase();
  if (!refresh) {
    const hit = loadCache(cachePath)[cacheKey];
    if (hit) {
      debug(`resolved "${cacheKey}" from cache → ${hit.channelId}`);
      return { guildId: hit.guildId, channelId: hit.channelId };
    }
  }

  // 4. Split "server/channel" on the LAST slash (server names may contain spaces,
  //    not slashes). A leading '#' on the channel is accepted and stripped.
  const slash = input.lastIndexOf("/");
  const guildQuery = (slash >= 0 ? input.slice(0, slash) : "").trim().toLowerCase();
  const channelQuery = (slash >= 0 ? input.slice(slash + 1) : input).trim().replace(/^#/, "").toLowerCase();
  if (!channelQuery) {
    throw new DiscordError(0, undefined, `could not read "${input}" as a URL, ID, or channel name.`);
  }

  // 5. Choose which server(s) to search.
  const guilds = await client.request<DiscordGuild[]>("/users/@me/guilds", { query: { limit: 200 } });
  let searchIn: DiscordGuild[];
  if (guildQuery) {
    const exact = guilds.filter((g) => g.name.toLowerCase() === guildQuery);
    searchIn = exact.length ? exact : guilds.filter((g) => g.name.toLowerCase().includes(guildQuery));
    if (!searchIn.length) throw new DiscordError(0, undefined, `no server matching "${guildQuery}".`);
  } else if (defaultGuild && guilds.some((g) => g.id === defaultGuild)) {
    searchIn = guilds.filter((g) => g.id === defaultGuild);
  } else {
    searchIn = guilds; // no hint → scan every server
    if (guilds.length > 1) {
      info(`looking up "#${channelQuery}" across ${guilds.length} servers… (set default_guild or use "server/${channelQuery}" to narrow)`);
    }
  }

  // 6. Collect channels named channelQuery (case-insensitive), skipping categories.
  const matches: { guild: DiscordGuild; channel: DiscordChannel }[] = [];
  for (const g of searchIn) {
    let channels: DiscordChannel[];
    try {
      channels = await client.request<DiscordChannel[]>(`/guilds/${g.id}/channels`);
    } catch (e) {
      debug(`  channels in "${g.name}" (${g.id}) skipped: ${(e as Error).message}`);
      continue;
    }
    for (const c of channels) {
      if (c.type === 4) continue; // category
      if ((c.name ?? "").toLowerCase() === channelQuery) matches.push({ guild: g, channel: c });
    }
  }

  if (matches.length === 0) {
    throw new DiscordError(
      0,
      undefined,
      `no channel named "#${channelQuery}"${guildQuery ? ` in a server matching "${guildQuery}"` : ""}.`,
    );
  }
  if (matches.length > 1) {
    const list = matches.map((m) => `  ${m.guild.name} / #${m.channel.name}  ${m.channel.id}`).join("\n");
    throw new DiscordError(
      0,
      undefined,
      `"#${channelQuery}" matches ${matches.length} channels — narrow it with "server/${channelQuery}" or a channel id:\n${list}`,
    );
  }
  const ref = { guildId: matches[0].guild.id, channelId: matches[0].channel.id };
  // 7. Remember it so this name resolves instantly next time.
  const cache = loadCache(cachePath);
  cache[cacheKey] = ref;
  saveCache(cachePath, cache);
  return ref;
}

/**
 * Resolve a server reference — a guild id, a channel URL's guild, or a server
 * NAME — to a guild id. Names match case-insensitively (exact wins over
 * substring); ambiguity and misses error clearly. Bots must pass an id.
 */
export async function resolveGuild(input: string, client: DiscordClient): Promise<string> {
  const t = input.trim();
  if (/^\d{15,25}$/.test(t)) return t;
  const urlGuild = t.match(/channels\/(\d+)/)?.[1];
  if (urlGuild) return urlGuild;

  if (client.isBot) {
    throw new DiscordError(
      0,
      undefined,
      `looking up a server by name ("${input}") needs a user token — pass a guild id with a bot token.`,
    );
  }
  const q = t.toLowerCase();
  const guilds = await client.request<DiscordGuild[]>("/users/@me/guilds", { query: { limit: 200 } });
  const exact = guilds.filter((g) => g.name.toLowerCase() === q);
  const matches = exact.length ? exact : guilds.filter((g) => g.name.toLowerCase().includes(q));
  if (matches.length === 0) throw new DiscordError(0, undefined, `no server matching "${input}".`);
  if (matches.length > 1) {
    const list = matches.map((g) => `  ${g.name}`).join("\n");
    throw new DiscordError(0, undefined, `"${input}" matches ${matches.length} servers — use the exact name:\n${list}`);
  }
  return matches[0].id;
}
