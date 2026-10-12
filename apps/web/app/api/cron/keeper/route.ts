import { getKeeperGateway } from "@/lib/server/chain";
import { cronRoute, dynamicRoute } from "@/lib/server/cron";
import { runKeeper } from "@/lib/server/keeper";
import { getStore } from "@/lib/server/services";

export const maxDuration = 60;

/** Push claimMany batches after the dispute window (every 15 min). */
export const GET = dynamicRoute(cronRoute("keeper", () => runKeeper({ chain: getKeeperGateway(), store: getStore() })));
