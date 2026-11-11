import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { type Clock, healthStep, healthVerdict, waitForHealth } from "./health.ts";

// The health wait against a real HTTP server on a port the system picks.
// The clock is passed in, so the wait's deadline passes without the test
// waiting: each pause moves the clock on by the pause.

/** A clock that starts at 0 and moves on only when the wait pauses. */
function steppedClock(): Clock & { pauses: number[] } {
  let now = 0;
  const pauses: number[] = [];
  return {
    pauses,
    now: () => now,
    sleep: async (ms) => {
      pauses.push(ms);
      now += ms;
    },
  };
}

type Answer = { status: number; body: string };

/** Starts a server that gives `answers` in turn, then the last one forever. Resolves once it listens. */
async function serve(
  answers: Answer[],
): Promise<{ url: string; asked: () => number; server: Server }> {
  let asked = 0;
  const server = createServer((_request, response) => {
    const answer = answers[Math.min(asked, answers.length - 1)] ?? { status: 500, body: "" };
    asked += 1;
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the server has no port");
  return { url: `http://127.0.0.1:${String(address.port)}/healthz`, asked: () => asked, server };
}

/** Stops the server. The fetches keep their connections open, so they are closed too. */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

const FAILING: Answer = {
  status: 503,
  body: JSON.stringify({ ok: false, parts: { db: "failed", bucket: "ok", queue: "timeout" } }),
};
const HEALTHY: Answer = { status: 200, body: JSON.stringify({ ok: true, parts: { db: "ok" } }) };

test("the wait gives up after the time passed in, and names the parts that failed", async () => {
  const { url, asked, server } = await serve([FAILING]);
  try {
    const clock = steppedClock();
    const result = await waitForHealth({
      url,
      deadlineMs: 1000,
      pollMs: 250,
      requestTimeoutMs: 5000,
      clock,
    });
    assert.equal(result.healthy, false);
    assert.equal(result.status, 503);
    assert.deepEqual(result.failedParts, ["db", "queue"]);
    // Asked at 0, 250, 500, 750 and 1000 ms; at 1000 the deadline has passed.
    assert.equal(result.asked, 5);
    assert.equal(asked(), 5);
    assert.deepEqual(clock.pauses, [250, 250, 250, 250]);
    assert.match(
      result.message,
      /^gave up after 1000 ms and 5 asks: .+failing, answered 503, failing parts: db, queue$/,
    );
  } finally {
    await close(server);
  }
});

test("the wait ends at the first healthy answer", async () => {
  const { url, asked, server } = await serve([FAILING, FAILING, HEALTHY]);
  try {
    const result = await waitForHealth({
      url,
      deadlineMs: 60_000,
      pollMs: 1000,
      requestTimeoutMs: 5000,
      clock: steppedClock(),
    });
    assert.equal(result.healthy, true);
    assert.equal(result.asked, 3);
    assert.equal(asked(), 3);
  } finally {
    await close(server);
  }
});

test("an address where nothing answers fails as nothing answering", async () => {
  // A port the system gave out and that is closed again, so nothing listens there.
  const { url, server } = await serve([HEALTHY]);
  await close(server);
  const result = await waitForHealth({
    url,
    deadlineMs: 0,
    pollMs: 10,
    requestTimeoutMs: 5000,
    clock: steppedClock(),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.status, null);
  assert.match(result.message, /nothing answered/);
});

test("only a 200 is healthy, and a 503 without parts still fails", () => {
  assert.equal(healthVerdict("u", { status: 200, body: null }).healthy, true);
  for (const status of [503, 500, 404, 301]) {
    assert.equal(healthVerdict("u", { status, body: null }).healthy, false);
  }
  assert.deepEqual(healthVerdict("u", { status: 503, body: { ok: false } }), {
    healthy: false,
    status: 503,
    failedParts: [],
    message: "u: failing, answered 503",
  });
});

test("the health step fails with the reason the wait gave", async () => {
  const { url, server } = await serve([FAILING]);
  try {
    const lines: string[] = [];
    const step = healthStep({
      url,
      deadlineMs: 500,
      pollMs: 250,
      requestTimeoutMs: 5000,
      clock: steppedClock(),
    });
    assert.ok("task" in step);
    const outcome = await step.task((line) => lines.push(line));
    assert.equal(outcome.ok, false);
    assert.match(
      outcome.ok ? "" : outcome.reason,
      /gave up after 500 ms .+failing parts: db, queue/,
    );
    assert.match(lines.join("\n"), /asking again in 250 ms/);
  } finally {
    await close(server);
  }
});
