// Output formatting: human-readable to the terminal, or normalized JSON for piping.

import type { DiscordMessage, DiscordGuild, DiscordChannel } from "./types.ts";
import { displayName, CHANNEL_TYPE } from "./types.ts";
import { fmtTime, permalink } from "./util.ts";
import { info } from "./log.ts";

/** JSON-friendly, stable projection of a message. */
export interface NormalizedMessage {
  id: string;
  ts: string;
  guild_id: string | null;
  channel_id: string;
  author: { id: string; name: string; username: string; bot: boolean };
  content: string;
  edited: boolean;
  attachments: { filename: string; url: string; size: number }[];
  embeds: { author: string | null; title: string | null; description: string | null; url: string | null }[];
  reply_to: { id: string; author: string; excerpt: string } | null;
  permalink: string;
}

function excerpt(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

export function normalizeMessage(
  msg: DiscordMessage,
  guildId: string | null = null,
): NormalizedMessage {
  const ref = msg.referenced_message ?? null;
  return {
    id: msg.id,
    ts: msg.timestamp,
    guild_id: guildId,
    channel_id: msg.channel_id,
    author: {
      id: msg.author?.id ?? "",
      name: msg.author ? displayName(msg.author) : "(unknown)",
      username: msg.author?.username ?? "",
      bot: !!msg.author?.bot,
    },
    content: msg.content ?? "",
    edited: !!msg.edited_timestamp,
    attachments: (msg.attachments ?? []).map((a) => ({
      filename: a.filename,
      url: a.url,
      size: a.size,
    })),
    embeds: (msg.embeds ?? []).map((e) => ({
      author: e.author?.name ?? null,
      title: e.title ?? null,
      description: e.description ? excerpt(e.description, 200) : null,
      url: e.url ?? null,
    })),
    reply_to: ref
      ? {
          id: ref.id,
          author: ref.author ? displayName(ref.author) : "(unknown)",
          excerpt: excerpt(ref.content ?? ""),
        }
      : null,
    permalink: permalink(guildId, msg.channel_id, msg.id),
  };
}

/** Emit a JSON envelope: { data: <payload> }. */
export function printJson(payload: unknown): void {
  process.stdout.write(JSON.stringify({ data: payload }, null, 2) + "\n");
}

function renderMessage(m: NormalizedMessage): string {
  const lines: string[] = [];
  const edited = m.edited ? " (edited)" : "";
  lines.push(`[${fmtTime(m.ts)}] ${m.author.name}${m.author.bot ? " [bot]" : ""}:${edited}`);
  if (m.reply_to) {
    lines.push(`    ↳ re: ${m.reply_to.author}: "${m.reply_to.excerpt}"`);
  }
  const body = m.content.trim();
  if (body) {
    for (const line of body.split("\n")) lines.push(`    ${line}`);
  } else if (m.attachments.length === 0 && m.embeds.length === 0) {
    lines.push(`    (no text)`);
  }
  for (const e of m.embeds) {
    const head = [e.author, e.title].filter(Boolean).join(" · ");
    if (head || e.url) lines.push(`    ▪ ${head || "(embed)"}${e.url ? ` — ${e.url}` : ""}`);
    if (e.description) lines.push(`      ${e.description}`);
  }
  for (const a of m.attachments) {
    lines.push(`    📎 ${a.filename} — ${a.url}`);
  }
  lines.push(`    ${m.permalink}`);
  return lines.join("\n");
}

/** Print a list of messages, either as JSON or human-readable blocks. */
export function printMessages(
  msgs: DiscordMessage[],
  opts: { json: boolean; guildId?: string | null },
): void {
  const normalized = msgs.map((m) => normalizeMessage(m, opts.guildId ?? null));
  if (opts.json) {
    printJson(normalized);
    return;
  }
  if (normalized.length === 0) {
    info("(no messages)");
    return;
  }
  process.stdout.write(normalized.map(renderMessage).join("\n\n") + "\n");
}

/** Print an already-normalized list (used by cross-guild search where each message has its own guild). */
export function printNormalized(list: NormalizedMessage[], json: boolean): void {
  if (json) {
    printJson(list);
    return;
  }
  if (list.length === 0) {
    info("(no results)");
    return;
  }
  process.stdout.write(list.map(renderMessage).join("\n\n") + "\n");
}

const CHANNEL_ICON: Record<number, string> = {
  0: "#", // text
  2: "🔊", // voice
  5: "📣", // announcement
  10: "🧵",
  11: "🧵",
  12: "🔒",
  13: "🎙",
  15: "🗂",
  16: "🖼",
};

/** Print a guild's channels grouped under their categories (or JSON). */
export function printChannels(channels: DiscordChannel[], json: boolean): void {
  if (json) {
    printJson(
      channels.map((c) => ({
        id: c.id,
        name: c.name ?? null,
        type: c.type,
        type_name: CHANNEL_TYPE[c.type] ?? String(c.type),
        parent_id: c.parent_id ?? null,
        position: c.position ?? 0,
      })),
    );
    return;
  }
  if (channels.length === 0) {
    info("(no channels — or the token can't see this guild)");
    return;
  }
  const pos = (c: DiscordChannel) => c.position ?? 0;
  const categories = channels.filter((c) => c.type === 4).sort((a, b) => pos(a) - pos(b));
  const childrenOf = (parentId: string | null) =>
    channels
      .filter((c) => c.type !== 4 && (c.parent_id ?? null) === parentId)
      .sort((a, b) => pos(a) - pos(b));
  const line = (c: DiscordChannel) => `  ${CHANNEL_ICON[c.type] ?? "#"} ${c.name ?? "(unnamed)"}  ${c.id}`;

  const out: string[] = [];
  for (const c of childrenOf(null)) out.push(line(c)); // uncategorized first
  for (const cat of categories) {
    out.push(`${out.length ? "\n" : ""}▸ ${cat.name ?? "(category)"}`);
    for (const c of childrenOf(cat.id)) out.push(line(c));
  }
  process.stdout.write(out.join("\n") + "\n");
}

/** Print DM / group-DM channels (assumed pre-sorted, most recent first). */
export function printDms(channels: DiscordChannel[], json: boolean): void {
  const label = (c: DiscordChannel) =>
    c.name || (c.recipients ?? []).map(displayName).join(", ") || "(no recipients)";
  if (json) {
    printJson(
      channels.map((c) => ({
        id: c.id,
        type: c.type,
        type_name: CHANNEL_TYPE[c.type] ?? String(c.type),
        name: label(c),
        recipients: (c.recipients ?? []).map((u) => ({
          id: u.id,
          name: displayName(u),
          username: u.username,
        })),
        last_message_id: c.last_message_id ?? null,
      })),
    );
    return;
  }
  if (channels.length === 0) {
    info("(no DMs)");
    return;
  }
  const rows = channels
    .map((c) => `  ${c.type === 3 ? "👥" : "@"} ${label(c)}  ${c.id}`)
    .join("\n");
  process.stdout.write(rows + "\n");
}

export function printGuilds(guilds: DiscordGuild[], json: boolean): void {
  if (json) {
    printJson(guilds.map((g) => ({ id: g.id, name: g.name })));
    return;
  }
  if (guilds.length === 0) {
    info("(no guilds)");
    return;
  }
  const rows = guilds
    .map((g) => `  ${g.id}  ${g.name}`)
    .join("\n");
  process.stdout.write(rows + "\n");
}
