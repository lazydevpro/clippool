import { getAddress, type Address, type Hash, type Hex } from "viem";
import type { CampaignRow } from "@/lib/db/schema";
import type {
  ChainGateway,
  ClaimLeaf,
  ClipPoolLog,
  OnchainCampaign,
  PostRootArgs,
  SimulationResult,
  TxOutcome,
} from "@/lib/server/chain";
import { campaignRowFromChain, type JobStore, type SaveSnapshotInput, type SubmissionRef } from "@/lib/server/store";
import type { YouTubeClient, YtChannel, YtPlaylistItem, YtVideo } from "@/lib/server/youtube";
import { FALLBACK_WINDOWS, ROOT_DEADLINE, type ContractWindows } from "@/lib/shared/status";

/** Default contract windows for fakes: the mainnet 48h / 1h deployment. */
export const FAKE_WINDOWS: ContractWindows = { ...FALLBACK_WINDOWS };

export const ZERO32 = `0x${"0".repeat(64)}` as Hex;
export const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
export const txHash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

export function onchainCampaign(over: Partial<OnchainCampaign> = {}): OnchainCampaign {
  return {
    brand: addr(0xb0b),
    token: "0x3600000000000000000000000000000000000000",
    pool: 1_000_000_000n,
    totalAllocated: 0n,
    claimed: 0n,
    startTime: 1_000_000,
    endTime: 1_100_000,
    snapshotTime: 1_200_000,
    rootPostedAt: 0,
    maxShareBps: 2000,
    minViews: 1000,
    rulesHash: `0x${"ab".repeat(32)}`,
    root: ZERO32,
    snapshotHash: ZERO32,
    remainderRefunded: false,
    unclaimedSwept: false,
    ...over,
  };
}

export function campaignRow(
  id: number,
  c: OnchainCampaign,
  over: Partial<CampaignRow> = {},
  disputeWindow = FAKE_WINDOWS.disputeWindow,
): CampaignRow {
  return {
    ...campaignRowFromChain(id, c, disputeWindow),
    noRootRefunded: false,
    oracleHold: false,
    oracleNote: null,
    rootTx: null,
    createTx: null,
    createdBlock: null,
    updatedAt: new Date(0),
    ...over,
  } as CampaignRow;
}

export interface FakeAllocation {
  campaignId: number;
  root: string;
  wallet: string;
  amount: string;
  proof: Hex[];
  status: "pending" | "paid" | "failed";
  claimTx: string | null;
  failReason: string | null;
}

/** In-memory JobStore with the same semantics as the Drizzle store. */
export class FakeStore implements JobStore {
  sync = new Map<number, bigint>();
  campaigns = new Map<number, CampaignRow>();
  submissions: (SubmissionRef & { campaignId: number; status: string })[] = [];
  observations: { submissionId: number; views: number; fetchedAt: Date }[] = [];
  snapshots: (Omit<SaveSnapshotInput, "allocations"> & { json: unknown })[] = [];
  allocations: FakeAllocation[] = [];
  calls: string[] = [];

