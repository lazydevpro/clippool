import type { Hex } from "viem";
import { CLAIM_PERIOD } from "@/lib/shared/status";
import type { ChainGateway, ClaimLeaf, ClipPoolLog } from "./chain";
import { safeErrorMessage } from "./http";
import type { JobStore } from "./store";
import { chunk } from "./youtube";

export const CLAIM_BATCH = 50;

export interface KeeperDeps {
  chain: ChainGateway;
  store: JobStore;
  now?: () => number;
  batchSize?: number;
  /** Max claimMany txs per invocation. */
  maxBatches?: number;
}

export interface KeeperCampaignResult {
  id: number;
  skipped?: string;
  alreadyClaimed: number;
  simulatedFailed: number;
  deferred: number; // transient simulation errors — retried next run
  batches: { tx: Hex | null; sent: number; paid: number; failed: number; error?: string }[];
}

/** Apply Claimed / ClaimFailed logs from a claimMany receipt. */
export async function reconcileClaimLogs(store: JobStore, logs: ClipPoolLog[], tx: Hex) {
  let paid = 0;
  let failed = 0;
  for (const log of logs) {
    if (log.eventName === "Claimed") {
      await store.markClaimPaid(Number(log.args.id), log.args.account, tx);
      paid++;
    } else if (log.eventName === "ClaimFailed") {
      await store.markClaimFailed(Number(log.args.id), log.args.account, `ClaimFailed ${String(log.args.reason ?? "0x")}`, tx);
      failed++;
    }
  }
  return { paid, failed };
}

async function payCampaign(deps: KeeperDeps, id: number, now: number, budget: { batches: number }): Promise<KeeperCampaignResult> {
  const { chain, store } = deps;
  const res: KeeperCampaignResult = { id, alreadyClaimed: 0, simulatedFailed: 0, deferred: 0, batches: [] };
  const onchain = await chain.getCampaign(BigInt(id));
  if (onchain.rootPostedAt === 0) return { ...res, skipped: "no root onchain" };
  // Deployment-specific (mainnet 48h, testnet 10 min); a read failure skips this run instead of guessing.
  const { disputeWindow } = await chain.getWindows();
  if (now < onchain.rootPostedAt + disputeWindow) return { ...res, skipped: "dispute window open" };
  // claimMany reverts as a whole after the deadline; leftovers go back via sweepUnclaimed.
  if (now >= onchain.rootPostedAt + disputeWindow + CLAIM_PERIOD) return { ...res, skipped: "claim period ended" };

  const pending = await store.pendingAllocations(id, onchain.root);
  const ready: ClaimLeaf[] = [];
  for (const p of pending) {
    if (await chain.isClaimed(BigInt(id), p.wallet)) {
      await store.markClaimPaid(id, p.wallet, null);
      res.alreadyClaimed++;
      continue;
    }
    // Arc blocklist reverts still burn gas inside claimMany — simulate each leaf first.
    const leaf = { account: p.wallet, amount: p.amount, proof: p.proof };
    const sim = await chain.simulateClaim(BigInt(id), leaf);
    if (sim.ok) ready.push(leaf);
    else if (sim.kind === "revert") {
      await store.markClaimFailed(id, p.wallet, `simulation reverted: ${sim.reason}`, null);
      res.simulatedFailed++;
    } else res.deferred++;
  }

  for (const batch of chunk(ready, deps.batchSize ?? CLAIM_BATCH)) {
    if (budget.batches <= 0) {
      res.deferred += batch.length;
      continue;
    }
    budget.batches--;
    try {
      const tx = await chain.claimMany(BigInt(id), batch);
      const r = await reconcileClaimLogs(store, tx.logs, tx.hash);
      res.batches.push({ tx: tx.hash, sent: batch.length, ...r });
    } catch (e) {
      res.batches.push({ tx: null, sent: batch.length, paid: 0, failed: 0, error: safeErrorMessage(e) });
    }
  }
  return res;
}

/** Cron: after the dispute window, push every pending leaf via claimMany (≤50 per tx). */
export async function runKeeper(deps: KeeperDeps): Promise<KeeperCampaignResult[]> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const budget = { batches: deps.maxBatches ?? 10 };
  const out: KeeperCampaignResult[] = [];
  for (const row of await deps.store.campaignsReadyForPayout(now)) {
    try {
      out.push(await payCampaign(deps, row.id, now, budget));
    } catch (e) {
      out.push({ id: row.id, skipped: `error: ${safeErrorMessage(e)}`, alreadyClaimed: 0, simulatedFailed: 0, deferred: 0, batches: [] });
    }
  }
  return out;
}
