import { getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  ConnectBody,
  connectYouTube,
  createEligibleCache,
  findEligibleShorts,
  linkedChannels,
  parseWalletQuery,
  type ChannelOwner,
  type ChannelOwnerStore,
} from "@/lib/server/channels";
import {
  listOwnedChannels,
  mapOwnedChannel,
  verifyGoogleAccessToken,
  YOUTUBE_READONLY_SCOPE,
  type GoogleOAuth,
  type OwnedChannel,
} from "@/lib/server/google";
import { createRateLimiter, HttpError, toErrorResponse } from "@/lib/server/http";
import { addr, FakeYouTube, ytVideo } from "./helpers/fakes";

const CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
const NOW = 1_800_000_000;
const TOKEN = "ya29.test-access-token-0123456789";
const chId = (c: string) => `UC${c.repeat(22)}`;

/** fetch stub: records calls, answers with the given JSON/status. */
function stubFetch(answer: (url: URL, init?: RequestInit) => { status?: number; body?: unknown } | Error) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const impl = (async (u: string, init?: RequestInit) => {
    const url = new URL(u);
    calls.push({ url, init });
    const a = answer(url, init);
    if (a instanceof Error) throw a;
    return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const errCode = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof HttpError ? `${e.status} ${e.code}` : String(e)),
  );

const goodInfo = { aud: CLIENT_ID, azp: CLIENT_ID, scope: `openid ${YOUTUBE_READONLY_SCOPE}`, exp: String(NOW + 3000), expires_in: "3000" };