  async getLastSyncedBlock(chainId: number) {
    return this.sync.get(chainId) ?? null;
  }
  async setLastSyncedBlock(chainId: number, block: bigint) {
    this.sync.set(chainId, block);
  }
  async upsertCampaign(
    id: number,
    c: OnchainCampaign,
    disputeWindow: number,
    extra: { createTx?: Hex; createdBlock?: number; rootTx?: Hex } = {},
  ) {
    const prev = this.campaigns.get(id);
    const base = prev ?? campaignRow(id, c, {}, disputeWindow);
    this.campaigns.set(id, {
      ...base,
      ...campaignRowFromChain(id, c, disputeWindow),
      ...(extra.createTx ? { createTx: extra.createTx } : {}),
      ...(extra.createdBlock !== undefined ? { createdBlock: extra.createdBlock } : {}),
      ...(extra.rootTx ? { rootTx: extra.rootTx } : {}),
    });
  }
  async markNoRootRefunded(id: number) {
    const c = this.campaigns.get(id);
    if (c) c.noRootRefunded = true;
  }
  async onRootCancelled(id: number, root: Hex) {
    this.allocations = this.allocations.filter((a) => !(a.campaignId === id && a.root === root.toLowerCase()));
    const c = this.campaigns.get(id);
    if (c) c.oracleHold = true;
  }
  private alloc(id: number, wallet: string) {
    return this.allocations.find((a) => a.campaignId === id && a.wallet.toLowerCase() === wallet.toLowerCase());
  }
  async markClaimPaid(id: number, wallet: string, tx: Hex | null) {
    const a = this.alloc(id, wallet);
    if (a) Object.assign(a, { status: "paid", failReason: null }, tx ? { claimTx: tx } : {});
  }
  async markClaimFailed(id: number, wallet: string, reason: string, tx: Hex | null) {
    const a = this.alloc(id, wallet);
    if (a && a.status !== "paid") Object.assign(a, { status: "failed", failReason: reason }, tx ? { claimTx: tx } : {});
  }
  async campaignsAwaitingRoot(now: number) {
    return [...this.campaigns.values()].filter(
      (c) => c.snapshotTime <= now && c.snapshotTime > now - ROOT_DEADLINE && !c.rootPostedAt && !c.noRootRefunded && !c.oracleHold,
    );
  }
  async acceptedSubmissions(campaignId: number) {
    return this.submissions
      .filter((s) => s.campaignId === campaignId && s.status === "accepted")
      .map(({ id, videoId, channelId, wallet }) => ({ id, videoId, channelId, wallet }));
  }
  async recordViews(rows: { submissionId: number; views: number }[], fetchedAt: Date) {
    this.observations.push(...rows.map((r) => ({ ...r, fetchedAt })));
  }
  async saveSnapshot(input: SaveSnapshotInput) {
    this.calls.push("saveSnapshot");
    const { allocations, ...snap } = input;
    this.snapshots.push(snap);
    this.allocations = this.allocations.filter((a) => a.campaignId !== input.campaignId);
    this.allocations.push(
      ...allocations.map((a) => ({
        campaignId: input.campaignId,
        root: input.root.toLowerCase(),
        wallet: getAddress(a.wallet),
        amount: a.amount,
        proof: a.proof,
        status: "pending" as const,
        claimTx: null,
        failReason: null,
      })),
    );
  }
  async setOracleNote(id: number, note: string, opts: { hold?: boolean; rootTx?: Hex } = {}) {
    const c = this.campaigns.get(id);
    if (!c) return;
    c.oracleNote = note;
    if (opts.hold !== undefined) c.oracleHold = opts.hold;
    if (opts.rootTx) c.rootTx = opts.rootTx;
  }
  async campaignsReadyForPayout(now: number) {
    return [...this.campaigns.values()].filter(
      (c) =>
        c.rootPostedAt &&
        c.root &&
        (c.disputeEndsAt ?? Infinity) <= now &&
        this.allocations.some((a) => a.campaignId === c.id && a.status === "pending"),
    );
  }
  async pendingAllocations(campaignId: number, root: Hex) {
    return this.allocations
      .filter((a) => a.campaignId === campaignId && a.root === root.toLowerCase() && a.status === "pending")
      .map((a) => ({ wallet: getAddress(a.wallet) as Address, amount: BigInt(a.amount), proof: a.proof }));
  }
  async submissionsToRefresh(now: number) {
    const live = new Set([...this.campaigns.values()].filter((c) => c.startTime <= now && c.snapshotTime > now).map((c) => c.id));
    return this.submissions.filter((s) => live.has(s.campaignId) && s.status === "accepted");
  }
  async purge(now: Date) {
    const cutoff = now.getTime() - 30 * 86400 * 1000;
    const before = this.observations.length;
    this.observations = this.observations.filter((o) => o.fetchedAt.getTime() >= cutoff);
    let purged = 0;
    for (const s of this.snapshots) {
      if (s.purgeAfter.getTime() <= now.getTime() && s.json !== null) {
        s.json = null;
        purged++;
      }
    }
    return { observationsDeleted: before - this.observations.length, snapshotsPurged: purged };
  }
}

/** Scriptable ChainGateway that records every call. */
export class FakeChain implements ChainGateway {
  chainId = 5042002;
  head = 0n;
  logs: ClipPoolLog[] = [];
  campaigns = new Map<string, OnchainCampaign>();
  claimed = new Set<string>();
  getLogsCalls: { from: bigint; to: bigint }[] = [];
  postRootCalls: PostRootArgs[] = [];
  simulatePostRootResult: SimulationResult = { ok: true };
  claimSim = new Map<string, SimulationResult>(); // by lowercase account
  claimManyCalls: { id: bigint; leaves: ClaimLeaf[] }[] = [];
  /** Accounts whose transfer fails inside claimMany (emits ClaimFailed). */
  failInBatch = new Set<string>();
  order: string[] = [];
  nowForRootPost = 0;
  txCounter = 1;
  /** DISPUTE_WINDOW() / MIN_MEASUREMENT_DELAY() of the fake deployment; set `windowsError` to simulate an RPC failure. */
  windows: ContractWindows = { ...FAKE_WINDOWS };
  windowsError: Error | null = null;
  getWindowsCalls = 0;

