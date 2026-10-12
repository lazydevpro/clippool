import { cronRoute, dynamicRoute } from "@/lib/server/cron";
import { runPurge } from "@/lib/server/jobs";
import { getStore } from "@/lib/server/services";

export const maxDuration = 60;

/** Enforce 30-day YouTube statistics retention (daily). */
export const GET = dynamicRoute(cronRoute("purge", () => runPurge({ store: getStore() })));