describe("verifyGoogleAccessToken (tokeninfo)", () => {
  const verify = (body: unknown, status = 200) =>
    verifyGoogleAccessToken(TOKEN, CLIENT_ID, stubFetch(() => ({ status, body })).impl, NOW);

  it("accepts a token minted for our client with youtube.readonly; calls tokeninfo", async () => {
    const f = stubFetch(() => ({ body: goodInfo }));
    const r = await verifyGoogleAccessToken(TOKEN, CLIENT_ID, f.impl, NOW);
    expect(r).toEqual({ scopes: ["openid", YOUTUBE_READONLY_SCOPE], expiresIn: 3000 });
    expect(f.calls[0]!.url.origin + f.calls[0]!.url.pathname).toBe("https://oauth2.googleapis.com/tokeninfo");
    expect(f.calls[0]!.url.searchParams.get("access_token")).toBe(TOKEN);
  });
  it("accepts when only azp (or only aud) matches", async () => {
    expect(await errCode(verify({ ...goodInfo, aud: "other-app" }))).toBe("ok");
    expect(await errCode(verify({ ...goodInfo, azp: undefined }))).toBe("ok");
  });
  it("aud/azp mismatch → 401 (token minted for another app can't be replayed)", async () => {
    expect(await errCode(verify({ ...goodInfo, aud: "evil.apps.googleusercontent.com", azp: "evil.apps.googleusercontent.com" }))).toBe(
      "401 invalid_token",
    );
    expect(await errCode(verify({ ...goodInfo, aud: undefined, azp: undefined }))).toBe("401 invalid_token");
    // empty configured client id never matches
    expect(await errCode(verifyGoogleAccessToken(TOKEN, "", stubFetch(() => ({ body: { ...goodInfo, aud: "", azp: "" } })).impl, NOW))).toBe(
      "401 invalid_token",
    );
  });
  it("missing youtube.readonly scope → 401", async () => {
    expect(await errCode(verify({ ...goodInfo, scope: "openid email" }))).toBe("401 invalid_token");
    expect(await errCode(verify({ ...goodInfo, scope: `${YOUTUBE_READONLY_SCOPE}x` }))).toBe("401 invalid_token");
    expect(await errCode(verify({ ...goodInfo, scope: undefined }))).toBe("401 invalid_token");
  });
  it("expired → 401 (expires_in ≤ 0 or exp in the past)", async () => {
    expect(await errCode(verify({ ...goodInfo, expires_in: "0" }))).toBe("401 invalid_token");
    expect(await errCode(verify({ ...goodInfo, exp: String(NOW - 1), expires_in: "5" }))).toBe("401 invalid_token");
    expect(await errCode(verify({ ...goodInfo, expires_in: undefined, exp: String(NOW - 10) }))).toBe("401 invalid_token");
    expect(await errCode(verify({ ...goodInfo, expires_in: undefined, exp: undefined }))).toBe("401 invalid_token");
  });
  it("Google errors: 400 invalid_token → 401; 5xx / network → 502; never leaks the token", async () => {
    expect(await errCode(verify({ error: "invalid_token", error_description: "Invalid Value" }, 400))).toBe("401 invalid_token");
    expect(await errCode(verify("not json at all", 400))).toBe("401 invalid_token");
    expect(await errCode(verify({}, 503))).toBe("502 google_unavailable");
    const boom = stubFetch(() => new TypeError(`fetch failed https://oauth2.googleapis.com/tokeninfo?access_token=${TOKEN}`));
    const err = await verifyGoogleAccessToken(TOKEN, CLIENT_ID, boom.impl, NOW).catch((e: Error) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(502);
    expect((err as HttpError).message).not.toContain(TOKEN);
  });
});

describe("listOwnedChannels (channels.list?mine=true)", () => {
  const item = (c: string, title = `Chan ${c}`) => ({
    id: chId(c),
    snippet: { title, thumbnails: { medium: { url: `https://yt3.ggpht.com/${c}` } } },
  });

  it("sends the bearer token and maps channels (dedup, drops malformed ids)", async () => {
    const f = stubFetch(() => ({ body: { items: [item("a"), item("a"), { id: "nope" }, item("b")] } }));
    const out = await listOwnedChannels(TOKEN, f.impl);
    expect(f.calls[0]!.url.pathname).toBe("/youtube/v3/channels");
    expect(f.calls[0]!.url.searchParams.get("mine")).toBe("true");
    expect(f.calls[0]!.url.searchParams.get("part")).toBe("snippet");
    expect(f.calls[0]!.url.searchParams.has("key")).toBe(false);
    expect(new Headers(f.calls[0]!.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(out).toEqual([
      { channelId: chId("a"), title: "Chan a", thumbnailUrl: "https://yt3.ggpht.com/a" },
      { channelId: chId("b"), title: "Chan b", thumbnailUrl: "https://yt3.ggpht.com/b" },
    ]);
  });
  it("no channel → []", async () => {
    expect(await listOwnedChannels(TOKEN, stubFetch(() => ({ body: { pageInfo: { totalResults: 0 } } })).impl)).toEqual([]);
    expect(await listOwnedChannels(TOKEN, stubFetch(() => ({ status: 404, body: {} })).impl)).toEqual([]);
  });
  it("401/403 → 401 invalid_token; quota → 503; 5xx → 502", async () => {
    expect(await errCode(listOwnedChannels(TOKEN, stubFetch(() => ({ status: 401, body: {} })).impl))).toBe("401 invalid_token");
    expect(
      await errCode(listOwnedChannels(TOKEN, stubFetch(() => ({ status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } })).impl)),
    ).toBe("401 invalid_token");
    expect(
      await errCode(listOwnedChannels(TOKEN, stubFetch(() => ({ status: 403, body: { error: { errors: [{ reason: "quotaExceeded" }] } } })).impl)),
    ).toBe("503 youtube_quota");
    expect(await errCode(listOwnedChannels(TOKEN, stubFetch(() => ({ status: 500, body: {} })).impl))).toBe("502 google_unavailable");
  });
  it("mapOwnedChannel tolerates missing snippet", () => {
    expect(mapOwnedChannel({ id: chId("c") })).toEqual({ channelId: chId("c"), title: "", thumbnailUrl: null });
    expect(mapOwnedChannel(null)).toBeNull();
  });
});

// ───────────────────────────── connect + eligible ─────────────────────────────

class FakeOwners implements ChannelOwnerStore {
  rows = new Map<string, ChannelOwner & { verifiedAt: Date }>();
  submitted = new Map<number, Set<string>>();
  async upsertOwners(wallet: Address, channels: OwnedChannel[], verifiedAt: Date) {
    for (const c of channels) this.rows.set(c.channelId, { channelId: c.channelId, wallet, channelTitle: c.title, verifiedAt });
  }
  async channelsOf(wallet: Address) {
    return [...this.rows.values()].filter((r) => r.wallet.toLowerCase() === wallet.toLowerCase());
  }
  async ownerOf(channelId: string) {
    return this.rows.get(channelId) ?? null;
  }
  async submittedVideoIds(campaignId: number, ids: string[]) {
    const s = this.submitted.get(campaignId) ?? new Set<string>();
    return new Set(ids.filter((i) => s.has(i)));
  }
}

function fakeGoogle(opts: { channels?: OwnedChannel[]; verifyError?: HttpError } = {}): GoogleOAuth & { verified: string[] } {
  const verified: string[] = [];
  return {
    verified,
    async verify(t) {
      verified.push(t);
      if (opts.verifyError) throw opts.verifyError;
      return { scopes: [YOUTUBE_READONLY_SCOPE], expiresIn: 3000 };
    },
    async ownedChannels() {
      return opts.channels ?? [];
    },
  };
}

describe("connectYouTube", () => {
  const wallet = addr(0xc0ffee);
  const chan: OwnedChannel = { channelId: chId("a"), title: "Priya Shorts", thumbnailUrl: "https://yt3.ggpht.com/a" };

  it("verifies the token, upserts owned channels with the wallet, returns them", async () => {
    const owners = new FakeOwners();
    const google = fakeGoogle({ channels: [chan] });
    const res = await connectYouTube(google, owners, { accessToken: TOKEN, wallet: wallet.toLowerCase() as Address }, new Date(5));
    expect(google.verified).toEqual([TOKEN]);
    expect(res).toEqual({ wallet, channels: [chan] });
    expect(owners.rows.get(chan.channelId)).toMatchObject({ wallet, channelTitle: "Priya Shorts" });
  });
  it("re-connecting moves the channel to the new wallet (for future campaigns)", async () => {
    const owners = new FakeOwners();
    const google = fakeGoogle({ channels: [chan] });
    await connectYouTube(google, owners, { accessToken: TOKEN, wallet });
    await connectYouTube(google, owners, { accessToken: TOKEN, wallet: addr(0xbeef) });
    expect(owners.rows.get(chan.channelId)!.wallet).toBe(addr(0xbeef));
    expect(await owners.channelsOf(wallet)).toEqual([]);
  });
  it("no channel → 400 no_channel; invalid token → 401 and nothing stored", async () => {
    const owners = new FakeOwners();
    expect(await errCode(connectYouTube(fakeGoogle({ channels: [] }), owners, { accessToken: TOKEN, wallet }))).toBe("400 no_channel");
    const bad = fakeGoogle({ channels: [chan], verifyError: new HttpError(401, "invalid_token", "x") });
    expect(await errCode(connectYouTube(bad, owners, { accessToken: TOKEN, wallet }))).toBe("401 invalid_token");
    expect(owners.rows.size).toBe(0);
  });
  it("the no-channel error has the agreed message and a clean JSON body", async () => {
    const err = await connectYouTube(fakeGoogle(), new FakeOwners(), { accessToken: TOKEN, wallet }).catch((e) => e);
    const res = toErrorResponse("test", err);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "no_channel", message: "This Google account has no YouTube channel." } });
  });
});

