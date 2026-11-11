import { env } from "cloudflare:workers";
import { PROBE_TABLE } from "./worker.ts";

// Every test file starts with the table the test Worker's `db` probe reads, in
// DB only. EMPTY_DB stays without it, so a probe against it fails as it does
// when D1 is unwell.
await env.DB.exec(`CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (id INTEGER)`);
