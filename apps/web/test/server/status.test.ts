import { describe, expect, it } from "vitest";
import { deriveCampaignStatus as derive, FALLBACK_WINDOWS, type CampaignStatusInput } from "@/lib/shared/status";

const DISPUTE_WINDOW = FALLBACK_WINDOWS.disputeWindow; // mainnet 48h
const deriveCampaignStatus = (c: CampaignStatusInput, now: number) => derive(c, now, DISPUTE_WINDOW);

const base: CampaignStatusInput = {
  startTime: 1000,
  endTime: 2000,
  snapshotTime: 3000,
  rootPostedAt: null,
  totalAllocated: null,
  claimed: "0",
  unclaimedSwept: false,
  noRootRefunded: false,
};

describe("deriveCampaignStatus", () => {
  it("time-based phases before a root", () => {
    expect(deriveCampaignStatus(base, 999)).toBe("upcoming");
    expect(deriveCampaignStatus(base, 1000)).toBe("live");
    expect(deriveCampaignStatus(base, 1999)).toBe("live");
    expect(deriveCampaignStatus(base, 2000)).toBe("measuring");
    expect(deriveCampaignStatus(base, 2999)).toBe("measuring");
    expect(deriveCampaignStatus(base, 3000)).toBe("allocating");
    expect(deriveCampaignStatus({ ...base, rootPostedAt: 0 }, 10_000_000)).toBe("allocating");
  });

  const posted = { ...base, rootPostedAt: 3100, totalAllocated: "900", claimed: "0" };
  it("disputing inside the 48h window (explicit or implied disputeEndsAt)", () => {
    expect(deriveCampaignStatus(posted, 3100)).toBe("disputing");
    expect(deriveCampaignStatus(posted, 3100 + DISPUTE_WINDOW - 1)).toBe("disputing");
    expect(deriveCampaignStatus({ ...posted, disputeEndsAt: 5000 }, 4999)).toBe("disputing");
    expect(deriveCampaignStatus({ ...posted, disputeEndsAt: 5000 }, 5000)).toBe("paying");
  });
  it("uses the given dispute window when disputeEndsAt is unknown (testnet: 10 min)", () => {
    const short = 600;
    expect(derive(posted, 3100 + short - 1, short)).toBe("disputing");
    expect(derive(posted, 3100 + short, short)).toBe("paying");
    // an explicit disputeEndsAt (mirrored from the chain) wins over the window
    expect(derive({ ...posted, disputeEndsAt: 3100 + short }, 3100 + short, DISPUTE_WINDOW)).toBe("paying");
  });
  it("paying until everything is claimed or swept", () => {
    const after = 3100 + DISPUTE_WINDOW;
    expect(deriveCampaignStatus(posted, after)).toBe("paying");
    expect(deriveCampaignStatus({ ...posted, claimed: "500" }, after)).toBe("paying");
    expect(deriveCampaignStatus({ ...posted, claimed: "900" }, after)).toBe("completed");
    expect(deriveCampaignStatus({ ...posted, unclaimedSwept: true }, after)).toBe("completed");
  });
  it("zero root (nothing allocated) completes after the dispute window", () => {
    const zero = { ...posted, totalAllocated: "0" };
    expect(deriveCampaignStatus(zero, 3200)).toBe("disputing");
    expect(deriveCampaignStatus(zero, 3100 + DISPUTE_WINDOW)).toBe("completed");
  });
  it("refunded wins over everything", () => {
    expect(deriveCampaignStatus({ ...base, noRootRefunded: true }, 10_000_000)).toBe("refunded");
    expect(deriveCampaignStatus({ ...base, unclaimedSwept: true }, 10_000_000)).toBe("refunded"); // mirror of refundNoRoot
  });
});
