import { computeAllocation, snapshotHash, verifyProof, ZERO_ROOT, type SnapshotDocument } from "@clippool/allocation";
import { beforeEach, describe, expect, it } from "vitest";
import { runOracle } from "@/lib/server/oracle";
import { addr, campaignRow, FakeChain, FakeStore, FakeYouTube, onchainCampaign, ytVideo } from "./helpers/fakes";

const NOW = 1_200_500; // past snapshotTime (1_200_000)
const alice = addr(0xa11ce);
const bob = addr(0xb0b0);
const carol = addr(0xca201);

function setup() {
  const chain = new FakeChain();
  const store = new FakeStore();
  const youtube = new FakeYouTube();
  const c = onchainCampaign({ pool: 1_000_000_000n, maxShareBps: 5000, minViews: 1000 });
  chain.campaigns.set("1", c);
  const save = store.saveSnapshot.bind(store);
  store.saveSnapshot = async (input) => {
    chain.order.push("saveSnapshot");
    return save(input);
  };
  store.campaigns.set(1, campaignRow(1, c));
  const subs = [
    { id: 1, videoId: "aaaaaaaaaa1", channelId: "UCa", wallet: alice, views: 900_000 },
    { id: 2, videoId: "aaaaaaaaaa2", channelId: "UCa", wallet: alice, views: 100_000 },
    { id: 3, videoId: "bbbbbbbbbb1", channelId: "UCb", wallet: bob, views: 250_000 },
    { id: 4, videoId: "ccccccccc01", channelId: "UCc", wallet: carol, views: 500 }, // < minViews
    { id: 5, videoId: "ccccccccc02", channelId: "UCc", wallet: carol, views: 400_000, privacy: "private" },
    { id: 6, videoId: "deleted0001", channelId: "UCc", wallet: carol, views: 0, deleted: true },
  ];
  for (const s of subs) {
    store.submissions.push({ id: s.id, videoId: s.videoId, channelId: s.channelId, wallet: s.wallet, campaignId: 1, status: "accepted" });
    if (!s.deleted) youtube.videos.set(s.videoId, ytVideo({ id: s.videoId, viewCount: s.views, privacyStatus: s.privacy ?? "public" }));
  }
  // a manually rejected submission must be ignored
  store.submissions.push({ id: 7, videoId: "rejected001", channelId: "UCz", wallet: addr(0xbad), campaignId: 1, status: "rejected" });
  youtube.videos.set("rejected001", ytVideo({ id: "rejected001", viewCount: 10_000_000 }));
  return { chain, store, youtube, c };
}

