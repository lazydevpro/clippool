import type { Hex } from "viem";
import { LOG_WINDOW, planLogWindows, type ChainGateway, type ClipPoolLog } from "./chain";
import type { JobStore } from "./store";

export interface SyncDeps {
  chain: ChainGateway;
  store: JobStore;
  deployBlock: bigint;
  /** Bound per invocation so a cold start can't exceed the function timeout; next cron continues. */
  maxWindows?: number;
  windowSize?: bigint;
}

export interface SyncResult {
  fromBlock: string;
  toBlock: string;
  head: string;
  windows: number;
  events: number;
  caughtUp: boolean;
}

const byPosition = (a: ClipPoolLog, b: ClipPoolLog) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

/** Apply one window of logs. Campaign rows are re-mirrored from getCampaign (idempotent). */
export async function applyLogs(deps: Pick<SyncDeps, "chain" | "store">, logs: ClipPoolLog[]): Promise<void> {
  const { chain, store } = deps;
  const touched = new Map<number, { createTx?: Hex; createdBlock?: number; rootTx?: Hex }>();
  const touch = (id: bigint, extra: { createTx?: Hex; createdBlock?: number; rootTx?: Hex } = {}) => {
    const key = Number(id);
    touched.set(key, { ...touched.get(key), ...extra });
  };
  const noRootRefunded: number[] = [];
  // Cached after the first read; throwing here aborts the window so it is retried (never mirror a guessed value).
  const disputeWindow = logs.length ? (await chain.getWindows()).disputeWindow : 0;

  for (const log of [...logs].sort(byPosition)) {
    const id = BigInt(log.args.id);
    switch (log.eventName) {
      case "CampaignCreated":
        touch(id, { createTx: log.transactionHash, createdBlock: Number(log.blockNumber) });
        break;
      case "RootPosted":
        touch(id, { rootTx: log.transactionHash });
        break;
      case "RootCancelled":
        // Mirror first so the campaign row exists, then drop the cancelled leaves.
        await store.upsertCampaign(Number(id), await chain.getCampaign(id), disputeWindow, touched.get(Number(id)));
        await store.onRootCancelled(Number(id), log.args.root);
        touch(id);
        break;
      case "Claimed":
        await store.markClaimPaid(Number(id), log.args.account, log.transactionHash);
        touch(id);
        break;
      case "ClaimFailed":
        await store.markClaimFailed(Number(id), log.args.account, `ClaimFailed ${String(log.args.reason ?? "0x")}`, log.transactionHash);
        touch(id);
        break;
      case "NoRootRefunded":
        noRootRefunded.push(Number(id));
        touch(id);
        break;
      case "RemainderRefunded":
      case "UnclaimedSwept":
        touch(id);
        break;
    }
  }
  for (const [id, extra] of touched) {
    await store.upsertCampaign(id, await chain.getCampaign(BigInt(id)), disputeWindow, extra);
  }
  for (const id of noRootRefunded) await store.markNoRootRefunded(id);
}

/** Index ClipPool events from the last synced block (or the deploy block) in ≤9,999-block windows. */
export async function syncEvents(deps: SyncDeps): Promise<SyncResult> {
  const { chain, store } = deps;
  const size = deps.windowSize ?? LOG_WINDOW;
  const last = await store.getLastSyncedBlock(chain.chainId);
  const from = last === null ? deps.deployBlock : last + 1n;
  const head = await chain.getBlockNumber();
  const all = from <= head ? planLogWindows(from, head, size) : [];
  const windows = all.slice(0, deps.maxWindows ?? 25);
  let events = 0;
  for (const w of windows) {
    const logs = await chain.getLogs(w.from, w.to);
    events += logs.length;
    await applyLogs(deps, logs);
    await store.setLastSyncedBlock(chain.chainId, w.to);
  }
  return {
    fromBlock: from.toString(),
    toBlock: (windows.at(-1)?.to ?? from - 1n).toString(),
    head: head.toString(),
    windows: windows.length,
    events,
    caughtUp: windows.length === all.length,
  };
}
