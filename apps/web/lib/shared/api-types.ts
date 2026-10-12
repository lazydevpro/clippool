// HTTP contract between apps/web frontend and backend (app/api/**).
// All token amounts are decimal strings in base units (6 decimals). Timestamps are unix seconds.

export type CampaignStatus =
  | "upcoming"   // now < startTime
  | "live"       // accepting submissions
  | "measuring"  // endTime ≤ now < snapshotTime
  | "allocating" // snapshotTime passed, root not posted yet
  | "disputing"  // root posted, inside dispute window
  | "paying"     // dispute window over, payouts in progress
  | "completed"  // all allocations paid (or swept)
  | "refunded";  // no root in time → brand refunded

export interface CampaignSummary {
  id: string;
  brand: `0x${string}`;
  token: `0x${string}`;
  tokenSymbol: "USDC" | "EURC";
  pool: string;
  startTime: number;
  endTime: number;
  snapshotTime: number;
  maxShareBps: number;
  minViews: number;
  status: CampaignStatus;
  title: string | null;
  submissionsCount: number;
  creatorsCount: number;
  /** The contract's DISPUTE_WINDOW() in seconds (deploy-time immutable: mainnet 172800, testnet 600). */
  disputeWindow: number;
}

export interface CampaignDetail extends CampaignSummary {
  rules: string | null;
  rulesHash: `0x${string}`;
  createTx: `0x${string}` | null;
  root: `0x${string}` | null;
  totalAllocated: string | null;
  claimed: string;
  disputeEndsAt: number | null;
}

/** GET /api/campaigns → { campaigns: CampaignSummary[] } */
export interface CampaignListResponse { campaigns: CampaignSummary[] }

/** POST /api/campaigns/:id/meta — brand attaches title + rules after createCampaign tx.
 *  Backend checks keccak256(utf8(rules)) == onchain rulesHash. */
export interface CampaignMetaRequest { title: string; rules: string; createTx: `0x${string}` }

export interface LeaderboardVideo { videoId: string; title: string; views: number; thumbnailUrl: string | null }
export interface LeaderboardEntry {
  wallet: `0x${string}`;
  channels: { channelId: string; title: string }[];
  videos: LeaderboardVideo[];
  views: number;
  estimatedAmount: string; // pro-rata estimate with current views (allocation engine)
  sharePct: number;        // 0–100
}
/** GET /api/campaigns/:id/leaderboard */
export interface LeaderboardResponse { updatedAt: number; totalViews: number; entries: LeaderboardEntry[] }

/** POST /api/submissions */
export interface SubmissionRequest { campaignId: string; videoUrl: string; wallet: `0x${string}` }
export type SubmissionRejectReason =
  | "invalid_url" | "video_not_found" | "not_public" | "not_short" | "outside_window"
  | "missing_binding_code" | "duplicate" | "channel_locked_to_other_wallet"
  | "campaign_not_live" | "channel_too_new";
export interface SubmissionResponse {
  status: "accepted" | "rejected";
  reason?: SubmissionRejectReason;
  message?: string;
  submission?: {
    videoId: string;
    channelId: string;
    channelTitle: string;
    title: string;
    views: number;
    /** How ownership was proven: connected channel ("oauth") or binding code in the description ("code"). */
    proof?: "oauth" | "code";
  };
}

/** GET /api/campaigns/:id/receipts */
export interface ReceiptsResponse {
  root: `0x${string}` | null;
  totalAllocated: string | null;
  snapshotHash: `0x${string}` | null;
  disputeEndsAt: number | null;
  allocations: {
    wallet: `0x${string}`;
    amount: string;
    status: "pending" | "paid" | "failed";
    claimTx: `0x${string}` | null;
  }[];
}

/** GET /api/campaigns/:id/snapshot → the published snapshot JSON (available ≤30 days after snapshot). */

// ── Circle user-controlled wallets (creator login) ──
/** POST /api/circle/social-token { deviceId } → { deviceToken, deviceEncryptionKey } */
export interface CircleSocialTokenResponse { deviceToken: string; deviceEncryptionKey: string }
/** POST /api/circle/initialize { userToken } → { challengeId | null, wallets } (creates ARC wallet if missing) */
export interface CircleInitializeResponse { challengeId: string | null; wallets: { id: string; address: `0x${string}`; blockchain: string }[] }
/** GET /api/circle/wallets (header: x-user-token) → { wallets: [...], balances: { [address]: { USDC: string; EURC: string } } } */
export interface CircleWalletsResponse {
  wallets: { id: string; address: `0x${string}`; blockchain: string }[];
  balances: Record<string, { USDC: string; EURC: string }>;
}

/** Cron routes (GET, header Authorization: Bearer $CRON_SECRET):
 *  /api/cron/sync      index CampaignCreated/RootPosted/Claimed events → DB
 *  /api/cron/refresh   refresh views for live/measuring campaigns
 *  /api/cron/snapshot  final snapshot → allocation → postRoot
 *  /api/cron/keeper    push claimMany after dispute window */

// ── Additions (web-backend) ──
/** POST /api/campaigns/:id/meta → 201 (first write) or 200 (identical re-post); 409 if already set differently. */
export interface CampaignMetaResponse { ok: true; campaignId: string }
/** Every non-2xx JSON response from app/api/**. `details` carries zod field errors on 400 invalid_request. */
export interface ApiErrorResponse { error: { code: string; message: string; details?: unknown } }
/** /api/cron/purge (daily): delete view observations > 30 days, null expired snapshot JSON. */

// ── Connect YouTube (Google OAuth, youtube.readonly) ──
export interface YouTubeChannel { channelId: string; title: string; thumbnailUrl: string | null }
/** POST /api/youtube/connect — `accessToken` is a Google token-client access token; verified, used once, never stored.
 *  400 no_channel (Google account has no YouTube channel) · 401 invalid_token (bad / expired / other app / missing scope). */
export interface YouTubeConnectRequest { accessToken: string; wallet: `0x${string}` }
/** POST /api/youtube/connect and GET /api/youtube/channels?wallet=0x… */
export interface YouTubeChannelsResponse { wallet: `0x${string}`; channels: YouTubeChannel[] }
export interface EligibleShort {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: number; // unix seconds
  durationSec: number;
  views: number;
  /** An accepted submission for this video already exists in this campaign. */
  alreadySubmitted: boolean;
}
/** GET /api/campaigns/:id/eligible-shorts?wallet=0x… — recent uploads (≤50 per channel) of the wallet's
 *  connected channels that pass the static rules (public, ≤180 s, published in [startTime, endTime]). */
export interface EligibleShortsResponse { wallet: `0x${string}`; channels: YouTubeChannel[]; shorts: EligibleShort[] }
