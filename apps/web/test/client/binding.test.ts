import { describe, expect, it } from "vitest";
import { bindingCode as sharedBindingCode } from "@clippool/allocation";
import { bindingCode as clientBindingCode } from "@/lib/client/binding";

describe("client bindingCode", () => {
  it("matches @clippool/allocation for many (id, wallet) pairs", () => {
    const wallets = [
      "0x36475AB9f3a7cA3d4A1B6C2F4bE1e3e3B2Ed9604",
      "0x0000000000000000000000000000000000000001",
      "0xFB2074b9e45A9c00080060F1D6e6fBc0266dC9cD",
    ] as const;
    for (const w of wallets) {
      for (const id of [1n, 2n, 42n, 1_000_000n]) {
        expect(clientBindingCode(id, w)).toBe(sharedBindingCode(id, w));
      }
    }
  });
  it("matches the Solidity known answer (42, 0x3647…9604) → cp-66ff1078", () => {
    expect(clientBindingCode(42n, "0x3647B92816983F6bacF16B9468FF3363Ec489604")).toBe("cp-66ff1078");
  });
});
