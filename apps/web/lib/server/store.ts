import "server-only";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import type { Db } from "@/lib/db";
import { allocations, campaigns, snapshots, submissions, syncState, viewObservations } from "@/lib/db/schema";
import type { CampaignRow } from "@/lib/db/schema";
import { ROOT_DEADLINE } from "@/lib/shared/status";
import { disputeEndsAtOf, type OnchainCampaign } from "./chain";

export const YT_RETENTION_SEC = 30 * 86400;

export interface SubmissionRef {
  id: number;
  videoId: string;
  channelId: string;
  wallet: string;
}

export interface PendingAllocation {
  wallet: Address;
  amount: bigint;
  proof: Hex[];
}

export interface SaveSnapshotInput {
  campaignId: number;
  json: unknown;
  hash: Hex;
  root: Hex;
  createdAt: Date;
  purgeAfter: Date;
  allocations: { wallet: string; amount: string; proof: Hex[] }[];
}

/** Persistence surface used by the cron jobs (Drizzle below; in-memory fakes in tests). */
export interface JobStore {
  // sync
  getLastSyncedBlock(chainId: number): Promise<bigint | null>;
  setLastSyncedBlock(chainId: number, block: bigint): Promise<void>;
  /** `disputeWindow` = the contract's DISPUTE_WINDOW() (ChainGateway.getWindows), used for disputeEndsAt. */
  upsertCampaign(
    id: number,
    c: OnchainCampaign,
    disputeWindow: number,
    extra?: { createTx?: Hex; createdBlock?: number; rootTx?: Hex },
  ): Promise<void>;
  markNoRootRefunded(id: number): Promise<void>;
  onRootCancelled(id: number, root: Hex): Promise<void>;
  markClaimPaid(id: number, wallet: string, tx: Hex | null): Promise<void>;
  markClaimFailed(id: number, wallet: string, reason: string, tx: Hex | null): Promise<void>;
  // oracle
  campaignsAwaitingRoot(now: number): Promise<CampaignRow[]>;
  acceptedSubmissions(campaignId: number): Promise<SubmissionRef[]>;
  recordViews(rows: { submissionId: number; views: number }[], fetchedAt: Date): Promise<void>;
  saveSnapshot(input: SaveSnapshotInput): Promise<void>;
  setOracleNote(id: number, note: string, opts?: { hold?: boolean; rootTx?: Hex }): Promise<void>;
  // keeper
  campaignsReadyForPayout(now: number): Promise<CampaignRow[]>;
  pendingAllocations(campaignId: number, root: Hex): Promise<PendingAllocation[]>;
  // refresh
  submissionsToRefresh(now: number): Promise<SubmissionRef[]>;
  // purge
  purge(now: Date): Promise<{ observationsDeleted: number; snapshotsPurged: number }>;
}

export function campaignRowFromChain(id: number, c: OnchainCampaign, disputeWindow: number) {
  const posted = c.rootPostedAt > 0;
  return {
    id,
    brand: getAddress(c.brand),
    token: getAddress(c.token),
    pool: c.pool.toString(),
    startTime: c.startTime,
    endTime: c.endTime,
    snapshotTime: c.snapshotTime,
    maxShareBps: c.maxShareBps,
    minViews: c.minViews,
    rulesHash: c.rulesHash.toLowerCase(),
    root: posted ? c.root.toLowerCase() : null,
    totalAllocated: posted ? c.totalAllocated.toString() : null,
    snapshotHash: posted ? c.snapshotHash.toLowerCase() : null,
    rootPostedAt: posted ? c.rootPostedAt : null,
    disputeEndsAt: disputeEndsAtOf(c, disputeWindow),
    claimed: c.claimed.toString(),
    remainderRefunded: c.remainderRefunded,
    unclaimedSwept: c.unclaimedSwept,
  };
}

