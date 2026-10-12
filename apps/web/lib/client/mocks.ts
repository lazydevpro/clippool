// Realistic fixtures for NEXT_PUBLIC_USE_MOCKS=1 (local development and demo screenshots).
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type {
  CampaignDetail,
  CampaignListResponse,
  CampaignStatus,
  CircleInitializeResponse,
  CircleSocialTokenResponse,
  CircleWalletsResponse,
  EligibleShort,
  EligibleShortsResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  ReceiptsResponse,
  SubmissionRequest,
  SubmissionResponse,
  YouTubeChannel,
  YouTubeChannelsResponse,
  YouTubeConnectRequest,
} from "@/lib/shared/api-types";
import { activeChain, chainKey, TOKENS } from "@/lib/shared/chain";
import { FALLBACK_WINDOWS } from "@/lib/shared/status";
import { CIRCLE_BLOCKCHAIN } from "./env";

const HOUR = 3600;
const DAY = 86400;
const USDC = 1_000_000n;

const hash = (seed: string): Hex => keccak256(toHex(seed));
const addr = (seed: string): Address => getAddress(`0x${hash(seed).slice(-40)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MOCK_BRAND = addr("brand:arc-ecosystem");
export const MOCK_CIRCLE_WALLET = addr("creator:priya");

/** Interfaces §2 water-filling allocation, bigint + floor division. */
function allocate(pool: bigint, maxShareBps: number, scores: Map<Address, bigint>): Map<Address, bigint> {
  const cap = (pool * BigInt(maxShareBps)) / 10000n;
  let remaining = pool;
  let active = [...scores.keys()]
    .filter((w) => (scores.get(w) ?? 0n) > 0n)
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  const alloc = new Map<Address, bigint>();
  while (active.length) {
    const S = active.reduce((s, w) => s + (scores.get(w) ?? 0n), 0n);
    if (S === 0n) break;
    const tentative = new Map(active.map((w) => [w, (remaining * (scores.get(w) ?? 0n)) / S]));
    const capped = active.filter((w) => (tentative.get(w) ?? 0n) >= cap);
    if (!capped.length) {
      for (const w of active) alloc.set(w, tentative.get(w) ?? 0n);
      break;
    }
    for (const w of capped) {
      alloc.set(w, cap);
      remaining -= cap;
    }
    active = active.filter((w) => !capped.includes(w));
  }
  return alloc;
}

const CREATORS: { name: string; handle: string; videos: string[] }[] = [
  { name: "Priya Shorts", handle: "priya", videos: ["USDC on Arc in 30 seconds", "Why gas in USDC is a big deal", "I paid 0.1¢ for this tx"] },
  { name: "OnchainOli", handle: "oli", videos: ["Arc explained like I'm 5", "Sub-second finality, tested live"] },
  { name: "LatAm Ledger", handle: "latam", videos: ["Cobrando en USDC desde Bogotá", "Stablecoins vs. bank wires"] },
  { name: "Manila Minutes", handle: "manila", videos: ["Remittances, but instant", "My first Arc wallet"] },
  { name: "DeFi in 60", handle: "defi60", videos: ["What is a Merkle payout?", "Pro-rata pools explained"] },
  { name: "Kofi Codes", handle: "kofi", videos: ["Deploying to Arc with Foundry"] },
  { name: "StableStack", handle: "stable", videos: ["EURC vs USDC: which one?", "Paying gas in stablecoins"] },
  { name: "Ana Builds", handle: "ana", videos: ["Building a USDC tip jar", "Arc testnet faucet speedrun"] },
  { name: "Rahul Reacts", handle: "rahul", videos: ["Reacting to Arc's launch"] },
  { name: "Mia Makes Money", handle: "mia", videos: ["Getting paid per view, fairly"] },
  { name: "TokenTalk Shorts", handle: "tokentalk", videos: ["3 things about Arc", "Why stablecoin chains?"] },
  { name: "Clip Kitchen", handle: "kitchen", videos: ["Clipping 101 for crypto"] },
  { name: "Night Owl Crypto", handle: "owl", videos: ["Arc at 2am"] },
  { name: "Seoul Stablecoins", handle: "seoul", videos: ["KRW to USDC on Arc"] },
];

const VIEW_PROFILES: Record<string, number[]> = {
  "4": [412_380, 268_940, 197_210, 154_870, 121_400, 98_120, 77_530, 61_090, 44_870, 31_200, 18_440, 6_120],
  "3": [188_200, 140_510, 96_300, 71_950, 52_400, 33_100, 12_900, 4_480],
  "2": [96_400, 71_300, 50_220, 40_870, 28_800, 17_650, 9_310, 3_050, 1_420],
  "1": [38_100, 26_900, 18_300, 9_870, 4_210],
};

interface MockCampaignSeed {
  id: string;
  title: string;
  token: "USDC" | "EURC";
  pool: bigint;
  status: CampaignStatus;
  maxShareBps: number;
  minViews: number;
  rules: string;
  times: (now: number) => { start: number; end: number; snapshot: number; disputeEndsAt: number | null };
}

const SEEDS: MockCampaignSeed[] = [
  {
    id: "4",
    title: "Arc Launch Week: Shorts Challenge",
    token: "USDC",
    pool: 5_000n * USDC,
    status: "live",
    maxShareBps: 2000,
    minViews: 1000,
    rules: [
      "Make a YouTube Short (≤ 3 minutes) about Arc: what it is, why gas in USDC matters, or a demo of something you built.",
      "",
      "• Put your binding code (cp-…) in the video description.",
      "• Original content only. No re-uploads, no botted views.",
      "• Disclose the paid promotion using YouTube's \"Includes paid promotion\" toggle.",
      "• Any language is welcome.",
      "",
      "The pool is split pro-rata by views at the snapshot, with a 20% cap per creator.",
    ].join("\n"),
    times: (now) => ({ start: now - 3 * DAY, end: now + 4 * DAY + 5 * HOUR, snapshot: now + 11 * DAY + 5 * HOUR, disputeEndsAt: null }),
  },
  {
    id: "3",
    title: "Stablecoins in 60 Seconds (EURC)",
    token: "EURC",
    pool: 2_500n * USDC,
    status: "disputing",
    maxShareBps: 2500,
    minViews: 2000,
    rules: "Explain euro stablecoins and EURC on Arc in under 60 seconds. Binding code in the description. Paid-promotion disclosure required.",
    times: (now) => ({ start: now - 16 * DAY, end: now - 9 * DAY, snapshot: now - 18 * HOUR, disputeEndsAt: now + 30 * HOUR }),
  },
  {
    id: "2",
    title: "Ship It on Arc: Builder Tips",
    token: "USDC",
    pool: 1_500n * USDC,
    status: "paying",
    maxShareBps: 2000,
    minViews: 1000,
    rules: "Short-form dev tips for building on Arc: Foundry, viem, USDC gas, Circle wallets. Code must be real and runnable.",
    times: (now) => ({ start: now - 24 * DAY, end: now - 17 * DAY, snapshot: now - 10 * DAY, disputeEndsAt: now - 8 * DAY }),
  },
  {
    id: "1",
    title: "ClipPool Pilot",
    token: "USDC",
    pool: 250n * USDC,
    status: "completed",
    maxShareBps: 3000,
    minViews: 500,
    rules: "Our first pilot: any Short that explains how ClipPool pays creators pro-rata.",
    times: (now) => ({ start: now - 40 * DAY, end: now - 33 * DAY, snapshot: now - 26 * DAY, disputeEndsAt: now - 24 * DAY }),
  },
];

function buildLeaderboard(seed: MockCampaignSeed): LeaderboardEntry[] {
  const views = VIEW_PROFILES[seed.id] ?? [];
  const offset = Number(seed.id) * 3;
  const rows = views.map((v, i) => {
    const c = CREATORS[(i + offset) % CREATORS.length];
    const wallet = c.handle === "priya" ? MOCK_CIRCLE_WALLET : addr(`creator:${c.handle}`);
    const vids = c.videos.map((title, j) => ({
      videoId: hash(`${seed.id}:${c.handle}:${j}`).slice(2, 13),
      title,
      views: j === 0 ? Math.round(v * (c.videos.length > 1 ? 0.7 : 1)) : Math.round((v * 0.3) / (c.videos.length - 1)),
      thumbnailUrl: null,
    }));
    const total = vids.reduce((s, x) => s + x.views, 0);
    return { wallet, name: c.name, handle: c.handle, vids, total };
  });
  const scores = new Map<Address, bigint>();
  for (const r of rows) if (r.total >= seed.minViews) scores.set(r.wallet, BigInt(r.total));
  const alloc = allocate(seed.pool, seed.maxShareBps, scores);
  return rows
    .map((r) => {
      const amount = alloc.get(r.wallet) ?? 0n;
      return {
        wallet: r.wallet,
        channels: [{ channelId: `UC${hash(`ch:${r.handle}`).slice(2, 24)}`, title: r.name }],
        videos: r.vids,
        views: r.total,
        estimatedAmount: amount.toString(),
        sharePct: Number((amount * 1_000_000n) / seed.pool) / 10_000,
      };
    })
    .sort((a, b) => b.views - a.views);
}

function detail(seed: MockCampaignSeed, now: number): CampaignDetail {
  const t = seed.times(now);
  const board = buildLeaderboard(seed);
  const totalAllocated = board.reduce((s, e) => s + BigInt(e.estimatedAmount), 0n);
  const posted = ["disputing", "paying", "completed"].includes(seed.status);
  const claimed =
    seed.status === "completed"
      ? totalAllocated
      : seed.status === "paying"
        ? board.slice(0, 5).reduce((s, e) => s + BigInt(e.estimatedAmount), 0n)
        : 0n;
  return {
    id: seed.id,
    brand: MOCK_BRAND,
    token: TOKENS[chainKey][seed.token],
    tokenSymbol: seed.token,
    pool: seed.pool.toString(),
    startTime: t.start,
    endTime: t.end,
    snapshotTime: t.snapshot,
    maxShareBps: seed.maxShareBps,
    minViews: seed.minViews,
    status: seed.status,
    title: seed.title,
    submissionsCount: board.reduce((s, e) => s + e.videos.length, 0),
    creatorsCount: board.length,
    disputeWindow: FALLBACK_WINDOWS.disputeWindow, // mock seeds use the mainnet 48h window
    rules: seed.rules,
    rulesHash: keccak256(toHex(seed.rules)),
    createTx: hash(`createTx:${seed.id}`),
    root: posted ? hash(`root:${seed.id}`) : null,
    totalAllocated: posted ? totalAllocated.toString() : null,
    claimed: claimed.toString(),
    disputeEndsAt: t.disputeEndsAt,
  };
}

const nowSec = () => Math.floor(Date.now() / 1000);
const seedFor = (id: string) => SEEDS.find((s) => s.id === id);

// ── Connect YouTube mocks: linked channels persist in localStorage so reloads keep them ──
const MOCK_CHANNELS: YouTubeChannel[] = [
  { channelId: "UCdemo00000000000000000a", title: "Your Channel", thumbnailUrl: null },
  { channelId: "UCdemo00000000000000000b", title: "Your Second Channel", thumbnailUrl: null },
];
const MOCK_LINKS_KEY = "clippool.mock.ytLinks";
const mockSubmitted = new Set<string>();

function readLinks(): Record<string, string[]> {
  try {
    return JSON.parse(window.localStorage.getItem(MOCK_LINKS_KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}
function writeLinks(links: Record<string, string[]>) {
  try {
    window.localStorage.setItem(MOCK_LINKS_KEY, JSON.stringify(links));
  } catch {}
}
const linkedTo = (wallet: string) =>
  (readLinks()[wallet.toLowerCase()] ?? []).map((id) => MOCK_CHANNELS.find((c) => c.channelId === id)).filter((c): c is YouTubeChannel => Boolean(c));

const MOCK_SHORT_TITLES = [
  "Why paying gas in USDC changes everything #shorts",
  "I sent $5 across the world in 0.4 seconds",
  "Arc testnet faucet speedrun",
  "3 things nobody tells you about stablecoins",
];

export class MockNotFoundError extends Error {
  status = 404;
}

export const mockApi = {
  async listCampaigns(): Promise<CampaignListResponse> {
    await sleep(350);
    const now = nowSec();
    return {
      campaigns: SEEDS.map((s) => {
        const d = detail(s, now);
        return {
          id: d.id, brand: d.brand, token: d.token, tokenSymbol: d.tokenSymbol, pool: d.pool,
          startTime: d.startTime, endTime: d.endTime, snapshotTime: d.snapshotTime,
          maxShareBps: d.maxShareBps, minViews: d.minViews, status: d.status, title: d.title,
          submissionsCount: d.submissionsCount, creatorsCount: d.creatorsCount, disputeWindow: d.disputeWindow,
        };
      }),
    };
  },
  async getCampaign(id: string): Promise<CampaignDetail> {
    await sleep(300);
    const s = seedFor(id);
    if (!s) throw new MockNotFoundError("Campaign not found");
    return detail(s, nowSec());
  },
  async getLeaderboard(id: string): Promise<LeaderboardResponse> {
    await sleep(450);
    const s = seedFor(id);
    if (!s) throw new MockNotFoundError("Campaign not found");
    const entries = buildLeaderboard(s);
    return { updatedAt: nowSec() - 240, totalViews: entries.reduce((a, e) => a + e.views, 0), entries };
  },
  async getReceipts(id: string): Promise<ReceiptsResponse> {
    await sleep(400);
    const s = seedFor(id);
    if (!s) throw new MockNotFoundError("Campaign not found");
    const d = detail(s, nowSec());
    const entries = buildLeaderboard(s).filter((e) => BigInt(e.estimatedAmount) > 0n);
    return {
      root: d.root,
      totalAllocated: d.totalAllocated,
      snapshotHash: d.root ? hash(`snapshot:${id}`) : null,
      disputeEndsAt: d.disputeEndsAt,
      allocations: entries
        .map((e, i) => {
          const paid = s.status === "completed" || (s.status === "paying" && i < 5);
          return {
            wallet: e.wallet,
            amount: e.estimatedAmount,
            status: paid ? ("paid" as const) : ("pending" as const),
            claimTx: paid ? hash(`claim:${id}:${e.wallet}`) : null,
          };
        })
        .sort((a, b) => (a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1)),
    };
  },
  async getSnapshot(id: string): Promise<unknown> {
    const s = seedFor(id);
    if (!s) throw new MockNotFoundError("Campaign not found");
    const d = detail(s, nowSec());
    const board = buildLeaderboard(s);
    return {
      version: "mock-1",
      chainId: activeChain.id,
      campaign: { id: d.id, pool: d.pool, maxShareBps: d.maxShareBps, minViews: String(d.minViews) },
      submissions: board.flatMap((e) =>
        e.videos.map((v) => ({ videoId: v.videoId, channelId: e.channels[0].channelId, wallet: e.wallet, views: String(v.views) })),
      ),
      allocations: board.map((e) => ({ wallet: e.wallet, amount: e.estimatedAmount })),
      root: d.root,
    };
  },
  async postMeta(): Promise<{ ok: true }> {
    await sleep(500);
    return { ok: true };
  },
  async submit(req: SubmissionRequest): Promise<SubmissionResponse> {
    await sleep(1100);
    const url = req.videoUrl.trim();
    const m = url.match(/(?:shorts\/|youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/);
    if (!m) return { status: "rejected", reason: "invalid_url" };
    const s = seedFor(req.campaignId);
    if (s && s.status !== "live") return { status: "rejected", reason: "campaign_not_live" };
    if (/nocode/i.test(url)) return { status: "rejected", reason: "missing_binding_code" };
    if (/dupe/i.test(url)) return { status: "rejected", reason: "duplicate" };
    if (mockSubmitted.has(m[1])) return { status: "rejected", reason: "duplicate" };
    mockSubmitted.add(m[1]);
    const linked = linkedTo(req.wallet);
    return {
      status: "accepted",
      submission: {
        videoId: m[1],
        channelId: linked[0]?.channelId ?? "UCdemo0000000000000000",
        channelTitle: linked[0]?.title ?? "Your Channel",
        title: "Why paying gas in USDC changes everything #shorts",
        views: 12_480,
        proof: linked.length ? "oauth" : "code",
      },
    };
  },
  async connectYouTube(req: YouTubeConnectRequest): Promise<YouTubeChannelsResponse> {
    await sleep(900);
    const links = readLinks();
    const key = req.wallet.toLowerCase();
    const have = new Set(links[key] ?? []);
    // First connect links the first channel; "Connect another channel" links the next one.
    const next = MOCK_CHANNELS.find((c) => !have.has(c.channelId)) ?? MOCK_CHANNELS[0];
    for (const w of Object.keys(links)) links[w] = links[w].filter((id) => id !== next.channelId); // owner re-points the channel
    links[key] = [...(links[key] ?? []), next.channelId];
    writeLinks(links);
    return { wallet: getAddress(req.wallet), channels: [next] };
  },
  async youtubeChannels(wallet: string): Promise<YouTubeChannelsResponse> {
    await sleep(250);
    return { wallet: getAddress(wallet), channels: linkedTo(wallet) };
  },
  async eligibleShorts(campaignId: string, wallet: string): Promise<EligibleShortsResponse> {
    await sleep(700);
    const channels = linkedTo(wallet);
    const s = seedFor(campaignId);
    if (!s) throw new MockNotFoundError("Campaign not found");
    // Only the live mock campaign has fresh uploads in its window; the others show the empty state.
    if (!channels.length || s.status !== "live") return { wallet: getAddress(wallet), channels, shorts: [] };
    const t = s.times(nowSec());
    const shorts: EligibleShort[] = channels.flatMap((c, ci) =>
      MOCK_SHORT_TITLES.slice(0, ci === 0 ? 4 : 2).map((title, i) => {
        const videoId = hash(`mock-short:${c.channelId}:${i}`).slice(2, 13);
        return {
          videoId,
          channelId: c.channelId,
          channelTitle: c.title,
          title,
          thumbnailUrl: null,
          publishedAt: Math.min(nowSec() - 3600, t.start + (i + 1) * 9 * HOUR + ci * HOUR),
          durationSec: [42, 58, 31, 175][i] ?? 45,
          views: [12_480, 3_920, 815, 27_300][i] ?? 1000,
          alreadySubmitted: (ci === 0 && i === 2) || mockSubmitted.has(videoId),
        };
      }),
    );
    shorts.sort((a, b) => b.publishedAt - a.publishedAt);
    return { wallet: getAddress(wallet), channels, shorts };
  },
  async circleSocialToken(): Promise<CircleSocialTokenResponse> {
    await sleep(300);
    return { deviceToken: "mock-device-token", deviceEncryptionKey: "mock-device-key" };
  },
  async circleInitialize(): Promise<CircleInitializeResponse> {
    await sleep(300);
    return { challengeId: null, wallets: [{ id: "mock-wallet", address: MOCK_CIRCLE_WALLET, blockchain: CIRCLE_BLOCKCHAIN }] };
  },
  async circleWallets(): Promise<CircleWalletsResponse> {
    await sleep(350);
    return {
      wallets: [{ id: "mock-wallet", address: MOCK_CIRCLE_WALLET, blockchain: CIRCLE_BLOCKCHAIN }],
      balances: { [MOCK_CIRCLE_WALLET]: { USDC: "1284650000", EURC: "312400000" } },
    };
  },
};
