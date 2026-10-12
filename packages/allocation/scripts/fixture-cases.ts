/**
 * Golden fixture definitions (interfaces.md §4). Shared by scripts/generate-fixtures.ts and the
 * drift test in test/fixtures.test.ts. Node-only helpers live in generate-fixtures.ts.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, slice, toBytes } from "viem";
import { buildSnapshot, computeAllocation, getProof, type CampaignInput, type Submission } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = resolve(here, "../../../contracts/test/fixtures");
export const EXAMPLES_DIR = resolve(here, "../examples");
export const EXAMPLE_SNAPSHOT_FIXTURE = "whale-capped";

export const USDC = 1_000_000n; // 6 decimals

export interface FixtureJson {
  name: string;
  description: string;
  campaign: { id: string; pool: string; maxShareBps: number; minViews: string };
  submissions: { videoId: string; channelId: string; wallet: string; views: string }[];
  expected: {
    allocations: { wallet: string; amount: string }[];
    totalAllocated: string;
    leftover: string;
    root: string;
    proofs: { wallet: string; amount: string; proof: string[] }[];
  };
}

export interface FixtureCase {
  name: string;
  description: string;
  campaign: CampaignInput;
  submissions: Submission[];
}

// ---------- deterministic identities ----------

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function hashChars(label: string, n: number): string {
  const bytes = toBytes(keccak256(toBytes(label)));
  let out = "";
  for (let i = 0; i < n; i++) out += B64URL[bytes[i]! & 63];
  return out;
}

/** Deterministic, checksummed test wallet #n. */
export function wallet(n: number): `0x${string}` {
  return getAddress(slice(keccak256(toBytes(`clippool-fixture-wallet-${n}`)), 12));
}
/** Real-looking 11-char YouTube video id. */
export function videoId(label: string): string {
  return hashChars(`video:${label}`, 11);
}
/** Real-looking 24-char "UC…" channel id. */
export function channelId(label: string): string {
  return `UC${hashChars(`channel:${label}`, 22)}`;
}

function sub(w: number, ch: string, vid: string, views: bigint): Submission {
  return { videoId: videoId(vid), channelId: channelId(ch), wallet: wallet(w), views };
}

