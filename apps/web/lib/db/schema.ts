import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Conventions
 * - campaign ids and unix-second timestamps that mirror the chain: bigint (mode "number"; all fit in 2^53).
 * - token amounts (uint128/uint256 base units): numeric(78,0) read/written as decimal strings.
 * - addresses: EIP-55 checksummed text; hashes: 0x-prefixed lowercase hex text.
 * - YouTube statistics (view counts) live ONLY in view_observations + snapshots.json and are purged
 *   after 30 days (YouTube API Developer Policies III.E.4).
 */

const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });
const unix = (name: string) => bigint(name, { mode: "number" });

/** Offchain mirror of ClipPool.getCampaign(id) + indexer bookkeeping. */
export const campaigns = pgTable("campaigns", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  brand: text("brand").notNull(),
  token: text("token").notNull(),
  pool: amount("pool").notNull(),
  startTime: unix("start_time").notNull(),
  endTime: unix("end_time").notNull(),
  snapshotTime: unix("snapshot_time").notNull(),
  maxShareBps: integer("max_share_bps").notNull(),
  minViews: bigint("min_views", { mode: "number" }).notNull(),
  rulesHash: text("rules_hash").notNull(),
  root: text("root"),
  totalAllocated: amount("total_allocated"),
  snapshotHash: text("snapshot_hash"),
  rootPostedAt: unix("root_posted_at"),
  disputeEndsAt: unix("dispute_ends_at"),
  claimed: amount("claimed").notNull().default("0"),
  remainderRefunded: boolean("remainder_refunded").notNull().default(false),
  unclaimedSwept: boolean("unclaimed_swept").notNull().default(false),
  noRootRefunded: boolean("no_root_refunded").notNull().default(false),
  /** Set when the guardian cancels a root; the oracle will not repost until an operator clears it. */
  oracleHold: boolean("oracle_hold").notNull().default(false),
  /** Last oracle outcome for ops visibility, e.g. "posted", "no_allocations_skipped", "error: …". */
  oracleNote: text("oracle_note"),
  rootTx: text("root_tx"),
  createTx: text("create_tx"),
  createdBlock: bigint("created_block", { mode: "number" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaignMeta = pgTable("campaign_meta", {
  campaignId: bigint("campaign_id", { mode: "number" })
    .primaryKey()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rules: text("rules").notNull(),
  /** keccak256(utf8(rules)) == onchain rulesHash and createTx sender == brand. */
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable(
  "submissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignId: bigint("campaign_id", { mode: "number" })
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    channelId: text("channel_id").notNull(),
    channelTitle: text("channel_title").notNull(),
    title: text("title").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    wallet: text("wallet").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    durationSec: integer("duration_sec").notNull(),
    /** "accepted" | "rejected" (operators set "rejected" + reason to exclude fraud before a repost). */
    status: text("status").notNull().default("accepted"),
    /** How the submitter proved control of the video: "oauth" (channel_owners) | "code" (binding code). */
    proof: text("proof").$type<SubmissionProof>().notNull().default("code"),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("submissions_campaign_video_accepted_uq")
      .on(t.campaignId, t.videoId)
      .where(sql`${t.status} = 'accepted'`),
    index("submissions_campaign_idx").on(t.campaignId),
  ],
);

export type SubmissionProof = "oauth" | "code";

/**
 * Channels whose ownership was proven with Google OAuth (youtube.readonly, channels.list?mine=true).
 * The proven owner picks the payout wallet; re-connecting may change it for FUTURE campaigns
 * (per-campaign channel_wallets locks still win once a submission is accepted).
 * Google access tokens are never stored.
 */
export const channelOwners = pgTable(
  "channel_owners",
  {
    channelId: text("channel_id").primaryKey(),
    wallet: text("wallet").notNull(),
    channelTitle: text("channel_title").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    /** Always "oauth" today. */
    method: text("method").notNull().default("oauth"),
  },
  (t) => [index("channel_owners_wallet_idx").on(t.wallet)],
);

/** First valid submission locks a channel to a payout wallet for the campaign. */
export const channelWallets = pgTable(
  "channel_wallets",
  {
    campaignId: bigint("campaign_id", { mode: "number" })
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    wallet: text("wallet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("channel_wallets_campaign_channel_uq").on(t.campaignId, t.channelId)],
);

/** YouTube statistics — purged after 30 days. */
export const viewObservations = pgTable(
  "view_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    submissionId: bigint("submission_id", { mode: "number" })
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    views: bigint("views", { mode: "number" }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("view_observations_submission_fetched_idx").on(t.submissionId, t.fetchedAt),
    index("view_observations_fetched_idx").on(t.fetchedAt),
  ],
);

/** Published snapshot documents. `json` is nulled at purgeAfter (it contains view counts). */
export const snapshots = pgTable(
  "snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignId: bigint("campaign_id", { mode: "number" })
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    json: jsonb("json"),
    hash: text("hash").notNull(),
    root: text("root").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
  },
  (t) => [index("snapshots_campaign_idx").on(t.campaignId, t.createdAt)],
);

export const allocations = pgTable(
  "allocations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignId: bigint("campaign_id", { mode: "number" })
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /** Root this leaf belongs to (a cancelled root's leaves are deleted). */
    root: text("root").notNull(),
    wallet: text("wallet").notNull(),
    amount: amount("amount").notNull(),
    proof: jsonb("proof").$type<`0x${string}`[]>().notNull(),
    /** "pending" | "paid" | "failed" */
    status: text("status").notNull().default("pending"),
    claimTx: text("claim_tx"),
    failReason: text("fail_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("allocations_campaign_wallet_uq").on(t.campaignId, t.wallet),
    index("allocations_status_idx").on(t.campaignId, t.status),
  ],
);

export const syncState = pgTable("sync_state", {
  chainId: integer("chain_id").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignRow = typeof campaigns.$inferSelect;
export type CampaignInsert = typeof campaigns.$inferInsert;
export type CampaignMetaRow = typeof campaignMeta.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type AllocationRow = typeof allocations.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type ChannelOwnerRow = typeof channelOwners.$inferSelect;
