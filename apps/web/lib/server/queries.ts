import "server-only";
import { estimateShares } from "@clippool/allocation";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { allocations, campaignMeta, campaigns, snapshots, submissions, viewObservations } from "@/lib/db/schema";
import type { CampaignMetaRow, CampaignRow } from "@/lib/db/schema";
import type {
  CampaignDetail,
  CampaignSummary,
  LeaderboardEntry,
  LeaderboardResponse,
  ReceiptsResponse,
} from "@/lib/shared/api-types";
import { TOKENS, type ChainKey } from "@/lib/shared/chain";
import { deriveCampaignStatus } from "@/lib/shared/status";
import { YT_RETENTION_SEC } from "./store";

type Hex = `0x${string}`;

export function tokenSymbolOf(token: string, chainKey: ChainKey): "USDC" | "EURC" {
  return token.toLowerCase() === TOKENS[chainKey].EURC.toLowerCase() ? "EURC" : "USDC";
}

/** @param disputeWindow the contract's DISPUTE_WINDOW() in seconds (getContractWindows). */
export function statusOf(c: CampaignRow, now: number, disputeWindow: number) {
  return deriveCampaignStatus(
    {
      startTime: c.startTime,
      endTime: c.endTime,
      snapshotTime: c.snapshotTime,
      rootPostedAt: c.rootPostedAt,
      disputeEndsAt: c.disputeEndsAt,
      totalAllocated: c.totalAllocated,
      claimed: c.claimed,
      unclaimedSwept: c.unclaimedSwept,
      noRootRefunded: c.noRootRefunded,
    },
    now,
    disputeWindow,
  );
}

export function toSummary(
  c: CampaignRow,
  meta: Pick<CampaignMetaRow, "title" | "verified"> | null,
  counts: { submissions: number; creators: number },
  chainKey: ChainKey,
  now: number,
  disputeWindow: number,
): CampaignSummary {
  return {
    id: String(c.id),
    brand: c.brand as Hex,
    token: c.token as Hex,
    tokenSymbol: tokenSymbolOf(c.token, chainKey),
    pool: c.pool,
    startTime: c.startTime,
    endTime: c.endTime,
    snapshotTime: c.snapshotTime,
    maxShareBps: c.maxShareBps,
    minViews: c.minViews,
    status: statusOf(c, now, disputeWindow),
    title: meta?.verified ? meta.title : null,
    submissionsCount: counts.submissions,
    creatorsCount: counts.creators,
    disputeWindow,
  };
}

export function toDetail(
  c: CampaignRow,
  meta: Pick<CampaignMetaRow, "title" | "rules" | "verified"> | null,
  counts: { submissions: number; creators: number },
  chainKey: ChainKey,
  now: number,
  disputeWindow: number,
): CampaignDetail {
  return {
    ...toSummary(c, meta, counts, chainKey, now, disputeWindow),
    rules: meta?.verified ? meta.rules : null,
    rulesHash: c.rulesHash as Hex,
    createTx: (c.createTx as Hex | null) ?? null,
    root: (c.rootPostedAt ? (c.root as Hex) : null) ?? null,
    totalAllocated: c.rootPostedAt ? c.totalAllocated : null,
    claimed: c.claimed,
    disputeEndsAt: c.disputeEndsAt ?? null,
  };
}

const countsSql = {
  submissions: sql<number>`(select count(*)::int from ${submissions} s where s.campaign_id = ${campaigns.id} and s.status = 'accepted')`,
  creators: sql<number>`(select count(distinct lower(s.wallet))::int from ${submissions} s where s.campaign_id = ${campaigns.id} and s.status = 'accepted')`,
};

export async function listCampaigns(db: Db, chainKey: ChainKey, now: number, disputeWindow: number): Promise<CampaignSummary[]> {
  const rows = await db
    .select({ c: campaigns, title: campaignMeta.title, verified: campaignMeta.verified, ...countsSql })
    .from(campaigns)
    .leftJoin(campaignMeta, eq(campaignMeta.campaignId, campaigns.id))
    .orderBy(desc(campaigns.id))
    .limit(200);
  return rows.map((r) =>
    toSummary(r.c, r.title !== null ? { title: r.title, verified: !!r.verified } : null, { submissions: Number(r.submissions), creators: Number(r.creators) }, chainKey, now, disputeWindow),
  );
}

export async function getCampaignDetail(
  db: Db,
  id: number,
  chainKey: ChainKey,
  now: number,
  disputeWindow: number,
): Promise<CampaignDetail | null> {
  const [r] = await db
    .select({ c: campaigns, meta: campaignMeta, ...countsSql })
    .from(campaigns)
    .leftJoin(campaignMeta, eq(campaignMeta.campaignId, campaigns.id))
    .where(eq(campaigns.id, id));
  if (!r) return null;
  return toDetail(r.c, r.meta, { submissions: Number(r.submissions), creators: Number(r.creators) }, chainKey, now, disputeWindow);
}

