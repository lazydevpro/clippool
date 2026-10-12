import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { clipPoolAbi } from "@/lib/shared/abi";
import { CHAINS, MIN_MAX_FEE_PER_GAS } from "@/lib/shared/chain";
import { FALLBACK_WINDOWS, type ContractWindows } from "@/lib/shared/status";
import { env } from "./env";
import { safeErrorMessage } from "./http";

export { deriveCampaignStatus } from "@/lib/shared/status";

// ───────────────────────────── types ─────────────────────────────

/** getCampaign(id) as plain JS (amounts as bigint, times as unix seconds). */
export interface OnchainCampaign {
  brand: Address;
  token: Address;
  pool: bigint;
  totalAllocated: bigint;
  claimed: bigint;
  startTime: number;
  endTime: number;
  snapshotTime: number;
  rootPostedAt: number;
  maxShareBps: number;
  minViews: number;
  rulesHash: Hex;
  root: Hex;
  snapshotHash: Hex;
  remainderRefunded: boolean;
  unclaimedSwept: boolean;
}

export type ClipPoolEventName =
  | "CampaignCreated"
  | "RootPosted"
  | "RootCancelled"
  | "Claimed"
  | "ClaimFailed"
  | "RemainderRefunded"
  | "UnclaimedSwept"
  | "NoRootRefunded";

export interface ClipPoolLog {
  eventName: ClipPoolEventName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
}

export interface ClaimLeaf {
  account: Address;
  amount: bigint;
  proof: Hex[];
}

export type SimulationResult = { ok: true } | { ok: false; kind: "revert" | "transient"; reason: string };

export interface PostRootArgs {
  id: bigint;
  root: Hex;
  totalAllocated: bigint;
  snapshotHash: Hex;
}

export interface TxOutcome {
  hash: Hash;
  logs: ClipPoolLog[];
}

/** Everything the jobs need from the chain — implemented with viem below, faked in tests. */
export interface ChainGateway {
  chainId: number;
  getBlockNumber(): Promise<bigint>;
  getLogs(fromBlock: bigint, toBlock: bigint): Promise<ClipPoolLog[]>;
  getCampaign(id: bigint): Promise<OnchainCampaign>;
  /** DISPUTE_WINDOW() / MIN_MEASUREMENT_DELAY() (immutables): read once, then cached per process. Throws if unreadable. */
  getWindows(): Promise<ContractWindows>;
  isClaimed(id: bigint, account: Address): Promise<boolean>;
  simulatePostRoot(args: PostRootArgs): Promise<SimulationResult>;
  postRoot(args: PostRootArgs): Promise<TxOutcome>;
  simulateClaim(id: bigint, leaf: ClaimLeaf): Promise<SimulationResult>;
  simulateClaimMany(id: bigint, leaves: ClaimLeaf[]): Promise<SimulationResult>;
  claimMany(id: bigint, leaves: ClaimLeaf[]): Promise<TxOutcome>;
  getTransaction(hash: Hash): Promise<{ from: Address; to: Address | null; status: "success" | "reverted"; logs: ClipPoolLog[] }>;
}

// ───────────────────────────── pure helpers ─────────────────────────────

/** eth_getLogs on Arc is limited to 10,000 blocks; we use inclusive windows of `size` blocks. */
export const LOG_WINDOW = 9_999n;

export function planLogWindows(from: bigint, to: bigint, size: bigint = LOG_WINDOW): { from: bigint; to: bigint }[] {
  if (size <= 0n) throw new RangeError("window size must be positive");
  const out: { from: bigint; to: bigint }[] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    out.push({ from: start, to: end < to ? end : to });
  }
  return out;
}

/** Arc rejects maxFeePerGas < 20 gwei: raise the estimate to the floor and keep priority ≤ max. */
export function applyFeeFloor(est: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | undefined) {
  const maxFeePerGas = est?.maxFeePerGas && est.maxFeePerGas > MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : MIN_MAX_FEE_PER_GAS;
  const prio = est?.maxPriorityFeePerGas ?? 1_000_000_000n;
  return { maxFeePerGas, maxPriorityFeePerGas: prio > maxFeePerGas ? maxFeePerGas : prio };
}

