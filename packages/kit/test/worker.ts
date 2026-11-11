import { healthHandler } from "../src/worker/index.ts";

// The Worker the kit's Worker tests run against, shaped the way a tool mounts
// the helpers. Its bindings are real local ones (vitest.config.ts):
// - GET /healthz answers through the kit's handler, with a `db` probe that
//   reads the table test/setup.ts makes. A test that hands this Worker
//   EMPTY_DB as its DB, which has no such table, sees that part fail.
// - POST /hb/<token> stands in for cfx-status's heartbeat address. It keeps
//   each ping in PINGS, so a test can see that a job's heartbeat arrived.

export type TestEnv = {
  DB: D1Database;
  EMPTY_DB: D1Database;
  PINGS: KVNamespace;
  MAIL: SendEmail;
};

export const PROBE_TABLE = "health_probe";

export function app(env: TestEnv): (request: Request) => Promise<Response> {
  const health = healthHandler({
    db: async () => (await env.DB.prepare(`SELECT 1 FROM ${PROBE_TABLE}`).all()).success,
  });
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return health(request);
    const ping = /^\/hb\/([\w-]+)$/.exec(url.pathname);
    if (ping !== null && request.method === "POST") {
      await env.PINGS.put(`ping:${ping[1] ?? ""}`, url.search);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };
}

export default {
  fetch: (request: Request, env: TestEnv) => app(env)(request),
} satisfies ExportedHandler<TestEnv>;
