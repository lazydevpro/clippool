import { bindingCode } from "@clippool/allocation";
import type { SubmissionRejectReason } from "@/lib/shared/api-types";

// ───────────────────────────── URL parsing ─────────────────────────────

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

/**
 * Extract the 11-char video id from the URL forms creators paste:
 * youtube.com/shorts/ID, youtube.com/watch?v=ID, youtu.be/ID, m./www./music. hosts,
 * /embed/ID, /live/ID, /v/ID — with or without scheme and with any extra query params.
 * A bare 11-char id is accepted too. Returns null for anything else.
 */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (VIDEO_ID.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined;
  if (SHORT_HOSTS.has(host)) {
    id = parts[0];
  } else if (YT_HOSTS.has(host)) {
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

// ───────────────────────────── ISO-8601 durations ─────────────────────────────

const ISO_DURATION =
  /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** "PT1M30S" → 90, "P0D" → 0, "P1DT2H" → 93600. Returns null when malformed. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = ISO_DURATION.exec(value.trim());
  if (!m || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const [w, d, h, min, sec] = m.slice(1).map((x) => (x ? Number(x) : 0));
  return Math.round(w! * 604800 + d! * 86400 + h! * 3600 + min! * 60 + sec!);
}

// ───────────────────────────── API client ─────────────────────────────

export interface YtVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: number; // unix seconds
  durationSec: number | null;
  privacyStatus: string; // "public" | "unlisted" | "private"
  uploadStatus: string; // "processed" | "uploaded" | "deleted" | "failed" | "rejected"
  viewCount: number;
  thumbnailUrl: string | null;
}

export interface YtChannel {
  id: string;
  title: string;
  publishedAt: number; // unix seconds
  thumbnailUrl?: string | null;
  /** contentDetails.relatedPlaylists.uploads ("UU…"), when YouTube returns it. */
  uploadsPlaylistId?: string | null;
}

export interface YtPlaylistItem {
  videoId: string;
  /** contentDetails.videoPublishedAt (unix seconds) — NaN when YouTube omits it. */
  publishedAt: number;
}

export interface YouTubeClient {
  /** Missing ids are absent from the map (deleted / never existed / private to the key). */
  getVideos(ids: string[]): Promise<Map<string, YtVideo>>;
  getChannels(ids: string[]): Promise<Map<string, YtChannel>>;
  /** Newest-first items of a playlist (one playlistItems.list page, ≤50). Unknown playlist → []. */
  getPlaylistItems(playlistId: string, max?: number): Promise<YtPlaylistItem[]>;
}

export class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`YouTube API error ${status}: ${reason}`);
    this.name = "YouTubeApiError";
  }
}

const API = "https://www.googleapis.com/youtube/v3";
export const YT_BATCH = 50;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const toUnix = (iso: string | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : NaN);

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapVideo(item: any): YtVideo {
  const sn = item.snippet ?? {};
  const thumbs = sn.thumbnails ?? {};
  return {
    id: item.id,
    channelId: sn.channelId ?? "",
    channelTitle: sn.channelTitle ?? "",
    title: sn.title ?? "",
    description: sn.description ?? "",
    publishedAt: toUnix(sn.publishedAt),
    durationSec: parseIsoDuration(item.contentDetails?.duration),
    privacyStatus: item.status?.privacyStatus ?? "unknown",
    uploadStatus: item.status?.uploadStatus ?? "unknown",
    viewCount: Number(item.statistics?.viewCount ?? 0),
    thumbnailUrl: pickThumbnail(thumbs),
  };
}

/** Best thumbnail URL from a YouTube `thumbnails` object. */
export function pickThumbnail(thumbs: any): string | null {
  const t = thumbs ?? {};
  return (t.high ?? t.medium ?? t.default)?.url ?? null;
}

