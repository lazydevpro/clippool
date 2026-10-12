import { describe, expect, it } from "vitest";
import { runKeeper } from "@/lib/server/keeper";
import { addr, campaignRow, FAKE_WINDOWS, FakeChain, FakeStore, onchainCampaign, ZERO32 } from "./helpers/fakes";

const ROOT = `0x${"22".repeat(32)}` as const;
const POSTED_AT = 1_200_100;
const AFTER = POSTED_AT + FAKE_WINDOWS.disputeWindow; // 48h (mainnet deployment)

async function setup(n: number, disputeWindow = FAKE_WINDOWS.disputeWindow) {
  const chain = new FakeChain();
  chain.windows = { ...chain.windows, disputeWindow };
  const store = new FakeStore();
  const c = onchainCampaign({ root: ROOT, rootPostedAt: POSTED_AT, totalAllocated: BigInt(n * 10) });
  chain.campaigns.set("1", c);
  store.campaigns.set(1, campaignRow(1, c, {}, disputeWindow));
  const wallets = Array.from({ length: n }, (_, i) => addr(0x1000 + i));
  await store.saveSnapshot({
    campaignId: 1,
    json: {},
    hash: ZERO32,
    root: ROOT,
    createdAt: new Date(),
    purgeAfter: new Date(),
    allocations: wallets.map((w) => ({ wallet: w, amount: "10", proof: [ZERO32] })),
  });
  return { chain, store, wallets };
}

