// `job`: the one way a tool's `scheduled` handler and Durable Object alarms run
// work (docs/conventions.md, section 6). Each job records its outcome as one
// structured log line, and one job's failure never stops the others. Ported
// from cfmail:apps/worker/src/cron.ts (`step`, which isolates each cron job)
// and the JSON event lines of cfanalytics:apps/watch/src/index.ts. What is
// new: the duration, and the heartbeat pings. A success pings the address, so
// cfx-status raises an alert when a job stops running. A failure pings it with
// `status=fail`, so cfx-status raises the alert at once.

/** The line `job` logs once per run of a job. */
export type JobLine =
  | {
      event: "job_done";
      job: string;
      ms: number;
      heartbeat: "sent" | "failed" | "none";
      heartbeat_error?: string;
    }
  | {
      event: "job_failed";
      job: string;
      ms: number;
      error: string;
      heartbeat: "sent" | "failed" | "none";
      heartbeat_error?: string;
    };

/** What one run of a job came to. A job never rejects; its failure is here. */
export type JobOutcome =
  | { job: string; ok: true; ms: number; heartbeat: "sent" | "failed" | "none" }
  | { job: string; ok: false; ms: number; error: string; heartbeat: "sent" | "failed" | "none" };

export type JobOptions = {
  /** The job's heartbeat address, pinged with POST after each run: as it is on success, with `status=fail` on failure. None by default. */
  heartbeat?: string;
  /** How the heartbeat is reached. By default the runtime's fetch. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** The clock the duration is read from, in milliseconds. */
  now?: () => number;
  /** Where the outcome line goes. By default one JSON line: errors to the error log. */
  log?: (line: JobLine) => void;
};

/** How long a heartbeat ping may take before it counts as failed. */
export const HEARTBEAT_TIMEOUT_MS = 10_000;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function logToConsole(line: JobLine): void {
  if (line.event === "job_failed") console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

async function ping(
  url: string,
  fetch: NonNullable<JobOptions["fetch"]>,
): Promise<{ sent: true } | { sent: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok
      ? { sent: true }
      : { sent: false, error: `the heartbeat answered ${response.status}` };
  } catch (error) {
    return { sent: false, error: errorText(error) };
  }
}

/** The heartbeat address that reports a failed run: `status=fail` added to its query. */
export function failPing(heartbeat: string): string {
  const url = new URL(heartbeat);
  url.searchParams.set("status", "fail");
  return url.toString();
}

type Pinged = { heartbeat: "sent" | "none" } | { heartbeat: "failed"; heartbeat_error: string };

async function report(
  url: string | undefined,
  fetch: NonNullable<JobOptions["fetch"]>,
): Promise<Pinged> {
  if (url === undefined) return { heartbeat: "none" };
  const pinged = await ping(url, fetch);
  return pinged.sent
    ? { heartbeat: "sent" }
    : { heartbeat: "failed", heartbeat_error: pinged.error };
}

/**
 * Runs the job `name`, logs `job_done` or `job_failed` with its name and
 * duration, and resolves to the outcome. It never rejects, so a handler can
 * run several jobs and each runs whatever the others do. On success it pings
 * the heartbeat, and on failure it pings it with `status=fail`, when one is
 * given. A ping that fails is logged on the outcome line and changes nothing else.
 */
export async function job(
  name: string,
  work: () => Promise<unknown>,
  {
    heartbeat,
    fetch = (url, init) => globalThis.fetch(url, init),
    now = () => Date.now(),
    log = logToConsole,
  }: JobOptions = {},
): Promise<JobOutcome> {
  const started = now();
  let failure: string | null = null;
  try {
    await work();
  } catch (error) {
    failure = errorText(error);
  }
  const ms = now() - started;
  const pinged = await report(
    heartbeat === undefined ? undefined : failure === null ? heartbeat : failPing(heartbeat),
    fetch,
  );
  if (failure !== null) {
    log({ event: "job_failed", job: name, ms, error: failure, ...pinged });
    return { job: name, ok: false, ms, error: failure, heartbeat: pinged.heartbeat };
  }
  log({ event: "job_done", job: name, ms, ...pinged });
  return { job: name, ok: true, ms, heartbeat: pinged.heartbeat };
}
