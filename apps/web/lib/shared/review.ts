/** A signed brand review is accepted for this long after `issuedAt` (and up to 60s in the future for clock skew). */
export const REVIEW_SIG_MAX_AGE_SEC = 600;

export type ReviewDecision = "approved" | "rejected";

/** The exact text the brand wallet signs (EIP-191 personal_sign) to approve or reject a submission. */
export function reviewMessage(campaignId: string | number, submissionId: number, decision: ReviewDecision, issuedAt: number): string {
  const verb = decision === "approved" ? "Approve" : "Reject";
  return `ClipPool brand review\n${verb} submission ${submissionId} in campaign #${campaignId}\nIssued at: ${issuedAt}`;
}
