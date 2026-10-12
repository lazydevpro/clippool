import type { JobStore } from "./store";
import { countableViews, type YouTubeClient } from "./youtube";

/** Hourly: refresh views for accepted submissions of live/measuring campaigns. */
export async function runRefresh(deps: { store: JobStore; youtube: YouTubeClient; now?: () => number }) {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const subs = await deps.store.submissionsToRefresh(now);
  if (subs.length === 0) return { submissions: 0, observations: 0 };
  const videos = await deps.youtube.getVideos(subs.map((s) => s.videoId));
  const rows = subs.map((s) => ({ submissionId: s.id, views: countableViews(videos.get(s.videoId)) }));
  await deps.store.recordViews(rows, new Date(now * 1000));
  return { submissions: subs.length, observations: rows.length, apiCalls: Math.ceil(new Set(subs.map((s) => s.videoId)).size / 50) };
}

/** Daily: enforce the 30-day YouTube statistics retention limit. */
export async function runPurge(deps: { store: JobStore; now?: () => number }) {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  return deps.store.purge(new Date(now * 1000));
}
