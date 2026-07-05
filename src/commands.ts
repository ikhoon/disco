// Command implementations. Each takes a DiscordClient and prints to stdout (data) / stderr (logs).

import { DiscordClient, DiscordError } from "./client.ts";
import type { DiscordMessage, DiscordUser, DiscordGuild, DiscordChannel, SearchResponse } from "./types.ts";
import { displayName } from "./types.ts";
import { printMessages, printGuilds, printChannels, printDms, printNormalized, printJson, normalizeMessage } from "./format.ts";
import { info, debug, warn } from "./log.ts";
import { storeCredential, type Credential } from "./auth.ts";
import { captureUserToken, manualPasteToken, clipboardToken, BrowserNotFoundError } from "./capture.ts";

const MAX_PER_PAGE = 100; // /channels/{id}/messages and /users/@me/mentions cap
const SEARCH_PER_PAGE = 25; // search caps at 25
const SEARCH_OFFSET_MAX = 9975;
const HARD_MESSAGE_CAP = 1000; // safety cap for history/mention walking

function userOnly(feature: string): DiscordError {
  return new DiscordError(
    0,
    undefined,
    `\`${feature}\` requires a USER token — this is a user-only Discord endpoint that a bot token cannot use. Set one with \`disco auth set\`.`,
  );
}

// ---- whoami -----------------------------------------------------------------

export async function cmdWhoami(client: DiscordClient, json: boolean): Promise<void> {
  const me = await client.request<DiscordUser & { email?: string; verified?: boolean }>("/users/@me");
  if (json) {
    printJson(me);
    return;
  }
  const name = displayName(me);
  // Only add the @handle when it differs from the display name (avoids "ikhoon (@ikhoon)").
  const handle = me.username && me.username !== name ? ` (@${me.username})` : "";
  const kind = client.isBot ? "bot" : "user";
  info(`👤  ${name}${handle}  ·  ${kind} token`);
  info(`    ${"id".padEnd(5)}  ${me.id}`);
  if (me.email) info(`    ${"email".padEnd(5)}  ${me.email}`);
}

// ---- auth login -------------------------------------------------------------

export interface AuthLoginOpts {
  json: boolean;
  manual: boolean;
  clipboard: boolean;
  browserPath?: string;
  bot: boolean;
}

/**
 * `disco auth login` — obtain a USER token the easy way. Default: assisted
 * browser capture (CDP). Fallbacks: `--manual` guided paste, `--clipboard`.
 * All paths converge on `finishLogin` (validate via /users/@me, then store).
 */
export async function cmdAuthLogin(opts: AuthLoginOpts): Promise<void> {
  if (opts.bot) {
    throw new DiscordError(
      0,
      undefined,
      "`auth login` captures a USER token from your browser. For a bot token, use `disco auth set --token <t> --bot`.",
    );
  }
  // Reassure + stay honest: it's your own account and your own token.
  info("🔐  Signing in with your own Discord account.");
  info("    Your token never leaves this machine — stored encrypted in the macOS Keychain; disco only reads, never posts.");
  info("    ⚠️  Automating a user account is against Discord's ToS — your own account, your own risk.");

  let token: string;
  if (opts.clipboard) {
    token = await clipboardToken();
  } else if (opts.manual) {
    token = await manualPasteToken();
  } else {
    try {
      token = await captureUserToken({ browserPath: opts.browserPath });
    } catch (e) {
      if (e instanceof BrowserNotFoundError) {
        warn(`${e.message} — falling back to a manual paste.`);
        token = await manualPasteToken();
      } else {
        throw e;
      }
    }
  }
  await finishLogin(token, opts.json);
}

/** Validate a freshly captured token, then store it. Reuses cmdWhoami + storeCredential. */
async function finishLogin(raw: string, json: boolean): Promise<void> {
  const token = raw.trim();
  if (!token) throw new DiscordError(0, undefined, "no token captured.");
  const cred: Credential = { token, bot: false };
  info("✓  Token captured.");
  await cmdWhoami(new DiscordClient(cred), json); // validates via /users/@me; throws on 401
  await storeCredential(cred);
  info("🔑  Saved to the macOS Keychain — you're all set.");
}

// ---- guilds -----------------------------------------------------------------

export async function cmdGuilds(client: DiscordClient, json: boolean): Promise<DiscordGuild[]> {
  const guilds = await client.request<DiscordGuild[]>("/users/@me/guilds", { query: { limit: 200 } });
  printGuilds(guilds, json);
  return guilds;
}

