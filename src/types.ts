// Minimal subset of Discord API objects we consume.

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string;
  bot?: boolean;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  size: number;
  content_type?: string;
}

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string | null;
  /** Channel topic / description (text channels). */
  topic?: string | null;
  guild_id?: string;
  parent_id?: string | null;
  position?: number;
  /** DM / group-DM only. */
  recipients?: DiscordUser[];
  last_message_id?: string | null;
}

/** Discord channel type enum → short label. */
export const CHANNEL_TYPE: Record<number, string> = {
  0: "text",
  1: "dm",
  2: "voice",
  3: "group-dm",
  4: "category",
  5: "announcement",
  10: "announcement-thread",
  11: "thread",
  12: "private-thread",
  13: "stage",
  14: "directory",
  15: "forum",
  16: "media",
};

export interface DiscordGuild {
  id: string;
  name: string;
  /** true when you own this server (from /users/@me/guilds). */
  owner?: boolean;
  /** total members, present when the list is fetched with ?with_counts=true. */
  approximate_member_count?: number;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  author?: { name?: string; url?: string };
  fields?: { name: string; value: string }[];
  timestamp?: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  type: number;
  attachments: DiscordAttachment[];
  embeds?: DiscordEmbed[];
  mentions: DiscordUser[];
  mention_everyone?: boolean;
  referenced_message?: DiscordMessage | null;
  thread?: DiscordChannel | null;
  /** present in search results to mark the actual hit within a context group. */
  hit?: boolean;
}

export interface SearchResponse {
  total_results: number;
  /** Each entry is a context group; the element with hit=true is the match (now usually 1 element). */
  messages: DiscordMessage[][];
  analytics_id?: string;
  doing_deep_historical_index?: boolean;
  documents_indexed?: number;
  /** Present on a 202 "index not yet available" body (seconds). */
  retry_after?: number;
  code?: number;
  message?: string;
}

/** Display name preference: global name → username. */
export function displayName(user: DiscordUser): string {
  return user.global_name || user.username || user.id;
}