describe("runOracle", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("final fetch → snapshot → allocations with proofs → simulate → postRoot with the engine's root", async () => {
    const { chain, store, youtube, c } = env;
    const out = await runOracle({ chain, store, youtube, now: () => NOW });

    // expected result straight from @clippool/allocation with the final views (private/deleted = 0)
    const expected = computeAllocation({ id: 1n, pool: c.pool, maxShareBps: c.maxShareBps, minViews: BigInt(c.minViews) }, [
      { videoId: "aaaaaaaaaa1", channelId: "UCa", wallet: alice, views: 900_000n },
      { videoId: "aaaaaaaaaa2", channelId: "UCa", wallet: alice, views: 100_000n },
      { videoId: "bbbbbbbbbb1", channelId: "UCb", wallet: bob, views: 250_000n },
      { videoId: "ccccccccc01", channelId: "UCc", wallet: carol, views: 500n },
      { videoId: "ccccccccc02", channelId: "UCc", wallet: carol, views: 0n },
      { videoId: "deleted0001", channelId: "UCc", wallet: carol, views: 0n },
    ]);
    expect(expected.allocations.map((a) => a.wallet)).toEqual([alice, bob].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1)));

    // simulate first; proofs persisted before the tx is broadcast
    expect(chain.order).toEqual(["simulatePostRoot", "saveSnapshot", "postRoot"]);
    expect(chain.postRootCalls).toHaveLength(1);
    const args = chain.postRootCalls[0]!;
    const snap = store.snapshots[0]!.json as SnapshotDocument;
    expect(args).toEqual({ id: 1n, root: expected.root, totalAllocated: expected.totalAllocated, snapshotHash: snapshotHash(snap) });
    expect(store.snapshots[0]!.hash).toBe(args.snapshotHash);
    expect(out).toEqual([
      expect.objectContaining({ id: 1, result: "posted", root: expected.root, totalAllocated: expected.totalAllocated.toString() }),
    ]);

    // only accepted submissions were fetched; YouTube ids batched in one call
    expect(youtube.calls).toHaveLength(1);
    expect(youtube.calls[0]).not.toContain("rejected001");
    // observations recorded from the final fetch
    expect(store.observations.map((o) => o.views)).toEqual([900_000, 100_000, 250_000, 500, 0, 0]);

    // snapshot retention + allocations with valid proofs against the posted root
    expect(store.snapshots[0]!.purgeAfter.getTime()).toBe((NOW + 30 * 86400) * 1000);
    expect(store.allocations).toHaveLength(expected.allocations.length);
    for (const a of store.allocations) {
      expect(a.status).toBe("pending");
      expect(a.root).toBe(expected.root.toLowerCase());
      expect(verifyProof(expected.root, 1n, a.wallet, BigInt(a.amount), a.proof)).toBe(true);
    }
    // campaign mirrored after posting
    expect(store.campaigns.get(1)).toMatchObject({ root: expected.root.toLowerCase(), oracleNote: "posted", rootTx: out[0]!.result === "posted" ? out[0]!.tx : "" });
  });

  it("is idempotent: a campaign whose root is already posted onchain is not re-posted", async () => {
    const { chain, store, youtube } = env;
    chain.campaigns.get("1")!.rootPostedAt = NOW - 10;
    const out = await runOracle({ chain, store, youtube, now: () => NOW });
    expect(out).toEqual([{ id: 1, result: "already_posted" }]);
    expect(chain.postRootCalls).toHaveLength(0);
    expect(youtube.calls).toHaveLength(0);
    expect(store.campaigns.get(1)!.rootPostedAt).toBe(NOW - 10);
  });

  it("zero valid submissions → posts ZERO_ROOT with totalAllocated 0", async () => {
    const { chain, store, youtube } = env;
    store.submissions = [];
    const out = await runOracle({ chain, store, youtube, now: () => NOW });
    expect(chain.postRootCalls[0]).toMatchObject({ id: 1n, root: ZERO_ROOT, totalAllocated: 0n });
    expect(out[0]).toMatchObject({ result: "posted" });
    expect(store.allocations).toHaveLength(0);
    expect(youtube.calls).toHaveLength(0); // no quota spent
  });

  it("zero allocations and the contract rejects a zero root → skip + hold (brand uses refundNoRoot)", async () => {
    const { chain, store, youtube } = env;
    for (const v of youtube.videos.values()) v.viewCount = 10; // everything below minViews
    chain.simulatePostRootResult = { ok: false, kind: "revert", reason: "ZeroRoot" };
    const out = await runOracle({ chain, store, youtube, now: () => NOW });
    expect(out[0]).toMatchObject({ id: 1, result: "skipped_no_allocations" });
    expect(chain.postRootCalls).toHaveLength(0);
    expect(store.snapshots).toHaveLength(0);
    expect(store.campaigns.get(1)!.oracleHold).toBe(true);
    // held campaigns are not retried
    expect(await runOracle({ chain, store, youtube, now: () => NOW })).toEqual([]);
  });

  it("simulation revert with allocations → error, nothing stored or sent; retried next run", async () => {
    const { chain, store, youtube } = env;
    chain.simulatePostRootResult = { ok: false, kind: "revert", reason: "NotOracle" };
    const out = await runOracle({ chain, store, youtube, now: () => NOW });
    expect(out[0]).toMatchObject({ result: "error" });
    expect(store.snapshots).toHaveLength(0);
    expect(chain.postRootCalls).toHaveLength(0);
    expect(store.campaigns.get(1)!.oracleHold).toBe(false);
    expect(store.campaigns.get(1)!.oracleNote).toMatch(/NotOracle/);
  });

  it("YouTube failure → error outcome, no tx", async () => {
    const { chain, store, youtube } = env;
    youtube.fail = true;
    const out = await runOracle({ chain, store, youtube, now: () => NOW });
    expect(out[0]).toMatchObject({ result: "error" });
    expect(chain.order).toEqual([]);
  });

  it("skips campaigns before snapshotTime, held, refunded, or past the root deadline", async () => {
    const { chain, store, youtube } = env;
    expect(await runOracle({ chain, store, youtube, now: () => 1_199_999 })).toEqual([]);
    expect(await runOracle({ chain, store, youtube, now: () => 1_200_000 + 14 * 86400 })).toEqual([]);
    store.campaigns.get(1)!.noRootRefunded = true;
    expect(await runOracle({ chain, store, youtube, now: () => NOW })).toEqual([]);
  });

  it("dedupes repeated videoIds before allocation", async () => {
    const { chain, store, youtube } = env;
    store.submissions.push({ id: 99, videoId: "aaaaaaaaaa1", channelId: "UCa", wallet: alice, campaignId: 1, status: "accepted" });
    await runOracle({ chain, store, youtube, now: () => NOW });
    const snap = store.snapshots[0]!.json as SnapshotDocument;
    expect(snap.inputs.submissions.filter((s) => s.videoId === "aaaaaaaaaa1")).toHaveLength(1);
  });
});
