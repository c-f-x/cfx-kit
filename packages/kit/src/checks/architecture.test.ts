import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import {
  coreViolations,
  crossSliceViolations,
  durableObjectJurisdictionViolations,
  mailViolations,
  moduleStateViolations,
  scheduledWorkViolations,
} from "./architecture.ts";
import { importsOf } from "./source.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

const sample = (file: string, text: string) => ({ file, text });

test("the import scan sees the shapes the code uses", () => {
  const text = [
    'import { a } from "./a.ts";',
    'import type { B } from "../b.ts";',
    'import {\n  c,\n  type D,\n} from "@scope/shared/x";',
    'export { e } from "./e.ts";',
    'import "./side-effect.ts";',
    'const f = await import("./f.ts");',
  ].join("\n");
  assert.deepEqual(importsOf(text), [
    { spec: "./a.ts", typeOnly: false },
    { spec: "../b.ts", typeOnly: true },
    { spec: "@scope/shared/x", typeOnly: false },
    { spec: "./e.ts", typeOnly: false },
    { spec: "./side-effect.ts", typeOnly: false },
    { spec: "./f.ts", typeOnly: false },
  ]);
});

test("the core check flags I/O, imports from outside core/, clocks, randomness and throws", () => {
  const found = coreViolations([
    sample("src/features/runs/core/verdict.ts", 'import { Hono } from "hono";'),
    sample("src/features/runs/core/verdict.ts", 'import { put } from "../store.ts";'),
    sample("src/core/clock.ts", 'import { readFile } from "node:fs";'),
    sample("src/features/runs/core/verdict.ts", "export const now = () => Date.now();"),
    sample("src/features/runs/core/verdict.ts", "export const id = () => crypto.randomUUID();"),
    sample("src/features/runs/core/verdict.ts", 'export function f() { throw new Error("x"); }'),
    // Allowed: another core file, a type from anywhere, a comment naming
    // Date.now(), and the same calls in a file outside core/.
    sample(
      "src/features/runs/core/verdict.ts",
      'import { ok } from "../../../core/result.ts";\nimport type { Env } from "../../../env.ts";\n// not Date.now()',
    ),
    sample("src/features/runs/store.ts", "export const now = () => Date.now();"),
  ]);
  assert.deepEqual(found, [
    "src/features/runs/core/verdict.ts imports hono",
    "src/features/runs/core/verdict.ts imports ../store.ts, which is outside core/",
    "src/core/clock.ts imports node:fs",
    "src/features/runs/core/verdict.ts reads a clock, a random source or the network",
    "src/features/runs/core/verdict.ts reads a clock, a random source or the network",
    "src/features/runs/core/verdict.ts throws",
  ]);
});

test("the cross-slice check flags reaching into another slice's files", () => {
  const found = crossSliceViolations(
    [
      sample("src/features/pages/http.ts", 'import { x } from "../runs/store.ts";'),
      sample("src/features/pages/http.ts", 'import { y } from "../runs/index.ts";'),
      sample("src/features/pages/http.ts", 'import { z } from "../runs";'),
      sample("src/features/pages/core/page.ts", 'import { w } from "./order.ts";'),
      sample("src/app.ts", 'import { v } from "./features/runs/store.ts";'),
    ],
    ["src/features"],
  );
  assert.deepEqual(found, ["src/features/pages/http.ts imports ../runs/store.ts"]);
});

test("the module-state check flags state requests could share", () => {
  const found = moduleStateViolations([
    sample("src/a.ts", "let cache;"),
    sample("src/b.ts", "export const seen = new Map();"),
    sample("src/c.ts", "export const queue = new Array<string>();"),
    sample("src/e.ts", 'const PATHS = ["/e", "/batch"] as const;'),
    sample("src/d.ts", "const LIMIT = 500;\nfunction f() {\n  let x = 1;\n}"),
  ]);
  assert.deepEqual(found, [
    "src/a.ts keeps module-level mutable state",
    "src/b.ts keeps module-level mutable state",
    "src/c.ts keeps module-level mutable state",
  ]);
});

test("the mail check flags mail sent outside the one mail.ts", () => {
  const found = mailViolations(
    [
      sample(
        "src/mail.ts",
        'import { notify } from "@c-f-x/kit/worker";\nawait env.ALERT.send(message);\nfetch(base + "/api/svc/send");',
      ),
      sample("src/features/runs/alert.ts", "await env.ALERT.send({ to, subject, text });"),
      sample(
        "src/features/runs/notify.ts",
        'await fetch(cfmail + "/api/svc/send", { method: "POST" });',
      ),
      sample("src/raw.ts", 'import { EmailMessage } from "cloudflare:email";'),
      sample("src/features/pages/mail.ts", "export const x = 1;"),
      sample("src/features/runs/tell.ts", 'import { job, notify } from "@c-f-x/kit/worker";'),
      // Allowed: passing the binding to mail.ts, a comment about sending, and
      // the kit's other helpers.
      sample("src/cron.ts", 'import { job, type JobLine } from "@c-f-x/kit/worker";'),
      sample(
        "src/index.ts",
        "await sendAlert(env.ALERT, change);\n// env.ALERT.send( is mail.ts's job",
      ),
    ],
    ["ALERT"],
  );
  assert.deepEqual(found, [
    "a tool has one mail.ts, and this one has 2: src/mail.ts, src/features/pages/mail.ts",
    "src/features/runs/alert.ts sends through the email binding ALERT; only mail.ts sends mail",
    "src/features/runs/notify.ts calls cfmail; only mail.ts sends mail",
    "src/raw.ts imports cloudflare:email; only mail.ts sends mail",
    "src/features/runs/tell.ts imports notify from @c-f-x/kit/worker; only mail.ts sends mail",
  ]);
});

