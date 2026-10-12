import { describe, expect, it } from "vitest";
import { LOG_WINDOW, planLogWindows, type ClipPoolLog } from "@/lib/server/chain";
import { syncEvents } from "@/lib/server/sync";
import { addr, FakeChain, FakeStore, onchainCampaign, txHash, ZERO32 } from "./helpers/fakes";

describe("planLogWindows", () => {
  it("covers [from, to] with inclusive ≤9,999-block windows, no gaps or overlap", () => {
    const w = planLogWindows(100n, 25_000n);
    expect(w).toEqual([
      { from: 100n, to: 10_098n },
      { from: 10_099n, to: 20_097n },
      { from: 20_098n, to: 25_000n },
    ]);
    for (const x of w) expect(x.to - x.from + 1n <= LOG_WINDOW).toBe(true);
    for (let i = 1; i < w.length; i++) expect(w[i]!.from).toBe(w[i - 1]!.to + 1n);
  });
  it("edge cases", () => {
    expect(planLogWindows(5n, 5n)).toEqual([{ from: 5n, to: 5n }]);
    expect(planLogWindows(6n, 5n)).toEqual([]);
    expect(planLogWindows(0n, 9_998n)).toEqual([{ from: 0n, to: 9_998n }]);
    expect(planLogWindows(0n, 9_999n)).toEqual([{ from: 0n, to: 9_998n }, { from: 9_999n, to: 9_999n }]);
    expect(() => planLogWindows(0n, 1n, 0n)).toThrow();
  });
});

const log = (eventName: ClipPoolLog["eventName"], blockNumber: bigint, args: Record<string, unknown>, logIndex = 0, tx = 1): ClipPoolLog => ({
  eventName,
  args,
  blockNumber,
  logIndex,
  transactionHash: txHash(tx),
});

describe("syncEvents", () => {
  it("pages from the deploy block, persists sync_state per window, resumes, and stops at head", async () => {
    const chain = new FakeChain();
    const store = new FakeStore();
    chain.head = 50_000n;
    const r1 = await syncEvents({ chain, store, deployBlock: 1_000n, maxWindows: 2 });
    expect(chain.getLogsCalls).toEqual([
      { from: 1_000n, to: 10_998n },
      { from: 10_999n, to: 20_997n },
    ]);
    expect(store.sync.get(chain.chainId)).toBe(20_997n);
    expect(r1).toMatchObject({ windows: 2, caughtUp: false, toBlock: "20997" });

    const r2 = await syncEvents({ chain, store, deployBlock: 1_000n, maxWindows: 10 });
    expect(chain.getLogsCalls.slice(2).map((c) => c.from)).toEqual([20_998n, 30_997n, 40_996n]);
    expect(chain.getLogsCalls.at(-1)!.to).toBe(50_000n);
    expect(r2.caughtUp).toBe(true);

    const r3 = await syncEvents({ chain, store, deployBlock: 1_000n });
    expect(r3.windows).toBe(0); // nothing new
    expect(chain.getLogsCalls).toHaveLength(5);
  });

  it("applies events: create (createTx), root posted, claims, cancel, no-root refund", async () => {
    const chain = new FakeChain();
    const store = new FakeStore();
    chain.head = 200n;
    const c1 = onchainCampaign();
    chain.campaigns.set("1", c1);
    chain.campaigns.set("2", onchainCampaign());
    const alice = addr(0xa11ce);
    const bob = addr(0xb0b0);
    chain.logs = [
      log("CampaignCreated", 10n, { id: 1n, brand: c1.brand }, 0, 11),
      log("CampaignCreated", 12n, { id: 2n, brand: c1.brand }, 0, 12),
    ];
    await syncEvents({ chain, store, deployBlock: 0n });
    expect(store.campaigns.get(1)).toMatchObject({ createTx: txHash(11), createdBlock: 10, pool: "1000000000", root: null });
    expect(store.campaigns.get(2)?.createTx).toBe(txHash(12));

    // oracle saved leaves; root posted; claims land
    const root = `0x${"11".repeat(32)}` as const;
    await store.saveSnapshot({
      campaignId: 1,
      json: {},
      hash: ZERO32,
      root,
      createdAt: new Date(),
      purgeAfter: new Date(),
      allocations: [
        { wallet: alice, amount: "600", proof: [] },
        { wallet: bob, amount: "400", proof: [] },
      ],
    });
    Object.assign(c1, { root, totalAllocated: 1000n, rootPostedAt: 1_200_100, claimed: 600n });
    chain.head = 400n;
    chain.logs.push(
      log("RootPosted", 300n, { id: 1n, root }, 0, 30),
      log("Claimed", 350n, { id: 1n, account: alice, amount: 600n }, 0, 35),
      log("ClaimFailed", 350n, { id: 1n, account: bob, amount: 400n, reason: "0x" }, 1, 35),
    );
    await syncEvents({ chain, store, deployBlock: 0n });
    const row = store.campaigns.get(1)!;
    expect(row).toMatchObject({ root, rootTx: txHash(30), totalAllocated: "1000", claimed: "600", disputeEndsAt: 1_200_100 + 48 * 3600 });
    expect(store.allocations.find((a) => a.wallet === alice)).toMatchObject({ status: "paid", claimTx: txHash(35) });
    expect(store.allocations.find((a) => a.wallet === bob)).toMatchObject({ status: "failed", claimTx: txHash(35) });

    // guardian cancels campaign 2's root; brand of campaign 2 refunds later
    await store.saveSnapshot({ campaignId: 2, json: {}, hash: ZERO32, root, createdAt: new Date(), purgeAfter: new Date(), allocations: [{ wallet: alice, amount: "1", proof: [] }] });
    chain.head = 500n;
    chain.logs.push(log("RootCancelled", 450n, { id: 2n, root }), log("NoRootRefunded", 460n, { id: 2n, brand: c1.brand, amount: 1n }));
    await syncEvents({ chain, store, deployBlock: 0n });
    expect(store.allocations.filter((a) => a.campaignId === 2)).toHaveLength(0);
    expect(store.campaigns.get(2)).toMatchObject({ oracleHold: true, noRootRefunded: true });
  });

  it("mirrors disputeEndsAt with the deployed DISPUTE_WINDOW (testnet 10 min); an unreadable window retries the block range", async () => {
    const chain = new FakeChain();
    const store = new FakeStore();
    chain.windows = { disputeWindow: 600, minMeasurementDelay: 300 };
    const root = `0x${"44".repeat(32)}` as const;
    chain.campaigns.set("1", onchainCampaign({ root, totalAllocated: 10n, rootPostedAt: 1_200_100 }));
    chain.head = 100n;
    chain.logs.push(log("RootPosted", 50n, { id: 1n, root }, 0, 5));

    chain.windowsError = new Error("rpc down");
    await expect(syncEvents({ chain, store, deployBlock: 0n })).rejects.toThrow("rpc down");
    expect(store.campaigns.size).toBe(0);
    expect(await store.getLastSyncedBlock(chain.chainId)).toBeNull(); // window not marked synced

    chain.windowsError = null;
    await syncEvents({ chain, store, deployBlock: 0n });
    expect(store.campaigns.get(1)).toMatchObject({ rootPostedAt: 1_200_100, disputeEndsAt: 1_200_100 + 600 });
  });
});