// ---- channels ---------------------------------------------------------------

export async function cmdChannels(client: DiscordClient, guildId: string, json: boolean): Promise<void> {
  const channels = await client.request<DiscordChannel[]>(`/guilds/${guildId}/channels`);
  if (!json) info(`${channels.length} channel(s) in guild ${guildId}`);
  printChannels(channels, json);
}

// ---- dms ----------------------------------------------------------------------

export async function cmdDms(client: DiscordClient, json: boolean): Promise<void> {
  if (client.isBot) throw userOnly("dms");
  const channels = await client.request<DiscordChannel[]>("/users/@me/channels");
  // Most recently active first (last_message_id is a time-ordered snowflake).
  const key = (c: DiscordChannel) => BigInt(c.last_message_id ?? c.id);
  channels.sort((a, b) => (key(a) > key(b) ? -1 : key(a) < key(b) ? 1 : 0));
  if (!json) info(`${channels.length} DM channel(s)`);
  printDms(channels, json);
}

// ---- channel / thread history ----------------------------------------------

/** Look up a channel's guild so bare-ID queries still produce working permalinks (null for DMs). */
async function resolveGuildId(client: DiscordClient, channelId: string): Promise<string | null> {
  try {
    const ch = await client.request<DiscordChannel>(`/channels/${channelId}`);
    return ch.guild_id ?? null;
  } catch {
    return null;
  }
}

