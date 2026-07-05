// Resolve a channel reference from a URL, a bare snowflake, or a human name:
//   "armeria"            → a channel named "armeria" (in the default guild, else any)
//   "Armeria/armeria"    → "armeria" in a server whose name matches "Armeria"
//   "LINE Open Source/armeria"   → spaces are fine (quote it, or leave it unquoted)
// A URL or snowflake resolves with no network calls; a name lists your servers
// and their channels to find the match.

import { DiscordClient, DiscordError } from "./client.ts";
import type { DiscordGuild, DiscordChannel } from "./types.ts";
import { parseRef, type DiscordRef } from "./util.ts";
import { debug, info } from "./log.ts";

/** Resolve `input` to a channel ref, looking it up by name when it isn't a URL/ID. */
export async function resolveChannelRef(
  input: string,
  client: DiscordClient,
  defaultGuild?: string,
): Promise<DiscordRef> {
  // 1. A URL or bare snowflake resolves directly — no lookup.
  const direct = parseRef(input);
  if (direct) return direct;

  if (client.isBot) {
    throw new DiscordError(
      0,
      undefined,
      `name lookup ("${input}") needs a user token (it lists your servers). Use a channel ID or URL with a bot token.`,
    );
  }

  // 2. Split "server/channel" on the LAST slash (server names may contain spaces,
  //    not slashes). A leading '#' on the channel is accepted and stripped.
  const slash = input.lastIndexOf("/");
  const guildQuery = (slash >= 0 ? input.slice(0, slash) : "").trim().toLowerCase();
  const channelQuery = (slash >= 0 ? input.slice(slash + 1) : input).trim().replace(/^#/, "").toLowerCase();
  if (!channelQuery) {
    throw new DiscordError(0, undefined, `could not read "${input}" as a URL, ID, or channel name.`);
  }

  // 3. Choose which server(s) to search.
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

  // 4. Collect channels named channelQuery (case-insensitive), skipping categories.
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
  return { guildId: matches[0].guild.id, channelId: matches[0].channel.id };
}
