// Circle user-controlled wallets (Google social login), client-only. The SDK touches `window` at
// construction time, so it is loaded with a dynamic import and never evaluated on the server.
import type { Address } from "viem";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { Configs, SocialLoginProvider, SocialLoginResult } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { CircleWalletsResponse } from "@/lib/shared/api-types";
import { api } from "./api";
import { CIRCLE_APP_ID, CIRCLE_BLOCKCHAIN, GOOGLE_CLIENT_ID, USE_MOCKS } from "./env";

export interface CircleSession {
  userToken: string;
  encryptionKey: string;
  address: Address;
  walletId: string;
  email?: string;
}

const SESSION_KEY = "clippool.circle.session";
const PENDING_KEY = "clippool.circle.pending";
const CHANGE_EVENT = "clippool:circle-session";

interface PendingLogin {
  deviceToken: string;
  deviceEncryptionKey: string;
  redirectUri: string;
  /** Page to return to after the fixed OAuth callback route finishes the login. */
  returnTo: string;
  startedAt: number;
}

/** Single OAuth redirect target, so Google only needs one registered URI per origin. */
export const CIRCLE_CALLBACK_PATH = "/auth/callback";

// ── session store (sessionStorage, subscribable for useSyncExternalStore) ──
let cachedRaw: string | null | undefined;
let cachedSession: CircleSession | null = null;

export function readCircleSession(): CircleSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (raw === cachedRaw) return cachedSession;
  cachedRaw = raw;
  try {
    cachedSession = raw ? (JSON.parse(raw) as CircleSession) : null;
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

function writeSession(s: CircleSession | null) {
  if (s) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else window.sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCircleSession(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function logoutCircle() {
  writeSession(null);
  window.sessionStorage.removeItem(PENDING_KEY);
}

function readPending(): PendingLogin | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingLogin) : null;
  } catch {
    return null;
  }
}

/** Where to send the user after the callback route completes the login (same-origin paths only). */
export function pendingReturnTo(): string {
  const to = readPending()?.returnTo ?? "/me";
  return to.startsWith("/") && !to.startsWith("//") ? to : "/me";
}

/** True when the page was just loaded as the Google OAuth redirect target of a login we started. */
export function hasPendingCircleLogin(): boolean {
  if (typeof window === "undefined") return false;
  const pending = readPending();
  if (!pending) return false;
  if (Date.now() - pending.startedAt > 15 * 60 * 1000) {
    window.sessionStorage.removeItem(PENDING_KEY);
    return false;
  }
  return /id_token=|access_token=|error=/.test(window.location.hash);
}

// ── SDK ──
async function loadSdk(configs: Configs, onLogin?: (err: unknown, res: SocialLoginResult | undefined) => void) {
  const mod = await import("@circle-fin/w3s-pw-web-sdk");
  // The SDK is a singleton: constructing again re-applies configs and re-runs the redirect check.
  return new mod.W3SSdk(configs, onLogin as never) as W3SSdk;
}

const redirectUri = () => `${window.location.origin}${CIRCLE_CALLBACK_PATH}`;

function loginConfigs(p: Pick<PendingLogin, "deviceToken" | "deviceEncryptionKey" | "redirectUri">): Configs {
  return {
    appSettings: { appId: CIRCLE_APP_ID },
    loginConfigs: {
      deviceToken: p.deviceToken,
      deviceEncryptionKey: p.deviceEncryptionKey,
      google: { clientId: GOOGLE_CLIENT_ID, redirectUri: p.redirectUri, selectAccountPrompt: true },
    },
  };
}

export type CirclePhase = "device" | "redirecting" | "verifying" | "initializing" | "pin" | "wallet";

