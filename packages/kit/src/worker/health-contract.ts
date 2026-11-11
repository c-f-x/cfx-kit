// The family's health contract as a test (docs/conventions.md, section 6). A
// tool's own suite calls `checkHealthContract` on its Worker and expects no
// problems, so every tool runs the same test at the kit version it pins.
// `c-f-x check layout` fails a tool repository whose tests never call it.
// The clauses are the ones cfanalytics' platform-12 to platform-14 test, with
// the parts cfmail's health answer names.

/** How the contract reaches a Worker: a fetch handler, or a service binding's `fetch`. */
export type WorkerFetch = (request: Request) => Promise<Response>;

export type HealthContractTarget = {
  /** The Worker, healthy. */
  fetch: WorkerFetch;
  /**
   * One entry per part the test can break: the part's name, and the Worker
   * reached with that part's probe failing, for example the tool's handler
   * given an empty D1 database in place of its own. At least one.
   */
  failing: { part: string; fetch: WorkerFetch }[];
  /** The health address. By default `https://example.com/healthz`. */
  url?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const noStore = (response: Response) =>
  (response.headers.get("cache-control") ?? "")
    .split(",")
    .some((directive) => directive.trim().toLowerCase() === "no-store");

/**
 * The clauses of the health contract the Worker breaks, as sentences. None
 * means it keeps them all: 200 with `{"ok":true,"parts":{...}}` when healthy,
 * 503 naming the failing part, `Cache-Control: no-store` on every answer, and
 * 405 for POST.
 */
export async function checkHealthContract({
  fetch,
  failing,
  url = "https://example.com/healthz",
}: HealthContractTarget): Promise<string[]> {
  const problems: string[] = [];

  const healthy = await fetch(new Request(url));
  const when = "GET /healthz when healthy";
  if (healthy.status !== 200) problems.push(`${when}: answered ${healthy.status}, not 200`);
  const body = await bodyOf(healthy);
  if (!isRecord(body) || body.ok !== true)
    problems.push(`${when}: the body does not say "ok": true`);
  const parts = isRecord(body) && isRecord(body.parts) ? Object.entries(body.parts) : [];
  if (parts.length === 0) problems.push(`${when}: the body names no parts`);
  for (const [part, state] of parts)
    if (state !== "ok") problems.push(`${when}: ${part} is "${String(state)}", not "ok"`);
  if (!noStore(healthy)) problems.push(`${when}: Cache-Control is not no-store`);

  if (failing.length === 0)
    problems.push("the contract test names no failing part, so it cannot see a 503 name it");
  const perPart = await Promise.all(
    failing.map(async ({ part, fetch: broken }) => {
      const found: string[] = [];
      const answer = await broken(new Request(url));
      const at = `GET /healthz with ${part} failing`;
      if (answer.status !== 503) found.push(`${at}: answered ${answer.status}, not 503`);
      const failed = await bodyOf(answer);
      if (!isRecord(failed) || failed.ok !== false)
        found.push(`${at}: the body does not say "ok": false`);
      if (!isRecord(failed) || !isRecord(failed.parts) || failed.parts[part] !== "failed")
        found.push(`${at}: the body does not name ${part} as "failed"`);
      if (!noStore(answer)) found.push(`${at}: Cache-Control is not no-store`);
      return found;
    }),
  );
  problems.push(...perPart.flat());

  const post = await fetch(new Request(url, { method: "POST" }));
  if (post.status !== 405) problems.push(`POST /healthz: answered ${post.status}, not 405`);
  if (!noStore(post)) problems.push("POST /healthz: Cache-Control is not no-store");
  await post.body?.cancel();

  return problems;
}