test("the scheduled-work check flags work a scheduled handler or an alarm runs outside job", () => {
  const found = scheduledWorkViolations([
    sample(
      "src/index.ts",
      [
        "export default {",
        "  async scheduled(controller, env, ctx) {",
        "    const db = makeDB(env.DB);",
        '    ctx.waitUntil(job("sweep", () => sweep(db)));',
        "  },",
        "};",
      ].join("\n"),
    ),
    sample(
      "src/store.ts",
      "export class Store extends DurableObject {\n  async alarm(): Promise<void> {\n    await this.flush();\n  }\n}",
    ),
    sample(
      "src/arrow.ts",
      "export default { scheduled: (c, env, ctx) => ctx.waitUntil(runCron(env)) };",
    ),
    sample(
      "src/named.ts",
      "const scheduled = async (c, env) => {\n  await sweep(env);\n};\nexport default { fetch, scheduled };",
    ),
    sample(
      "src/elsewhere.ts",
      'import { onCron } from "./cron.ts";\nexport default { scheduled: onCron };',
    ),
    // Allowed: every job through job, at once or one after another, a cron
    // switch, a job that runs other calls inside it, an alarm that only runs
    // a job, an interface naming alarm(), and calls to alarm or scheduled.
    sample(
      "src/ok.ts",
      [
        'import { job } from "@c-f-x/kit/worker";',
        "export default {",
        "  async scheduled(controller, env, ctx) {",
        "    switch (controller.cron) {",
        '      case "0 3 * * *":',
        '        await job("backup", () => backup(env), { heartbeat: env.BACKUP_HEARTBEAT });',
        "        break;",
        "      default:",
        "        ctx.waitUntil(",
        '          Promise.all([job("sweep", () => sweep(env)), job("probe", async () => probe(await load(env)))]),',
        "        );",
        "    }",
        "  },",
        "};",
        "export class Prober extends DurableObject {",
        '  async alarm() {\n    await job("probe", () => this.probe());\n  }',
        "}",
        "interface Alarmed { alarm(): Promise<void>; }",
        "export const later = (stub) => stub.alarm();",
        "await worker.scheduled(controller, env, ctx);",
      ].join("\n"),
    ),
    sample(
      "src/named-ok.ts",
      'function scheduled(c, env, ctx) {\n  ctx.waitUntil(job("sweep", () => sweep(env)));\n}\nexport default { scheduled };',
    ),
  ]);
  assert.deepEqual(found, [
    "src/index.ts runs makeDB( in its scheduled handler outside job",
    "src/store.ts runs this.flush( in its alarm outside job",
    "src/arrow.ts runs runCron( in its scheduled handler outside job",
    "src/named.ts runs sweep( in its scheduled handler outside job",
    "src/elsewhere.ts names onCron as its scheduled handler, which it does not define, so the check cannot see that it runs only through job",
  ]);
});

test("the Durable Object check flags a jurisdiction written into the code", () => {
  const found = durableObjectJurisdictionViolations([
    sample("src/eu.ts", 'const id = env.STORE.jurisdiction("eu").idFromName(p);'),
    sample("src/us.ts", "const ns = env.STORE.jurisdiction('fedramp');"),
    sample("src/split.ts", "const ns = env.STORE\n  .jurisdiction(\n    `eu`\n  );"),
    // Allowed: the site's jurisdiction, read from configuration, and no jurisdiction at all.
    sample("src/site.ts", "const ns = env.STORE.jurisdiction(env.JURISDICTION);"),
    sample("src/plain.ts", "const id = env.PROBER.idFromName(region);"),
    sample("src/note.ts", '// never write env.STORE.jurisdiction("eu")\nexport {};'),
  ]);
  assert.deepEqual(found, [
    'src/eu.ts writes the jurisdiction "eu" into the code; read it from configuration, the site file\'s jurisdiction',
    'src/us.ts writes the jurisdiction "fedramp" into the code; read it from configuration, the site file\'s jurisdiction',
    'src/split.ts writes the jurisdiction "eu" into the code; read it from configuration, the site file\'s jurisdiction',
  ]);
});

