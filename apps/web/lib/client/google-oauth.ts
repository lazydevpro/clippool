// "Connect YouTube" via Google Identity Services (GIS) token client: a popup returns a short-lived
// access token with the read-only youtube.readonly scope. No redirect URI, no new npm deps.
// The token is sent once to POST /api/youtube/connect and then dropped (never stored client-side).
import { GOOGLE_CLIENT_ID } from "./env";

export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const GIS_SRC = "https://accounts.google.com/gsi/client";

// ── Minimal GIS typings (google.accounts.oauth2) ──
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}
interface GisErrorResponse {
  type: "popup_failed_to_open" | "popup_closed" | "unknown" | string;
  message?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: "" | "none" | "consent" | "select_account"; hint?: string }): void;
}
interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: GisErrorResponse) => void;
    prompt?: string;
    include_granted_scopes?: boolean;
  }): GisTokenClient;
  hasGrantedAllScopes(response: GisTokenResponse, ...scopes: string[]): boolean;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } };
  }
}

export class GoogleConnectError extends Error {
  constructor(
    message: string,
    readonly kind: "closed" | "blocked" | "denied" | "scope" | "unavailable" | "unknown",
  ) {
    super(message);
    this.name = "GoogleConnectError";
  }
}

const oauth2 = () => (typeof window === "undefined" ? undefined : window.google?.accounts?.oauth2);

let loading: Promise<void> | null = null;

/** Load the GIS script once (call early, e.g. on mount, so the click can open the popup synchronously). */
export function loadGoogleIdentity(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new GoogleConnectError("Google sign-in runs in the browser.", "unavailable"));
  if (oauth2()) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const fail = () => {
      loading = null;
      reject(new GoogleConnectError("Couldn't load Google sign-in. Check your connection or ad blocker and try again.", "unavailable"));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => (oauth2() ? resolve() : fail()), { once: true });
    script.addEventListener("error", () => {
      script.remove();
      fail();
    }, { once: true });
    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return loading;
}

export const isGoogleIdentityReady = () => Boolean(oauth2());

/**
 * Open the Google popup and resolve with an access token for youtube.readonly.
 * Call from a click handler; if GIS is already loaded the popup opens synchronously (no popup blocker).
 * `selectAccount` forces the account chooser (to connect a different channel / brand account).
 */
export async function requestYouTubeAccessToken({ selectAccount = false }: { selectAccount?: boolean } = {}): Promise<string> {
  if (!GOOGLE_CLIENT_ID) throw new GoogleConnectError("Connect YouTube isn't configured on this deployment.", "unavailable");
  if (!oauth2()) await loadGoogleIdentity();
  const api = oauth2()!;
  return new Promise<string>((resolve, reject) => {
    const client = api.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: YOUTUBE_READONLY_SCOPE,
      include_granted_scopes: false,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new GoogleConnectError(
              resp.error === "access_denied" ? "Google access was declined." : "Google sign-in didn't complete. Please try again.",
              resp.error === "access_denied" ? "denied" : "unknown",
            ),
          );
          return;
        }
        if (!api.hasGrantedAllScopes(resp, YOUTUBE_READONLY_SCOPE)) {
          reject(new GoogleConnectError("Please tick “See your YouTube account” so we can find your channel.", "scope"));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        if (err.type === "popup_closed") reject(new GoogleConnectError("The Google window was closed before finishing.", "closed"));
        else if (err.type === "popup_failed_to_open")
          reject(new GoogleConnectError("Your browser blocked the Google window. Allow pop-ups for this site and try again.", "blocked"));
        else reject(new GoogleConnectError("Google sign-in didn't complete. Please try again.", "unknown"));
      },
    });
    client.requestAccessToken({ prompt: selectAccount ? "select_account" : "" });
  });
}