/** Throws YouTubeApiError with the API's reason; never echoes the URL (it may contain the key). */
export async function throwYouTubeError(res: Response): Promise<never> {
  let reason = res.statusText;
  try {
    const body = (await res.json()) as any;
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? reason;
  } catch {}
  throw new YouTubeApiError(res.status, String(reason));
}

export function mapChannel(it: any): YtChannel {
  return {
    id: it.id,
    title: it.snippet?.title ?? "",
    publishedAt: toUnix(it.snippet?.publishedAt),
    thumbnailUrl: pickThumbnail(it.snippet?.thumbnails),
    uploadsPlaylistId: it.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export function createYouTubeClient(apiKey: string, fetchImpl: typeof fetch = fetch): YouTubeClient {
  const get = (resource: string, qs: URLSearchParams) =>
    fetchImpl(`${API}/${resource}?${qs}`, { headers: { accept: "application/json" }, cache: "no-store" });
  async function list(resource: "videos" | "channels", part: string, ids: string[]): Promise<any[]> {
    const items: any[] = [];
    for (const batch of chunk([...new Set(ids)], YT_BATCH)) {
      const res = await get(resource, new URLSearchParams({ part, id: batch.join(","), maxResults: String(YT_BATCH), key: apiKey }));
      if (!res.ok) await throwYouTubeError(res);
      const body = (await res.json()) as any;
      items.push(...(body.items ?? []));
    }
    return items;
  }
  return {
    async getVideos(ids) {
      if (ids.length === 0) return new Map();
      const items = await list("videos", "snippet,statistics,contentDetails,status", ids);
      return new Map(items.map((it) => [it.id as string, mapVideo(it)]));
    },
    async getChannels(ids) {
      if (ids.length === 0) return new Map();
      // Same 1-unit cost with contentDetails; it carries the uploads playlist id.
      const items = await list("channels", "snippet,contentDetails", ids);
      return new Map(items.map((it) => [it.id as string, mapChannel(it)]));
    },
    async getPlaylistItems(playlistId, max = YT_BATCH) {
      const qs = new URLSearchParams({
        part: "contentDetails",
        playlistId,
        maxResults: String(Math.min(Math.max(1, max), YT_BATCH)),
        key: apiKey,
      });
      const res = await get("playlistItems", qs);
      if (res.status === 404) return []; // playlistNotFound: channel without uploads
      if (!res.ok) await throwYouTubeError(res);
      const body = (await res.json()) as any;
      return ((body.items ?? []) as any[])
        .map((it) => ({ videoId: it.contentDetails?.videoId as string, publishedAt: toUnix(it.contentDetails?.videoPublishedAt) }))
        .filter((it) => typeof it.videoId === "string" && VIDEO_ID.test(it.videoId));
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Views that count at snapshot time: deleted / non-public / missing videos count 0. */
export function countableViews(video: YtVideo | undefined): number {
  if (!video) return 0;
  if (video.privacyStatus !== "public") return 0;
  if (["deleted", "failed", "rejected"].includes(video.uploadStatus)) return 0;
  return Number.isFinite(video.viewCount) && video.viewCount > 0 ? Math.floor(video.viewCount) : 0;
}

// ───────────────────────────── validation ─────────────────────────────

export const MAX_SHORT_DURATION_SEC = 180;
export const MIN_CHANNEL_AGE_SEC = 30 * 86400;

export interface ValidationInput {
  campaignId: bigint | number | string;
  wallet: `0x${string}`;
  videoId: string;
}
export interface ValidationCampaign {
  startTime: number;
  endTime: number;
}
export interface ExistingState {
  /** This video already has an accepted submission in this campaign. */
  duplicate: boolean;
  /** Wallet the channel is locked to in this campaign, if any. */
  channelWallet: string | null;
  /** Payout wallet the channel's proven owner linked via Google OAuth (channel_owners), if any. */
  channelOwner?: string | null;
}
export type SubmissionProof = "oauth" | "code";
export type ValidationResult =
  | { status: "accepted"; proof: SubmissionProof }
  | { status: "rejected"; reason: SubmissionRejectReason; message: string };
type PrecheckResult = { status: "ok" } | Extract<ValidationResult, { status: "rejected" }>;

export const MISSING_PROOF_MESSAGE = "Connect your YouTube channel, or add your binding code to the Short's description.";

const reject = (reason: SubmissionRejectReason, message: string): Extract<ValidationResult, { status: "rejected" }> => ({
  status: "rejected",
  reason,
  message,
});

/** Checks that need no YouTube call (lets the route skip quota on obvious rejects). */
export function precheckSubmission(
  campaign: ValidationCampaign,
  existing: Pick<ExistingState, "duplicate">,
  now: number,
): PrecheckResult {
  if (now < campaign.startTime || now > campaign.endTime) {
    return reject("campaign_not_live", "This campaign is not accepting submissions right now.");
  }
  if (existing.duplicate) return reject("duplicate", "This video was already submitted to this campaign.");
  return { status: "ok" };
}

/** Static campaign rules a video must meet regardless of proof (public, Shorts length, in window). */
export function staticRuleViolation(
  video: YtVideo,
  campaign: ValidationCampaign,
): Extract<ValidationResult, { status: "rejected" }> | null {
  if (video.uploadStatus === "deleted") return reject("video_not_found", "Video not found.");
  if (video.privacyStatus !== "public" || ["failed", "rejected"].includes(video.uploadStatus)) {
    return reject("not_public", "The video must be public.");
  }
  if (video.durationSec === null || video.durationSec > MAX_SHORT_DURATION_SEC) {
    return reject("not_short", `Shorts must be ${MAX_SHORT_DURATION_SEC} seconds or shorter.`);
  }
  if (!(video.publishedAt >= campaign.startTime && video.publishedAt <= campaign.endTime)) {
    return reject("outside_window", "The video must be published during the campaign.");
  }
  return null;
}

/**
 * Proof that the submitter controls the video: the channel's OAuth-proven owner linked this wallet
 * ("oauth"), or the description contains the campaign+wallet binding code ("code"). OAuth wins.
 */
export function proofOf(
  input: ValidationInput,
  video: Pick<YtVideo, "description">,
  channelOwner: string | null | undefined,
): SubmissionProof | null {
  if (channelOwner && channelOwner.toLowerCase() === input.wallet.toLowerCase()) return "oauth";
  const code = bindingCode(BigInt(input.campaignId), input.wallet);
  if (video.description.toLowerCase().includes(code)) return "code";
  return null;
}

/**
 * Pure submission validation (spec §5.2). Order: campaign live → duplicate → video exists →
 * public → Shorts length → published in window → proof (OAuth owner or binding code) →
 * channel wallet lock → channel age.
 */
export function validateSubmission(
  input: ValidationInput,
  campaign: ValidationCampaign,
  video: YtVideo | null | undefined,
  channel: YtChannel | null | undefined,
  existing: ExistingState,
  now: number = Math.floor(Date.now() / 1000),
): ValidationResult {
  const pre = precheckSubmission(campaign, existing, now);
  if (pre.status === "rejected") return pre;
  if (!video) return reject("video_not_found", "Video not found.");
  const violation = staticRuleViolation(video, campaign);
  if (violation) return violation;
  const proof = proofOf(input, video, existing.channelOwner);
  if (!proof) return reject("missing_binding_code", MISSING_PROOF_MESSAGE);
  if (existing.channelWallet && existing.channelWallet.toLowerCase() !== input.wallet.toLowerCase()) {
    return reject(
      "channel_locked_to_other_wallet",
      "This channel is already linked to a different payout wallet for this campaign.",
    );
  }
  if (!channel || !Number.isFinite(channel.publishedAt) || now - channel.publishedAt < MIN_CHANNEL_AGE_SEC) {
    return reject("channel_too_new", "Channels must be at least 30 days old.");
  }
  return { status: "accepted", proof };
}
