import { keccak256, stringToBytes } from "viem";
import { compareWallets, computeAllocation, normalizeWallet } from "./allocate";
import { getProof } from "./tree";
import type { CampaignInput, Hex, Submission } from "./types";

/** Recorded in every snapshot; bump when the algorithm or snapshot format changes. */
export const SCRIPT_VERSION = "@clippool/allocation@0.1.0";

// ---------- JSON document types (all big numbers as decimal strings) ----------

export interface SnapshotCampaign {
  id: string;
  pool: string;
  maxShareBps: number;
  minViews: string;
}

export interface SnapshotSubmission {
  videoId: string;
  channelId: string;
  wallet: string;
  views: string;
}

export interface SnapshotAllocation {
  wallet: string;
  amount: string;
  views: string;
}

export interface SnapshotProof {
  wallet: string;
  amount: string;
  proof: Hex[];
}

export interface SnapshotDocument {
  scriptVersion: string;
  inputs: { campaign: SnapshotCampaign; submissions: SnapshotSubmission[] };
  /** Sorted ascending by lowercase wallet. */
  allocations: SnapshotAllocation[];
  totalAllocated: string;
  leftover: string;
  /** bytes32(0) when there are no allocations. */
  root: Hex;
  /** Sorted ascending by lowercase wallet. */
  proofs: SnapshotProof[];
}

// ---------- canonical JSON + hash ----------

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit order, no whitespace, bigints as
 * decimal strings, `undefined` object members omitted. Non-integer / unsafe numbers are rejected
 * so the encoding never depends on float formatting. Array order is preserved (it is meaningful).
 */
export function canonicalize(value: unknown): string {
  return encode(value, "$");
}

function encode(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "bigint":
      return JSON.stringify(v.toString());
    case "string":
    case "boolean":
      return JSON.stringify(v);
    case "number":
      if (!Number.isSafeInteger(v)) throw new TypeError(`non-integer number at ${path}: ${v}`);
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return `[${v.map((x, i) => encode(x, `${path}[${i}]`)).join(",")}]`;
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k], `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new TypeError(`unsupported value at ${path}: ${typeof v}`);
  }
}

/** keccak256 of the canonical UTF-8 JSON — the `snapshotHash` posted onchain. */
export function snapshotHash(snapshot: SnapshotDocument | unknown): Hex {
  return keccak256(stringToBytes(canonicalize(snapshot)));
}

// ---------- build ----------

function compareSubmissions(a: SnapshotSubmission, b: SnapshotSubmission): number {
  return (
    compareWallets(a.wallet, b.wallet) ||
    cmp(a.channelId, b.channelId) ||
    cmp(a.videoId, b.videoId) ||
    cmpBig(BigInt(a.views), BigInt(b.views))
  );
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Build the publishable snapshot. Submissions are recorded verbatim (including ones below
 * minViews, so verifiers re-apply the filter) with checksummed wallets, in a canonical order,
 * so the snapshot and its hash are independent of input order.
 */
export function buildSnapshot(campaign: CampaignInput, submissions: readonly Submission[]): SnapshotDocument {
  const result = computeAllocation(campaign, submissions);
  const subs: SnapshotSubmission[] = submissions
    .map((s) => ({
      videoId: s.videoId,
      channelId: s.channelId,
      wallet: normalizeWallet(s.wallet),
      views: s.views.toString(),
    }))
    .sort(compareSubmissions);
  return {
    scriptVersion: SCRIPT_VERSION,
    inputs: {
      campaign: {
        id: campaign.id.toString(),
        pool: campaign.pool.toString(),
        maxShareBps: campaign.maxShareBps,
        minViews: campaign.minViews.toString(),
      },
      submissions: subs,
    },
    allocations: result.allocations.map((a) => ({
      wallet: a.wallet,
      amount: a.amount.toString(),
      views: a.views.toString(),
    })),
    totalAllocated: result.totalAllocated.toString(),
    leftover: result.leftover.toString(),
    root: result.root,
    proofs: result.tree
      ? result.allocations.map((a) => ({
          wallet: a.wallet,
          amount: a.amount.toString(),
          proof: getProof(result.tree!, a.wallet)!,
        }))
      : [],
  };
}

// ---------- parse ----------

const DECIMAL = /^(0|[1-9][0-9]*)$/;

export function parseDecimal(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !DECIMAL.test(v)) {
    throw new TypeError(`${what} must be a decimal string, got ${JSON.stringify(v)}`);
  }
  return BigInt(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Convert the snapshot's `inputs` to typed allocation inputs (validates shape). */
export function snapshotInputs(doc: unknown): { campaign: CampaignInput; submissions: Submission[] } {
  if (!isObj(doc) || !isObj(doc.inputs) || !isObj(doc.inputs.campaign) || !Array.isArray(doc.inputs.submissions)) {
    throw new TypeError("snapshot must have inputs.campaign and inputs.submissions[]");
  }
  const c = doc.inputs.campaign;
  if (typeof c.maxShareBps !== "number") throw new TypeError("inputs.campaign.maxShareBps must be a number");
  const campaign: CampaignInput = {
    id: parseDecimal(c.id, "inputs.campaign.id"),
    pool: parseDecimal(c.pool, "inputs.campaign.pool"),
    maxShareBps: c.maxShareBps,
    minViews: parseDecimal(c.minViews, "inputs.campaign.minViews"),
  };
  const submissions = doc.inputs.submissions.map((s: unknown, i: number): Submission => {
    if (!isObj(s) || typeof s.videoId !== "string" || typeof s.channelId !== "string" || typeof s.wallet !== "string") {
      throw new TypeError(`inputs.submissions[${i}] is malformed`);
    }
    return {
      videoId: s.videoId,
      channelId: s.channelId,
      wallet: s.wallet,
      views: parseDecimal(s.views, `inputs.submissions[${i}].views`),
    };
  });
  return { campaign, submissions };
}