export function classifySimulationError(err: unknown): SimulationResult {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      // viem also maps JSON-RPC -32603 (internal error) to "reverted"; only trust it as a real revert
      // when there is revert data or the node said "revert" — otherwise retry later (never mark a
      // leaf failed because of a flaky RPC).
      const reason = revert.data?.errorName === "Error" ? revert.reason : (revert.data?.errorName ?? revert.reason);
      const hasData = !!revert.data || (!!revert.raw && revert.raw !== "0x") || !!revert.signature;
      if (hasData || /revert/i.test(`${revert.reason ?? ""} ${err.details ?? ""}`)) {
        return { ok: false, kind: "revert", reason: reason ?? "execution reverted" };
      }
      return { ok: false, kind: "transient", reason: reason ?? revert.shortMessage };
    }
    if (/revert/i.test(err.details ?? "") || /revert/i.test(err.shortMessage)) {
      return { ok: false, kind: "revert", reason: err.shortMessage };
    }
    return { ok: false, kind: "transient", reason: err.shortMessage };
  }
  return { ok: false, kind: "transient", reason: err instanceof Error ? err.name : "unknown error" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toOnchainCampaign(c: any): OnchainCampaign {
  return {
    brand: c.brand,
    token: c.token,
    pool: BigInt(c.pool),
    totalAllocated: BigInt(c.totalAllocated),
    claimed: BigInt(c.claimed),
    startTime: Number(c.startTime),
    endTime: Number(c.endTime),
    snapshotTime: Number(c.snapshotTime),
    rootPostedAt: Number(c.rootPostedAt),
    maxShareBps: Number(c.maxShareBps),
    minViews: Number(c.minViews),
    rulesHash: c.rulesHash,
    root: c.root,
    snapshotHash: c.snapshotHash,
    remainderRefunded: Boolean(c.remainderRefunded),
    unclaimedSwept: Boolean(c.unclaimedSwept),
  };
}

/** @param disputeWindow the contract's DISPUTE_WINDOW() in seconds (see ChainGateway.getWindows). */
export const disputeEndsAtOf = (c: Pick<OnchainCampaign, "rootPostedAt">, disputeWindow: number) =>
  c.rootPostedAt > 0 ? c.rootPostedAt + disputeWindow : null;

// Immutables never change for a deployment, so one successful read per (client, address) is enough. Keyed by the
// PublicClient (a process singleton in production) so tests with fresh clients don't share entries.
const windowsCache = new WeakMap<PublicClient, Map<string, Promise<ContractWindows>>>();

function readWindows(pc: PublicClient, address: Address): Promise<ContractWindows> {
  let byAddress = windowsCache.get(pc);
  if (!byAddress) {
    byAddress = new Map();
    windowsCache.set(pc, byAddress);
  }
  const cache = byAddress;
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const p = Promise.all([
    pc.readContract({ address, abi: clipPoolAbi, functionName: "DISPUTE_WINDOW" }),
    pc.readContract({ address, abi: clipPoolAbi, functionName: "MIN_MEASUREMENT_DELAY" }),
  ]).then(([w, m]) => ({ disputeWindow: Number(w), minMeasurementDelay: Number(m) }));
  cache.set(key, p);
  // Never cache a failure: the next call retries.
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key);
  });
  return p;
}

// ───────────────────────────── viem implementation ─────────────────────────────

export function getServerChain(): Chain {
  return CHAINS[env.chainKey()];
}

let publicClient: PublicClient | undefined;
export function getPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({ chain: getServerChain(), transport: http(env.rpcUrl(), { timeout: 20_000 }) });
  }
  return publicClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeLogs(logs: readonly any[]): ClipPoolLog[] {
  return logs
    .filter((l) => l.eventName)
    .map((l) => ({
      eventName: l.eventName as ClipPoolEventName,
      args: l.args ?? {},
      blockNumber: BigInt(l.blockNumber ?? 0n),
      logIndex: Number(l.logIndex ?? 0),
      transactionHash: l.transactionHash,
    }));
}

export interface ViemGatewayOptions {
  publicClient: PublicClient;
  address: Address;
  /** Signs postRoot. */
  oracle?: { wallet: WalletClient<Transport, Chain, Account> };
  /** Signs claimMany. */
  keeper?: { wallet: WalletClient<Transport, Chain, Account> };
  receiptTimeoutMs?: number;
}