describe("request validation", () => {
  it("ConnectBody: wallet checksummed; bad token / wallet rejected", () => {
    const ok = ConnectBody.parse({ accessToken: TOKEN, wallet: addr(0xabc).toLowerCase() });
    expect(ok.wallet).toBe(addr(0xabc));
    expect(ConnectBody.safeParse({ accessToken: "short", wallet: addr(1) }).success).toBe(false);
    expect(ConnectBody.safeParse({ accessToken: TOKEN, wallet: "0x123" }).success).toBe(false);
    expect(ConnectBody.safeParse({ wallet: addr(1) }).success).toBe(false);
  });
  it("parseWalletQuery: missing/invalid → ZodError → 400 invalid_request", async () => {
    expect(parseWalletQuery(`http://x/api?wallet=${addr(0xabc).toLowerCase()}`)).toBe(addr(0xabc));
    for (const u of ["http://x/api", "http://x/api?wallet=nope"]) {
      let err: unknown;
      try {
        parseWalletQuery(u);
      } catch (e) {
        err = e;
      }
      const res = toErrorResponse("test", err);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
    }
  });
});

describe("rate limit", () => {
  it("fixed window per key: limit+1 blocked with retry-after, resets after the window, keys independent", () => {
    const rl = createRateLimiter(10, 60_000);
    for (let i = 0; i < 10; i++) expect(rl.check("1.2.3.4", 1000).ok).toBe(true);
    const blocked = rl.check("1.2.3.4", 1000);
    expect(blocked).toEqual({ ok: false, retryAfterSec: 60 });
    expect(rl.check("5.6.7.8", 1000).ok).toBe(true);
    expect(rl.check("1.2.3.4", 61_001).ok).toBe(true);
  });
});