/** Step 1: get a device token from our backend and redirect to Google. Resolves only in mock mode. */
export async function startGoogleLogin(onPhase: (p: CirclePhase) => void): Promise<CircleSession | void> {
  if (USE_MOCKS) {
    onPhase("verifying");
    const init = await api.circleInitialize("mock-user-token");
    onPhase("wallet");
    return finishWithWallets("mock-user-token", "mock-encryption-key", init.wallets);
  }
  onPhase("device");
  const sdk = await loadSdk({ appSettings: { appId: CIRCLE_APP_ID } });
  const deviceId = await sdk.getDeviceId();
  const { deviceToken, deviceEncryptionKey } = await api.circleSocialToken(deviceId);
  const pending: PendingLogin = {
    deviceToken,
    deviceEncryptionKey,
    redirectUri: redirectUri(),
    returnTo: `${window.location.pathname}${window.location.search}`,
    startedAt: Date.now(),
  };
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  onPhase("redirecting");
  sdk.updateConfigs(loginConfigs(pending));
  await sdk.performLogin("Google" as SocialLoginProvider);
}

let resumeInFlight: Promise<CircleSession> | null = null;

/** Step 2 (after the Google redirect): verify the id_token, create/unlock the wallet, store the session.
 *  Idempotent while in flight (React StrictMode runs effects twice in development). */
export function resumeGoogleLogin(onPhase: (p: CirclePhase) => void): Promise<CircleSession> {
  resumeInFlight ??= resume(onPhase).finally(() => {
    resumeInFlight = null;
  });
  return resumeInFlight;
}

async function resume(onPhase: (p: CirclePhase) => void): Promise<CircleSession> {
  const pending = readPending();
  if (!pending) throw new Error("No sign-in in progress.");
  onPhase("verifying");

  let sdk: W3SSdk | undefined;
  const result = await new Promise<SocialLoginResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Google sign-in timed out. Please try again.")), 60_000);
    void loadSdk(loginConfigs(pending), (err, res) => {
      clearTimeout(timer);
      if (err || !res) reject(new Error((err as { message?: string })?.message || "Google sign-in failed."));
      else resolve(res);
    }).then((s) => {
      sdk = s;
    }, reject);
  }).finally(() => window.sessionStorage.removeItem(PENDING_KEY));

  const { userToken, encryptionKey } = result;
  onPhase("initializing");
  const init = await api.circleInitialize(userToken);
  if (init.challengeId) {
    onPhase("pin");
    const s = sdk ?? (await loadSdk(loginConfigs(pending)));
    s.setAuthentication({ userToken, encryptionKey });
    await new Promise<void>((resolve, reject) => {
      s.execute(init.challengeId!, (err) => (err ? reject(new Error(err.message || "Wallet setup was not completed.")) : resolve()));
    });
  }
  onPhase("wallet");
  return finishWithWallets(userToken, encryptionKey, init.wallets, result.oAuthInfo?.socialUserInfo?.email);
}

async function finishWithWallets(
  userToken: string,
  encryptionKey: string,
  initial: CircleWalletsResponse["wallets"],
  email?: string,
): Promise<CircleSession> {
  // Circle creates the wallet asynchronously after the setup challenge — poll briefly.
  let wallets = initial;
  let wallet = pickArcWallet(wallets);
  for (let attempt = 0; !wallet && attempt < 15; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000));
    try {
      wallets = (await api.circleWallets(userToken)).wallets;
    } catch {
      // transient — retry
    }
    wallet = pickArcWallet(wallets);
  }
  if (!wallet) throw new Error("Signed in, but your Arc wallet is still being created. Try again in a minute.");
  const session: CircleSession = { userToken, encryptionKey, address: wallet.address, walletId: wallet.id, email };
  writeSession(session);
  return session;
}

export function pickArcWallet(wallets: CircleWalletsResponse["wallets"]) {
  return (
    wallets.find((w) => w.blockchain === CIRCLE_BLOCKCHAIN) ??
    wallets.find((w) => w.blockchain.toUpperCase().startsWith("ARC")) ??
    null
  );
}
