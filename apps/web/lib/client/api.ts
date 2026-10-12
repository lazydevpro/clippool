// Single entry point for every HTTP call the frontend makes. NEXT_PUBLIC_USE_MOCKS=1 swaps in fixtures.
import type {
  CampaignDetail,
  CampaignListResponse,
  CampaignMetaRequest,
  CircleInitializeResponse,
  CircleSocialTokenResponse,
  CircleWalletsResponse,
  EligibleShortsResponse,
  LeaderboardResponse,
  ReceiptsResponse,
  SubmissionRequest,
  SubmissionResponse,
  YouTubeChannelsResponse,
  YouTubeConnectRequest,
} from "@/lib/shared/api-types";
import { USE_MOCKS } from "./env";
import { mockApi } from "./mocks";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export const isNotFound = (err: unknown) => (err as { status?: number } | null)?.status === 404;

/** Accepts `{ error: "msg" }`, `{ message }`, or `{ error: { code, message } }`. */
function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { error?: unknown; message?: unknown };
  if (typeof b.message === "string") return b.message;
  if (typeof b.error === "string") return b.error;
  if (b.error && typeof b.error === "object") {
    const m = (b.error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(errorMessage(body) || `Request failed (${res.status})`, res.status, body);
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  listCampaigns(): Promise<CampaignListResponse> {
    return USE_MOCKS ? mockApi.listCampaigns() : request("/api/campaigns");
  },

  /** GET /api/campaigns/:id → CampaignDetail (accepts a bare object or `{ campaign }`). */
  async getCampaign(id: string): Promise<CampaignDetail> {
    if (USE_MOCKS) return mockApi.getCampaign(id);
    const body = await request<CampaignDetail | { campaign: CampaignDetail }>(`/api/campaigns/${enc(id)}`);
    return "campaign" in body ? body.campaign : body;
  },

  getLeaderboard(id: string): Promise<LeaderboardResponse> {
    return USE_MOCKS ? mockApi.getLeaderboard(id) : request(`/api/campaigns/${enc(id)}/leaderboard`);
  },

  getReceipts(id: string): Promise<ReceiptsResponse> {
    return USE_MOCKS ? mockApi.getReceipts(id) : request(`/api/campaigns/${enc(id)}/receipts`);
  },

  snapshotUrl(id: string): string {
    return `/api/campaigns/${enc(id)}/snapshot`;
  },

  getSnapshot(id: string): Promise<unknown> {
    return USE_MOCKS ? mockApi.getSnapshot(id) : request(`/api/campaigns/${enc(id)}/snapshot`);
  },

  postMeta(id: string, meta: CampaignMetaRequest): Promise<unknown> {
    if (USE_MOCKS) return mockApi.postMeta();
    return request(`/api/campaigns/${enc(id)}/meta`, { method: "POST", body: JSON.stringify(meta) });
  },

  /** POST /api/submissions. A rejection may arrive with a 4xx status; it is returned, not thrown. */
  async submit(req: SubmissionRequest): Promise<SubmissionResponse> {
    if (USE_MOCKS) return mockApi.submit(req);
    try {
      return await request<SubmissionResponse>("/api/submissions", { method: "POST", body: JSON.stringify(req) });
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as SubmissionResponse | undefined) : undefined;
      if (body && typeof body === "object" && body.status === "rejected") return body;
      throw err;
    }
  },

  /** POST /api/youtube/connect — the access token is sent once and not kept anywhere. */
  connectYouTube(req: YouTubeConnectRequest): Promise<YouTubeChannelsResponse> {
    if (USE_MOCKS) return mockApi.connectYouTube(req);
    return request("/api/youtube/connect", { method: "POST", body: JSON.stringify(req) });
  },

  youtubeChannels(wallet: string): Promise<YouTubeChannelsResponse> {
    if (USE_MOCKS) return mockApi.youtubeChannels(wallet);
    return request(`/api/youtube/channels?wallet=${enc(wallet)}`);
  },

  eligibleShorts(campaignId: string, wallet: string): Promise<EligibleShortsResponse> {
    if (USE_MOCKS) return mockApi.eligibleShorts(campaignId, wallet);
    return request(`/api/campaigns/${enc(campaignId)}/eligible-shorts?wallet=${enc(wallet)}`);
  },

  circleSocialToken(deviceId: string): Promise<CircleSocialTokenResponse> {
    if (USE_MOCKS) return mockApi.circleSocialToken();
    return request("/api/circle/social-token", { method: "POST", body: JSON.stringify({ deviceId }) });
  },

  circleInitialize(userToken: string): Promise<CircleInitializeResponse> {
    if (USE_MOCKS) return mockApi.circleInitialize();
    return request("/api/circle/initialize", { method: "POST", body: JSON.stringify({ userToken }) });
  },

  circleWallets(userToken: string): Promise<CircleWalletsResponse> {
    if (USE_MOCKS) return mockApi.circleWallets();
    return request("/api/circle/wallets", { headers: { "x-user-token": userToken } });
  },
};
