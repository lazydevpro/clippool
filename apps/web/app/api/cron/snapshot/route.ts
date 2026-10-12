import { getOracleGateway } from "@/lib/server/chain";
import { cronRoute, dynamicRoute } from "@/lib/server/cron";
import { runOracle } from "@/lib/server/oracle";
import { getStore, getYouTube } from "@/lib/server/services";

export const maxDuration = 60;

/** Final snapshot → allocation → postRoot for campaigns past snapshotTime (every 15 min). */
export const GET = dynamicRoute(cronRoute("snapshot", () => runOracle({ chain: getOracleGateway(), store: getStore(), youtube: getYouTube() })));
