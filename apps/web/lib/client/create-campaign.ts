// Brand funding flow: EIP-2612 permit + createCampaignWithPermit in one tx, with an approve + createCampaign
// fallback when the wallet can't produce a permit signature.
import { keccak256, parseEventLogs, parseSignature, toBytes, type Address, type Hash } from "viem";
import {
  estimateFeesPerGas,
  readContract,
  signTypedData,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { clipPoolAbi, erc20PermitAbi } from "@/lib/shared/abi";
import { activeChain, MIN_MAX_FEE_PER_GAS, TOKEN_DECIMALS } from "@/lib/shared/chain";
import { isUserRejection } from "./errors";
import { wagmiConfig } from "./wagmi";

export type CreateStep = "checking" | "signing" | "approving" | "creating" | "confirming";

export interface CreateCampaignInput {
  clipPool: Address;
  account: Address;
  token: Address;
  pool: bigint;
  startTime: bigint;
  endTime: bigint;
  measurementDelay: bigint;
  maxShareBps: number;
  minViews: number;
  rules: string;
}

export interface CreateCampaignCallbacks {
  onStep: (step: CreateStep) => void;
  onTx: (hash: Hash, kind: "approve" | "create") => void;
  /** Called when permit signing failed for a reason other than the user cancelling. */
  onFallback?: (reason: string) => void;
}

export class InsufficientBalanceError extends Error {
  constructor(
    readonly balance: bigint,
    readonly needed: bigint,
  ) {
    super("Insufficient token balance");
    this.name = "InsufficientBalanceError";
  }
}

export const rulesHashOf = (rules: string) => keccak256(toBytes(rules));

/** Arc drops txs with maxFeePerGas < 20 gwei; never go below that floor. */
async function feeOverrides() {
  let maxFeePerGas = MIN_MAX_FEE_PER_GAS * 2n;
  let maxPriorityFeePerGas = 1_000_000_000n;
  try {
    const est = await estimateFeesPerGas(wagmiConfig, { chainId: activeChain.id });
    if (est.maxFeePerGas) maxFeePerGas = est.maxFeePerGas;
    if (est.maxPriorityFeePerGas !== undefined) maxPriorityFeePerGas = est.maxPriorityFeePerGas;
  } catch {
    // keep defaults
  }
  if (maxFeePerGas < MIN_MAX_FEE_PER_GAS) maxFeePerGas = MIN_MAX_FEE_PER_GAS;
  if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

export async function readTokenBalance(token: Address, account: Address): Promise<bigint> {
  return readContract(wagmiConfig, {
    address: token,
    abi: erc20PermitAbi,
    functionName: "balanceOf",
    args: [account],
    chainId: activeChain.id,
  });
}

export async function createCampaignOnchain(
  input: CreateCampaignInput,
  cb: CreateCampaignCallbacks,
): Promise<{ id: bigint; hash: Hash }> {
  const { clipPool, account, token, pool } = input;
  const chainId = activeChain.id;
  const params = {
    token,
    pool,
    startTime: input.startTime,
    endTime: input.endTime,
    measurementDelay: input.measurementDelay,
    maxShareBps: input.maxShareBps,
    minViews: input.minViews,
    rulesHash: rulesHashOf(input.rules),
  } as const;

  cb.onStep("checking");
  const tokenRead = { address: token, abi: erc20PermitAbi, chainId } as const;
  const [name, decimals, nonce, balance] = await Promise.all([
    readContract(wagmiConfig, { ...tokenRead, functionName: "name" }),
    readContract(wagmiConfig, { ...tokenRead, functionName: "decimals" }),
    readContract(wagmiConfig, { ...tokenRead, functionName: "nonces", args: [account] }),
    readTokenBalance(token, account),
  ]);
  const version = await readContract(wagmiConfig, { ...tokenRead, functionName: "version" }).catch(() => "1");
  if (Number(decimals) !== TOKEN_DECIMALS) throw new Error(`Unexpected token decimals (${decimals}); expected 6.`);
  if (balance < pool) throw new InsufficientBalanceError(balance, pool);

  const fees = await feeOverrides();
  let hash: Hash | undefined;

  // 1) Preferred: permit signature + single transaction.
  try {
    cb.onStep("signing");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
    const signature = await signTypedData(wagmiConfig, {
      account,
      domain: { name, version, chainId, verifyingContract: token },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: account, spender: clipPool, value: pool, nonce, deadline },
    });
    const sig = parseSignature(signature);
    const v = Number(sig.v ?? BigInt(sig.yParity + 27));

    cb.onStep("creating");
    const { request } = await simulateContract(wagmiConfig, {
      account,
      address: clipPool,
      abi: clipPoolAbi,
      functionName: "createCampaignWithPermit",
      args: [params, deadline, v, sig.r, sig.s],
      chainId,
      ...fees,
    });
    hash = await writeContract(wagmiConfig, request);
    cb.onTx(hash, "create");
  } catch (err) {
    if (isUserRejection(err)) throw err;
    if (hash) throw err;
    // Signing unsupported or permit rejected: fall back to approve + createCampaign.
    cb.onFallback?.(err instanceof Error ? err.message : String(err));
  }

  // 2) Fallback: approve (if needed) then createCampaign.
  if (!hash) {
    const allowance = await readContract(wagmiConfig, {
      address: token,
      abi: erc20PermitAbi,
      functionName: "allowance",
      args: [account, clipPool],
      chainId,
    });
    if (allowance < pool) {
      cb.onStep("approving");
      const approveHash = await writeContract(wagmiConfig, {
        account,
        address: token,
        abi: erc20PermitAbi,
        functionName: "approve",
        args: [clipPool, pool],
        chainId,
        ...fees,
      });
      cb.onTx(approveHash, "approve");
      const r = await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId });
      if (r.status !== "success") throw new Error("The approval transaction reverted.");
    }
    cb.onStep("creating");
    const { request } = await simulateContract(wagmiConfig, {
      account,
      address: clipPool,
      abi: clipPoolAbi,
      functionName: "createCampaign",
      args: [params],
      chainId,
      ...fees,
    });
    hash = await writeContract(wagmiConfig, request);
    cb.onTx(hash, "create");
  }

  cb.onStep("confirming");
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId });
  if (receipt.status !== "success") throw new Error("The campaign transaction reverted.");
  const [created] = parseEventLogs({ abi: clipPoolAbi, eventName: "CampaignCreated", logs: receipt.logs });
  if (!created) throw new Error("Transaction confirmed, but no CampaignCreated event was found.");
  return { id: created.args.id, hash };
}
