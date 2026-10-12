import "server-only";
import { initiateUserControlledWalletsClient, type CircleUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { getDb } from "@/lib/db";
import { env } from "./env";
import { createGoogleOAuth, type GoogleOAuth } from "./google";
import { createDbStore, type JobStore } from "./store";
import { createYouTubeClient, type YouTubeClient } from "./youtube";

/** Lazy production wiring (each getter validates only the env it needs). */
let store: JobStore | undefined;
export const getStore = (): JobStore => (store ??= createDbStore(getDb()));

let youtube: YouTubeClient | undefined;
export const getYouTube = (): YouTubeClient => (youtube ??= createYouTubeClient(env.youtubeApiKey()));

let google: GoogleOAuth | undefined;
export const getGoogleOAuth = (): GoogleOAuth => (google ??= createGoogleOAuth(env.googleClientId()));

let circle: CircleUserControlledWalletsClient | undefined;
export const getCircle = (): CircleUserControlledWalletsClient =>
  (circle ??= initiateUserControlledWalletsClient({ apiKey: env.circleApiKey() }));
