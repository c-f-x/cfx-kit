import type { OpStep } from "./operation.ts";
import type { Log } from "./run-steps.ts";

// A deploy reports success only once the tool's health address answers 200.
// A new custom domain answers only once its certificate is issued, so the
// wait asks again until a deadline that catches a real fault. Ported from
// `healthVerdict` in cfanalytics:scripts/lib/ops.mjs and `healthyWithin` and
// `healthOf` in cfanalytics:scripts/ops.mjs. The family contract
// (docs/conventions.md, section 6) has a 503 name its failing parts, so the
// verdict names them when the answer does.

/** What one answer from a health address means. */
export type HealthVerdict = {
  healthy: boolean;
  /** The status it answered, or null when nothing answered. */
  status: number | null;
  /** The parts the answer named as failing, in the order it named them. */
  failedParts: string[];
  message: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The parts a health body names as anything but "ok". */
function failingParts(body: unknown): string[] {
  if (!isRecord(body) || !isRecord(body.parts)) return [];
  return Object.entries(body.parts)
    .filter(([, state]) => state !== "ok")
    .map(([part]) => part);
}

/**
 * What an answer means. Only a 200 is healthy. `body` is the parsed JSON
 * body, or null when it was not JSON. A null `status` means nothing answered.
 */
export function healthVerdict(
  url: string,
  answer: { status: number; body: unknown } | { status: null; error: string },
): HealthVerdict {
  if (answer.status === null) {
    return {
      healthy: false,
      status: null,
      failedParts: [],
      message: `${url}: nothing answered (${answer.error})`,
    };
  }
  if (answer.status === 200) {
    return { healthy: true, status: 200, failedParts: [], message: `${url}: healthy` };
  }
  const failedParts = failingParts(answer.body);
  const named = failedParts.length === 0 ? "" : `, failing parts: ${failedParts.join(", ")}`;
  return {
    healthy: false,
    status: answer.status,
    failedParts,
    message: `${url}: failing, answered ${String(answer.status)}${named}`,
  };
}

/** The clock the wait reads and sleeps on. Passed in so a test can run it without waiting. */
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type HealthWait = {
  /** The tool's health address, for example `https://status.example.com/healthz`. */
  url: string;
  /** How long to keep asking before giving up. */
  deadlineMs: number;
  /** The pause between two asks. */
  pollMs: number;
  /** How long one ask may take before it counts as nothing answering. */
  requestTimeoutMs: number;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  log?: Log;
};

/** An error's message, with its cause's: fetch says only "fetch failed" and keeps the why in the cause. */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/** Asks `url` once and says what the answer means. */
export async function askHealth(
  url: string,
  {
    requestTimeoutMs,
    fetch = globalThis.fetch,
  }: { requestTimeoutMs: number; fetch?: typeof globalThis.fetch },
): Promise<HealthVerdict> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // A body that is not JSON names no parts; the status still decides.
    }
    return healthVerdict(url, { status: response.status, body });
  } catch (error) {
    return healthVerdict(url, { status: null, error: errorText(error) });
  }
}

/** The last verdict of a wait, and how many times it asked. */
export type HealthWaitResult = HealthVerdict & { asked: number };

/**
 * Asks `url` until it answers 200 or `deadlineMs` has passed, and resolves
 * to the last verdict. A wait that gives up says so, with what failed last.
 */
export async function waitForHealth({
  url,
  deadlineMs,
  pollMs,
  requestTimeoutMs,
  fetch = globalThis.fetch,
  clock = systemClock,
  log = () => {},
}: HealthWait): Promise<HealthWaitResult> {
  const deadline = clock.now() + deadlineMs;
  for (let asked = 1; ; asked += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each ask waits for the one before
    const verdict = await askHealth(url, { requestTimeoutMs, fetch });
    if (verdict.healthy) return { ...verdict, asked };
    if (clock.now() >= deadline) {
      return {
        ...verdict,
        asked,
        message: `gave up after ${String(deadlineMs)} ms and ${String(asked)} asks: ${verdict.message}`,
      };
    }
    log(`${verdict.message}; asking again in ${String(pollMs)} ms`);
    // oxlint-disable-next-line no-await-in-loop -- the pause between asks
    await clock.sleep(pollMs);
  }
}

/** The step that fails unless the tool's health address answers 200 within the deadline. */
export function healthStep(wait: HealthWait): OpStep {
  return {
    name: "the deployment answers its health address",
    does: `ask ${wait.url} until it answers 200, for up to ${String(wait.deadlineMs)} ms`,
    undo: "Nothing to undo: it only reads. If it fails, undo the deploy step.",
    task: async (log) => {
      const result = await waitForHealth({ log, ...wait });
      log(result.message);
      return result.healthy ? { ok: true } : { ok: false, reason: result.message };
    },
  };
}
