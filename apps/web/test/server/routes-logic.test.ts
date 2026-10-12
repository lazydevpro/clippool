import { estimateShares } from "@clippool/allocation";
import { keccak256, stringToBytes } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { env, MissingEnvError, __resetEnvForTests } from "@/lib/server/env";
import { campaignIdParam, HttpError, safeErrorMessage, createRateLimiter, toErrorResponse } from "@/lib/server/http";
import { verifyCampaignMeta } from "@/lib/server/meta";
import { buildLeaderboard, toDetail, tokenSymbolOf, toSummary, type LeaderboardRow } from "@/lib/server/queries";
import { circleBlockchain } from "@/lib/server/circle";
import { addr, campaignRow, FakeChain, onchainCampaign, txHash } from "./helpers/fakes";

describe("buildLeaderboard", () => {
  const alice = addr(0xa11ce);
  const bob = addr(0xb0b0);
  const rows: LeaderboardRow[] = [
    { videoId: "a1", channelId: "UCa", channelTitle: "A", title: "a1", thumbnailUrl: null, wallet: alice, views: 600_000 },
    { videoId: "a2", channelId: "UCa2", channelTitle: "A2", title: "a2", thumbnailUrl: null, wallet: alice.toLowerCase(), views: 400_000 },
    { videoId: "b1", channelId: "UCb", channelTitle: "B", title: "b1", thumbnailUrl: "https://i.ytimg.com/b.jpg", wallet: bob, views: 500 },
    { videoId: "b2", channelId: "UCb", channelTitle: "B", title: "b2", thumbnailUrl: null, wallet: bob, views: null }, // purged/never fetched
  ];
  const campaign = { id: 1, pool: "1000000000", maxShareBps: 10_000, minViews: 1000 };

  it("aggregates per wallet (case-insensitive) and uses the engine's estimates", () => {
    const lb = buildLeaderboard(campaign, rows, 123);
    const { shares } = estimateShares(
      { pool: 1_000_000_000n, maxShareBps: 10_000, minViews: 1000n },
      rows.map((r) => ({ videoId: r.videoId, channelId: r.channelId, wallet: r.wallet, views: BigInt(r.views ?? 0) })),
    );
    expect(lb.updatedAt).toBe(123);
    expect(lb.totalViews).toBe(1_000_500);
    expect(lb.entries).toHaveLength(2);
    const [first, second] = lb.entries;
    expect(first).toMatchObject({ wallet: alice, views: 1_000_000, estimatedAmount: shares[0]!.amount.toString(), sharePct: 100 });
    expect(first!.channels.map((c) => c.channelId)).toEqual(["UCa", "UCa2"]);
    expect(first!.videos.map((v) => v.videoId)).toEqual(["a1", "a2"]);
    expect(second).toMatchObject({ wallet: bob, views: 500, estimatedAmount: "0", sharePct: 0 });
    expect(second!.channels).toHaveLength(1);
  });

  it("empty campaign", () => {
    expect(buildLeaderboard(campaign, [], 1)).toEqual({ updatedAt: 1, totalViews: 0, entries: [] });
  });
});

describe("verifyCampaignMeta", () => {
  const rules = "Post a Short with #ad.\nUse our sound.";
  const brand = addr(0xb0b);
  function chainWith(over: { from?: string; status?: "success" | "reverted"; id?: bigint; rulesHash?: `0x${string}` } = {}) {
    const chain = new FakeChain();
    chain.campaigns.set("3", onchainCampaign({ brand, rulesHash: over.rulesHash ?? keccak256(stringToBytes(rules)) }));
    chain.txs.set(txHash(9), {
      from: (over.from ?? brand) as `0x${string}`,
      to: addr(0xc1),
      status: over.status ?? "success",
      logs: [{ eventName: "CampaignCreated", args: { id: over.id ?? 3n, brand }, blockNumber: 77n, logIndex: 0, transactionHash: txHash(9) }],
    });
    return chain;
  }
  const code = (p: Promise<unknown>) => p.then(() => "ok", (e: HttpError) => e.code);

  it("accepts when tx sender is the brand and keccak256(utf8(rules)) matches", async () => {
    const r = await verifyCampaignMeta(chainWith(), 3, { rules, createTx: txHash(9) });
    expect(r.brand).toBe(brand);
    expect(r.createdBlock).toBe(77);
  });
  it("rejects mismatches", async () => {
    expect(await code(verifyCampaignMeta(chainWith(), 3, { rules: rules + " ", createTx: txHash(9) }))).toBe("rules_hash_mismatch");
    expect(await code(verifyCampaignMeta(chainWith({ from: addr(0xe71) }), 3, { rules, createTx: txHash(9) }))).toBe("not_brand");
    expect(await code(verifyCampaignMeta(chainWith({ id: 4n }), 3, { rules, createTx: txHash(9) }))).toBe("tx_mismatch");
    expect(await code(verifyCampaignMeta(chainWith({ status: "reverted" }), 3, { rules, createTx: txHash(9) }))).toBe("tx_reverted");
    expect(await code(verifyCampaignMeta(chainWith(), 3, { rules, createTx: txHash(10) }))).toBe("tx_not_found");
  });
});

