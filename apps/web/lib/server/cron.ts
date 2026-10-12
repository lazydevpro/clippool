import "server-only";
import { env } from "./env";
import { connection } from "next/server";
import { isAuthorizedCron, json, jsonError, route } from "./http";

/**
 * GET handler for /api/cron/* — the GitHub Actions scheduler (.github/workflows/cron.yml) sends `Authorization: Bearer $CRON_SECRET`.
 * `getSecret` is injectable for tests.
 */
export function cronRoute(name: string, job: () => Promise<unknown>, getSecret: () => string = env.cronSecret) {
  return route(`cron:${name}`, async (req: Request) => {
    const secret = getSecret(); // MissingEnvError → 503 via route()
    if (!isAuthorizedCron(req.headers.get("authorization"), secret)) {
      return jsonError(401, "unauthorized", "Missing or invalid cron credentials");
    }
    const started = Date.now();
    const result = await job();
    console.log(`[cron:${name}] done in ${Date.now() - started}ms`);
    return json({ ok: true, job: name, durationMs: Date.now() - started, result }, { headers: { "cache-control": "no-store" } });
  });
}

/** Opt a route out of prerendering before it touches request data (Next 16 cache components). */
export function dynamicRoute(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    await connection();
    return handler(req);
  };
}
