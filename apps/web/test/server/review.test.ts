import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertBrandReview } from "@/lib/server/review";
import { REVIEW_SIG_MAX_AGE_SEC, reviewMessage } from "@/lib/shared/review";

const brand = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const NOW = 1_800_000_000;
const campaign = { id: 7, brand: brand.address, snapshotTime: NOW + 3600 };
const verify = (a: Parameters<typeof verifyMessage>[0]) => verifyMessage(a);

async function signed(signer = brand, opts: { submissionId?: number; decision?: "approved" | "rejected"; issuedAt?: number } = {}) {
  const submissionId = opts.submissionId ?? 42;
  const decision = opts.decision ?? "approved";
  const issuedAt = opts.issuedAt ?? NOW;
  const signature = await signer.signMessage({ message: reviewMessage(campaign.id, submissionId, decision, issuedAt) });
  return { submissionId, decision, issuedAt, signature };
}

describe("assertBrandReview", () => {
  it("accepts the brand's fresh signature", async () => {
    await expect(assertBrandReview({ campaign, now: NOW + 5, ...(await signed()) }, verify)).resolves.toBeUndefined();
  });

  it("rejects a signature from any other wallet (brand address alone is not proof)", async () => {
    await expect(assertBrandReview({ campaign, now: NOW, ...(await signed(other)) }, verify)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a signature reused for a different submission or decision", async () => {
    const s = await signed();
    await expect(assertBrandReview({ campaign, now: NOW, ...s, submissionId: 43 }, verify)).rejects.toMatchObject({ status: 403 });
    await expect(assertBrandReview({ campaign, now: NOW, ...s, decision: "rejected" }, verify)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects stale or future-dated signatures", async () => {
    const s = await signed();
    await expect(assertBrandReview({ campaign, now: NOW + REVIEW_SIG_MAX_AGE_SEC + 1, ...s }, verify)).rejects.toMatchObject({ status: 401 });
    await expect(assertBrandReview({ campaign, now: NOW - 120, ...s }, verify)).rejects.toMatchObject({ status: 401 });
  });

  it("closes reviews at the snapshot", async () => {
    const s = await signed(brand, { issuedAt: campaign.snapshotTime });
    await expect(assertBrandReview({ campaign, now: campaign.snapshotTime, ...s }, verify)).rejects.toMatchObject({ status: 409 });
  });
});
