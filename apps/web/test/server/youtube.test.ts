import { bindingCode } from "@clippool/allocation";
import { describe, expect, it } from "vitest";
import {
  countableViews,
  createYouTubeClient,
  parseIsoDuration,
  parseVideoId,
  validateSubmission,
  YouTubeApiError,
  type ExistingState,
} from "@/lib/server/youtube";
import { addr, ytVideo } from "./helpers/fakes";

const ID = "dQw4w9WgXcQ";

describe("parseVideoId", () => {
  it.each([
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://youtube.com/shorts/${ID}?feature=share`, ID],
    [`https://m.youtube.com/shorts/${ID}`, ID],
    [`youtube.com/shorts/${ID}`, ID],
    [`http://www.youtube.com/watch?v=${ID}`, ID],
    [`https://www.youtube.com/watch?feature=shared&v=${ID}&t=10s`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
    [`https://music.youtube.com/watch?v=${ID}&list=RD`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://youtu.be/${ID}?si=abcDEF123`, ID],
    [`youtu.be/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}?si=x`, ID],
    [`https://www.youtube.com/shorts/${ID}/`, ID],
    [`  https://youtube.com/shorts/${ID}  `, ID],
    [ID, ID],
    ["https://youtube.com/shorts/abc-_DEF123", "abc-_DEF123"],
  ])("%s → %s", (url, id) => expect(parseVideoId(url)).toBe(id));

  it.each([
    "",
    "not a url",
    "https://example.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com.evil.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/short",
    "https://www.youtube.com/shorts/dQw4w9WgXcQX", // 12 chars
    "https://www.youtube.com/watch?v=",
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
    "ftp://youtu.be/dQw4w9WgXcQ",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(parseVideoId(url)).toBeNull());
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT59S", 59],
    ["PT1M", 60],
    ["PT1M30S", 90],
    ["PT3M", 180],
    ["PT3M1S", 181],
    ["PT1H2M3S", 3723],
    ["P0D", 0],
    ["P1DT2H", 93600],
    ["P1W", 604800],
    ["PT0.5S", 1],
  ])("%s → %i", (iso, sec) => expect(parseIsoDuration(iso)).toBe(sec));

  it.each(["", "P", "PT", "1M30S", "PT1X", "garbage"])("rejects %j", (iso) => expect(parseIsoDuration(iso)).toBeNull());
  it("handles null/undefined", () => {
    expect(parseIsoDuration(null)).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
  });
});

describe("validateSubmission", () => {
  const wallet = addr(0xc0ffee);
  const other = addr(0xbeef);
  const campaignId = 7n;
  const code = bindingCode(campaignId, wallet);
  const campaign = { startTime: 1_000_000, endTime: 1_100_000 };
  const now = 1_060_000;
  const channel = { id: "UC" + "a".repeat(22), title: "Chan", publishedAt: now - 31 * 86400 };
  const good = ytVideo({ id: ID, description: `Sponsored! ${code.toUpperCase()} #ad` });
  const fresh: ExistingState = { duplicate: false, channelWallet: null };
  const input = { campaignId, wallet, videoId: ID };
  const run = (over: { video?: unknown; channel?: unknown; existing?: Partial<ExistingState>; now?: number; campaign?: typeof campaign } = {}) =>
    validateSubmission(
      input,
      over.campaign ?? campaign,
      "video" in over ? (over.video as never) : good,
      "channel" in over ? (over.channel as never) : channel,
      { ...fresh, ...over.existing },
      over.now ?? now,
    );
  const reason = (r: ReturnType<typeof run>) => (r.status === "rejected" ? r.reason : "accepted");

  it("accepts a valid Short (binding code match is case-insensitive)", () => {
    expect(run()).toEqual({ status: "accepted", proof: "code" });
    // same wallet re-submitting another video on a locked channel is fine
    expect(reason(run({ existing: { channelWallet: wallet.toLowerCase() } }))).toBe("accepted");
  });
  it("campaign_not_live before start / after end; inclusive bounds", () => {
    expect(reason(run({ now: campaign.startTime - 1 }))).toBe("campaign_not_live");
    expect(reason(run({ now: campaign.endTime + 1 }))).toBe("campaign_not_live");
    expect(reason(run({ now: campaign.endTime }))).toBe("accepted");
  });
  it("duplicate", () => expect(reason(run({ existing: { duplicate: true } }))).toBe("duplicate"));
  it("video_not_found (missing or deleted)", () => {
    expect(reason(run({ video: null }))).toBe("video_not_found");
    expect(reason(run({ video: { ...good, uploadStatus: "deleted" } }))).toBe("video_not_found");
  });
  it("not_public (private, unlisted, rejected upload)", () => {
    expect(reason(run({ video: { ...good, privacyStatus: "private" } }))).toBe("not_public");
    expect(reason(run({ video: { ...good, privacyStatus: "unlisted" } }))).toBe("not_public");
    expect(reason(run({ video: { ...good, uploadStatus: "rejected" } }))).toBe("not_public");
  });
  it("not_short (>180s or unknown duration); exactly 180s passes", () => {
    expect(reason(run({ video: { ...good, durationSec: 181 } }))).toBe("not_short");
    expect(reason(run({ video: { ...good, durationSec: null } }))).toBe("not_short");
    expect(reason(run({ video: { ...good, durationSec: 180 } }))).toBe("accepted");
  });
  it("outside_window", () => {
    expect(reason(run({ video: { ...good, publishedAt: campaign.startTime - 1 } }))).toBe("outside_window");
    expect(reason(run({ video: { ...good, publishedAt: campaign.endTime + 1 } }))).toBe("outside_window");
    expect(reason(run({ video: { ...good, publishedAt: Number.NaN } }))).toBe("outside_window");
    expect(reason(run({ video: { ...good, publishedAt: campaign.startTime } }))).toBe("accepted");
  });
  it("missing_binding_code (absent, other wallet's code, other campaign's code)", () => {
    expect(reason(run({ video: { ...good, description: "no code" } }))).toBe("missing_binding_code");
    expect(reason(run({ video: { ...good, description: bindingCode(campaignId, other) } }))).toBe("missing_binding_code");
    expect(reason(run({ video: { ...good, description: bindingCode(8n, wallet) } }))).toBe("missing_binding_code");
  });
  it("channel_locked_to_other_wallet", () => {
    expect(reason(run({ existing: { channelWallet: other } }))).toBe("channel_locked_to_other_wallet");
  });
  it("channel_too_new (<30 days or unknown channel)", () => {
    expect(reason(run({ channel: { ...channel, publishedAt: now - 29 * 86400 } }))).toBe("channel_too_new");
    expect(reason(run({ channel: null }))).toBe("channel_too_new");
    expect(reason(run({ channel: { ...channel, publishedAt: now - 30 * 86400 } }))).toBe("accepted");
  });
  it("rejections carry a human message", () => {
    const r = run({ video: { ...good, description: "" } });
    expect(r.status === "rejected" && r.message).toBe(
      "Connect your YouTube channel, or add your binding code to the Short's description.",
    );
  });

  describe("ownership proof: oauth vs code vs neither", () => {
    const noCode = { ...good, description: "no code here" };
    it("oauth: channel connected to the submitting wallet (case-insensitive), no code needed", () => {
      expect(run({ video: noCode, existing: { channelOwner: wallet.toLowerCase() } })).toEqual({ status: "accepted", proof: "oauth" });
    });
    it("oauth wins when both proofs hold", () => {
      expect(run({ existing: { channelOwner: wallet } })).toEqual({ status: "accepted", proof: "oauth" });
    });
    it("code: channel connected to ANOTHER wallet still accepts a valid binding code", () => {
      expect(run({ existing: { channelOwner: other } })).toEqual({ status: "accepted", proof: "code" });
    });
    it("neither: no owner link and no code → missing_binding_code", () => {
      expect(reason(run({ video: noCode }))).toBe("missing_binding_code");
      expect(reason(run({ video: noCode, existing: { channelOwner: other } }))).toBe("missing_binding_code");
      expect(reason(run({ video: noCode, existing: { channelOwner: null } }))).toBe("missing_binding_code");
    });
    it("oauth path still enforces the static rules, the channel lock and channel age", () => {
      const owner = { channelOwner: wallet };
      expect(reason(run({ video: { ...noCode, durationSec: 181 }, existing: owner }))).toBe("not_short");
      expect(reason(run({ video: { ...noCode, privacyStatus: "unlisted" }, existing: owner }))).toBe("not_public");
      expect(reason(run({ video: { ...noCode, publishedAt: campaign.endTime + 1 }, existing: owner }))).toBe("outside_window");
      expect(reason(run({ video: noCode, existing: { ...owner, channelWallet: other } }))).toBe("channel_locked_to_other_wallet");
      expect(reason(run({ video: noCode, existing: owner, channel: { ...channel, publishedAt: now - 86400 } }))).toBe("channel_too_new");
      expect(reason(run({ video: noCode, existing: { ...owner, duplicate: true } }))).toBe("duplicate");
    });
  });
});

describe("countableViews", () => {
  it("deleted / private / missing videos count 0", () => {
    expect(countableViews(undefined)).toBe(0);
    expect(countableViews(ytVideo({ id: ID, privacyStatus: "private" }))).toBe(0);
    expect(countableViews(ytVideo({ id: ID, uploadStatus: "deleted" }))).toBe(0);
    expect(countableViews(ytVideo({ id: ID, viewCount: 1234 }))).toBe(1234);
  });
});

describe("createYouTubeClient", () => {
  const item = (id: string) => ({
    id,
    snippet: {
      channelId: "UCx",
      channelTitle: "X",
      title: "t",
      description: "d",
      publishedAt: "2026-10-01T00:00:00Z",
      thumbnails: { high: { url: "https://i.ytimg.com/x.jpg" } },
    },
    contentDetails: { duration: "PT45S" },
    status: { privacyStatus: "public", uploadStatus: "processed" },
    statistics: { viewCount: "4242" },
  });

  it("batches ≤50 ids per videos.list call with the right parts and maps fields", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      const ids = url.searchParams.get("id")!.split(",");
      return new Response(JSON.stringify({ items: ids.map(item) }), { status: 200 });
    }) as unknown as typeof fetch;
    const yt = createYouTubeClient("test-key-123456", fetchImpl);
    const ids = Array.from({ length: 120 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
    const out = await yt.getVideos([...ids, ids[0]!]); // duplicates are collapsed
    expect(urls.map((u) => u.searchParams.get("id")!.split(",").length)).toEqual([50, 50, 20]);
    expect(urls[0]!.pathname).toBe("/youtube/v3/videos");
    expect(urls[0]!.searchParams.get("part")).toBe("snippet,statistics,contentDetails,status");
    expect(out.size).toBe(120);
    expect(out.get(ids[3]!)).toMatchObject({ durationSec: 45, viewCount: 4242, privacyStatus: "public", publishedAt: 1790812800 });
    expect(await yt.getVideos([])).toEqual(new Map());
  });

  it("channels.list(part=snippet,contentDetails) → publishedAt, thumbnail, uploads playlist", async () => {
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      expect(url.pathname).toBe("/youtube/v3/channels");
      expect(url.searchParams.get("part")).toBe("snippet,contentDetails");
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "UCx",
              snippet: { title: "X", publishedAt: "2020-01-01T00:00:00Z", thumbnails: { default: { url: "https://yt3.ggpht.com/x" } } },
              contentDetails: { relatedPlaylists: { uploads: "UUx" } },
            },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const ch = await createYouTubeClient("test-key-123456", fetchImpl).getChannels(["UCx"]);
    expect(ch.get("UCx")).toEqual({
      id: "UCx",
      title: "X",
      publishedAt: 1577836800,
      thumbnailUrl: "https://yt3.ggpht.com/x",
      uploadsPlaylistId: "UUx",
    });
  });

  it("playlistItems.list(part=contentDetails) → video ids + videoPublishedAt; 404 → []", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      if (url.searchParams.get("playlistId") === "UUmissing") {
        return new Response(JSON.stringify({ error: { errors: [{ reason: "playlistNotFound" }] } }), { status: 404 });
      }
      return new Response(
        JSON.stringify({
          items: [
            { contentDetails: { videoId: "abcdefghijk", videoPublishedAt: "2026-10-01T00:00:00Z" } },
            { contentDetails: { videoId: "bad" } },
            { contentDetails: { videoId: "abcdefghijl" } },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const yt = createYouTubeClient("test-key-123456", fetchImpl);
    const items = await yt.getPlaylistItems("UUx", 500);
    expect(urls[0]!.pathname).toBe("/youtube/v3/playlistItems");
    expect(urls[0]!.searchParams.get("part")).toBe("contentDetails");
    expect(urls[0]!.searchParams.get("maxResults")).toBe("50");
    expect(items).toEqual([
      { videoId: "abcdefghijk", publishedAt: 1790812800 },
      { videoId: "abcdefghijl", publishedAt: Number.NaN },
    ]);
    expect(await yt.getPlaylistItems("UUmissing")).toEqual([]);
  });

  it("errors carry the API reason but never the key/URL", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 })) as unknown as typeof fetch;
    const err = await createYouTubeClient("secret-key-abcdef", fetchImpl).getVideos([ID]).catch((e) => e);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect(err.message).toContain("quotaExceeded");
    expect(err.message).not.toContain("secret-key");
  });
});
