import { and, eq, inArray, sql } from "drizzle-orm";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { channelOwners, submissions } from "@/lib/db/schema";
import type {
  EligibleShort,
  EligibleShortsResponse,
  YouTubeChannel,
  YouTubeChannelsResponse,
} from "@/lib/shared/api-types";
import type { GoogleOAuth, OwnedChannel } from "./google";
import { HttpError, logError } from "./http";
import { staticRuleViolation, YT_BATCH, type ValidationCampaign, type YouTubeClient } from "./youtube";

// ───────────────────────────── persistence ─────────────────────────────

export interface ChannelOwner {
  channelId: string;
  wallet: string;
  channelTitle: string;
}

/** channel_owners access (Drizzle below; in-memory fake in tests). */
export interface ChannelOwnerStore {
  /** Upsert: the proven owner's latest choice of payout wallet wins. */
  upsertOwners(wallet: Address, channels: OwnedChannel[], verifiedAt: Date): Promise<void>;
  channelsOf(wallet: Address): Promise<ChannelOwner[]>;
  ownerOf(channelId: string): Promise<ChannelOwner | null>;
  /** Video ids with an accepted submission in the campaign. */
  submittedVideoIds(campaignId: number, videoIds: string[]): Promise<Set<string>>;
}

export function createDbChannelOwnerStore(db: Db): ChannelOwnerStore {
  return {
    async upsertOwners(wallet, channels, verifiedAt) {
      if (channels.length === 0) return;
      await db
        .insert(channelOwners)
        .values(channels.map((c) => ({ channelId: c.channelId, wallet, channelTitle: c.title, verifiedAt, method: "oauth" })))
        .onConflictDoUpdate({
          target: channelOwners.channelId,
          set: {
            wallet,
            // excluded.* = the row we tried to insert
            channelTitle: sqlExcluded("channel_title"),
            verifiedAt,
            method: "oauth",
          },
        });
    },
    async channelsOf(wallet) {
      return db
        .select({ channelId: channelOwners.channelId, wallet: channelOwners.wallet, channelTitle: channelOwners.channelTitle })
        .from(channelOwners)
        .where(eq(channelOwners.wallet, getAddress(wallet)))
        .orderBy(channelOwners.verifiedAt);
    },
    async ownerOf(channelId) {
      const [row] = await db
        .select({ channelId: channelOwners.channelId, wallet: channelOwners.wallet, channelTitle: channelOwners.channelTitle })
        .from(channelOwners)
        .where(eq(channelOwners.channelId, channelId));
      return row ?? null;
    },
    async submittedVideoIds(campaignId, videoIds) {
      if (videoIds.length === 0) return new Set();
      const rows = await db
        .select({ videoId: submissions.videoId })
        .from(submissions)
        .where(
          and(eq(submissions.campaignId, campaignId), inArray(submissions.videoId, videoIds), eq(submissions.status, "accepted")),
        );
      return new Set(rows.map((r) => r.videoId));
    },
  };
}

