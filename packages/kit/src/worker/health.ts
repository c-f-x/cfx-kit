// The health handler every tool mounts at `GET /healthz` (docs/conventions.md,
// section 6). Ported from cfanalytics:apps/worker/src/platform/health.ts
// (no-store on every answer, 405 for other methods) and cfmail's
// `/api/health` in cfmail:apps/worker/src/api/index.ts (named parts, probes
// run at once, the error only in the log). What changed: the tool passes its
// probes in, and the answer names every part, as the family contract asks.

/**
 * One part's probe. It resolves to true when the part answered. A probe that
 * resolves to false, or throws, marks its part failed.
 */
export type Probe = () => Promise<boolean>;

/** The structured line logged for each failed part. The caller sees only "failed". */
export type HealthLine = { event: "health_failed"; part: string; error: string };

export type HealthOptions = {
  /** Where failed parts are logged. By default one JSON line to the error log. */
  log?: (line: HealthLine) => void;
};

/** The health body: `ok`, and each part as "ok" or "failed". */
export type HealthBody = { ok: boolean; parts: Record<string, "ok" | "failed"> };

const NO_STORE = { "cache-control": "no-store" };

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const logToConsole = (line: HealthLine) => console.error(JSON.stringify(line));

/**
 * A handler for `GET /healthz`. It runs every probe at once and answers 200
 * with `{"ok":true,"parts":{...}}`, or 503 naming every part that failed.
 * Every answer carries `Cache-Control: no-store`. Any other method gets 405.
 */
export function healthHandler(
  probes: Record<string, Probe>,
  { log = logToConsole }: HealthOptions = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET") {
      return Response.json(
        { error: "method_not_allowed" },
        { status: 405, headers: { ...NO_STORE, allow: "GET" } },
      );
    }
    // Each probe's failure, or null when it answered; logged afterwards in
    // the order the parts were named, so the log does not depend on timing.
    const failures = await Promise.all(
      Object.entries(probes).map(async ([part, probe]): Promise<[string, string | null]> => {
        try {
          return [part, (await probe()) ? null : "the probe answered false"];
        } catch (error) {
          return [part, errorText(error)];
        }
      }),
    );
    for (const [part, error] of failures)
      if (error !== null) log({ event: "health_failed", part, error });
    const body: HealthBody = {
      ok: failures.every(([, error]) => error === null),
      parts: Object.fromEntries(failures.map(([part, error]) => [part, error ? "failed" : "ok"])),
    };
    return Response.json(body, { status: body.ok ? 200 : 503, headers: NO_STORE });
  };
}
