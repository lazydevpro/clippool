import { isAddress } from "viem";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clientIp, createRateLimiter, jsonError, json, readJson, route } from "@/lib/server/http";
import { getYouTube } from "@/lib/server/services";
import { submitVideo } from "@/lib/server/submit";
import type { SubmissionResponse } from "@/lib/shared/api-types";

const limiter = createRateLimiter(10, 60_000); // 10 submissions / minute / IP / instance

const Body = z.object({
  campaignId: z.string().regex(/^[1-9]\d{0,15}$/).transform(Number),
  videoUrl: z.string().trim().min(1).max(500),
  wallet: z
    .string()
    .refine((w) => isAddress(w, { strict: false }), "invalid wallet address")
    .transform((w) => w as `0x${string}`),
});

/** Validation outcomes (accepted/rejected) are 200 with SubmissionResponse; malformed input is 400. */
export const POST = route("POST /api/submissions", async (req: Request) => {
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return jsonError(429, "rate_limited", "Too many submissions — try again shortly.", undefined, { "retry-after": String(rl.retryAfterSec) });
  const body = Body.parse(await readJson(req));
  const res = await submitVideo(getDb(), getYouTube(), body, Math.floor(Date.now() / 1000));
  return json<SubmissionResponse>(res);
});