describe("linkedChannels", () => {
  it("returns live titles/thumbnails, falls back to stored titles when YouTube fails", async () => {
    const wallet = addr(0xc0ffee);
    const owners = new FakeOwners();
    await owners.upsertOwners(wallet, [{ channelId: chId("a"), title: "Old title", thumbnailUrl: null }], new Date());
    const yt = new FakeYouTube();
    yt.channels.set(chId("a"), { id: chId("a"), title: "New title", publishedAt: 0, thumbnailUrl: "https://yt3.ggpht.com/a" });
    expect(await linkedChannels(owners, yt, wallet)).toEqual({
      wallet,
      channels: [{ channelId: chId("a"), title: "New title", thumbnailUrl: "https://yt3.ggpht.com/a" }],
    });
    const broken = new FakeYouTube();
    broken.getChannels = async () => {
      throw new Error("quotaExceeded");
    };
    expect((await linkedChannels(owners, broken, wallet)).channels).toEqual([{ channelId: chId("a"), title: "Old title", thumbnailUrl: null }]);
    expect((await linkedChannels(owners, null, addr(0xdead))).channels).toEqual([]);
  });
});

describe("findEligibleShorts", () => {
  const wallet = addr(0xc0ffee);
  const campaign = { id: 2, startTime: 1_000_000, endTime: 1_100_000 };
  const A = chId("a");
  const B = chId("b");
  const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;

  function setup() {
    const owners = new FakeOwners();
    const yt = new FakeYouTube();
    void owners.upsertOwners(wallet, [{ channelId: A, title: "A", thumbnailUrl: null }], new Date(1));
    void owners.upsertOwners(wallet, [{ channelId: B, title: "B", thumbnailUrl: null }], new Date(2));
    yt.channels.set(A, { id: A, title: "A live", publishedAt: 0, thumbnailUrl: "https://yt3.ggpht.com/a", uploadsPlaylistId: "UUa-from-api" });
    // B has no uploadsPlaylistId from the API → derived "UU" + suffix
    yt.channels.set(B, { id: B, title: "B live", publishedAt: 0 });
    const inWindow = 1_050_000;
    const videos = [
      ytVideo({ id: vid(1), channelId: A, publishedAt: inWindow, durationSec: 59, viewCount: 1200, title: "ok A" }),
      ytVideo({ id: vid(2), channelId: A, publishedAt: inWindow + 10, durationSec: 180, viewCount: 50, title: "ok A 180s" }),
      ytVideo({ id: vid(3), channelId: A, publishedAt: inWindow, durationSec: 181 }), // too long
      ytVideo({ id: vid(4), channelId: A, publishedAt: inWindow, privacyStatus: "unlisted" }), // not public
      ytVideo({ id: vid(5), channelId: A, publishedAt: campaign.startTime - 1 }), // before window (no videoPublishedAt hint)
      ytVideo({ id: vid(6), channelId: B, publishedAt: inWindow + 20, durationSec: 30, viewCount: 7, title: "ok B" }),
      ytVideo({ id: vid(7), channelId: B, publishedAt: campaign.endTime + 1 }), // after window
      ytVideo({ id: vid(8), channelId: chId("z"), publishedAt: inWindow }), // someone else's video in the playlist
      ytVideo({ id: vid(9), channelId: B, publishedAt: inWindow, durationSec: null }), // unknown duration
      ytVideo({ id: vid(10), channelId: A, publishedAt: 900_000 }), // pre-filtered by videoPublishedAt
    ];
    for (const v of videos) yt.videos.set(v.id, v);
    yt.playlists.set("UUa-from-api", [1, 2, 3, 4, 5, 8].map((n) => ({ videoId: vid(n), publishedAt: Number.NaN })).concat({ videoId: vid(10), publishedAt: 900_000 }));
    yt.playlists.set(`UU${B.slice(2)}`, [6, 7, 9].map((n) => ({ videoId: vid(n), publishedAt: Number.NaN })));
    return { owners, yt };
  }

  it("keeps public ≤180s Shorts published in [start,end] from the wallet's channels, newest first", async () => {
    const { owners, yt } = setup();
    owners.submitted.set(2, new Set([vid(2)]));
    const res = await findEligibleShorts(owners, yt, campaign, wallet);
    expect(res.wallet).toBe(wallet);
    expect(res.channels).toEqual([
      { channelId: A, title: "A live", thumbnailUrl: "https://yt3.ggpht.com/a" },
      { channelId: B, title: "B live", thumbnailUrl: null },
    ]);
    expect(res.shorts.map((s) => [s.videoId, s.alreadySubmitted])).toEqual([
      [vid(6), false],
      [vid(2), true],
      [vid(1), false],
    ]);
    expect(res.shorts[2]).toMatchObject({ title: "ok A", views: 1200, durationSec: 59, channelId: A, publishedAt: 1_050_000 });
    // quota: 1 channels.list for both channels, 1 playlistItems per channel, videos.list without pre-filtered ids
    expect(yt.channelCalls).toEqual([[A, B]]);
    expect(yt.playlistCalls).toEqual(["UUa-from-api", `UU${B.slice(2)}`]);
    expect(yt.calls).toHaveLength(1);
    expect(yt.calls[0]).not.toContain(vid(10));
  });

  it("wallet with no connected channel → empty, no YouTube calls", async () => {
    const { owners, yt } = setup();
    const res = await findEligibleShorts(owners, yt, campaign, addr(0xdead));
    expect(res).toEqual({ wallet: addr(0xdead), channels: [], shorts: [] });
    expect(yt.calls).toHaveLength(0);
    expect(yt.playlistCalls).toHaveLength(0);
  });

  it("caches the YouTube part ~60s but reads alreadySubmitted fresh", async () => {
    const { owners, yt } = setup();
    const cache = createEligibleCache(60_000);
    const first = await findEligibleShorts(owners, yt, campaign, wallet, cache, 0);
    expect(first.shorts.every((s) => !s.alreadySubmitted)).toBe(true);
    owners.submitted.set(2, new Set([vid(1)]));
    const second = await findEligibleShorts(owners, yt, campaign, wallet, cache, 30_000);
    expect(yt.calls).toHaveLength(1); // served from cache
    expect(second.shorts.find((s) => s.videoId === vid(1))!.alreadySubmitted).toBe(true);
    await findEligibleShorts(owners, yt, campaign, wallet, cache, 61_000);
    expect(yt.calls).toHaveLength(2); // expired
    // a newly connected channel changes the key → fresh fetch
    await owners.upsertOwners(wallet, [{ channelId: chId("c"), title: "C", thumbnailUrl: null }], new Date(3));
    await findEligibleShorts(owners, yt, campaign, wallet, cache, 62_000);
    expect(yt.calls).toHaveLength(3);
  });

  it("wallet comparison is case-insensitive and the response wallet is checksummed", async () => {
    const { owners, yt } = setup();
    const res = await findEligibleShorts(owners, yt, campaign, wallet.toLowerCase() as Address);
    expect(res.wallet).toBe(getAddress(wallet));
    expect(res.shorts).toHaveLength(3);
  });
});
