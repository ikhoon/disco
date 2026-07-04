// Snowflake / time / URL helpers.

// Discord epoch: 2015-01-01T00:00:00.000Z in ms.
export const DISCORD_EPOCH = 1420070400000n;

/** Convert a Discord snowflake ID to the Date it encodes. */
export function snowflakeToDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

/** Convert a Date to the smallest snowflake at/after that instant (for before/after paging). */
export function dateToSnowflake(date: Date): string {
  return ((BigInt(date.getTime()) - DISCORD_EPOCH) << 22n).toString();
}

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a time expression into a Date.
 * Accepts relative windows ("10m", "2h", "3d", "1w") or an absolute date
 * ("2026-06-01", "2026-06-01T09:00").
 */
export function parseTime(input: string): Date {
  const rel = input.trim().match(/^(\d+)\s*([mhdw])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = UNIT_MS[rel[2].toLowerCase()];
    const d = new Date(Date.now() - n * unit);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`time window "${input}" is out of range`);
    }
    return d;
  }
  const abs = new Date(input);
  if (Number.isNaN(abs.getTime())) {
    throw new Error(`invalid time "${input}" — use 10m / 2h / 3d / 1w or an ISO date`);
  }
  return abs;
}

export interface DiscordRef {
  /** null for DMs / group DMs (the "@me" pseudo-guild). */
  guildId: string | null;
  channelId: string;
  messageId?: string;
}

/**
 * Parse a Discord message/channel URL or a bare channel ID.
 *   https://discord.com/channels/<guild|@me>/<channel>/<message?>
 *   <channelId>            (bare snowflake)
 */
export function parseRef(input: string): DiscordRef | null {
  const url = input.match(/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?/);
  if (url) {
    return {
      guildId: url[1] === "@me" ? null : url[1],
      channelId: url[2],
      messageId: url[3],
    };
  }
  if (/^\d{15,25}$/.test(input.trim())) {
    return { guildId: null, channelId: input.trim() };
  }
  return null;
}

/** Build a canonical permalink for a message. */
export function permalink(guildId: string | null | undefined, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId ?? "@me"}/${channelId}/${messageId}`;
}

/** Compact local timestamp: "2026-07-03 09:12". */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
