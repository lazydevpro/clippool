import { describe, expect, it, vi } from "vitest";
import type { CircleUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { initializeUser, isAlreadyInitialized } from "@/lib/server/circle";

const ARC_WALLET = { id: "w1", address: "0x00000000000000000000000000000000000000a1", blockchain: "ARC-TESTNET" };

function fakeClient(opts: {
  wallets?: (typeof ARC_WALLET)[];
  initializeError?: unknown;
}) {
  const client = {
    listWallets: vi.fn(async () => ({ data: { wallets: opts.wallets ?? [] } })),
    createUserPinWithWallets: vi.fn(async () => {
      if (opts.initializeError) throw opts.initializeError;
      return { data: { challengeId: "init-challenge" } };
    }),
    createWallet: vi.fn(async () => ({ data: { challengeId: "wallet-challenge" } })),
    getUserStatus: vi.fn(),
  };
  return client as unknown as CircleUserControlledWalletsClient & typeof client;
}

describe("initializeUser (Circle user-controlled wallets)", () => {
  it("returns the existing Arc wallet without a challenge", async () => {
    const c = fakeClient({ wallets: [ARC_WALLET] });
    await expect(initializeUser(c, "tok", "arcTestnet")).resolves.toEqual({ challengeId: null, wallets: [ARC_WALLET] });
    expect(c.createUserPinWithWallets).not.toHaveBeenCalled();
    expect(c.getUserStatus).not.toHaveBeenCalled(); // social users never set a PIN — don't branch on pinStatus
  });

  it("initializes a brand-new user on ARC-TESTNET with an EOA", async () => {
    const c = fakeClient({});
    await expect(initializeUser(c, "tok", "arcTestnet")).resolves.toEqual({ challengeId: "init-challenge", wallets: [] });
    expect(c.createUserPinWithWallets).toHaveBeenCalledWith({ userToken: "tok", blockchains: ["ARC-TESTNET"], accountType: "EOA" });
  });

  it("falls back to createWallet when the user is already initialized (155106)", async () => {
    const c = fakeClient({ initializeError: { response: { status: 409, data: { code: 155106, message: "User has already been initialized." } } } });
    await expect(initializeUser(c, "tok", "arc")).resolves.toEqual({ challengeId: "wallet-challenge", wallets: [] });
    expect(c.createWallet).toHaveBeenCalledWith({ userToken: "tok", blockchains: ["ARC"], accountType: "EOA" });
  });

  it("ignores wallets on other chains", async () => {
    const c = fakeClient({ wallets: [{ ...ARC_WALLET, blockchain: "BASE-SEPOLIA" }] });
    const r = await initializeUser(c, "tok", "arcTestnet");
    expect(r.challengeId).toBe("init-challenge");
  });

  it("surfaces other Circle errors as HTTP errors", async () => {
    const c = fakeClient({ initializeError: { response: { status: 401, data: { code: 155104, message: "invalid token" } } } });
    await expect(initializeUser(c, "tok", "arcTestnet")).rejects.toMatchObject({ status: 401 });
  });
});

describe("isAlreadyInitialized", () => {
  it.each([
    [{ response: { data: { code: 155106 } } }, true],
    [{ data: { code: "155106" } }, true],
    [new Error("User has already been initialized"), true],
    [{ response: { data: { code: 155104, message: "invalid token" } } }, false],
    [undefined, false],
  ])("%j → %s", (err, expected) => {
    expect(isAlreadyInitialized(err)).toBe(expected);
  });
});
