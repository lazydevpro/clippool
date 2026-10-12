import { z } from "zod";
import { initializeUser } from "@/lib/server/circle";
import { env } from "@/lib/server/env";
import { json, readJson, route } from "@/lib/server/http";
import { getCircle } from "@/lib/server/services";
import type { CircleInitializeResponse } from "@/lib/shared/api-types";

const Body = z.object({ userToken: z.string().min(10).max(4000) });

export const POST = route("POST /api/circle/initialize", async (req: Request) => {
  const { userToken } = Body.parse(await readJson(req));
  return json<CircleInitializeResponse>(await initializeUser(getCircle(), userToken, env.chainKey()), { headers: { "cache-control": "no-store" } });
});
