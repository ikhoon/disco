import { describe, expect, test } from "bun:test";
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

const GUILDS = [
  { id: "g1", name: "Armeria" },
  { id: "g2", name: "LINE Open Source" },
];
const CHANNELS: Record<string, any[]> = {
  g1: [
    { id: "c1", name: "armeria", type: 0 },
    { id: "c1ko", name: "armeria-ko", type: 0 },
    { id: "cat", name: "General", type: 4 }, // category, must be skipped
  ],
  g2: [{ id: "c9", name: "armeria", type: 0 }], // same name in another server → ambiguous
};
const nameClient = () =>
  fakeClient({
    "/users/@me/guilds": () => GUILDS,
    "/guilds/g1/channels": () => CHANNELS.g1,
    "/guilds/g2/channels": () => CHANNELS.g2,
  });

describe("resolveChannelRef", () => {
  test("passes a URL through with no lookup", async () => {
    const ref = await resolveChannelRef(
      "https://discord.com/channels/111/222/333",
      fakeClient({}),
    );
    expect(ref).toEqual({ guildId: "111", channelId: "222", messageId: "333" });
  });

  test("passes a bare snowflake through", async () => {
    const ref = await resolveChannelRef("1087272728177942629", fakeClient({}));
    expect(ref.channelId).toBe("1087272728177942629");
  });

  test('resolves "Server/channel" to the channel id', async () => {
    const ref = await resolveChannelRef("Armeria/armeria", nameClient());
    expect(ref).toEqual({ guildId: "g1", channelId: "c1" });
  });

  test("strips a leading # and matches case-insensitively", async () => {
    const ref = await resolveChannelRef("armeria/#ARMERIA-KO", nameClient());
    expect(ref).toEqual({ guildId: "g1", channelId: "c1ko" });
  });

  test("uses default_guild when the name has no server part", async () => {
    const ref = await resolveChannelRef("armeria", nameClient(), "g2");
    expect(ref).toEqual({ guildId: "g2", channelId: "c9" });
  });

  test("errors with the candidate list when a bare name is ambiguous across servers", async () => {
    await expect(resolveChannelRef("armeria", nameClient())).rejects.toThrow(/matches 2 channels/);
  });

  test("errors clearly when no channel matches", async () => {
    await expect(resolveChannelRef("Armeria/nope", nameClient())).rejects.toThrow(/no channel named "#nope"/);
  });

  test("rejects name lookup on a bot token", async () => {
    await expect(resolveChannelRef("armeria", fakeClient({}, true))).rejects.toThrow(/needs a user token/);
  });
});
