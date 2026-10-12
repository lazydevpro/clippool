import { unstable_rethrow } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { BaseError } from "viem";
import { z } from "zod";
import { MissingEnvError } from "./env";

/** Consistent JSON error body: { error: { code, message } }. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
  const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return Response.json(body, { status, headers });
}

export function json<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

const URL_RE = /\bhttps?:\/\/[^\s"')]+/gi;
const HEX_KEY_RE = /0x[0-9a-fA-F]{64}\b/g;

/** Error text that is safe to log or return: no URLs (RPC keys / API keys live in them), no 32-byte hex. */
export function safeErrorMessage(err: unknown): string {
  let msg: string;
  if (err instanceof BaseError) msg = err.shortMessage;
  else if (err instanceof Error) msg = `${err.name}: ${err.message}`;
  else msg = String(err);
  return msg.replace(URL_RE, "[url]").replace(HEX_KEY_RE, (m) => `${m.slice(0, 10)}…`).slice(0, 300);
}

export function logError(scope: string, err: unknown) {
  console.error(`[${scope}] ${safeErrorMessage(err)}`);
}

/** Map anything thrown inside a route to a JSON error without leaking internals. */
export function toErrorResponse(scope: string, err: unknown): Response {
  if (err instanceof HttpError) return jsonError(err.status, err.code, err.message, err.details);
  if (err instanceof z.ZodError) {
    return jsonError(400, "invalid_request", "Request validation failed", z.flattenError(err).fieldErrors);
  }
  if (err instanceof MissingEnvError) {
    console.error(`[${scope}] ${err.message}`); // variable name only
    return jsonError(503, "not_configured", "This service is not configured yet.");
  }
  logError(scope, err);
  return jsonError(500, "internal_error", "Something went wrong.");
}

/** Wrap a route handler with consistent error handling. */
export function route<A extends unknown[]>(scope: string, handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      unstable_rethrow(err); // let Next's internal signals (prerender bailout, notFound…) through
      return toErrorResponse(scope, err);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be valid JSON");
  }
}

export const campaignIdParam = z
  .string()
  .regex(/^[1-9]\d{0,15}$/, "campaign id must be a positive integer")
  .transform(Number);

export async function parseCampaignId(params: Promise<{ id: string }>): Promise<number> {
  const { id } = await params;
  const r = campaignIdParam.safeParse(id);
  if (!r.success) throw new HttpError(400, "invalid_campaign_id", "Campaign id must be a positive integer");
  return r.data;
}

// ───────────────────────────── cron auth ─────────────────────────────

/** True iff `authorization` is exactly `Bearer ${secret}` (constant-time compare). */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authorization);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// ───────────────────────────── rate limit ─────────────────────────────

/**
 * Light fixed-window limiter, per server instance (serverless instances don't share it — it only
 * blunts bursts; YouTube quota is the real budget).
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
      const cur = hits.get(key);
      if (!cur || cur.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfterSec: 0 };
      }
      cur.count += 1;
      return { ok: cur.count <= limit, retryAfterSec: Math.ceil((cur.resetAt - now) / 1000) };
    },
  };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
