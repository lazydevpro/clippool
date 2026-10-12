import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseTransaction,
  type Hex,
} from "viem";
import { FALLBACK_WINDOWS } from "@/lib/shared/status";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { applyFeeFloor, createViemGateway, getContractWindows } from "@/lib/server/chain";
import { clipPoolAbi } from "@/lib/shared/abi";
import { MIN_MAX_FEE_PER_GAS } from "@/lib/shared/chain";
import { addr } from "./helpers/fakes";

// Well-known public anvil test key #0 — never funded on Arc.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const POOL = addr(0xc11b);
const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}` as Hex;

type Handler = (params: unknown[]) => unknown;

/** Minimal in-process JSON-RPC node: records methods, serves canned answers, never touches the network. */
function fakeNode(overrides: Record<string, Handler> = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const raw: Hex[] = [];
  let receiptLogs: unknown[] = [];
  const defaults: Record<string, Handler> = {
    eth_chainId: () => hex(arcTestnet.id),
    eth_blockNumber: () => hex(1000),
    eth_getBlockByNumber: () => ({
      number: hex(1000),
      hash: `0x${"0b".repeat(32)}`,
      parentHash: `0x${"0a".repeat(32)}`,
      timestamp: hex(1_700_000_000),
      baseFeePerGas: hex(1_000_000_000n), // 1 gwei → must be floored to 20 gwei
      gasLimit: hex(30_000_000),
      gasUsed: "0x0",
      transactions: [],
      miner: addr(0),
      difficulty: "0x0",
      extraData: "0x",
      logsBloom: `0x${"0".repeat(512)}`,
      nonce: "0x0000000000000000",
      receiptsRoot: `0x${"0".repeat(64)}`,
      sha3Uncles: `0x${"0".repeat(64)}`,
      size: "0x0",
      stateRoot: `0x${"0".repeat(64)}`,
      totalDifficulty: "0x0",
      transactionsRoot: `0x${"0".repeat(64)}`,
      uncles: [],
    }),
    eth_maxPriorityFeePerGas: () => hex(1_000_000_000n),
    eth_call: () => `0x${"00".repeat(32)}`, // claimMany returns uint256; postRoot ignores it
    eth_estimateGas: () => hex(200_000),
    eth_getTransactionCount: () => "0x0",
    eth_sendRawTransaction: ([tx]) => {
      raw.push(tx as Hex);
      return keccak256(tx as Hex);
    },
    eth_getTransactionReceipt: ([hash]) => ({
      blockHash: `0x${"0b".repeat(32)}`,
      blockNumber: hex(1001),
      contractAddress: null,
      cumulativeGasUsed: hex(100_000),
      effectiveGasPrice: hex(20_000_000_000n),
      from: privateKeyToAccount(TEST_KEY).address,
      gasUsed: hex(100_000),
      logs: receiptLogs,
      logsBloom: `0x${"0".repeat(512)}`,
      status: "0x1",
      to: POOL,
      transactionHash: hash,
      transactionIndex: "0x0",
      type: "0x2",
    }),
  };
  const request = async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push({ method, params: params ?? [] });
    const h = overrides[method] ?? defaults[method];
    if (!h) throw new Error(`unexpected RPC ${method}`);
    return h(params ?? []);
  };
  return { request, calls, raw, setReceiptLogs: (l: unknown[]) => (receiptLogs = l) };
}

function gatewayOn(node: ReturnType<typeof fakeNode>) {
  const transport = custom({ request: node.request }, { retryCount: 0 });
  const publicClient = createPublicClient({ chain: arcTestnet, transport, pollingInterval: 10 });
  const wallet = createWalletClient({ account: privateKeyToAccount(TEST_KEY), chain: arcTestnet, transport, pollingInterval: 10 });
  return createViemGateway({ publicClient, address: POOL, oracle: { wallet }, keeper: { wallet }, receiptTimeoutMs: 5_000 });
}

describe("applyFeeFloor", () => {
  it("raises maxFeePerGas to ≥20 gwei and caps priority at max", () => {
    expect(applyFeeFloor(undefined).maxFeePerGas).toBe(MIN_MAX_FEE_PER_GAS);
    expect(applyFeeFloor({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n })).toEqual({ maxFeePerGas: MIN_MAX_FEE_PER_GAS, maxPriorityFeePerGas: 1n });
    expect(applyFeeFloor({ maxFeePerGas: 50_000_000_000n, maxPriorityFeePerGas: 60_000_000_000n })).toEqual({
      maxFeePerGas: 50_000_000_000n,
      maxPriorityFeePerGas: 50_000_000_000n,
    });
  });
});

describe("viem ChainGateway (fake RPC, no network)", () => {
  const args = { id: 7n, root: `0x${"12".repeat(32)}` as Hex, totalAllocated: 123_456n, snapshotHash: `0x${"34".repeat(32)}` as Hex };

  it("postRoot simulates via eth_call before broadcasting a type-2 tx with maxFeePerGas ≥ 20 gwei", async () => {
    const node = fakeNode();
    const out = await gatewayOn(node).postRoot(args);
    const methods = node.calls.map((c) => c.method);
    expect(methods.indexOf("eth_call")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("eth_call")).toBeLessThan(methods.indexOf("eth_sendRawTransaction"));
    expect(node.raw).toHaveLength(1);
    const tx = parseTransaction(node.raw[0]!);
    expect(tx.type).toBe("eip1559");
    expect(tx.chainId).toBe(arcTestnet.id);
    expect(tx.to?.toLowerCase()).toBe(POOL.toLowerCase());
    expect(tx.maxFeePerGas! >= MIN_MAX_FEE_PER_GAS).toBe(true);
    const decoded = decodeFunctionData({ abi: clipPoolAbi, data: tx.data! });
    expect(decoded.functionName).toBe("postRoot");
    expect(decoded.args).toEqual([args.id, args.root, args.totalAllocated, args.snapshotHash]);
    expect(out.hash).toBe(keccak256(node.raw[0]!));
  });

  it("simulatePostRoot classifies an eth_call revert as a revert (no tx sent)", async () => {
    const revertData = `0x08c379a0${encodeAbiParameters([{ type: "string" }], ["NotOracle"]).slice(2)}` as Hex;
    const node = fakeNode({
      eth_call: () => {
        throw Object.assign(new Error("execution reverted: NotOracle"), { code: 3, data: revertData });
      },
    });
    const sim = await gatewayOn(node).simulatePostRoot(args);
    expect(sim).toEqual({ ok: false, kind: "revert", reason: "NotOracle" });
    expect(node.raw).toHaveLength(0);
  });

  it("a bare 'execution reverted' (no data) is still a revert", async () => {
    const node = fakeNode({
      eth_call: () => {
        throw Object.assign(new Error("execution reverted"), { code: 3 });
      },
    });
    expect(await gatewayOn(node).simulateClaim(7n, { account: addr(1), amount: 1n, proof: [] })).toMatchObject({ ok: false, kind: "revert" });
  });

  it("simulateClaim: network failure is transient, not a revert", async () => {
    const node = fakeNode({
      eth_call: () => {
        throw Object.assign(new Error("upstream timeout"), { code: -32603 });
      },
    });
    const sim = await gatewayOn(node).simulateClaim(7n, { account: addr(1), amount: 1n, proof: [] });
    expect(sim).toMatchObject({ ok: false, kind: "transient" });
  });

  it("claimMany decodes Claimed / ClaimFailed from the receipt (only from the ClipPool address)", async () => {
    const node = fakeNode();
    const alice = addr(0xa11ce);
    const bob = addr(0xb0b0);
    const mk = (eventName: "Claimed" | "ClaimFailed", account: Hex, data: Hex, address: Hex = POOL, logIndex = 0) => ({
      address,
      topics: encodeEventTopics({ abi: clipPoolAbi, eventName, args: { id: 7n, account } }),
      data,
      blockHash: `0x${"0b".repeat(32)}`,
      blockNumber: hex(1001),
      logIndex: hex(logIndex),
      transactionHash: `0x${"0c".repeat(32)}`,
      transactionIndex: "0x0",
      removed: false,
    });
    node.setReceiptLogs([
      mk("Claimed", alice, encodeAbiParameters([{ type: "uint256" }], [600n]), POOL, 0),
      mk("ClaimFailed", bob, encodeAbiParameters([{ type: "uint256" }, { type: "bytes" }], [400n, "0xdead"]), POOL, 1),
      mk("Claimed", bob, encodeAbiParameters([{ type: "uint256" }], [400n]), addr(0x666), 2), // spoofed other contract
    ]);
    const out = await gatewayOn(node).claimMany(7n, [
      { account: alice, amount: 600n, proof: [] },
      { account: bob, amount: 400n, proof: [] },
    ]);
    expect(out.logs.map((l) => [l.eventName, l.args.account])).toEqual([
      ["Claimed", alice],
      ["ClaimFailed", bob],
    ]);
    const tx = parseTransaction(node.raw[0]!);
    expect(tx.maxFeePerGas! >= MIN_MAX_FEE_PER_GAS).toBe(true);
    expect(decodeFunctionData({ abi: clipPoolAbi, data: tx.data! }).functionName).toBe("claimMany");
  });

  it("getWindows reads DISPUTE_WINDOW / MIN_MEASUREMENT_DELAY once and caches them; failures are not cached", async () => {
    let fail = true;
    const node = fakeNode({
      eth_call: ([call]) => {
        if (fail) throw Object.assign(new Error("upstream timeout"), { code: -32603 });
        const { functionName } = decodeFunctionData({ abi: clipPoolAbi, data: (call as { data: Hex }).data });
        const v = functionName === "DISPUTE_WINDOW" ? 600n : functionName === "MIN_MEASUREMENT_DELAY" ? 300n : 0n;
        return encodeAbiParameters([{ type: "uint256" }], [v]);
      },
    });
    const gw = gatewayOn(node);
    await expect(gw.getWindows()).rejects.toThrow();
    // read paths fall back to the documented mainnet values instead of failing the request
    expect(await getContractWindows(gw)).toEqual(FALLBACK_WINDOWS);
    fail = false;
    expect(await gw.getWindows()).toEqual({ disputeWindow: 600, minMeasurementDelay: 300 });
    const calls = node.calls.filter((c) => c.method === "eth_call").length;
    expect(await gw.getWindows()).toEqual({ disputeWindow: 600, minMeasurementDelay: 300 });
    expect(await getContractWindows(gw)).toEqual({ disputeWindow: 600, minMeasurementDelay: 300 });
    expect(node.calls.filter((c) => c.method === "eth_call").length).toBe(calls); // cached
  });

  it("getLogs pages via eth_getLogs with the given block range", async () => {
    const node = fakeNode({ eth_getLogs: () => [] });
    await gatewayOn(node).getLogs(100n, 10_098n);
    const p = node.calls.find((c) => c.method === "eth_getLogs")!.params[0] as { fromBlock: Hex; toBlock: Hex; address: Hex };
    expect([p.fromBlock, p.toBlock]).toEqual([hex(100), hex(10_098)]);
    expect(p.address.toLowerCase()).toBe(POOL.toLowerCase());
  });
});
