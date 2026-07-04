import { describe, expect, test } from "bun:test";
import type { DiscordClient } from "../src/client.ts";
import { cmdDms, cmdGuilds, cmdMessage, cmdMention, cmdChannel, cmdSearch } from "../src/commands.ts";
import type { DiscordMessage } from "../src/types.ts";
import { captureStdout, parseEnvelope } from "./helpers/capture.ts";

// A scriptable fake client: route requests by path (+ optional query assert).
type Handler = (path: string, opts: any) => unknown;

function fakeClient(routes: Record<string, Handler>, isBot = false): DiscordClient {
  const calls: { path: string; opts: any }[] = [];
  const client = {
    isBot,
    calls,
    request: async (path: string, opts: any = {}) => {
      calls.push({ path, opts });
      for (const [prefix, handler] of Object.entries(routes)) {
        if (path.startsWith(prefix)) return handler(path, opts);
      }
      throw new Error(`fakeClient: unrouted request ${path}`);
    },
  };
  return client as unknown as DiscordClient;
}

function msg(id: string, ts: string, content: string): DiscordMessage {
  return {
    id,
    channel_id: "c1",
    author: { id: "u1", username: "jane", global_name: "Jane" },
    content,
    timestamp: ts,
    type: 0,
    attachments: [],
    mentions: [],
  };
}

describe("cmdDms", () => {
  const dms = [
    { id: "100", type: 1, recipients: [{ id: "u1", username: "alice" }], last_message_id: "500" },
    { id: "200", type: 3, name: null, recipients: [{ id: "u2", username: "bob" }, { id: "u3", username: "carol" }], last_message_id: "900" },
    { id: "300", type: 1, recipients: [{ id: "u4", username: "dave" }], last_message_id: null },
  ];

  test("sorts by last activity (snowflake) desc, falling back to the channel id", async () => {
    const out = await captureStdout(() =>
      cmdDms(fakeClient({ "/users/@me/channels": () => structuredClone(dms) }), true),
    );
    expect(parseEnvelope(out).map((c: any) => c.id)).toEqual(["200", "100", "300"]);
  });

  test("labels group DMs with recipient names and exposes type_name", async () => {
    const out = await captureStdout(() =>
      cmdDms(fakeClient({ "/users/@me/channels": () => structuredClone(dms) }), true),
    );
    const groups = parseEnvelope(out).filter((c: any) => c.type_name === "group-dm");
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("bob, carol");
  });

  test("rejects bot tokens with a user-only error", async () => {
    await expect(cmdDms(fakeClient({}, true), false)).rejects.toThrow(/requires a USER token/);
  });
});

describe("cmdGuilds", () => {
  test("returns and prints the guild list", async () => {
    const guilds = [{ id: "1", name: "example-channel" }];
    let returned: any;
    const out = await captureStdout(async () => {
      returned = await cmdGuilds(fakeClient({ "/users/@me/guilds": () => guilds }), true);
    });
    expect(returned).toEqual(guilds);
    expect(parseEnvelope(out)).toEqual(guilds);
  });
});

describe("cmdMessage", () => {
  test("user tokens fetch via history around=id and pick the exact message", async () => {
    const client = fakeClient({
      "/channels/c1/messages": (_p, opts) => {
        expect(opts.query.around).toBe("m2");
        return [msg("m1", "2026-07-01T00:00:00Z", "a"), msg("m2", "2026-07-01T00:01:00Z", "b")];
      },
    });
    const out = await captureStdout(() => cmdMessage(client, "c1", "m2", { json: true }));
    const data = parseEnvelope(out);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("m2");
    expect(data[0].content).toBe("b");
  });

  test("bot tokens use the direct message endpoint", async () => {
    const client = fakeClient(
      { "/channels/c1/messages/m2": () => msg("m2", "2026-07-01T00:01:00Z", "b") },
      true,
    );
    const out = await captureStdout(() => cmdMessage(client, "c1", "m2", { json: true }));
    expect(parseEnvelope(out)[0].id).toBe("m2");
  });

  test("404s clearly when the message is missing from the window", async () => {
    const client = fakeClient({ "/channels/c1/messages": () => [] });
    await expect(cmdMessage(client, "c1", "mX", { json: true })).rejects.toThrow(/message not found/);
  });
});

