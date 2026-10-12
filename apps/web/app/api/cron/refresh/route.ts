import { cronRoute, dynamicRoute } from "@/lib/server/cron";
import { runRefresh } from "@/lib/server/jobs";
import { getStore, getYouTube } from "@/lib/server/services";

export const maxDuration = 60;

/** Refresh views for live/measuring campaigns (hourly). */
export const GET = dynamicRoute(cronRoute("refresh", () => runRefresh({ store: getStore(), youtube: getYouTube() })));
