import { describe, expect, it } from "vitest";
import { concat, encodeAbiParameters, keccak256, type Hex } from "viem";
import { buildTree, computeAllocation, getProof, verifyProof, ZERO_ROOT, type Submission } from "../src/index";

/** Solidity: keccak256(bytes.concat(keccak256(abi.encode(campaignId, account, amount)))) */
function solidityLeaf(id: bigint, account: Hex, amount: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [id, account, amount]),
  );
  return keccak256(concat([inner]));
}

/** Independent port of OZ MerkleProof.processProof (commutative keccak of sorted pairs). */
function processProof(leaf: Hex, proof: Hex[]): Hex {
  let h = leaf;
  for (const p of proof) h = BigInt(h) < BigInt(p) ? keccak256(concat([h, p])) : keccak256(concat([p, h]));
  return h;
}

const subs = (n: number): Submission[] =>
  Array.from({ length: n }, (_, i) => ({
    videoId: `video${i}`.padEnd(11, "0"),
    channelId: "UC".padEnd(24, String(i % 10)),
    wallet: `0x${(i + 1).toString(16).padStart(40, "0")}`,
    views: BigInt(1000 + i * 37),
  }));

describe("Merkle tree", () => {
  it("leaf hashes match the Solidity encoding; proofs verify via an independent MerkleProof port", () => {
    for (const n of [1, 2, 3, 7, 16, 33]) {
      const res = computeAllocation({ id: 42n, pool: 1_000_000_000n, maxShareBps: 10000, minViews: 0n }, subs(n));
      const tree = res.tree!;
      expect(tree.length).toBe(res.allocations.length);
      for (const a of res.allocations) {
        const leaf = solidityLeaf(42n, a.wallet, a.amount);
        const idx = [...tree.entries()].find(([, v]) => v[1] === a.wallet)![0];
        expect(tree.leafHash(tree.at(idx)!)).toBe(leaf);
        const proof = getProof(tree, a.wallet)!;
        expect(processProof(leaf, proof)).toBe(res.root);
        expect(verifyProof(res.root, 42n, a.wallet.toLowerCase(), a.amount, proof)).toBe(true);
      }
    }
  });

  it("single leaf: root = leaf, empty proof", () => {
    const res = computeAllocation({ id: 1n, pool: 10n, maxShareBps: 10000, minViews: 0n }, subs(1));
    const a = res.allocations[0]!;
    expect(res.root).toBe(solidityLeaf(1n, a.wallet, a.amount));
    expect(getProof(res.tree!, a.wallet)).toEqual([]);
  });

  it("campaignId is bound into the leaf (no cross-campaign replay)", () => {
    const res = computeAllocation({ id: 5n, pool: 1000n, maxShareBps: 10000, minViews: 0n }, subs(4));
    const a = res.allocations[1]!;
    const proof = getProof(res.tree!, a.wallet)!;
    expect(verifyProof(res.root, 5n, a.wallet, a.amount, proof)).toBe(true);
    expect(verifyProof(res.root, 6n, a.wallet, a.amount, proof)).toBe(false);
  });

  it("getProof returns null for unknown wallets; verifyProof is false on garbage", () => {
    const res = computeAllocation({ id: 5n, pool: 1000n, maxShareBps: 10000, minViews: 0n }, subs(3));
    expect(getProof(res.tree!, "0x000000000000000000000000000000000000dEaD")).toBeNull();
    expect(verifyProof(res.root, 5n, "not-an-address", 1n, [])).toBe(false);
    expect(verifyProof(ZERO_ROOT, 5n, res.allocations[0]!.wallet, res.allocations[0]!.amount, [])).toBe(false);
  });

  it("buildTree: empty → null, duplicate wallet → throws", () => {
    expect(buildTree(1n, [])).toBeNull();
    const w = "0x0000000000000000000000000000000000000001";
    expect(() => buildTree(1n, [{ wallet: w, amount: 1n }, { wallet: w.toUpperCase().replace("0X", "0x"), amount: 2n }])).toThrow(/duplicate/);
  });

  it("matches a root computed independently with Foundry cast (single-creator fixture)", () => {
    // cast keccak $(cast keccak $(cast abi-encode "f(uint256,address,uint256)" 1 0xE19Fd37A7edAD08880410bd6dd5e6e43f09F07C5 500000000))
    const root = buildTree(1n, [{ wallet: "0xE19Fd37A7edAD08880410bd6dd5e6e43f09F07C5", amount: 500_000_000n }])!.root;
    expect(root).toBe("0x5ba806fab6f065d380c057b01fc3ac1f641dfe118a8f7248cb6bf18febac9d46");
  });
});