describe("env", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    __resetEnvForTests();
  });
  it("getters are lazy and throw MissingEnvError naming only the variable", () => {
    delete process.env.YOUTUBE_API_KEY;
    expect(() => env.youtubeApiKey()).toThrow(MissingEnvError);
    process.env.ORACLE_PRIVATE_KEY = "not-a-key";
    expect(() => env.oraclePrivateKey()).toThrow(/ORACLE_PRIVATE_KEY is malformed/);
    try {
      env.oraclePrivateKey();
    } catch (e) {
      expect((e as Error).message).not.toContain("not-a-key");
    }
  });
  it("chain key + RPC selection", () => {
    process.env.NEXT_PUBLIC_CHAIN = "arc";
    process.env.ARC_MAINNET_RPC_URL = "https://mainnet.example";
    process.env.ARC_TESTNET_RPC_URL = "https://testnet.example";
    expect(env.chainKey()).toBe("arc");
    expect(env.rpcUrl()).toBe("https://mainnet.example");
    delete process.env.NEXT_PUBLIC_CHAIN;
    expect(env.chainKey()).toBe("arcTestnet");
    expect(env.rpcUrl()).toBe("https://testnet.example");
    delete process.env.NEXT_PUBLIC_CLIPPOOL_DEPLOY_BLOCK;
    expect(() => env.deployBlock()).toThrow(MissingEnvError);
    process.env.NEXT_PUBLIC_CLIPPOOL_DEPLOY_BLOCK = "123456";
    expect(env.deployBlock()).toBe(123456n);
  });
});

describe("http helpers", () => {
  it("campaign id param", () => {
    expect(campaignIdParam.safeParse("12").data).toBe(12);
    for (const bad of ["0", "-1", "1.5", "abc", "01", ""]) expect(campaignIdParam.safeParse(bad).success).toBe(false);
  });
  it("safeErrorMessage strips URLs and private-key-sized hex", () => {
    const m = safeErrorMessage(new Error(`bad https://rpc.x/key123 0x${"a".repeat(64)}`));
    expect(m).not.toContain("key123");
    expect(m).not.toContain("a".repeat(64));
  });
  it("error responses are consistent JSON", async () => {
    const res = toErrorResponse("t", new HttpError(404, "campaign_not_found", "Campaign not found"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "campaign_not_found", message: "Campaign not found" } });
  });
  it("rate limiter", () => {
    const rl = createRateLimiter(2, 1000);
    expect(rl.check("ip", 0).ok).toBe(true);
    expect(rl.check("ip", 1).ok).toBe(true);
    expect(rl.check("ip", 2)).toMatchObject({ ok: false, retryAfterSec: 1 });
    expect(rl.check("other", 2).ok).toBe(true);
    expect(rl.check("ip", 1000).ok).toBe(true);
  });
  it("token symbol + Circle blockchain codes", () => {
    expect(tokenSymbolOf("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", "arcTestnet")).toBe("EURC");
    expect(tokenSymbolOf("0x3600000000000000000000000000000000000000", "arcTestnet")).toBe("USDC");
    expect(circleBlockchain("arc")).toBe("ARC");
    expect(circleBlockchain("arcTestnet")).toBe("ARC-TESTNET");
  });
});

describe("campaign API mapping carries the contract's dispute window", () => {
  const counts = { submissions: 0, creators: 0 };
  it("adds disputeWindow (seconds) and derives status with it", () => {
    // root posted at 1_200_100 on a 10-minute (testnet) deployment; the DB row's disputeEndsAt mirrors it
    const row = campaignRow(1, onchainCampaign({ root: `0x${"11".repeat(32)}`, totalAllocated: 5n, rootPostedAt: 1_200_100 }), {}, 600);
    expect(row.disputeEndsAt).toBe(1_200_700);
    const during = toSummary(row, null, counts, "arcTestnet", 1_200_699, 600);
    expect(during).toMatchObject({ disputeWindow: 600, status: "disputing" });
    const after = toDetail(row, null, counts, "arcTestnet", 1_200_700, 600);
    expect(after).toMatchObject({ disputeWindow: 600, status: "paying", disputeEndsAt: 1_200_700 });
  });
});
