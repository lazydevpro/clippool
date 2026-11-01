import type { Address, Hex } from "viem";
import { REVIEW_SIG_MAX_AGE_SEC, reviewMessage, type ReviewDecision } from "@/lib/shared/review";
import { HttpError } from "./http";

/** EOA or ERC-1271 check, e.g. `getPublicClient().verifyMessage`. */
export type MessageVerifier = (args: { address: Address; message: string; signature: Hex }) => Promise<boolean>;

/**
 * Throws unless `signature` is the campaign brand's signature over `reviewMessage(...)`, issued within
 * REVIEW_SIG_MAX_AGE_SEC, and the campaign has not reached its snapshot yet (later reviews can't change the split).
 */
export async function assertBrandReview(
  input: {
    campaign: { id: number; brand: string; snapshotTime: number };
    submissionId: number;
    decision: ReviewDecision;
    issuedAt: number;
    signature: Hex;
    now: number;
  },
  verify: MessageVerifier,
): Promise<void> {
  const { campaign, submissionId, decision, issuedAt, signature, now } = input;
  if (now >= campaign.snapshotTime) throw new HttpError(409, "review_closed", "Reviews close at the campaign snapshot");
  if (issuedAt > now + 60 || now - issuedAt > REVIEW_SIG_MAX_AGE_SEC) {
    throw new HttpError(401, "signature_expired", "Review signature expired — sign again");
  }
  const message = reviewMessage(campaign.id, submissionId, decision, issuedAt);
  const ok = await verify({ address: campaign.brand as Address, message, signature }).catch(() => false);
  if (!ok) throw new HttpError(403, "forbidden", "Only the campaign brand can review submissions");
}
