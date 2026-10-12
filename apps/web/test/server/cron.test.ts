import { describe, expect, it, vi } from "vitest";
import { cronRoute } from "@/lib/server/cron";
import { MissingEnvError } from "@/lib/server/env";
import { isAuthorizedCron } from "@/lib/server/http";
import { runPurge, runRefresh } from "@/lib/server/jobs";
import { campaignRow, FakeStore, FakeYouTube, onchainCampaign, ytVideo } from "./helpers/fakes";

const SECRET = "s3cret-s3cret-s3cret";
const req = (auth?: string) => new Request("http://localhost/api/cron/sync", { headers: auth ? { authorization: auth } : {} });

describe("isAuthorizedCron", () => {
  it.each([
    [`Bearer ${SECRET}`, SECRET, true],
    [`bearer ${SECRET}`, SECRET, false],
    [`Bearer ${SECRET}x`, SECRET, false],
    [SECRET, SECRET, false],
    ["Bearer ", SECRET, false],
    [null, SECRET, false],
    [`Bearer ${SECRET}`, undefined, false],
    ["Bearer ", "", false],
  ])("%j with secret %j → %s", (h, s, ok) => expect(isAuthorizedCron(h as string | null, s as string | undefined)).toBe(ok));
});

describe("cronRoute", () => {
  it("401 without / with wrong credentials, job not run", async () => {
    const job = vi.fn(async () => "ran");
    const GET = cronRoute("sync", job, () => SECRET);
    for (const r of [req(), req("Bearer nope"), req(`Basic ${SECRET}`)]) {
      const res = await GET(r);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
    }
    expect(job).not.toHaveBeenCalled();
  });

  it("runs the job with the right bearer token", async () => {
    const GET = cronRoute("sync", async () => ({ windows: 2 }), () => SECRET);
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, job: "sync", result: { windows: 2 } });
  });

  it("503 (no secret name/value leaked) when CRON_SECRET is missing", async () => {
    const GET = cronRoute("sync", async () => 1, () => {
      throw new MissingEnvError("CRON_SECRET");
    });
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("CRON_SECRET");
  });

  it("job errors → 500 with a generic message (no RPC URL / key leak)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const GET = cronRoute("keeper", async () => {
      throw new Error("HTTP request failed. URL: https://rpc.example/v1/SECRETKEY");
    }, () => SECRET);
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("SECRETKEY");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("SECRETKEY");
    spy.mockRestore();
  });
});

describe("refresh + purge jobs", () => {
  it("refresh records views only for live/measuring campaigns", async () => {
    const store = new FakeStore();
    const youtube = new FakeYouTube();
    store.campaigns.set(1, campaignRow(1, onchainCampaign())); // start 1_000_000, snapshot 1_200_000
    store.campaigns.set(2, campaignRow(2, onchainCampaign({ startTime: 5_000_000, endTime: 6_000_000, snapshotTime: 7_000_000 })));
    store.submissions.push(
      { id: 1, videoId: "v1", channelId: "c", wallet: "0x1", campaignId: 1, status: "accepted" },
      { id: 2, videoId: "v2", channelId: "c", wallet: "0x1", campaignId: 2, status: "accepted" },
    );
    youtube.videos.set("v1", ytVideo({ id: "v1", viewCount: 777 }));
    const r = await runRefresh({ store, youtube, now: () => 1_150_000 });
    expect(r).toMatchObject({ submissions: 1, observations: 1 });
    expect(store.observations).toEqual([{ submissionId: 1, views: 777, fetchedAt: new Date(1_150_000_000) }]);
  });

  it("purge deletes >30-day observations and nulls expired snapshot JSON", async () => {
    const store = new FakeStore();
    const now = 100 * 86400;
    store.observations.push(
      { submissionId: 1, views: 1, fetchedAt: new Date((now - 31 * 86400) * 1000) },
      { submissionId: 1, views: 2, fetchedAt: new Date((now - 29 * 86400) * 1000) },
    );
    store.snapshots.push(
      { campaignId: 1, json: { a: 1 }, hash: "0x1", root: "0x1", createdAt: new Date(0), purgeAfter: new Date((now - 1) * 1000) },
      { campaignId: 2, json: { a: 1 }, hash: "0x2", root: "0x2", createdAt: new Date(0), purgeAfter: new Date((now + 1) * 1000) },
    );
    expect(await runPurge({ store, now: () => now })).toEqual({ observationsDeleted: 1, snapshotsPurged: 1 });
    expect(store.observations.map((o) => o.views)).toEqual([2]);
    expect(store.snapshots.map((s) => s.json)).toEqual([null, { a: 1 }]);
  });
});
