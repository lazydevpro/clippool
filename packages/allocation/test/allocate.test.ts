import { describe, expect, it } from "vitest";
import { computeAllocation, computeAmounts, estimateShares, ZERO_ROOT, type Submission } from "../src/index";

// Wallets chosen so lowercase sort order is A < B < C < D < E < F.
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";
const E = "0x5555555555555555555555555555555555555555";
const F = "0x6666666666666666666666666666666666666666";

let n = 0;
const s = (wallet: string, views: bigint, channelId = "UCaaaaaaaaaaaaaaaaaaaaaa"): Submission => ({
  videoId: `vid${String(n++).padStart(8, "0")}`,
  channelId,
  wallet,
  views,
});
const amounts = (r: { allocations: { wallet: string; amount: bigint }[] }) =>
  Object.fromEntries(r.allocations.map((a) => [a.wallet.toLowerCase(), a.amount]));

const USDC = 1_000_000n;

describe("computeAmounts — hand-computed", () => {
  it("whale capped, excess redistributed", () => {
    // pool = 1,000,000,000 (1000 USDC), maxShareBps = 2000 → cap = 1e9 * 2000 / 10000 = 200,000,000
    // scores: A=500,000  B..F=100,000 each → S = 1,000,000
    // round 1: tentative A = 1e9 * 500,000 / 1,000,000 = 500,000,000 ≥ cap → capped
    //          tentative B..F = 1e9 * 100,000 / 1,000,000 = 100,000,000 (< cap)
    //          alloc A = 200,000,000; remaining = 1e9 − 2e8 = 800,000,000
    // round 2: S = 500,000; tentative B..F = 8e8 * 100,000 / 500,000 = 160,000,000 < cap → final
    // total = 2e8 + 5 * 1.6e8 = 1,000,000,000; leftover = 0
    const r = computeAmounts({ pool: 1000n * USDC, maxShareBps: 2000, minViews: 1000n }, [
      s(A, 500_000n),
      s(B, 100_000n),
      s(C, 100_000n),
      s(D, 100_000n),
      s(E, 100_000n),
      s(F, 100_000n),
    ]);
    expect(amounts(r)).toEqual({
      [A]: 200_000_000n,
      [B]: 160_000_000n,
      [C]: 160_000_000n,
      [D]: 160_000_000n,
      [E]: 160_000_000n,
      [F]: 160_000_000n,
    });
    expect(r.totalAllocated).toBe(1_000_000_000n);
    expect(r.leftover).toBe(0n);
  });

  it("cascading cap across three rounds", () => {
    // cap = 200,000,000. scores A=500k B=150k C=100k D=100k E=80k F=70k, S = 1,000,000
    // round 1: A = 1e9*500k/1M = 5e8 ≥ cap → capped; B = 1.5e8 < cap. remaining = 8e8
    // round 2: S = 500k. B = 8e8*150k/500k = 2.4e8 ≥ cap → capped. remaining = 6e8
    //          (C = D = 1.6e8, E = 1.28e8, F = 1.12e8 are below cap)
    // round 3: S = 350k. C = D = floor(6e8*100k/350k) = floor(171,428,571.43) = 171,428,571
    //          E = floor(6e8*80k/350k) = floor(137,142,857.14) = 137,142,857
    //          F = 6e8*70k/350k = 120,000,000 exactly
    // total = 2e8 + 2e8 + 2*171,428,571 + 137,142,857 + 120,000,000 = 999,999,999; leftover = 1
    const r = computeAmounts({ pool: 1000n * USDC, maxShareBps: 2000, minViews: 1000n }, [
      s(A, 500_000n),
      s(B, 150_000n),
      s(C, 100_000n),
      s(D, 100_000n),
      s(E, 80_000n),
      s(F, 70_000n),
    ]);
    expect(amounts(r)).toEqual({
      [A]: 200_000_000n,
      [B]: 200_000_000n,
      [C]: 171_428_571n,
      [D]: 171_428_571n,
      [E]: 137_142_857n,
      [F]: 120_000_000n,
    });
    expect(r.totalAllocated).toBe(999_999_999n);
    expect(r.leftover).toBe(1n);
  });

  it("rounding dust: zero allocations dropped, dust refunded", () => {
    // pool = 100 base units, no cap (cap = 100). scores A=B=C=1000, D=1 → S = 3001
    // A = B = C = floor(100*1000/3001) = floor(33.32) = 33 (< cap 100)
    // D = floor(100*1/3001) = 0 → dropped in step 6
    // total = 99; leftover = 1
    const r = computeAmounts({ pool: 100n, maxShareBps: 10000, minViews: 1n }, [
      s(A, 1000n),
      s(B, 1000n),
      s(C, 1000n),
      s(D, 1n),
    ]);
    expect(amounts(r)).toEqual({ [A]: 33n, [B]: 33n, [C]: 33n });
    expect(r.allocations.map((a) => a.views)).toEqual([1000n, 1000n, 1000n]);
    expect(r.totalAllocated).toBe(99n);
    expect(r.leftover).toBe(1n);
  });

  it("everyone capped → leftover refund", () => {
    // cap = 2e8; A = 1e9*300k/400k = 7.5e8 ≥ cap, B = 2.5e8 ≥ cap → both capped, active empty
    const r = computeAmounts({ pool: 1000n * USDC, maxShareBps: 2000, minViews: 0n }, [s(A, 300_000n), s(B, 100_000n)]);
    expect(amounts(r)).toEqual({ [A]: 200_000_000n, [B]: 200_000_000n });
    expect(r.leftover).toBe(600_000_000n);
  });

  it("all equal with dust", () => {
    // cap = 5e8; each = floor(1e9/3) = 333,333,333; leftover = 1
    const r = computeAmounts({ pool: 1000n * USDC, maxShareBps: 5000, minViews: 0n }, [s(A, 7n), s(B, 7n), s(C, 7n)]);
    expect(Object.values(amounts(r))).toEqual([333_333_333n, 333_333_333n, 333_333_333n]);
    expect(r.leftover).toBe(1n);
  });

  it("minViews applies per submission, before aggregation", () => {
    // A: 5000 kept, 500 dropped → score 5000; B: 999 dropped → absent; C: exactly 1000 kept
    // pool 1e8, no cap: A = floor(1e8*5000/6000) = 83,333,333; C = floor(1e8*1000/6000) = 16,666,666
    const r = computeAmounts({ pool: 100n * USDC, maxShareBps: 10000, minViews: 1000n }, [
      s(A, 5000n),
      s(A, 500n),
      s(B, 999n),
      s(C, 1000n),
    ]);
    expect(amounts(r)).toEqual({ [A]: 83_333_333n, [C]: 16_666_666n });
    expect(r.allocations[0]!.views).toBe(5000n);
    expect(r.leftover).toBe(1n);
  });

  it("aggregates per wallet across channels and address casing", () => {
    const mixed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"; // not a valid checksum, still accepted
    const lower = mixed.toLowerCase();
    const r = computeAmounts({ pool: 1000n, maxShareBps: 10000, minViews: 0n }, [
      s(lower, 30n, "UCchannelAAAAAAAAAAAAAAA"),
      s(mixed.toUpperCase().replace("0X", "0x"), 10n, "UCchannelBBBBBBBBBBBBBBB"),
      s(A, 40n),
    ]);
    expect(r.allocations).toHaveLength(2);
    // sorted ascending by lowercase address: 0x1111… < 0xabcd…
    expect(r.allocations[0]!.wallet).toBe("0x1111111111111111111111111111111111111111");
    expect(r.allocations[1]!.wallet.toLowerCase()).toBe(lower);
    expect(r.allocations[1]!.views).toBe(40n);
    // checksummed output
    expect(r.allocations[1]!.wallet).not.toBe(lower);
    expect(r.allocations.map((a) => a.amount)).toEqual([500n, 500n]);
  });

  it("no submissions / all filtered → empty, leftover = pool, zero root", () => {
    const res = computeAllocation({ id: 1n, pool: 5n, maxShareBps: 2000, minViews: 10n }, [s(A, 9n), s(B, 0n)]);
    expect(res.allocations).toEqual([]);
    expect(res.totalAllocated).toBe(0n);
    expect(res.leftover).toBe(5n);
    expect(res.root).toBe(ZERO_ROOT);
    expect(res.tree).toBeNull();
  });

  it("maxShareBps = 10000 means no cap; single creator takes the pool", () => {
    const r = computeAmounts({ pool: 777n, maxShareBps: 10000, minViews: 0n }, [s(A, 1n)]);
    expect(amounts(r)).toEqual({ [A]: 777n });
    expect(r.leftover).toBe(0n);
  });

  it("maxShareBps = 0 → cap 0, nothing allocated", () => {
    const r = computeAmounts({ pool: 1000n, maxShareBps: 0, minViews: 0n }, [s(A, 1n), s(B, 2n)]);
    expect(r.allocations).toEqual([]);
    expect(r.leftover).toBe(1000n);
  });

  it("zero-view submissions with minViews 0 get nothing", () => {
    const r = computeAmounts({ pool: 1000n, maxShareBps: 10000, minViews: 0n }, [s(A, 0n), s(B, 10n)]);
    expect(amounts(r)).toEqual({ [B]: 1000n });
  });

  it("rejects bad input", () => {
    const p = { pool: 1n, maxShareBps: 2000, minViews: 0n };
    expect(() => computeAmounts(p, [s("0x123", 1n)])).toThrow(/invalid wallet/);
    expect(() => computeAmounts(p, [s(A, -1n)])).toThrow(/views/);
    expect(() => computeAmounts({ ...p, maxShareBps: 10001 }, [])).toThrow(/maxShareBps/);
    expect(() => computeAmounts({ ...p, maxShareBps: 1.5 }, [])).toThrow(/maxShareBps/);
    expect(() => computeAmounts({ ...p, pool: -1n }, [])).toThrow(/pool/);
    expect(() => computeAmounts({ ...p, pool: 1n << 128n }, [])).toThrow(/pool/);
    expect(() => computeAmounts({ ...p, minViews: -1n }, [])).toThrow(/minViews/);
  });
});

describe("estimateShares", () => {
  it("returns exact amounts plus a display percentage", () => {
    const { shares, leftover } = estimateShares({ pool: 1000n * USDC, maxShareBps: 2000, minViews: 0n }, [
      s(A, 500_000n),
      s(B, 100_000n),
      s(C, 100_000n),
      s(D, 100_000n),
      s(E, 100_000n),
      s(F, 100_000n),
    ]);
    expect(shares.map((x) => x.sharePct)).toEqual([20, 16, 16, 16, 16, 16]);
    expect(shares[0]!.amount).toBe(200_000_000n);
    expect(leftover).toBe(0n);
  });

  it("handles pool 0", () => {
    const { shares } = estimateShares({ pool: 0n, maxShareBps: 2000, minViews: 0n }, [s(A, 1n)]);
    expect(shares).toEqual([]);
  });

  it("truncates to 4 decimals", () => {
    const { shares } = estimateShares({ pool: 3n, maxShareBps: 10000, minViews: 0n }, [s(A, 1n), s(B, 2n)]);
    // A = floor(3*1/3) = 1 → 33.3333%; B = 2 → 66.6666%
    expect(shares.map((x) => x.sharePct)).toEqual([33.3333, 66.6666]);
  });
});