describe("runKeeper", () => {
  it("does nothing inside the dispute window", async () => {
    const { chain, store } = await setup(3);
    expect(await runKeeper({ chain, store, now: () => AFTER - 1 })).toEqual([]); // store filter
    store.campaigns.get(1)!.disputeEndsAt = 0; // stale mirror: chain check still guards
    const out = await runKeeper({ chain, store, now: () => AFTER - 1 });
    expect(out[0]!.skipped).toBe("dispute window open");
    expect(chain.claimManyCalls).toHaveLength(0);
  });

  it("batches ≤50 leaves per claimMany and marks Claimed leaves paid with the tx", async () => {
    const { chain, store } = await setup(120);
    const out = await runKeeper({ chain, store, now: () => AFTER });
    expect(chain.claimManyCalls.map((c) => c.leaves.length)).toEqual([50, 50, 20]);
    expect(out[0]!.batches.map((b) => b.paid)).toEqual([50, 50, 20]);
    expect(store.allocations.every((a) => a.status === "paid" && a.claimTx)).toBe(true);
    // second run: nothing pending
    expect(await runKeeper({ chain, store, now: () => AFTER })).toEqual([]);
  });

  it("simulates every leaf first; reverting leaves (e.g. blocklisted) are marked failed and never sent", async () => {
    const { chain, store, wallets } = await setup(5);
    chain.claimSim.set(wallets[1]!.toLowerCase(), { ok: false, kind: "revert", reason: "Blacklistable: account is blacklisted" });
    chain.claimSim.set(wallets[3]!.toLowerCase(), { ok: false, kind: "transient", reason: "timeout" });
    const out = await runKeeper({ chain, store, now: () => AFTER });
    const sent = chain.claimManyCalls.flatMap((c) => c.leaves.map((l) => l.account));
    expect(sent).toEqual([wallets[0], wallets[2], wallets[4]]);
    // every simulation precedes the batch
    expect(chain.order.filter((o) => o.startsWith("simulateClaim"))).toHaveLength(5);
    const byWallet = (w: string) => store.allocations.find((a) => a.wallet === w)!;
    expect(byWallet(wallets[1]!)).toMatchObject({ status: "failed", failReason: expect.stringContaining("blacklisted") });
    expect(byWallet(wallets[3]!).status).toBe("pending"); // transient → retried next run
    expect(out[0]).toMatchObject({ simulatedFailed: 1, deferred: 1 });
  });

  it("already-claimed leaves are reconciled as paid without resending; ClaimFailed inside a batch → failed", async () => {
    const { chain, store, wallets } = await setup(4);
    chain.claimed.add(`1:${wallets[0]!.toLowerCase()}`);
    chain.failInBatch.add(wallets[2]!.toLowerCase());
    const out = await runKeeper({ chain, store, now: () => AFTER });
    expect(chain.claimManyCalls[0]!.leaves.map((l) => l.account)).toEqual([wallets[1], wallets[2], wallets[3]]);
    expect(out[0]).toMatchObject({ alreadyClaimed: 1, batches: [{ sent: 3, paid: 2, failed: 1 }] });
    expect(store.allocations.find((a) => a.wallet === wallets[2])).toMatchObject({ status: "failed", claimTx: expect.any(String) });
  });

  it("skips leaves of a different (cancelled/stale) root", async () => {
    const { chain, store } = await setup(2);
    chain.campaigns.get("1")!.root = `0x${"33".repeat(32)}`;
    const out = await runKeeper({ chain, store, now: () => AFTER });
    expect(chain.claimManyCalls).toHaveLength(0);
    expect(out[0]!.batches).toEqual([]);
  });

  it("stops after the claim deadline (claimMany would revert as a whole)", async () => {
    const { chain, store } = await setup(2);
    const out = await runKeeper({ chain, store, now: () => AFTER + 90 * 86400 });
    expect(out[0]!.skipped).toBe("claim period ended");
    expect(chain.claimManyCalls).toHaveLength(0);
    expect(store.allocations.every((a) => a.status === "pending")).toBe(true);
  });

  it("respects the per-run batch budget and leaves the rest pending", async () => {
    const { chain, store } = await setup(130);
    const out = await runKeeper({ chain, store, now: () => AFTER, maxBatches: 2 });
    expect(chain.claimManyCalls).toHaveLength(2);
    expect(out[0]!.deferred).toBe(30);
    expect(store.allocations.filter((a) => a.status === "pending")).toHaveLength(30);
  });

  it("uses the deployed contract's DISPUTE_WINDOW (testnet: 10 min), not a hardcoded 48h", async () => {
    const short = 10 * 60;
    const { chain, store } = await setup(2, short);
    expect(store.campaigns.get(1)!.disputeEndsAt).toBe(POSTED_AT + short);
    expect(await runKeeper({ chain, store, now: () => POSTED_AT + short - 1 })).toEqual([]); // store filter
    store.campaigns.get(1)!.disputeEndsAt = 0; // stale mirror: chain-side window still guards
    const early = await runKeeper({ chain, store, now: () => POSTED_AT + short - 1 });
    expect(early[0]!.skipped).toBe("dispute window open");
    const out = await runKeeper({ chain, store, now: () => POSTED_AT + short });
    expect(out[0]!.batches).toMatchObject([{ sent: 2, paid: 2 }]);
    // claim period (90d constant) is measured from the end of the short window
    const late = await setup(1, short);
    const ended = await runKeeper({ chain: late.chain, store: late.store, now: () => POSTED_AT + short + 90 * 86400 });
    expect(ended[0]!.skipped).toBe("claim period ended");
  });

  it("skips (and retries next run) when the window can't be read — never guesses", async () => {
    const { chain, store } = await setup(2);
    chain.windowsError = new Error("rpc down");
    const out = await runKeeper({ chain, store, now: () => AFTER });
    expect(out[0]!.skipped).toContain("rpc down");
    expect(chain.claimManyCalls).toHaveLength(0);
    chain.windowsError = null;
    expect((await runKeeper({ chain, store, now: () => AFTER }))[0]!.batches).toMatchObject([{ paid: 2 }]);
  });

  it("a failed claimMany tx leaves leaves pending (next run re-checks isClaimed)", async () => {
    const { chain, store } = await setup(3);
    chain.claimMany = async () => {
      throw new Error("transaction reverted");
    };
    const out = await runKeeper({ chain, store, now: () => AFTER });
    expect(out[0]!.batches[0]).toMatchObject({ tx: null, sent: 3, error: expect.stringContaining("reverted") });
    expect(store.allocations.every((a) => a.status === "pending")).toBe(true);
  });
});