export function createDbStore(db: Db): JobStore {
  return {
    async getLastSyncedBlock(chainId) {
      const [row] = await db.select().from(syncState).where(eq(syncState.chainId, chainId));
      return row ? row.lastBlock : null;
    },
    async setLastSyncedBlock(chainId, block) {
      await db
        .insert(syncState)
        .values({ chainId, lastBlock: block })
        .onConflictDoUpdate({ target: syncState.chainId, set: { lastBlock: block, updatedAt: new Date() } });
    },
    async upsertCampaign(id, c, disputeWindow, extra = {}) {
      const row = campaignRowFromChain(id, c, disputeWindow);
      const set = { ...row, updatedAt: new Date() } as Record<string, unknown>;
      delete set.id;
      if (extra.createTx) set.createTx = extra.createTx;
      if (extra.createdBlock !== undefined) set.createdBlock = extra.createdBlock;
      if (extra.rootTx) set.rootTx = extra.rootTx;
      await db
        .insert(campaigns)
        .values({ ...row, createTx: extra.createTx, createdBlock: extra.createdBlock, rootTx: extra.rootTx })
        .onConflictDoUpdate({ target: campaigns.id, set });
    },
    async markNoRootRefunded(id) {
      await db.update(campaigns).set({ noRootRefunded: true, updatedAt: new Date() }).where(eq(campaigns.id, id));
    },
    async onRootCancelled(id, root) {
      await db.batch([
        db.delete(allocations).where(and(eq(allocations.campaignId, id), eq(allocations.root, root.toLowerCase()))),
        db
          .update(campaigns)
          .set({ oracleHold: true, oracleNote: `root ${root} cancelled by guardian; clear oracle_hold after fixing data`, updatedAt: new Date() })
          .where(eq(campaigns.id, id)),
      ]);
    },
    async markClaimPaid(id, wallet, tx) {
      await db
        .update(allocations)
        .set({ status: "paid", ...(tx ? { claimTx: tx } : {}), failReason: null, updatedAt: new Date() })
        .where(and(eq(allocations.campaignId, id), eq(allocations.wallet, getAddress(wallet))));
    },
    async markClaimFailed(id, wallet, reason, tx) {
      await db
        .update(allocations)
        .set({ status: "failed", failReason: reason.slice(0, 500), ...(tx ? { claimTx: tx } : {}), updatedAt: new Date() })
        .where(and(eq(allocations.campaignId, id), eq(allocations.wallet, getAddress(wallet)), ne(allocations.status, "paid")));
    },
    async campaignsAwaitingRoot(now) {
      return db
        .select()
        .from(campaigns)
        .where(
          and(
            lte(campaigns.snapshotTime, now),
            gt(campaigns.snapshotTime, now - ROOT_DEADLINE),
            isNull(campaigns.rootPostedAt),
            eq(campaigns.noRootRefunded, false),
            eq(campaigns.oracleHold, false),
          ),
        );
    },
    async acceptedSubmissions(campaignId) {
      return db
        .select({ id: submissions.id, videoId: submissions.videoId, channelId: submissions.channelId, wallet: submissions.wallet })
        .from(submissions)
        .where(and(eq(submissions.campaignId, campaignId), eq(submissions.status, "accepted")));
    },
    async recordViews(rows, fetchedAt) {
      if (rows.length === 0) return;
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(viewObservations).values(rows.slice(i, i + 500).map((r) => ({ ...r, fetchedAt })));
      }
    },
    async saveSnapshot(input) {
      const allocRows = input.allocations.map((a) => ({
        campaignId: input.campaignId,
        root: input.root.toLowerCase(),
        wallet: getAddress(a.wallet),
        amount: a.amount,
        proof: a.proof,
        status: "pending",
      }));
      await db.batch([
        // Only reachable before a root is live onchain, so no leaf can be paid yet.
        db.delete(allocations).where(eq(allocations.campaignId, input.campaignId)),
        db.insert(snapshots).values({
          campaignId: input.campaignId,
          json: input.json,
          hash: input.hash.toLowerCase(),
          root: input.root.toLowerCase(),
          createdAt: input.createdAt,
          purgeAfter: input.purgeAfter,
        }),
        ...(allocRows.length ? [db.insert(allocations).values(allocRows)] : []),
      ]);
    },
    async setOracleNote(id, note, opts = {}) {
      await db
        .update(campaigns)
        .set({
          oracleNote: note.slice(0, 500),
          ...(opts.hold !== undefined ? { oracleHold: opts.hold } : {}),
          ...(opts.rootTx ? { rootTx: opts.rootTx } : {}),
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, id));
    },
    async campaignsReadyForPayout(now) {
      return db
        .select()
        .from(campaigns)
        .where(
          and(
            isNotNull(campaigns.rootPostedAt),
            isNotNull(campaigns.root),
            lte(campaigns.disputeEndsAt, now),
            sql`exists (select 1 from ${allocations} a where a.campaign_id = ${campaigns.id} and a.status = 'pending')`,
          ),
        );
    },
    async pendingAllocations(campaignId, root) {
      const rows = await db
        .select()
        .from(allocations)
        .where(and(eq(allocations.campaignId, campaignId), eq(allocations.root, root.toLowerCase()), eq(allocations.status, "pending")));
      return rows.map((r) => ({ wallet: getAddress(r.wallet), amount: BigInt(r.amount), proof: r.proof }));
    },
    async submissionsToRefresh(now) {
      const live = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(lte(campaigns.startTime, now), gt(campaigns.snapshotTime, now)));
      if (live.length === 0) return [];
      return db
        .select({ id: submissions.id, videoId: submissions.videoId, channelId: submissions.channelId, wallet: submissions.wallet })
        .from(submissions)
        .where(and(inArray(submissions.campaignId, live.map((c) => c.id)), eq(submissions.status, "accepted")));
    },
    async purge(now) {
      const cutoff = new Date(now.getTime() - YT_RETENTION_SEC * 1000);
      const deleted = await db.delete(viewObservations).where(lt(viewObservations.fetchedAt, cutoff)).returning({ id: viewObservations.id });
      const purged = await db
        .update(snapshots)
        .set({ json: null })
        .where(and(lte(snapshots.purgeAfter, now), isNotNull(snapshots.json)))
        .returning({ id: snapshots.id });
      return { observationsDeleted: deleted.length, snapshotsPurged: purged.length };
    },
  };
}
