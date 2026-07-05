import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscordClient } from "../src/client.ts";
import { resolveChannelRef } from "../src/resolve.ts";

// Minimal fake client: route by path prefix.
function fakeClient(routes: Record<string, (path: string) => unknown>, isBot = false): DiscordClient {
  return {
    isBot,
    request: async (path: string) => {
      for (const [prefix, handler] of Object.entries(routes)) {
        if (path.startsWith(prefix)) return handler(path);
      }
      throw new Error(`unrouted ${path}`);
    },
  } as unknown as DiscordClient;
}

/** A client that fails on any request — proves a code path made no network call. */
const throwingClient = () =>
  ({ isBot: false, request: async () => { throw new Error("network was called"); } }) as unknown as DiscordClient;

const GUILDS = [
  { id: "g1", name: "Example-channel" },
  { id: "g2", name: "Acme" },
];
const CHANNELS: Record<string, any[]> = {
  g1: [
    { id: "c1", name: "example-channel", type: 0 },
    { id: "c1ko", name: "example-channel-ko", type: 0 },
    { id: "cat", name: "General", type: 4 }, // category, must be skipped
  ],
  g2: [{ id: "c9", name: "example-channel", type: 0 }], // same name in another server → ambiguous
};
const nameClient = () =>
  fakeClient({
    "/users/@me/guilds": () => GUILDS,
    "/guilds/g1/channels": () => CHANNELS.g1,
    "/guilds/g2/channels": () => CHANNELS.g2,
  });

/** Fresh cache file per test so runs don't pollute each other or the real cache. */
function tmpCache(): string {
  return join(mkdtempSync(join(tmpdir(), "disco-cache-")), "channel-cache.json");
}

describe("resolveChannelRef", () => {
  test("passes a URL through with no lookup", async () => {
    const ref = await resolveChannelRef("https://discord.com/channels/111/222/333", fakeClient({}));
    expect(ref).toEqual({ guildId: "111", channelId: "222", messageId: "333" });
  });

  test("passes a bare snowflake through", async () => {
    const ref = await resolveChannelRef("955123456789012345", fakeClient({}));
    expect(ref.channelId).toBe("955123456789012345");
  });

  test('resolves "Server/channel" to the channel id', async () => {
    const ref = await resolveChannelRef("Example-channel/example-channel", nameClient(), { cachePath: tmpCache() });
    expect(ref).toEqual({ guildId: "g1", channelId: "c1" });
  });

  test("strips a leading # and matches case-insensitively", async () => {
    const ref = await resolveChannelRef("example-channel/#example-channel-KO", nameClient(), { cachePath: tmpCache() });
    expect(ref).toEqual({ guildId: "g1", channelId: "c1ko" });
  });

  test("uses default_guild when the name has no server part", async () => {
    const ref = await resolveChannelRef("example-channel", nameClient(), { defaultGuild: "g2", cachePath: tmpCache() });
    expect(ref).toEqual({ guildId: "g2", channelId: "c9" });
  });

  test("errors with the candidate list when a bare name is ambiguous across servers", async () => {
    await expect(
      resolveChannelRef("example-channel", nameClient(), { cachePath: tmpCache() }),
    ).rejects.toThrow(/matches 2 channels/);
  });

  test("errors clearly when no channel matches", async () => {
    await expect(
      resolveChannelRef("Example-channel/nope", nameClient(), { cachePath: tmpCache() }),
    ).rejects.toThrow(/no channel named "#nope"/);
  });

  test("rejects name lookup on a bot token", async () => {
    await expect(resolveChannelRef("example-channel", fakeClient({}, true))).rejects.toThrow(/needs a user token/);
  });

  test("a malformed Discord URL is a parse error, not a name lookup", async () => {
    await expect(
      resolveChannelRef("https://discord.com/channels/123456789", fakeClient({})),
    ).rejects.toThrow(/could not parse .* as a Discord URL/);
  });

  describe("caching", () => {
    test("a resolved name is served from cache on the next call (no network)", async () => {
      const cachePath = tmpCache();
      const first = await resolveChannelRef("Example-channel/example-channel", nameClient(), { cachePath });
      expect(first).toEqual({ guildId: "g1", channelId: "c1" });
      // Second call would throw if it hit the network — but the cache answers it.
      const second = await resolveChannelRef("Example-channel/example-channel", throwingClient(), { cachePath });
      expect(second).toEqual({ guildId: "g1", channelId: "c1" });
    });

    test("--refresh bypasses the cache and re-resolves", async () => {
      const cachePath = tmpCache();
      await resolveChannelRef("Example-channel/example-channel", nameClient(), { cachePath });
      // With refresh, a throwing client means the network WAS consulted → it throws.
      await expect(
        resolveChannelRef("Example-channel/example-channel", throwingClient(), { cachePath, refresh: true }),
      ).rejects.toThrow(/network was called/);
    });

    test("errors are not cached", async () => {
      const cachePath = tmpCache();
      await expect(
        resolveChannelRef("Example-channel/nope", nameClient(), { cachePath }),
      ).rejects.toThrow(/no channel named/);
      // A retry still hits the network (nothing was cached) — throwing client proves it.
      await expect(
        resolveChannelRef("Example-channel/nope", throwingClient(), { cachePath }),
      ).rejects.toThrow(/network was called/);
    });
  });
});