/** drizzle: reference the conflicting row's proposed value in ON CONFLICT DO UPDATE. */
const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`);

// ───────────────────────────── request schemas ─────────────────────────────

export const walletSchema = z
  .string()
  .trim()
  .refine((w) => isAddress(w, { strict: false }), "invalid wallet address")
  .transform((w) => getAddress(w));

export const ConnectBody = z.object({
  // Google access tokens are opaque ("ya29.…"), typically ~200 chars; bound it generously.
  accessToken: z.string().trim().min(20).max(4096),
  wallet: walletSchema,
});

export const WalletQuery = z.object({ wallet: walletSchema });

/** Parse `?wallet=` with the same 400 invalid_request shape as body validation. */
export function parseWalletQuery(url: string): Address {
  return WalletQuery.parse({ wallet: new URL(url).searchParams.get("wallet") ?? "" }).wallet;
}

// ───────────────────────────── connect ─────────────────────────────

/**
 * POST /api/youtube/connect core: verify the token belongs to our OAuth client with youtube.readonly,
 * read the caller's own channels, link each to the chosen payout wallet. The token is not kept.
 */
export async function connectYouTube(
  google: GoogleOAuth,
  owners: ChannelOwnerStore,
  input: { accessToken: string; wallet: Address },
  now: Date = new Date(),
): Promise<YouTubeChannelsResponse> {
  const wallet = getAddress(input.wallet);
  await google.verify(input.accessToken);
  const channels = await google.ownedChannels(input.accessToken);
  if (channels.length === 0) throw new HttpError(400, "no_channel", "This Google account has no YouTube channel.");
  await owners.upsertOwners(wallet, channels, now);
  return { wallet, channels: channels.map(({ channelId, title, thumbnailUrl }) => ({ channelId, title, thumbnailUrl })) };
}

/** Linked channels with live title/thumbnail (API key, 1 unit); stored title if YouTube is unavailable. */
async function withLiveDetails(
  youtube: YouTubeClient | null,
  rows: ChannelOwner[],
): Promise<{ channels: YouTubeChannel[]; uploads: Map<string, string> }> {
  const uploads = new Map<string, string>();
  let live = new Map<string, { title: string; thumbnailUrl?: string | null; uploadsPlaylistId?: string | null }>();
  if (youtube && rows.length) {
    try {
      live = await youtube.getChannels(rows.map((r) => r.channelId));
    } catch (err) {
      logError("youtube channels", err);
    }
  }
  const channels = rows.map((r) => {
    const l = live.get(r.channelId);
    // Uploads playlist id is "UU" + the channel id's suffix; prefer what the API says.
    uploads.set(r.channelId, l?.uploadsPlaylistId || `UU${r.channelId.slice(2)}`);
    return { channelId: r.channelId, title: l?.title || r.channelTitle, thumbnailUrl: l?.thumbnailUrl ?? null };
  });
  return { channels, uploads };
}

/** GET /api/youtube/channels core. */
export async function linkedChannels(
  owners: ChannelOwnerStore,
  youtube: YouTubeClient | null,
  wallet: Address,
): Promise<YouTubeChannelsResponse> {
  const rows = await owners.channelsOf(wallet);
  const { channels } = await withLiveDetails(youtube, rows);
  return { wallet: getAddress(wallet), channels };
}

// ───────────────────────────── eligible Shorts ─────────────────────────────

export const ELIGIBLE_TTL_MS = 60_000;
type Cached = { at: number; channels: YouTubeChannel[]; shorts: Omit<EligibleShort, "alreadySubmitted">[] };

/** Small per-instance TTL cache for the YouTube part (alreadySubmitted is always read fresh). */
export function createEligibleCache(ttlMs = ELIGIBLE_TTL_MS, maxEntries = 500) {
  const map = new Map<string, Cached>();
  return {
    get(key: string, now = Date.now()) {
      const hit = map.get(key);
      return hit && now - hit.at < ttlMs ? hit : undefined;
    },
    set(key: string, value: Omit<Cached, "at">, now = Date.now()) {
      if (map.size >= maxEntries) map.clear();
      map.set(key, { ...value, at: now });
    },
    size: () => map.size,
  };
}
export type EligibleCache = ReturnType<typeof createEligibleCache>;

export interface EligibleCampaign extends ValidationCampaign {
  id: number;
}

/**
 * Recent uploads (≤50 per connected channel) that pass the campaign's static rules.
 * Quota per uncached call: 1 (channels.list) + 1 per channel (playlistItems.list) + 1 per 50 videos.
 */
export async function findEligibleShorts(
  owners: ChannelOwnerStore,
  youtube: YouTubeClient,
  campaign: EligibleCampaign,
  wallet: Address,
  cache?: EligibleCache,
  nowMs: number = Date.now(),
): Promise<EligibleShortsResponse> {
  const checksummed = getAddress(wallet);
  const rows = await owners.channelsOf(checksummed);
  if (rows.length === 0) return { wallet: checksummed, channels: [], shorts: [] };

  const owned = new Set(rows.map((r) => r.channelId));
  const key = `${campaign.id}|${campaign.startTime}|${campaign.endTime}|${[...owned].sort().join(",")}`;
  let hit = cache?.get(key, nowMs);
  if (!hit) {
    const { channels, uploads } = await withLiveDetails(youtube, rows);
    const lists = await Promise.all([...uploads.values()].map((p) => youtube.getPlaylistItems(p, YT_BATCH)));
    // videoPublishedAt lets us skip obviously out-of-window uploads before spending videos.list quota.
    const ids = [
      ...new Set(
        lists
          .flat()
          .filter((it) => !Number.isFinite(it.publishedAt) || (it.publishedAt >= campaign.startTime && it.publishedAt <= campaign.endTime))
          .map((it) => it.videoId),
      ),
    ];
    const videos = await youtube.getVideos(ids);
    const shorts = [...videos.values()]
      .filter((v) => owned.has(v.channelId) && staticRuleViolation(v, campaign) === null)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .map((v) => ({
        videoId: v.id,
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        publishedAt: v.publishedAt,
        durationSec: v.durationSec ?? 0,
        views: Number.isFinite(v.viewCount) ? Math.max(0, Math.floor(v.viewCount)) : 0,
      }));
    hit = { at: nowMs, channels, shorts };
    cache?.set(key, { channels, shorts }, nowMs);
  }
  const submitted = await owners.submittedVideoIds(
    campaign.id,
    hit.shorts.map((s) => s.videoId),
  );
  return {
    wallet: checksummed,
    channels: hit.channels,
    shorts: hit.shorts.map((s) => ({ ...s, alreadySubmitted: submitted.has(s.videoId) })),
  };
}
