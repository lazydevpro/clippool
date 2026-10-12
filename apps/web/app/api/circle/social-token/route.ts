import { z } from "zod";
import { createSocialDeviceToken } from "@/lib/server/circle";
import { json, readJson, route } from "@/lib/server/http";
import { getCircle } from "@/lib/server/services";
import type { CircleSocialTokenResponse } from "@/lib/shared/api-types";

const Body = z.object({ deviceId: z.string().min(1).max(200) });

export const POST = route("POST /api/circle/social-token", async (req: Request) => {
  const { deviceId } = Body.parse(await readJson(req));
  return json<CircleSocialTokenResponse>(await createSocialDeviceToken(getCircle(), deviceId), { headers: { "cache-control": "no-store" } });
});