  async getBlockNumber() {
    return this.head;
  }
  async getLogs(from: bigint, to: bigint) {
    this.getLogsCalls.push({ from, to });
    return this.logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
  }
  async getCampaign(id: bigint) {
    const c = this.campaigns.get(id.toString());
    if (!c) throw new Error(`no campaign ${id}`);
    return { ...c };
  }
  async getWindows() {
    this.getWindowsCalls++;
    if (this.windowsError) throw this.windowsError;
    return { ...this.windows };
  }
  async isClaimed(id: bigint, account: Address) {
    return this.claimed.has(`${id}:${account.toLowerCase()}`);
  }
  async simulatePostRoot(args: PostRootArgs) {
    this.order.push("simulatePostRoot");
    void args;
    return this.simulatePostRootResult;
  }
  async postRoot(args: PostRootArgs): Promise<TxOutcome> {
    this.order.push("postRoot");
    this.postRootCalls.push(args);
    const c = this.campaigns.get(args.id.toString())!;
    Object.assign(c, {
      root: args.root,
      totalAllocated: args.totalAllocated,
      snapshotHash: args.snapshotHash,
      rootPostedAt: this.nowForRootPost || c.snapshotTime + 60,
    });
    return { hash: txHash(this.txCounter++), logs: [] };
  }
  async simulateClaim(id: bigint, leaf: ClaimLeaf) {
    this.order.push(`simulateClaim:${leaf.account}`);
    void id;
    return this.claimSim.get(leaf.account.toLowerCase()) ?? { ok: true };
  }
  async simulateClaimMany() {
    return { ok: true } as const;
  }
  async claimMany(id: bigint, leaves: ClaimLeaf[]): Promise<TxOutcome> {
    this.claimManyCalls.push({ id, leaves });
    const hash = txHash(this.txCounter++);
    const logs: ClipPoolLog[] = leaves.map((l, i) => {
      const fail = this.failInBatch.has(l.account.toLowerCase());
      if (!fail) this.claimed.add(`${id}:${l.account.toLowerCase()}`);
      return {
        eventName: fail ? "ClaimFailed" : "Claimed",
        args: fail ? { id, account: l.account, amount: l.amount, reason: "0xdead" } : { id, account: l.account, amount: l.amount },
        blockNumber: 1n,
        logIndex: i,
        transactionHash: hash,
      };
    });
    return { hash, logs };
  }
  txs = new Map<string, { from: Address; to: Address | null; status: "success" | "reverted"; logs: ClipPoolLog[] }>();
  async getTransaction(hash: Hash) {
    const t = this.txs.get(hash);
    if (!t) throw new Error("not found");
    return t;
  }
}

export function ytVideo(over: Partial<YtVideo> & { id: string }): YtVideo {
  return {
    channelId: "UC" + "a".repeat(22),
    channelTitle: "Chan",
    title: "My short",
    description: "",
    publishedAt: 1_050_000,
    durationSec: 30,
    privacyStatus: "public",
    uploadStatus: "processed",
    viewCount: 5000,
    thumbnailUrl: null,
    ...over,
  };
}

export class FakeYouTube implements YouTubeClient {
  videos = new Map<string, YtVideo>();
  channels = new Map<string, YtChannel>();
  calls: string[][] = [];
  fail = false;
  async getVideos(ids: string[]) {
    this.calls.push(ids);
    if (this.fail) throw new Error("quotaExceeded");
    return new Map(ids.filter((i) => this.videos.has(i)).map((i) => [i, this.videos.get(i)!]));
  }
  async getChannels(ids: string[]) {
    this.channelCalls.push(ids);
    return new Map(ids.filter((i) => this.channels.has(i)).map((i) => [i, this.channels.get(i)!]));
  }
  playlists = new Map<string, YtPlaylistItem[]>();
  channelCalls: string[][] = [];
  playlistCalls: string[] = [];
  async getPlaylistItems(playlistId: string, max = 50) {
    this.playlistCalls.push(playlistId);
    return (this.playlists.get(playlistId) ?? []).slice(0, max);
  }
}
