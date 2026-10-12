import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { computeAllocation, verifyProof, ZERO_ROOT, type Hex } from "../src/index";
import { FIXTURES_DIR, fixtureCases, generatedFiles, type FixtureJson } from "../scripts/fixture-cases";

const DECIMAL = /^(0|[1-9][0-9]*)$/;

describe("golden fixtures", () => {
  it("files on disk equal freshly generated output (no drift)", () => {
    for (const [path, contents] of generatedFiles()) {
      expect(existsSync(path), `${path} missing — run pnpm fixtures`).toBe(true);
      expect(readFileSync(path, "utf8"), `${basename(path)} drifted — run pnpm fixtures`).toBe(contents);
    }
    const onDisk = readdirSync(FIXTURES_DIR).filter((f) => f.startsWith("allocation-"));
    expect(onDisk.sort()).toEqual(fixtureCases().map((c) => `allocation-${c.name}.json`).sort());
  });

  it("has the required coverage", () => {
    const names = fixtureCases().map((c) => c.name);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const n of [
      "single-creator",
      "all-equal",
      "whale-capped",
      "everyone-capped",
      "below-min-filtered",
      "zero-valid-submissions",
      "rounding-dust",
      "multi-video-multi-channel",
      "large-random",
    ]) {
      expect(names).toContain(n);
    }
  });

  for (const c of fixtureCases()) {
    describe(c.name, () => {
      const f = JSON.parse(readFileSync(resolve(FIXTURES_DIR, `allocation-${c.name}.json`), "utf8")) as FixtureJson;

      it("follows the interfaces.md §4 format", () => {
        expect(Object.keys(f)).toEqual(["name", "description", "campaign", "submissions", "expected"]);
        expect(Object.keys(f.campaign)).toEqual(["id", "pool", "maxShareBps", "minViews"]);
        expect(Object.keys(f.expected)).toEqual(["allocations", "totalAllocated", "leftover", "root", "proofs"]);
        expect(f.name).toBe(c.name);
        for (const v of [f.campaign.id, f.campaign.pool, f.campaign.minViews, f.expected.totalAllocated, f.expected.leftover]) {
          expect(v).toMatch(DECIMAL);
        }
        expect(Number.isInteger(f.campaign.maxShareBps)).toBe(true);
        for (const s of f.submissions) {
          expect(Object.keys(s)).toEqual(["videoId", "channelId", "wallet", "views"]);
          expect(s.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/);
          expect(s.channelId).toMatch(/^UC[A-Za-z0-9_-]{22}$/);
          expect(s.wallet).toBe(getAddress(s.wallet));
          expect(s.views).toMatch(DECIMAL);
        }
        const ws = f.expected.allocations.map((a) => a.wallet.toLowerCase());
        for (let i = 1; i < ws.length; i++) expect(ws[i - 1]! < ws[i]!).toBe(true);
        expect(f.expected.proofs.map((p) => p.wallet)).toEqual(f.expected.allocations.map((a) => a.wallet));
        for (const a of f.expected.allocations) {
          expect(a.wallet).toBe(getAddress(a.wallet));
          expect(a.amount).toMatch(DECIMAL);
        }
        expect(f.expected.root).toMatch(/^0x[0-9a-f]{64}$/);
      });

      it("recomputes from its own JSON inputs; every proof verifies", () => {
        const campaign = {
          id: BigInt(f.campaign.id),
          pool: BigInt(f.campaign.pool),
          maxShareBps: f.campaign.maxShareBps,
          minViews: BigInt(f.campaign.minViews),
        };
        const r = computeAllocation(
          campaign,
          f.submissions.map((s) => ({ ...s, views: BigInt(s.views) })),
        );
        expect(r.root).toBe(f.expected.root);
        expect(r.totalAllocated.toString()).toBe(f.expected.totalAllocated);
        expect(r.leftover.toString()).toBe(f.expected.leftover);
        expect(BigInt(f.expected.totalAllocated) + BigInt(f.expected.leftover)).toBe(campaign.pool);
        expect(r.allocations.map((a) => ({ wallet: a.wallet, amount: a.amount.toString() }))).toEqual(f.expected.allocations);
        for (const p of f.expected.proofs) {
          expect(verifyProof(f.expected.root as Hex, campaign.id, p.wallet, BigInt(p.amount), p.proof as Hex[])).toBe(true);
        }
      });
    });
  }

  it("zero-valid-submissions uses the bytes32(0) root convention", () => {
    const f = JSON.parse(readFileSync(resolve(FIXTURES_DIR, "allocation-zero-valid-submissions.json"), "utf8")) as FixtureJson;
    expect(f.expected.root).toBe(ZERO_ROOT);
    expect(f.expected.allocations).toEqual([]);
    expect(f.expected.proofs).toEqual([]);
    expect(f.expected.leftover).toBe(f.campaign.pool);
    expect(f.description).toMatch(/bytes32\(0\)/);
  });

  it("whale-capped / cascade / large-random actually exercise the cap", () => {
    for (const name of ["whale-capped", "cascade-capped", "large-random", "everyone-capped"]) {
      const f = JSON.parse(readFileSync(resolve(FIXTURES_DIR, `allocation-${name}.json`), "utf8")) as FixtureJson;
      const cap = (BigInt(f.campaign.pool) * BigInt(f.campaign.maxShareBps)) / 10_000n;
      expect(f.expected.allocations.some((a) => BigInt(a.amount) === cap), name).toBe(true);
    }
    const large = JSON.parse(readFileSync(resolve(FIXTURES_DIR, "allocation-large-random.json"), "utf8")) as FixtureJson;
    expect(new Set(large.submissions.map((s) => s.wallet)).size).toBeGreaterThanOrEqual(50);
  });
});