/** mulberry32 — tiny seeded PRNG, deterministic across JS engines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// ---------- cases ----------

function largeRandomCase(): FixtureCase {
  const rand = mulberry32(0xc11990);
  const whales = new Set([7, 23, 41]);
  const submissions: Submission[] = [];
  for (let w = 1; w <= 60; w++) {
    const videos = 1 + (rand() % 3);
    for (let v = 0; v < videos; v++) {
      // whales: 3M-5M views; every 6th wallet: tiny views (straddling minViews 1000); else < 200k
      const views = whales.has(w)
        ? 3_000_000 + (rand() % 2_000_000)
        : w % 6 === 0
          ? rand() % 2_000
          : rand() % 200_000;
      // ~1 in 8 creators runs a second channel into the same wallet
      const ch = w % 8 === 0 && v === 1 ? `large-${w}-b` : `large-${w}`;
      submissions.push(sub(100 + w, ch, `large-${w}-${v}`, BigInt(views)));
    }
  }
  return {
    name: "large-random",
    description:
      "60 wallets, 1-3 videos each, seeded PRNG views (mulberry32 seed 0xc11990); 3 whales exceed the 10% cap; 6 submissions fall below minViews and 2 wallets drop out entirely (58 allocations)",
    campaign: { id: 9n, pool: 25_000n * USDC, maxShareBps: 1000, minViews: 1000n },
    submissions,
  };
}

export function fixtureCases(): FixtureCase[] {
  return [
    {
      name: "single-creator",
      description: "one creator, no cap (maxShareBps 10000): receives the whole pool; single-leaf tree (root = leaf, empty proof)",
      campaign: { id: 1n, pool: 500n * USDC, maxShareBps: 10000, minViews: 1000n },
      submissions: [sub(1, "solo", "solo-1", 48_213n)],
    },
    {
      name: "all-equal",
      description: "3 wallets with equal views, 50% cap not hit: 333333333 each, 1 base unit of dust refunded",
      campaign: { id: 2n, pool: 1000n * USDC, maxShareBps: 5000, minViews: 1000n },
      submissions: [
        sub(2, "eq-a", "eq-a-1", 100_000n),
        sub(3, "eq-b", "eq-b-1", 100_000n),
        sub(4, "eq-c", "eq-c-1", 100_000n),
      ],
    },
    {
      name: "whale-capped",
      description: "one wallet exceeds the 20% cap; excess redistributed pro-rata to the other 5 wallets",
      campaign: { id: 3n, pool: 1000n * USDC, maxShareBps: 2000, minViews: 1000n },
      submissions: [
        sub(5, "whale", "whale-1", 500_000n),
        sub(6, "wc-b", "wc-b-1", 100_000n),
        sub(7, "wc-c", "wc-c-1", 100_000n),
        sub(8, "wc-d", "wc-d-1", 100_000n),
        sub(9, "wc-e", "wc-e-1", 100_000n),
        sub(10, "wc-f", "wc-f-1", 100_000n),
      ],
    },
    {
      name: "cascade-capped",
      description:
        "whale capped in round 1, redistribution pushes a 2nd wallet over the 20% cap in round 2; round 3 leaves 1 unit of dust",
      campaign: { id: 4n, pool: 1000n * USDC, maxShareBps: 2000, minViews: 1000n },
      submissions: [
        sub(11, "cc-a", "cc-a-1", 500_000n),
        sub(12, "cc-b", "cc-b-1", 150_000n),
        sub(13, "cc-c", "cc-c-1", 100_000n),
        sub(14, "cc-d", "cc-d-1", 100_000n),
        sub(15, "cc-e", "cc-e-1", 80_000n),
        sub(16, "cc-f", "cc-f-1", 70_000n),
      ],
    },
    {
      name: "everyone-capped",
      description: "2 wallets with a 20% cap: both capped at 200 USDC, 600 USDC leftover refunded to the brand",
      campaign: { id: 5n, pool: 1000n * USDC, maxShareBps: 2000, minViews: 1000n },
      submissions: [sub(17, "ec-a", "ec-a-1", 300_000n), sub(18, "ec-b", "ec-b-1", 100_000n)],
    },
    {
      name: "below-min-filtered",
      description:
        "minViews 1000 applies per submission: 999-view video dropped (wallet excluded), 1000-view kept, a 500-view video of a qualifying wallet dropped",
      campaign: { id: 6n, pool: 100n * USDC, maxShareBps: 10000, minViews: 1000n },
      submissions: [
        sub(19, "bm-a", "bm-a-1", 5_000n),
        sub(19, "bm-a", "bm-a-2", 500n),
        sub(20, "bm-b", "bm-b-1", 999n),
        sub(21, "bm-c", "bm-c-1", 1_000n),
      ],
    },
    {
      name: "zero-valid-submissions",
      description:
        "no submission reaches minViews: allocations and proofs are empty, totalAllocated 0, leftover = pool, and root is bytes32(0) by convention (OZ cannot build an empty tree; nothing is claimable)",
      campaign: { id: 7n, pool: 250n * USDC, maxShareBps: 2000, minViews: 10_000n },
      submissions: [
        sub(22, "zv-a", "zv-a-1", 9_999n),
        sub(23, "zv-b", "zv-b-1", 0n),
        sub(24, "zv-c", "zv-c-1", 120n),
      ],
    },
    {
      name: "rounding-dust",
      description:
        "pool of 100 base units split 1000:1000:1000:1 -> 33/33/33/0; the zero allocation is dropped and 1 unit of dust is refunded",
      campaign: { id: 8n, pool: 100n, maxShareBps: 10000, minViews: 1n },
      submissions: [
        sub(25, "rd-a", "rd-a-1", 1_000n),
        sub(26, "rd-b", "rd-b-1", 1_000n),
        sub(27, "rd-c", "rd-c-1", 1_000n),
        sub(28, "rd-d", "rd-d-1", 1n),
      ],
    },
    {
      name: "multi-video-multi-channel",
      description:
        "wallet A has 2 channels / 3 videos (80k views), wallet B 1 channel / 2 videos (40k), wallet C 1 video (80k): views aggregate per wallet, not per channel",
      campaign: { id: 10n, pool: 1000n * USDC, maxShareBps: 5000, minViews: 1000n },
      submissions: [
        sub(29, "mv-a1", "mv-a1-1", 40_000n),
        sub(30, "mv-b", "mv-b-1", 30_000n),
        sub(29, "mv-a2", "mv-a2-1", 25_000n),
        sub(31, "mv-c", "mv-c-1", 80_000n),
        sub(29, "mv-a1", "mv-a1-2", 15_000n),
        sub(30, "mv-b", "mv-b-2", 10_000n),
      ],
    },
    largeRandomCase(),
  ];
}

// ---------- serialisation ----------

export function toFixtureJson(c: FixtureCase): FixtureJson {
  const r = computeAllocation(c.campaign, c.submissions);
  return {
    name: c.name,
    description: c.description,
    campaign: {
      id: c.campaign.id.toString(),
      pool: c.campaign.pool.toString(),
      maxShareBps: c.campaign.maxShareBps,
      minViews: c.campaign.minViews.toString(),
    },
    submissions: c.submissions.map((s) => ({
      videoId: s.videoId,
      channelId: s.channelId,
      wallet: getAddress(s.wallet),
      views: s.views.toString(),
    })),
    expected: {
      allocations: r.allocations.map((a) => ({ wallet: a.wallet, amount: a.amount.toString() })),
      totalAllocated: r.totalAllocated.toString(),
      leftover: r.leftover.toString(),
      root: r.root,
      proofs: r.tree
        ? r.allocations.map((a) => ({ wallet: a.wallet, amount: a.amount.toString(), proof: getProof(r.tree!, a.wallet)! }))
        : [],
    },
  };
}

export const fixtureFileName = (name: string) => `allocation-${name}.json`;
export const exampleSnapshotFileName = (name: string) => `${name}.snapshot.json`;

export const serialize = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Every file the generator writes: absolute path -> contents. */
export function generatedFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const cases = fixtureCases();
  for (const c of cases) files.set(resolve(FIXTURES_DIR, fixtureFileName(c.name)), serialize(toFixtureJson(c)));
  const ex = cases.find((c) => c.name === EXAMPLE_SNAPSHOT_FIXTURE)!;
  files.set(
    resolve(EXAMPLES_DIR, exampleSnapshotFileName(ex.name)),
    serialize(buildSnapshot(ex.campaign, ex.submissions)),
  );
  return files;
}