/** Walk /channels/{id}/messages backward (newest→oldest). Returns chronological order. */
async function fetchHistory(
  client: DiscordClient,
  channelId: string,
  opts: { since?: Date; limit?: number },
): Promise<DiscordMessage[]> {
  const all: DiscordMessage[] = [];
  let before: string | undefined;
  const cap = opts.limit ?? HARD_MESSAGE_CAP;

  while (all.length < cap) {
    const pageSize = Math.min(MAX_PER_PAGE, cap - all.length);
    const batch = await client.request<DiscordMessage[]>(`/channels/${channelId}/messages`, {
      query: { limit: pageSize, before },
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    const oldest = batch[batch.length - 1]; // newest-first order → last is oldest
    before = oldest.id;
    if (opts.since && new Date(oldest.timestamp) < opts.since) break;
    if (batch.length < pageSize) break; // reached the start of the channel
  }

  // Warn if the safety cap cut off a time-window query before reaching the window start.
  if (
    opts.since &&
    all.length >= cap &&
    all.length > 0 &&
    new Date(all[all.length - 1].timestamp) >= opts.since
  ) {
    warn(`⚠ stopped at the ${cap}-message safety cap; the time window may be incomplete — narrow it or use --limit.`);
  }

  let result = all;
  if (opts.since) result = result.filter((m) => new Date(m.timestamp) >= opts.since!);
  else if (opts.limit) result = result.slice(0, opts.limit);
  return result.reverse(); // chronological
}

export interface ChannelOpts {
  days?: number;
  limit?: number;
  since?: Date;
  json: boolean;
  guildId?: string | null;
  /** Resolve server nicknames for authors (default on). */
  nicks?: boolean;
}

// The Discord app shows each author's server nickname, but the REST message
// payload omits it, so we fetch it per unique author. Bounded to keep a busy
// channel's read from turning into hundreds of requests.
const NICK_LOOKUP_CAP = 50;

/** userId → server nickname, for authors that have one. Dedups; skips on error/cap. */
async function fetchNicks(
  client: DiscordClient,
  guildId: string,
  userIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const nicks: Record<string, string> = {};
  if (unique.length > NICK_LOOKUP_CAP) {
    info(`(${unique.length} authors — skipping nickname lookup; pass --no-nicks to silence)`);
    return nicks;
  }
  for (const uid of unique) {
    try {
      const m = await client.request<{ nick?: string | null }>(`/guilds/${guildId}/members/${uid}`);
      if (m?.nick) nicks[uid] = m.nick;
    } catch (e) {
      debug(`  member ${uid} nick lookup skipped: ${(e as Error).message}`);
    }
  }
  return nicks;
}

/** Resolve nicks for the authors of `msgs` unless disabled or outside a guild. */
async function nicksFor(
  client: DiscordClient,
  guildId: string | null,
  msgs: DiscordMessage[],
  enabled?: boolean,
): Promise<Record<string, string> | undefined> {
  if (enabled === false || !guildId || msgs.length === 0) return undefined;
  return fetchNicks(client, guildId, msgs.map((m) => m.author?.id ?? ""));
}

export async function cmdChannel(client: DiscordClient, channelId: string, opts: ChannelOpts): Promise<void> {
  // --limit takes precedence over the time window; otherwise default to --days (7).
  const since = opts.limit ? undefined : (opts.since ?? new Date(Date.now() - (opts.days ?? 7) * 86_400_000));
  const guildId = opts.guildId ?? (await resolveGuildId(client, channelId));
  const msgs = await fetchHistory(client, channelId, { since, limit: opts.limit });
  if (msgs.length === 0) {
    info("(no messages — the channel is empty, or the token lacks Read Message History here)");
  } else {
    info(`${msgs.length} message(s)`);
  }
  const nicks = await nicksFor(client, guildId, msgs, opts.json ? false : opts.nicks);
  printMessages(msgs, { json: opts.json, guildId, nicks });
}

export async function cmdThread(client: DiscordClient, channelId: string, opts: ChannelOpts): Promise<void> {
  // A thread is a channel; fetch the whole thread chronologically (capped).
  const guildId = opts.guildId ?? (await resolveGuildId(client, channelId));
  const msgs = await fetchHistory(client, channelId, { limit: opts.limit ?? HARD_MESSAGE_CAP });
  if (msgs.length === 0) {
    info("(no messages — empty thread, or missing Read Message History)");
  } else {
    info(`${msgs.length} message(s) in thread`);
  }
  const nicks = await nicksFor(client, guildId, msgs, opts.json ? false : opts.nicks);
  printMessages(msgs, { json: opts.json, guildId, nicks });
}

// ---- single message ---------------------------------------------------------

export async function cmdMessage(
  client: DiscordClient,
  channelId: string,
  messageId: string,
  opts: { json: boolean; guildId?: string | null; nicks?: boolean },
): Promise<void> {
  let msg: DiscordMessage | undefined;
  if (client.isBot) {
    // Bots can hit the singular endpoint directly.
    msg = await client.request<DiscordMessage>(`/channels/${channelId}/messages/${messageId}`);
  } else {
    // User tokens must emulate it via the history endpoint (around=id&limit=1).
    const arr = await client.request<DiscordMessage[]>(`/channels/${channelId}/messages`, {
      query: { around: messageId, limit: 1 },
    });
    msg = Array.isArray(arr) ? arr.find((m) => m.id === messageId) : undefined;
  }
  if (!msg) {
    throw new DiscordError(404, undefined, "message not found (it may be deleted, or the token can't see it)");
  }
  // Resolve the guild when it wasn't supplied (bare/2-arg form) so permalinks work
  // and server nicknames can be looked up.
  const guildId = opts.guildId ?? (await resolveGuildId(client, channelId));
  const nicks = await nicksFor(client, guildId, [msg], opts.json ? false : opts.nicks);
  printMessages([msg], { json: opts.json, guildId, nicks });
}

// ---- mentions ---------------------------------------------------------------

export interface MentionOpts {
  after?: Date;
  guildId?: string;
  limit?: number;
  json: boolean;
}

export async function cmdMention(client: DiscordClient, opts: MentionOpts): Promise<void> {
  if (client.isBot) throw userOnly("mention");

  // --after/--since sets an explicit window; else --limit fetches N most-recent; else default to 10m.
  const after = opts.after ?? (opts.limit ? undefined : new Date(Date.now() - 10 * 60_000));
  if (after && after < new Date(Date.now() - 7 * 86_400_000)) {
    debug("note: the mentions inbox only holds ~7 days; older results won't appear.");
  }

  const collected: DiscordMessage[] = [];
  let before: string | undefined;
  const cap = opts.limit ?? 200;

  while (collected.length < cap) {
    const pageSize = Math.min(MAX_PER_PAGE, cap - collected.length);
    const batch = await client.request<DiscordMessage[]>("/users/@me/mentions", {
      query: { limit: pageSize, before, roles: "true", everyone: "true", guild_id: opts.guildId },
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    collected.push(...batch);
    const oldest = batch[batch.length - 1];
    before = oldest.id;
    if (after && new Date(oldest.timestamp) < after) break;
    if (batch.length < pageSize) break;
  }

  const result = after ? collected.filter((m) => new Date(m.timestamp) >= after) : collected;
  info(`${result.length} mention(s)${after ? ` since ${after.toISOString()}` : ""}`);
  printMessages(result, { json: opts.json, guildId: opts.guildId ?? null });
}

// ---- search -----------------------------------------------------------------

export interface SearchOpts {
  guildId?: string;
  channelId?: string;
  count?: number;
  sort?: "timestamp" | "relevance";
  json: boolean;
}

/** Collapse the nested search response into a flat list of hit messages. */
function flattenSearch(res: SearchResponse): DiscordMessage[] {
  if (!res || !Array.isArray(res.messages)) return [];
  return res.messages
    .map((group) => group.find((m) => (m as DiscordMessage).hit) ?? group[0])
    .filter((m): m is DiscordMessage => !!m);
}

async function searchScope(
  client: DiscordClient,
  base: string,
  query: string,
  count: number,
  sort: "timestamp" | "relevance",
): Promise<{ hits: DiscordMessage[]; total: number }> {
  const hits: DiscordMessage[] = [];
  let total = 0;
  let offset = 0;

  while (hits.length < count && offset <= SEARCH_OFFSET_MAX) {
    const res = await client.request<SearchResponse>(`${base}/messages/search`, {
      query: {
        content: query,
        sort_by: sort,
        sort_order: "desc",
        limit: SEARCH_PER_PAGE,
        offset,
      },
    });
    total = res.total_results ?? 0;
    const batch = flattenSearch(res);
    if (batch.length === 0) break;
    hits.push(...batch);
    offset += SEARCH_PER_PAGE;
    if (hits.length >= total) break;
  }

  return { hits: hits.slice(0, count), total };
}

export async function cmdSearch(
  client: DiscordClient,
  query: string,
  opts: SearchOpts,
  defaultGuild?: string,
): Promise<void> {
  const count = opts.count ?? SEARCH_PER_PAGE;
  const sort = opts.sort ?? "timestamp";

  // DM / group-DM / private-channel search: user-only.
  if (opts.channelId) {
    if (client.isBot) throw userOnly("search --channel (DM search)");
    const { hits, total } = await searchScope(client, `/channels/${opts.channelId}`, query, count, sort);
    info(`${hits.length} of ${total} result(s) in channel ${opts.channelId}`);
    printMessages(hits, { json: opts.json, guildId: null });
    return;
  }

  const guildId = opts.guildId ?? defaultGuild;
  if (guildId) {
    const { hits, total } = await searchScope(client, `/guilds/${guildId}`, query, count, sort);
    info(`${hits.length} of ${total} result(s) in guild ${guildId}`);
    printMessages(hits, { json: opts.json, guildId });
    return;
  }

  // No guild specified → fan out across every guild the user is in (there is no global search).
  if (client.isBot) {
    throw new DiscordError(0, undefined, "bot-token search needs an explicit --guild <id>.");
  }
  const guilds = await client.request<DiscordGuild[]>("/users/@me/guilds", { query: { limit: 200 } });
  info(`no --guild given; searching ${guilds.length} guild(s)… (tip: set default_guild or pass --guild to narrow)`);

  const paired: { msg: DiscordMessage; guildId: string }[] = [];
  let failed = 0;
  for (const g of guilds) {
    try {
      const { hits } = await searchScope(client, `/guilds/${g.id}`, query, count, sort);
      for (const m of hits) paired.push({ msg: m, guildId: g.id });
    } catch (e) {
      const status = e instanceof DiscordError ? e.status : -1;
      if (status === 403 || status === 404) {
        // Expected: no search access to this guild — skip quietly.
        debug(`  search in "${g.name}" (${g.id}) skipped: ${(e as Error).message}`);
      } else {
        // Unexpected (rate-limit exhaustion / 5xx / network): a false "no results" otherwise.
        failed++;
        debug(`  search in "${g.name}" (${g.id}) failed: ${(e as Error).message}`);
      }
    }
  }
  if (failed > 0) {
    warn(`⚠ search failed in ${failed}/${guilds.length} guild(s) (rate limit / network / server error); results may be incomplete — re-run with -v for details.`);
  }
  // Re-sort by time only for timestamp mode; relevance keeps each guild's server ranking.
  if (sort === "timestamp") {
    paired.sort((a, b) => new Date(b.msg.timestamp).getTime() - new Date(a.msg.timestamp).getTime());
  }
  const top = paired.slice(0, count);
  info(`${top.length} result(s) across ${guilds.length} guild(s)`);
  printNormalized(
    top.map((p) => normalizeMessage(p.msg, p.guildId)),
    opts.json,
  );
}
