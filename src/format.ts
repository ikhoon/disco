// Output formatting: human-readable to the terminal, or normalized JSON for piping.

import type { DiscordMessage, DiscordGuild, DiscordChannel } from "./types.ts";
import { displayName, CHANNEL_TYPE } from "./types.ts";
import { fmtTime, permalink } from "./util.ts";
import { info } from "./log.ts";
import { bold, dim, cyan, green } from "./color.ts";

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

/**
 * Pad `s` on the right to `width` terminal columns. Uses Bun.stringWidth so ANSI
 * color codes (zero width) and wide glyphs (emoji, CJK count as 2) don't throw
 * the columns off — lets us align id columns across colored, emoji-prefixed rows.
 */
function padVisible(s: string, width: number): string {
  const pad = width - Bun.stringWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

export function normalizeMessage(
  msg: DiscordMessage,
  guildId: string | null = null,
  nicks?: Record<string, string>,
): NormalizedMessage {
  const ref = msg.referenced_message ?? null;
  const authorId = msg.author?.id ?? "";
  return {
    id: msg.id,
    ts: msg.timestamp,
    guild_id: guildId,
    channel_id: msg.channel_id,
    author: {
      id: authorId,
      // Prefer the server nickname (what the Discord app shows) when we have it.
      name: nicks?.[authorId] ?? (msg.author ? displayName(msg.author) : "(unknown)"),
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
          // Prefer the nickname here too, so the same person isn't shown under two names.
          author: ref.author ? (nicks?.[ref.author.id] ?? displayName(ref.author)) : "(unknown)",
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
  // A dim vertical-bar gutter ties a message's body to its author line, so blocks
  // stay visually grouped when scanning many messages.
  const g = dim("│ ");
  const edited = m.edited ? dim(" (edited)") : "";
  // Show the @username alongside the display name when they differ — the display
  // name is the primary identity (cyan), the handle is secondary (dim).
  const handle =
    m.author.username && m.author.username !== m.author.name ? dim(` (@${m.author.username})`) : "";
  lines.push(
    `[${green(fmtTime(m.ts))}] ${cyan(m.author.name)}${handle}${m.author.bot ? dim(" [bot]") : ""}:${edited}`,
  );
  if (m.reply_to) {
    lines.push(`${g}${dim(`↳ re: ${m.reply_to.author}: "${m.reply_to.excerpt}"`)}`);
  }
  const body = m.content.trim();
  if (body) {
    for (const line of body.split("\n")) lines.push(`${g}${line}`);
  } else if (m.attachments.length === 0 && m.embeds.length === 0) {
    lines.push(`${g}${dim("(no text)")}`);
  }
  for (const e of m.embeds) {
    const head = [e.author, e.title].filter(Boolean).join(" · ") || "(link)";
    // A link preview is auto-extracted metadata, not the person's words — render the
    // whole card dim, under a 🔗 marker, so it clearly recedes behind the typed text.
    lines.push(`${g}${dim(`🔗 ${head}`)}`);
    if (e.description) lines.push(`${g}${dim(`   ${e.description}`)}`);
    if (e.url) lines.push(`${g}${dim(`   ${e.url}`)}`);
  }
  for (const a of m.attachments) {
    lines.push(`${g}📎 ${a.filename}${dim(` — ${a.url}`)}`);
  }
  lines.push(`${g}${dim(m.permalink)}`);
  return lines.join("\n");
}

/** Print a list of messages, either as JSON or human-readable blocks. */
export function printMessages(
  msgs: DiscordMessage[],
  opts: { json: boolean; guildId?: string | null; nicks?: Record<string, string> },
): void {
  const normalized = msgs.map((m) => normalizeMessage(m, opts.guildId ?? null, opts.nicks));
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
        topic: c.topic ?? null,
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
  // Read like Discord's sidebar. To tell name from topic at a glance, the channel
  // name is cyan and the topic is the plain default foreground, joined by a dim
  // dash and aligned into a column WITHIN each group. (ids live only in --json.)
  const cell = (c: DiscordChannel) => {
    const nm = c.name ?? "(unnamed)";
    return c.type === 0 ? cyan(`#${nm}`) : `${CHANNEL_ICON[c.type] ?? "#"} ${cyan(nm)}`;
  };
  const renderGroup = (chs: DiscordChannel[]): string[] => {
    // Column start = the widest name among this group's channels that have a topic.
    const width = Math.max(0, ...chs.filter((c) => c.topic).map((c) => Bun.stringWidth(cell(c))));
    return chs.map((c) =>
      c.topic ? `    ${padVisible(cell(c), width)}  ${dim("—")} ${excerpt(c.topic, 60)}` : `    ${cell(c)}`,
    );
  };

  const out: string[] = [];
  const uncategorized = childrenOf(null);
  if (uncategorized.length) out.push(...renderGroup(uncategorized));
  for (const cat of categories) {
    // Category = section header: a cyan marker + a bold title so the grouping pops.
    out.push(`${out.length ? "\n" : ""}${cyan("▸")} ${bold(cat.name ?? "(category)")}`);
    out.push(...renderGroup(childrenOf(cat.id)));
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
  const cell = (c: DiscordChannel) => `${dim(c.type === 3 ? "👥" : "@")} ${cyan(label(c))}`;
  const width = Math.max(0, ...channels.map((c) => Bun.stringWidth(cell(c))));
  const rows = channels
    .map((c) => `  ${padVisible(cell(c), width)}  ${dim(c.id)}`)
    .join("\n");
  process.stdout.write(rows + "\n");
}

/** Compact member count: 88 → "88", 1234 → "1.2k", 12345 → "12k". */
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
}

export function printGuilds(guilds: DiscordGuild[], json: boolean): void {
  if (json) {
    printJson(
      guilds.map((g) => ({
        id: g.id,
        name: g.name,
        owner: !!g.owner,
        member_count: g.approximate_member_count ?? null,
      })),
    );
    return;
  }
  if (guilds.length === 0) {
    info("(no guilds)");
    return;
  }
  // Name (what you scan for) + a 👑 if you own it, then the member count in the
  // readable default foreground — aligned into a column so sizes line up for
  // comparison. The id is noise here, so it lives in --json.
  const cell = (g: DiscordGuild) => `${g.name}${g.owner ? " 👑" : ""}`;
  const width = Math.max(0, ...guilds.map((g) => Bun.stringWidth(cell(g))));
  const rows = guilds
    .map((g) => {
      const members =
        g.approximate_member_count != null ? `  ${dim("·")}  ${fmtCount(g.approximate_member_count)} members` : "";
      return `  ${padVisible(cell(g), width)}${members}`;
    })
    .join("\n");
  process.stdout.write(rows + "\n");
}