export async function getCampaignRow(db: Db, id: number): Promise<CampaignRow | null> {
  const [r] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return r ?? null;
}

// ───────────────────────────── leaderboard ─────────────────────────────

export interface LeaderboardRow {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnailUrl: string | null;
  wallet: string;
  views: number | null; // latest observation ≤ 30 days old, null if none
}

/** Pure: aggregate per wallet and estimate shares with the allocation engine on current views. */
export function buildLeaderboard(
  campaign: { id: number; pool: string; maxShareBps: number; minViews: number },
  rows: LeaderboardRow[],
  updatedAt: number,
): LeaderboardResponse {
  const { shares: estimates } = estimateShares(
    { pool: BigInt(campaign.pool), maxShareBps: campaign.maxShareBps, minViews: BigInt(campaign.minViews) },
    rows.map((r) => ({ videoId: r.videoId, channelId: r.channelId, wallet: r.wallet, views: BigInt(r.views ?? 0) })),
  );
  const byWallet = new Map(estimates.map((e) => [e.wallet.toLowerCase(), e]));
  const groups = new Map<string, LeaderboardEntry>();
  for (const r of rows) {
    const key = r.wallet.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      const est = byWallet.get(key);
      g = {
        wallet: (est?.wallet ?? r.wallet) as Hex,
        channels: [],
        videos: [],
        views: 0,
        estimatedAmount: est ? est.amount.toString() : "0",
        sharePct: est ? est.sharePct : 0,
      };
      groups.set(key, g);
    }
    if (!g.channels.some((c) => c.channelId === r.channelId)) g.channels.push({ channelId: r.channelId, title: r.channelTitle });
    g.videos.push({ videoId: r.videoId, title: r.title, views: r.views ?? 0, thumbnailUrl: r.thumbnailUrl });
    g.views += r.views ?? 0;
  }
  const entries = [...groups.values()].sort((a, b) => {
    const d = BigInt(b.estimatedAmount) - BigInt(a.estimatedAmount);
    return d !== 0n ? (d > 0n ? 1 : -1) : b.views - a.views || (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1);
  });
  for (const e of entries) e.videos.sort((a, b) => b.views - a.views);
  return { updatedAt, totalViews: entries.reduce((s, e) => s + e.views, 0), entries };
}

export async function leaderboardRows(db: Db, campaignId: number, now: number): Promise<LeaderboardRow[]> {
  const cutoff = new Date((now - YT_RETENTION_SEC) * 1000);
  const latestViews = sql<number | null>`(
    select vo.views from ${viewObservations} vo
    where vo.submission_id = ${submissions.id} and vo.fetched_at > ${cutoff.toISOString()}::timestamptz
    order by vo.fetched_at desc limit 1)`;
  const rows = await db
    .select({
      videoId: submissions.videoId,
      channelId: submissions.channelId,
      channelTitle: submissions.channelTitle,
      title: submissions.title,
      thumbnailUrl: submissions.thumbnailUrl,
      wallet: submissions.wallet,
      views: latestViews,
    })
    .from(submissions)
    .where(and(eq(submissions.campaignId, campaignId), eq(submissions.status, "accepted")));
  return rows.map((r) => ({ ...r, views: r.views === null ? null : Number(r.views) }));
}

// ───────────────────────────── receipts / snapshot ─────────────────────────────

export async function getReceipts(db: Db, c: CampaignRow): Promise<ReceiptsResponse> {
  const posted = !!c.rootPostedAt;
  const rows = posted
    ? await db
        .select({ wallet: allocations.wallet, amount: allocations.amount, status: allocations.status, claimTx: allocations.claimTx })
        .from(allocations)
        .where(and(eq(allocations.campaignId, c.id), eq(allocations.root, (c.root ?? "").toLowerCase())))
        .orderBy(allocations.wallet)
    : [];
  return {
    root: posted ? (c.root as Hex) : null,
    totalAllocated: posted ? c.totalAllocated : null,
    snapshotHash: posted ? (c.snapshotHash as Hex | null) : null,
    disputeEndsAt: c.disputeEndsAt ?? null,
    allocations: rows.map((r) => ({
      wallet: r.wallet as Hex,
      amount: r.amount,
      status: (["pending", "paid", "failed"].includes(r.status) ? r.status : "pending") as "pending" | "paid" | "failed",
      claimTx: (r.claimTx as Hex | null) ?? null,
    })),
  };
}

/** The snapshot whose hash is posted onchain, unless purged (30-day YouTube retention). */
export async function getPublishedSnapshot(db: Db, c: CampaignRow): Promise<{ json: unknown; hash: string } | null> {
  if (!c.rootPostedAt || !c.snapshotHash) return null;
  const [row] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.campaignId, c.id), eq(snapshots.hash, c.snapshotHash.toLowerCase())))
    .orderBy(desc(snapshots.createdAt))
    .limit(1);
  if (!row || row.json === null || row.purgeAfter.getTime() <= Date.now()) return null;
  return { json: row.json, hash: row.hash };
}
