import { buildSnapshot, snapshotHash, type SnapshotDocument } from "@clippool/allocation";
import type { Hex } from "viem";
import type { CampaignRow } from "@/lib/db/schema";
import type { ChainGateway, PostRootArgs } from "./chain";
import { safeErrorMessage } from "./http";
import type { JobStore } from "./store";
import { YT_RETENTION_SEC } from "./store";
import { countableViews, type YouTubeClient } from "./youtube";

export interface OracleDeps {
  chain: ChainGateway;
  store: JobStore;
  youtube: YouTubeClient;
  now?: () => number; // unix seconds
  /** Max campaigns per invocation (each costs ⌈n/50⌉ YouTube units + one tx). */
  maxCampaigns?: number;
}

export type OracleOutcome =
  | { id: number; result: "posted"; tx: Hex; root: Hex; totalAllocated: string; snapshotHash: Hex }
  | { id: number; result: "already_posted" }
  | { id: number; result: "skipped_no_allocations"; reason: string }
  | { id: number; result: "error"; reason: string };

export interface PreparedSnapshot {
  snapshot: SnapshotDocument;
  hash: Hex;
  args: PostRootArgs;
  observations: { submissionId: number; views: number }[];
}

/** Final fetch → snapshot → root/hash. Pure apart from the YouTube call. */
export async function prepareSnapshot(
  deps: Pick<OracleDeps, "store" | "youtube">,
  id: bigint,
  params: { pool: bigint; maxShareBps: number; minViews: number },
): Promise<PreparedSnapshot> {
  // The engine does not dedupe videoIds; the DB's partial unique index already prevents duplicates,
  // this is belt-and-braces (first accepted row wins).
  const seen = new Set<string>();
  const subs = (await deps.store.acceptedSubmissions(Number(id))).filter((s) => !seen.has(s.videoId) && seen.add(s.videoId));
  const videos = subs.length ? await deps.youtube.getVideos(subs.map((s) => s.videoId)) : new Map();
  const observations = subs.map((s) => ({ submissionId: s.id, views: countableViews(videos.get(s.videoId)) }));
  const snapshot = buildSnapshot(
    { id, pool: params.pool, maxShareBps: params.maxShareBps, minViews: BigInt(params.minViews) },
    subs.map((s, i) => ({ videoId: s.videoId, channelId: s.channelId, wallet: s.wallet, views: BigInt(observations[i]!.views) })),
  );
  const hash = snapshotHash(snapshot);
  const totalAllocated = BigInt(snapshot.totalAllocated);
  if (totalAllocated > params.pool) throw new Error("allocation exceeds pool"); // engine invariant; never post
  return { snapshot, hash, observations, args: { id, root: snapshot.root, totalAllocated, snapshotHash: hash } };
}

async function processCampaign(deps: OracleDeps, row: CampaignRow, now: number): Promise<OracleOutcome> {
  const { chain, store } = deps;
  const id = BigInt(row.id);
  // The chain is authoritative: a root may have been posted since the last sync.
  const onchain = await chain.getCampaign(id);
  if (onchain.rootPostedAt > 0) {
    await store.upsertCampaign(row.id, onchain, (await chain.getWindows()).disputeWindow);
    return { id: row.id, result: "already_posted" };
  }
  if (now < onchain.snapshotTime) return { id: row.id, result: "error", reason: "snapshot time not reached onchain" };

  const prepared = await prepareSnapshot(deps, id, onchain);
  const fetchedAt = new Date(now * 1000);
  await store.recordViews(prepared.observations, fetchedAt);

  const sim = await chain.simulatePostRoot(prepared.args);
  const empty = prepared.args.totalAllocated === 0n;
  if (!sim.ok) {
    if (empty && sim.kind === "revert") {
      // Contract refuses a zero root: nothing to pay, so leave it to refundNoRoot after ROOT_DEADLINE.
      const reason = `no valid allocations and postRoot(0) reverts (${sim.reason}); brand can refundNoRoot after the root deadline`;
      await store.setOracleNote(row.id, `skipped: ${reason}`, { hold: true });
      return { id: row.id, result: "skipped_no_allocations", reason };
    }
    await store.setOracleNote(row.id, `error: postRoot simulation failed (${sim.kind}): ${sim.reason}`);
    return { id: row.id, result: "error", reason: `simulation ${sim.kind}: ${sim.reason}` };
  }

  // Persist proofs before sending so a crash after broadcast never loses them.
  await store.saveSnapshot({
    campaignId: row.id,
    json: prepared.snapshot,
    hash: prepared.hash,
    root: prepared.args.root,
    createdAt: fetchedAt,
    purgeAfter: new Date((now + YT_RETENTION_SEC) * 1000),
    allocations: prepared.snapshot.proofs.map((p) => ({ wallet: p.wallet, amount: p.amount, proof: p.proof })),
  });
  const tx = await chain.postRoot(prepared.args);
  await store.setOracleNote(row.id, empty ? "posted (zero root, nothing allocated)" : "posted", { rootTx: tx.hash });
  await store.upsertCampaign(row.id, await chain.getCampaign(id), (await chain.getWindows()).disputeWindow, { rootTx: tx.hash });
  return {
    id: row.id,
    result: "posted",
    tx: tx.hash,
    root: prepared.args.root,
    totalAllocated: prepared.args.totalAllocated.toString(),
    snapshotHash: prepared.hash,
  };
}

/** Cron: for campaigns past snapshotTime without a root, snapshot views, allocate and postRoot. */
export async function runOracle(deps: OracleDeps): Promise<OracleOutcome[]> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const due = (await deps.store.campaignsAwaitingRoot(now)).slice(0, deps.maxCampaigns ?? 10);
  const out: OracleOutcome[] = [];
  for (const row of due) {
    try {
      out.push(await processCampaign(deps, row, now));
    } catch (e) {
      const reason = safeErrorMessage(e);
      await deps.store.setOracleNote(row.id, `error: ${reason}`).catch(() => {});
      out.push({ id: row.id, result: "error", reason });
    }
  }
  return out;
}
