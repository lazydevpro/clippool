import { computeAllocation } from "./allocate";
import { SCRIPT_VERSION, snapshotHash, snapshotInputs } from "./snapshot";
import { getProof, verifyProof } from "./tree";
import type { Hex } from "./types";

export interface VerifyReport {
  ok: boolean;
  /** Human-readable mismatches; empty when ok. */
  differences: string[];
  /** Non-fatal notes (e.g. scriptVersion differs). */
  warnings: string[];
  computed: {
    campaignId: bigint;
    root: Hex;
    totalAllocated: bigint;
    leftover: bigint;
    allocations: number;
    /** keccak256(canonical JSON) of the snapshot file as given. */
    snapshotHash: Hex;
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * Recompute allocation + Merkle root from `snapshot.inputs` and compare against every derived
 * field in the snapshot (root, totals, allocations, proofs). Pure; no I/O.
 */
export function verifySnapshot(snapshot: unknown): VerifyReport {
  const { campaign, submissions } = snapshotInputs(snapshot);
  const doc = snapshot as Record<string, unknown>;
  const r = computeAllocation(campaign, submissions);
  const differences: string[] = [];
  const warnings: string[] = [];

  if (doc.scriptVersion !== SCRIPT_VERSION) {
    warnings.push(`scriptVersion ${str(doc.scriptVersion)} != verifier ${SCRIPT_VERSION}`);
  }
  if (str(doc.root).toLowerCase() !== r.root.toLowerCase()) {
    differences.push(`root: snapshot ${str(doc.root)} != recomputed ${r.root}`);
  }
  if (str(doc.totalAllocated) !== r.totalAllocated.toString()) {
    differences.push(`totalAllocated: snapshot ${str(doc.totalAllocated)} != recomputed ${r.totalAllocated}`);
  }
  if (str(doc.leftover) !== r.leftover.toString()) {
    differences.push(`leftover: snapshot ${str(doc.leftover)} != recomputed ${r.leftover}`);
  }

  // allocations, per wallet
  const docAllocs = Array.isArray(doc.allocations) ? (doc.allocations as Record<string, unknown>[]) : [];
  if (!Array.isArray(doc.allocations)) differences.push("allocations: missing or not an array");
  const expected = new Map(r.allocations.map((a) => [a.wallet.toLowerCase(), a]));
  const seen = new Set<string>();
  for (const a of docAllocs) {
    const key = str(a.wallet).toLowerCase();
    seen.add(key);
    const e = expected.get(key);
    if (!e) {
      differences.push(`allocations: ${str(a.wallet)} is in the snapshot but recomputes to 0`);
      continue;
    }
    if (str(a.amount) !== e.amount.toString()) {
      differences.push(`allocations: ${e.wallet} amount snapshot ${str(a.amount)} != recomputed ${e.amount}`);
    }
    if (a.views !== undefined && str(a.views) !== e.views.toString()) {
      differences.push(`allocations: ${e.wallet} views snapshot ${str(a.views)} != recomputed ${e.views}`);
    }
  }
  for (const e of r.allocations) {
    if (!seen.has(e.wallet.toLowerCase())) {
      differences.push(`allocations: ${e.wallet} (${e.amount}) missing from snapshot`);
    }
  }
  const order = docAllocs.map((a) => str(a.wallet).toLowerCase());
  if (order.some((w, i) => i > 0 && order[i - 1]! >= w)) {
    differences.push("allocations: not sorted ascending by lowercase wallet");
  }

  // proofs: each must verify against the recomputed root and equal the recomputed proof
  if (doc.proofs !== undefined) {
    if (!Array.isArray(doc.proofs)) {
      differences.push("proofs: not an array");
    } else {
      const proofs = doc.proofs as Record<string, unknown>[];
      if (proofs.length !== r.allocations.length) {
        differences.push(`proofs: ${proofs.length} entries, expected ${r.allocations.length}`);
      }
      for (const p of proofs) {
        const proof = (Array.isArray(p.proof) ? p.proof : []) as Hex[];
        let amount: bigint;
        try {
          amount = BigInt(str(p.amount));
        } catch {
          differences.push(`proofs: ${str(p.wallet)} has a non-numeric amount`);
          continue;
        }
        if (!verifyProof(r.root, campaign.id, str(p.wallet), amount, proof)) {
          differences.push(`proofs: proof for ${str(p.wallet)} (${str(p.amount)}) does not verify against recomputed root`);
          continue;
        }
        const fresh = r.tree ? getProof(r.tree, str(p.wallet)) : null;
        if (!fresh || fresh.join() !== proof.join()) {
          differences.push(`proofs: proof for ${str(p.wallet)} differs from recomputed proof`);
        }
      }
    }
  }

  return {
    ok: differences.length === 0,
    differences,
    warnings,
    computed: {
      campaignId: campaign.id,
      root: r.root,
      totalAllocated: r.totalAllocated,
      leftover: r.leftover,
      allocations: r.allocations.length,
      snapshotHash: snapshotHash(snapshot),
    },
  };
}