export function createViemGateway(opts: ViemGatewayOptions): ChainGateway {
  const { publicClient: pc, address } = opts;
  const timeout = opts.receiptTimeoutMs ?? 60_000;

  async function fees() {
    let est: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | undefined;
    try {
      est = await pc.estimateFeesPerGas();
    } catch {
      est = undefined;
    }
    return applyFeeFloor(est);
  }

  function need<T>(v: T | undefined, what: string): T {
    if (!v) throw new Error(`${what} signer is not configured`);
    return v;
  }

  async function receipt(hash: Hash): Promise<TxOutcome> {
    const r = await pc.waitForTransactionReceipt({ hash, timeout });
    if (r.status !== "success") throw new Error(`transaction ${hash} reverted`);
    const logs = parseEventLogs({ abi: clipPoolAbi, logs: r.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase()) });
    return { hash, logs: decodeLogs(logs) };
  }

  const claimArgs = (leaves: ClaimLeaf[]) => leaves.map((l) => ({ account: l.account, amount: l.amount, proof: l.proof }));

  return {
    chainId: pc.chain?.id ?? 0,
    getBlockNumber: () => pc.getBlockNumber(),
    async getLogs(fromBlock, toBlock) {
      const logs = await pc.getContractEvents({ address, abi: clipPoolAbi, fromBlock, toBlock });
      return decodeLogs(logs);
    },
    async getCampaign(id) {
      const c = await pc.readContract({ address, abi: clipPoolAbi, functionName: "getCampaign", args: [id] });
      return toOnchainCampaign(c);
    },
    getWindows: () => readWindows(pc, address),
    isClaimed: (id, account) => pc.readContract({ address, abi: clipPoolAbi, functionName: "isClaimed", args: [id, account] }),
    async simulatePostRoot(a) {
      const { wallet } = need(opts.oracle, "oracle");
      try {
        await pc.simulateContract({
          account: wallet.account,
          address,
          abi: clipPoolAbi,
          functionName: "postRoot",
          args: [a.id, a.root, a.totalAllocated, a.snapshotHash],
        });
        return { ok: true };
      } catch (e) {
        return classifySimulationError(e);
      }
    },
    async postRoot(a) {
      const { wallet } = need(opts.oracle, "oracle");
      const { request } = await pc.simulateContract({
        account: wallet.account,
        address,
        abi: clipPoolAbi,
        functionName: "postRoot",
        args: [a.id, a.root, a.totalAllocated, a.snapshotHash],
        ...(await fees()),
      });
      const hash = await wallet.writeContract(request);
      return receipt(hash);
    },
    async simulateClaim(id, leaf) {
      const account = (opts.keeper ?? opts.oracle)?.wallet.account;
      try {
        await pc.simulateContract({
          account,
          address,
          abi: clipPoolAbi,
          functionName: "claim",
          args: [id, leaf.account, leaf.amount, leaf.proof],
        });
        return { ok: true };
      } catch (e) {
        return classifySimulationError(e);
      }
    },
    async simulateClaimMany(id, leaves) {
      const { wallet } = need(opts.keeper, "keeper");
      try {
        await pc.simulateContract({ account: wallet.account, address, abi: clipPoolAbi, functionName: "claimMany", args: [id, claimArgs(leaves)] });
        return { ok: true };
      } catch (e) {
        return classifySimulationError(e);
      }
    },
    async claimMany(id, leaves) {
      const { wallet } = need(opts.keeper, "keeper");
      const { request } = await pc.simulateContract({
        account: wallet.account,
        address,
        abi: clipPoolAbi,
        functionName: "claimMany",
        args: [id, claimArgs(leaves)],
        ...(await fees()),
      });
      const hash = await wallet.writeContract(request);
      return receipt(hash);
    },
    async getTransaction(hash) {
      const [tx, r] = await Promise.all([pc.getTransaction({ hash }), pc.getTransactionReceipt({ hash })]);
        const logs = parseEventLogs({ abi: clipPoolAbi, logs: r.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase()) });
      return { from: tx.from, to: tx.to ?? null, status: r.status, logs: decodeLogs(logs) };
    },
  };
}

function walletFor(privateKey: Hex): WalletClient<Transport, Chain, Account> {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: getServerChain(),
    transport: http(env.rpcUrl(), { timeout: 20_000 }),
  });
}

/** Read-only gateway (sync, routes). */
export function getReadGateway(): ChainGateway {
  return createViemGateway({ publicClient: getPublicClient(), address: env.clipPoolAddress() });
}

/**
 * Contract windows for read paths (API responses). Never throws: if the contract can't be read (address unset,
 * RPC down) it logs and returns the documented mainnet fallback (48h / 1h) without caching it.
 */
export async function getContractWindows(gateway?: Pick<ChainGateway, "getWindows">): Promise<ContractWindows> {
  try {
    return await (gateway ?? getReadGateway()).getWindows();
  } catch (e) {
    console.warn(`[chain] DISPUTE_WINDOW/MIN_MEASUREMENT_DELAY unreadable, using 48h/1h fallback: ${safeErrorMessage(e)}`);
    return { ...FALLBACK_WINDOWS };
  }
}

export function getOracleGateway(): ChainGateway {
  return createViemGateway({
    publicClient: getPublicClient(),
    address: env.clipPoolAddress(),
    oracle: { wallet: walletFor(env.oraclePrivateKey()) },
  });
}

export function getKeeperGateway(): ChainGateway {
  return createViemGateway({
    publicClient: getPublicClient(),
    address: env.clipPoolAddress(),
    keeper: { wallet: walletFor(env.keeperPrivateKey()) },
  });
}
