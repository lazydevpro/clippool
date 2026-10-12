import { describe, expect, it } from "vitest";
import { encodePacked, keccak256, numberToHex, type Hex } from "viem";
import { bindingCode, bindingCodeBytes4, containsBindingCode } from "../src/index";

const W = "0x3647B92816983F6bacF16B9468FF3363Ec489604";

describe("bindingCode", () => {
  it("known answer (computed with Foundry: cast keccak $(cast abi-encode --packed 'f(uint256,address)' 42 W))", () => {
    expect(bindingCode(42n, W)).toBe("cp-66ff1078");
    expect(bindingCodeBytes4(42n, W)).toBe("0x66ff1078");
  });

  it("equals viem keccak256(encodePacked) and a manual 32+20 byte packing", () => {
    for (const id of [0n, 1n, 42n, 2n ** 64n + 3n, 2n ** 256n - 1n]) {
      const viaViem = keccak256(encodePacked(["uint256", "address"], [id, W]));
      const manual = keccak256(`${numberToHex(id, { size: 32 })}${W.slice(2).toLowerCase()}` as Hex);
      expect(viaViem).toBe(manual);
      expect(bindingCode(id, W)).toBe(`cp-${manual.slice(2, 10)}`);
      expect(bindingCode(id, W)).toMatch(/^cp-[0-9a-f]{8}$/);
    }
  });

  it("is casing-insensitive in the wallet and differs per campaign", () => {
    expect(bindingCode(7n, W.toLowerCase())).toBe(bindingCode(7n, W));
    expect(bindingCode(7n, W)).not.toBe(bindingCode(8n, W));
  });

  it("containsBindingCode finds the code case-insensitively", () => {
    const code = bindingCode(42n, W);
    expect(containsBindingCode(`My short!\n#ad ${code.toUpperCase()} thanks`, 42n, W)).toBe(true);
    expect(containsBindingCode("no code here", 42n, W)).toBe(false);
  });
});