const WRANGLER = JSON.stringify({
  name: "cfx-sample",
  main: "src/index.ts",
  send_email: [{ name: "ALERT" }],
  durable_objects: {
    bindings: [
      { name: "STORE", class_name: "ProjectStore" },
      { name: "PROBER", class_name: "Prober" },
    ],
  },
});

const DATA_MODEL = [
  "## Lifetimes",
  "",
  "| Store | Holds | Lifetime | Removed by |",
  "|---|---|---|---|",
  "| `ProjectStore` | events | 30 days | the daily sweep |",
  "| `Prober` | nothing | none | nothing |",
  "",
].join("\n");

const CONFIG = JSON.stringify({ sources: ["src"], slices: ["src/features"], migrations: [] });

const CLEAN = {
  "c-f-x.json": CONFIG,
  "wrangler.jsonc": WRANGLER,
  "docs/data-model.md": DATA_MODEL,
  "src/index.ts": [
    'import { verdict } from "./features/runs/index.ts";',
    'import { sendAlert } from "./mail.ts";',
    "export const handle = async (env) => {",
    '  const store = env.STORE.jurisdiction(env.JURISDICTION).idFromName("p");',
    '  const probe = env.PROBER.idFromName("weur");',
    "  await sendAlert(env.ALERT, verdict([true]));",
    "};",
    "export default {",
    "  async scheduled(c, env, ctx) {",
    '    ctx.waitUntil(job("sweep", () => handle(env)));',
    "  },",
    "};",
  ].join("\n"),
  "src/mail.ts": "export const sendAlert = (binding, text) => binding.send({ text });\n",
  "src/features/runs/index.ts": 'export { verdict } from "./core/verdict.ts";\n',
  "src/features/runs/core/verdict.ts":
    "export const verdict = (results) => results.filter(Boolean).length > results.length / 2;\n",
  "src/features/runs/core/verdict.test.ts": "const started = Date.now();\n",
};

test("c-f-x check architecture fails on a sample that breaks each rule", async () => {
  const repo = path.join(scope.dir, "flagged");
  writeFiles(repo, {
    ...CLEAN,
    "src/features/runs/core/verdict.ts":
      'export const verdict = (r) => {\n  if (r.length === 0) throw new Error("none");\n  return Date.now();\n};\n',
    "src/features/pages/http.ts": 'import { x } from "../runs/core/verdict.ts";\n',
    "src/features/pages/cache.ts": "let last = null;\n",
    "src/features/pages/notify.ts": "export const tell = (env) => env.ALERT.send({ text: 'x' });\n",
    "src/store-id.ts": 'export const id = (env) => env.STORE.jurisdiction("eu").idFromName("p");\n',
    "src/cron.ts":
      "export default {\n  async scheduled(c, env) {\n    await sweep(env);\n  },\n};\n",
  });
  const { code, stderr } = await runCli(["check", "architecture"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /src\/features\/runs\/core\/verdict\.ts throws/);
  assert.match(stderr, /src\/features\/runs\/core\/verdict\.ts reads a clock/);
  assert.match(stderr, /src\/features\/pages\/http\.ts imports \.\.\/runs\/core\/verdict\.ts/);
  assert.match(stderr, /src\/features\/pages\/cache\.ts keeps module-level mutable state/);
  assert.match(stderr, /src\/features\/pages\/notify\.ts sends through the email binding ALERT/);
  assert.match(stderr, /src\/store-id\.ts writes the jurisdiction "eu" into the code/);
  assert.match(stderr, /src\/cron\.ts runs sweep\( in its scheduled handler outside job/);
  assert.match(stderr, /check architecture: failed with 7 problems/);
});

test("c-f-x check architecture passes a sample that keeps every rule", async () => {
  const repo = path.join(scope.dir, "clean");
  writeFiles(repo, CLEAN);
  const { code, stdout, stderr } = await runCli(["check", "architecture"], repo, scope.dir);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /check architecture: passed/);
});

// D-11 ended the exemption for a Durable Object that keeps nothing: under the
// EU-only rule such a class could skip the jurisdiction. This holds that the
// exemption stays gone. The sample's lifetimes row says Prober keeps nothing,
// and a jurisdiction written into its code is still flagged.
test("c-f-x check architecture gives a Durable Object that keeps nothing no exemption", async () => {
  const repo = path.join(scope.dir, "keeps-nothing");
  writeFiles(repo, {
    ...CLEAN,
    "src/probe-id.ts":
      'export const id = (env) => env.PROBER.jurisdiction("eu").idFromName("weur");\n',
  });
  const { code, stderr } = await runCli(["check", "architecture"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /src\/probe-id\.ts writes the jurisdiction "eu" into the code/);
});

test("c-f-x check architecture fails without a c-f-x.json to say where the code is", async () => {
  const repo = path.join(scope.dir, "unconfigured");
  writeFiles(repo, { "wrangler.jsonc": WRANGLER, "src/index.ts": "export {};\n" });
  const { code, stderr } = await runCli(["check", "architecture"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /c-f-x\.json is missing/);
});
