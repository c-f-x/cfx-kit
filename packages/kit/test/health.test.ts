import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { checkHealthContract, healthHandler } from "../src/worker/index.ts";
import worker, { app } from "./worker.ts";

// The health handler and the family's health contract (docs/conventions.md,
// section 6), on the real Workers runtime with real D1 databases.

const HEALTH_URL = "https://example.com/healthz";
const get = () => new Request(HEALTH_URL);

/** A health address written by hand: 200 for everything, no parts, no no-store. */
const careless = async () => Response.json({ ok: true });

describe("the health handler", () => {
  test("answers 200, ok and every part when each probe answers", async () => {
    const lines: unknown[] = [];
    const handler = healthHandler(
      {
        db: async () => (await env.DB.prepare("SELECT 1").first()) !== null,
        pings: async () => {
          await env.PINGS.get("health/none");
          return true;
        },
      },
      { log: (line) => lines.push(line) },
    );
    const response = await handler(get());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, parts: { db: "ok", pings: "ok" } });
    expect(lines).toEqual([]);
  });

  test("answers 503 naming every failed part, and logs why only to the log", async () => {
    const lines: unknown[] = [];
    const handler = healthHandler(
      {
        db: async () => (await env.EMPTY_DB.prepare("SELECT 1 FROM missing").first()) !== null,
        runs: async () => false,
        pings: async () => (await env.PINGS.get("health/none")) === null,
      },
      { log: (line) => lines.push(line) },
    );
    const response = await handler(get());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ ok: false, parts: { db: "failed", runs: "failed", pings: "ok" } });
    expect(JSON.stringify(body)).not.toMatch(/missing/);
    expect(lines).toEqual([
      { event: "health_failed", part: "db", error: expect.stringMatching(/missing/) },
      { event: "health_failed", part: "runs", error: "the probe answered false" },
    ]);
  });

  test("refuses every other method with 405, without running a probe", async () => {
    let ran = 0;
    const handler = healthHandler({
      db: async () => {
        ran += 1;
        return true;
      },
    });
    const answers = await Promise.all(
      ["POST", "PUT", "DELETE", "HEAD"].map((method) =>
        handler(new Request(HEALTH_URL, { method })),
      ),
    );
    for (const response of answers) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(ran).toBe(0);
  });
});

describe("the health contract test", () => {
  test("passes a Worker that mounts the kit's handler", async () => {
    const problems = await checkHealthContract({
      url: HEALTH_URL,
      fetch: (request) => exports.default.fetch(request),
      failing: [{ part: "db", fetch: (request) => app({ ...env, DB: env.EMPTY_DB })(request) }],
    });
    expect(problems).toEqual([]);
  });

  test("names each clause a Worker breaks", async () => {
    // It breaks every clause: no no-store, a 200 that names no parts, a
    // failing part that still answers 200 and calls itself ok, and a POST
    // that is served.
    const problems = await checkHealthContract({
      url: HEALTH_URL,
      fetch: careless,
      failing: [{ part: "db", fetch: careless }],
    });
    expect(problems).toEqual([
      "GET /healthz when healthy: the body names no parts",
      "GET /healthz when healthy: Cache-Control is not no-store",
      "GET /healthz with db failing: answered 200, not 503",
      'GET /healthz with db failing: the body does not say "ok": false',
      'GET /healthz with db failing: the body does not name db as "failed"',
      "GET /healthz with db failing: Cache-Control is not no-store",
      "POST /healthz: answered 200, not 405",
      "POST /healthz: Cache-Control is not no-store",
    ]);
  });

  test("needs at least one failing part to test", async () => {
    const problems = await checkHealthContract({
      url: HEALTH_URL,
      fetch: (request) => worker.fetch(request, env),
      failing: [],
    });
    expect(problems).toEqual([
      "the contract test names no failing part, so it cannot see a 503 name it",
    ]);
  });
});