describe("cmdMention", () => {
  test("rejects bot tokens (user-only inbox)", async () => {
    await expect(cmdMention(fakeClient({}, true), { json: true })).rejects.toThrow(/requires a USER token/);
  });

  test("filters results to the --after window and prints oldest→newest as returned", async () => {
    const now = Date.now();
    const recent = msg("m2", new Date(now - 60_000).toISOString(), "recent");
    const old = msg("m1", new Date(now - 86_400_000).toISOString(), "old");
    const client = fakeClient({ "/users/@me/mentions": () => [recent, old] });
    const out = await captureStdout(() =>
      cmdMention(client, { after: new Date(now - 3_600_000), json: true }),
    );
    const data = parseEnvelope(out);
    expect(data.map((m: any) => m.id)).toEqual(["m2"]);
  });
});

describe("cmdChannel", () => {
  test("pages full batches with a before cursor and prints chronologically", async () => {
    // The walker only requests another page after a FULL batch (Discord's
    // contract: a short page means the channel start). 120 messages newest-
    // first; --limit 110 → page 1 asks for 100 (m120..m21), page 2 for 10.
    const mkPage = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const n = from - i;
        return msg(`m${n}`, new Date(Date.UTC(2026, 6, 4) + n * 1000).toISOString(), `c${n}`);
      });
    const client = fakeClient({
      "/channels/c1/messages": (_p, opts) => {
        if (!opts.query.before) {
          expect(opts.query.limit).toBe(100);
          return mkPage(120, 100); // m120..m21
        }
        expect(opts.query.before).toBe("m21");
        expect(opts.query.limit).toBe(10);
        return mkPage(20, 10); // m20..m11
      },
    });
    const out = await captureStdout(() =>
      cmdChannel(client, "c1", { limit: 110, json: true, guildId: "g1" }),
    );
    const ids = parseEnvelope(out).map((m: any) => m.id);
    expect(ids).toHaveLength(110);
    expect(ids[0]).toBe("m11"); // oldest first
    expect(ids[109]).toBe("m120"); // newest last
  });

  test("a short page ends paging (channel start reached)", async () => {
    const client = fakeClient({
      "/channels/c1/messages": () => [
        msg("m2", "2026-07-04T00:00:02Z", "b"),
        msg("m1", "2026-07-04T00:00:01Z", "a"),
      ],
    });
    const out = await captureStdout(() =>
      cmdChannel(client, "c1", { limit: 50, json: true, guildId: "g1" }),
    );
    expect(parseEnvelope(out).map((m: any) => m.id)).toEqual(["m1", "m2"]);
  });

  test("time-window queries drop messages older than --since", async () => {
    const client = fakeClient({
      "/channels/c1/messages": () => [
        msg("m2", "2026-07-04T12:00:00Z", "in-window"),
        msg("m1", "2026-06-01T00:00:00Z", "too-old"),
      ],
    });
    const out = await captureStdout(() =>
      cmdChannel(client, "c1", { since: new Date("2026-07-01T00:00:00Z"), json: true, guildId: "g1" }),
    );
    expect(parseEnvelope(out).map((m: any) => m.id)).toEqual(["m2"]);
  });
});

describe("cmdSearch", () => {
  const hitGroup = (id: string, content: string): DiscordMessage[] => [
    { ...msg(`${id}-ctx`, "2026-07-04T00:00:00Z", "context") },
    { ...msg(id, "2026-07-04T00:00:01Z", content), hit: true },
  ];

  test("flattens context groups down to the hit message", async () => {
    const client = fakeClient({
      "/guilds/g1/messages/search": () => ({ total_results: 1, messages: [hitGroup("m9", "deploy failed")] }),
    });
    const out = await captureStdout(() =>
      cmdSearch(client, "deploy", { json: true, guildId: "g1" }),
    );
    const data = parseEnvelope(out);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("m9");
  });

  test("DM search with a bot token errors clearly", async () => {
    await expect(
      cmdSearch(fakeClient({}, true), "q", { json: true, channelId: "dm1" }),
    ).rejects.toThrow(/requires a USER token/);
  });

  test("bot search without --guild errors instead of fanning out", async () => {
    await expect(cmdSearch(fakeClient({}, true), "q", { json: true })).rejects.toThrow(/needs an explicit --guild/);
  });
});
