import { getReadGateway } from "@/lib/server/chain";
import { cronRoute, dynamicRoute } from "@/lib/server/cron";
import { env } from "@/lib/server/env";
import { getStore } from "@/lib/server/services";
import { syncEvents } from "@/lib/server/sync";

export const maxDuration = 60;

/** Index ClipPool events → DB (every 5 min). */
export const GET = dynamicRoute(cronRoute("sync", () => syncEvents({ chain: getReadGateway(), store: getStore(), deployBlock: env.deployBlock() })));
