import { connection } from "next/server";
import { getPublicClient } from "@/lib/server/chain";
import { listUserWallets } from "@/lib/server/circle";
import { env } from "@/lib/server/env";
import { HttpError, json, route } from "@/lib/server/http";
import { getCircle } from "@/lib/server/services";
import type { CircleWalletsResponse } from "@/lib/shared/api-types";

export const GET = route("GET /api/circle/wallets", async (req: Request) => {
  await connection();
  const userToken = req.headers.get("x-user-token");
  if (!userToken || userToken.length < 10 || userToken.length > 4000) {
    throw new HttpError(401, "missing_user_token", "x-user-token header is required");
  }
  return json<CircleWalletsResponse>(await listUserWallets(getCircle(), getPublicClient(), userToken, env.chainKey()), {
    headers: { "cache-control": "private, no-store" },
  });
});
