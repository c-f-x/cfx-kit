import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { failPing, type JobLine, job } from "../src/worker/index.ts";

// `job`, the wrapper every scheduled handler and alarm runs its work through
// (docs/conventions.md, section 6), on the Workers runtime. The heartbeat
// address is the test Worker's own /hb/<token> route, reached through its
// real fetch handler, which keeps each ping in a real KV namespace.

const heartbeatFetch = (url: string, init: RequestInit) =>
  exports.default.fetch(new Request(url, init));

/** A clock that moves 5 ms each time it is read, so a duration is known. */
const steppingClock = () => {
  let now = 1_000;
  return () => {
    now += 5;
    return now;
  };
};

describe("job", () => {
  test("logs job_done with its name and duration, and pings its heartbeat (job-01)", async () => {
    const lines: JobLine[] = [];
    const outcome = await job("sweep", async () => {}, {
      heartbeat: "https://status.example.com/hb/sweep-token",
      fetch: heartbeatFetch,
      now: steppingClock(),
      log: (line) => lines.push(line),
    });
    expect(outcome).toEqual({ job: "sweep", ok: true, ms: 5, heartbeat: "sent" });
    expect(lines).toEqual([{ event: "job_done", job: "sweep", ms: 5, heartbeat: "sent" }]);
    expect(await env.PINGS.get("ping:sweep-token")).toBe("");
  });

  test("logs job_failed with the error, pings its heartbeat with status=fail, and never rejects (job-02)", async () => {
    const lines: JobLine[] = [];
    const outcome = await job(
      "backup",
      async () => {
        await env.EMPTY_DB.prepare("SELECT * FROM missing").all();
      },
      {
        heartbeat: "https://status.example.com/hb/backup-token",
        fetch: heartbeatFetch,
        now: steppingClock(),
        log: (line) => lines.push(line),
      },
    );
    expect(outcome).toEqual({
      job: "backup",
      ok: false,
      ms: 5,
      error: expect.stringMatching(/missing/),
      heartbeat: "sent",
    });
    expect(lines).toEqual([
      {
        event: "job_failed",
        job: "backup",
        ms: 5,
        error: expect.stringMatching(/missing/),
        heartbeat: "sent",
      },
    ]);
    // cfx-status marks a heartbeat down at once on status=fail (cfx-status spec, hb-03),
    // so a failing job alerts now instead of when its window runs out.
    expect(await env.PINGS.get("ping:backup-token")).toBe("?status=fail");
  });

  test("one job's failure does not stop the others", async () => {
    const ran: string[] = [];
    const lines: JobLine[] = [];
    const log = (line: JobLine) => lines.push(line);
    const outcomes = await Promise.all([
      job(
        "first",
        async () => {
          throw new Error("first broke");
        },
        { log },
      ),
      job(
        "second",
        async () => {
          await env.DB.prepare("SELECT 1").first();
          ran.push("second");
        },
        { log },
      ),
    ]);
    await job("third", async () => ran.push("third"), { log });
    expect(outcomes.map((o) => o.ok)).toEqual([false, true]);
    expect(ran).toEqual(["second", "third"]);
    expect(lines.map((l) => `${l.event} ${l.job}`)).toEqual([
      "job_failed first",
      "job_done second",
      "job_done third",
    ]);
  });

  test("a heartbeat that cannot be reached is logged, and the job still counts as done", async () => {
    const lines: JobLine[] = [];
    const outcome = await job("sweep", async () => {}, {
      heartbeat: "https://status.example.com/nowhere",
      fetch: heartbeatFetch,
      log: (line) => lines.push(line),
    });
    expect(outcome).toMatchObject({ ok: true, heartbeat: "failed" });
    // The status=fail ping keeps any query the heartbeat address already has.
    expect(failPing("https://status.example.com/hb/t?source=cron")).toBe(
      "https://status.example.com/hb/t?source=cron&status=fail",
    );
    expect(lines).toEqual([
      {
        event: "job_done",
        job: "sweep",
        ms: expect.any(Number),
        heartbeat: "failed",
        heartbeat_error: "the heartbeat answered 404",
      },
    ]);
  });

  test("a job without a heartbeat logs that it has none", async () => {
    const lines: JobLine[] = [];
    await job("sweep", async () => {}, { log: (line) => lines.push(line) });
    expect(lines).toEqual([
      { event: "job_done", job: "sweep", ms: expect.any(Number), heartbeat: "none" },
    ]);
  });
});
