import { describe, expect, it } from "vitest";
import { formatDelay } from "@/lib/client/format";
import { delayPresets } from "@/lib/client/validation";

describe("delayPresets (respects the contract's MIN_MEASUREMENT_DELAY)", () => {
  it("mainnet minimum (1h): the standard 1h / 24h / 7d presets only", () => {
    expect(delayPresets(3600).map((p) => p.value)).toEqual(["3600", "86400", "604800"]);
  });
  it("testnet minimum (5 min): adds a 5-minute testnet preset first", () => {
    const p = delayPresets(300);
    expect(p.map((x) => x.value)).toEqual(["300", "3600", "86400", "604800"]);
    expect(p[0]!.label).toBe("5 minutes (testnet)");
  });
  it("never offers a preset below the minimum", () => {
    expect(delayPresets(60)[0]!.value).toBe("300");
    expect(delayPresets(600)[0]).toMatchObject({ value: "600", label: "10 minutes (testnet)" });
    expect(delayPresets(2 * 86400).map((p) => p.value)).toEqual(["604800"]);
  });
});

describe("formatDelay", () => {
  it("formats contract windows readably", () => {
    expect(formatDelay(172_800)).toBe("48 hours");
    expect(formatDelay(86_400)).toBe("24 hours");
    expect(formatDelay(3600)).toBe("1 hour");
    expect(formatDelay(604_800)).toBe("7 days");
    expect(formatDelay(600)).toBe("10 minutes");
    expect(formatDelay(60)).toBe("1 minute");
    expect(formatDelay(90)).toBe("1m 30s");
  });
});
