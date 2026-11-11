import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import { lifetimesTable, lifetimeViolations, tablesOf } from "./lifetimes.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

const table = (...rows: string[]) =>
  [
    "# Data model",
    "",
    "## Lifetimes",
    "",
    "One row per store.",
    "",
    "| Store | Holds | Lifetime | Removed by |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Other",
    "",
    "| Store | Holds | Lifetime | Removed by |",
    "|---|---|---|---|",
    "| `later` | x | x | x |",
    "",
  ].join("\n");

test("the table reader takes the rows under Lifetimes and flags a malformed row", () => {
  const read = lifetimesTable(
    "docs/data-model.md",
    table(
      "| `DB` | the registry | as long as the tool runs | uninstall |",
      "| `results` | one row per check run | 30 days | the daily sweep |",
      "| results | x | x | x |",
      "| `alerts` | sent alerts | | the daily sweep |",
      "| `DB` | again | x | x |",
      "| `keys` | x | x |",
    ),
  );
  assert.deepEqual(
    read?.rows.map((r) => r.store),
    ["DB", "results", "alerts", "DB"],
  );
  assert.deepEqual(read?.problems, [
    'docs/data-model.md: the lifetimes row "| results | x | x | x |" must name its store in backticks',
    "docs/data-model.md: the lifetimes row for `alerts` has an empty cell",
    "docs/data-model.md: `DB` has two lifetimes rows",
    'docs/data-model.md: the lifetimes row "| `keys` | x | x |" has 3 cells, not 4',
  ]);
});

test("the table reader flags other columns, and finds no table without the heading", () => {
  assert.deepEqual(
    lifetimesTable("d.md", "## Lifetimes\n\n| Table | Lifetime |\n|---|---|\n")?.problems,
    [
      "d.md: the lifetimes table's columns must be Store | Holds | Lifetime | Removed by, not Table | Lifetime",
    ],
  );
  assert.equal(
    lifetimesTable("d.md", "## Stores\n\n| Store | Holds | Lifetime | Removed by |\n"),
    null,
  );
  assert.equal(lifetimesTable("d.md", "## Lifetimes\n\nNone yet.\n\n## Next\n\n| a |\n"), null);
});

test("the table scan follows the steps: created, quoted, renamed and dropped", () => {
  const tables = tablesOf([
    [
      "-- CREATE TABLE commented (id);",
      "CREATE TABLE checks (id TEXT);",
      'CREATE TABLE IF NOT EXISTS "check_state" (id TEXT);',
      "create table `results` (id TEXT);--> statement-breakpoint",
      "CREATE VIRTUAL TABLE notes_fts USING fts5(text);",
      "CREATE TEMP TABLE scratch (id);",
      "CREATE TABLE main.[keys] (id);",
    ].join("\n"),
    "ALTER TABLE checks RENAME TO monitors;\nDROP TABLE IF EXISTS notes_fts;\nCREATE TABLE old (id);",
    "DROP TABLE old;",
  ]);
  assert.deepEqual(tables, ["check_state", "results", "keys", "monitors"]);
});

test("the lifetimes check flags a store without a row and a row without a store", () => {
  const rows = ["DB", "Prober", "results", "gone"].map((store) => ({
    store,
    holds: "x",
    lifetime: "x",
    removedBy: "x",
  }));
  const found = lifetimeViolations(
    "docs/data-model.md",
    rows,
    [
      { kind: "D1 database", name: "DB" },
      { kind: "R2 bucket", name: "BLOBS" },
      { kind: "Durable Object class", name: "Prober" },
    ],
    ["results", "alerts"],
  );
  assert.deepEqual(found, [
    "docs/data-model.md: the R2 bucket `BLOBS` in wrangler.jsonc has no lifetimes row",
    "docs/data-model.md: the table `alerts` in the migrations has no lifetimes row",
    "docs/data-model.md: the lifetimes row `gone` names no binding or table",
  ]);
});

const WRANGLER = `{
  "name": "cfx-sample",
  "d1_databases": [{ "binding": "DB", "jurisdiction": "eu" }],
  "kv_namespaces": [{ "binding": "CACHE" }],
  "durable_objects": {
    "bindings": [
      { "name": "PROBER", "class_name": "Prober" },
      // Defined by another Worker, whose repository says what it keeps.
      { "name": "OTHER", "class_name": "Other", "script_name": "cfx-other" }
    ]
  },
  "env": { "demo": { "r2_buckets": [{ "binding": "BLOBS", "jurisdiction": "eu" }] } }
}`;

const SAMPLE = {
  "c-f-x.json": JSON.stringify({ sources: [], slices: [], migrations: ["migrations"] }),
  "wrangler.jsonc": WRANGLER,
  "migrations/0001_init.sql": "CREATE TABLE checks (id TEXT);\nCREATE TABLE results (id TEXT);\n",
  "migrations/0002_alerts.sql": "CREATE TABLE alerts (id TEXT);\n",
};

const ROWS = [
  "| `DB` | the registry | as long as the tool runs | uninstall |",
  "| `CACHE` | rendered pages | 60 seconds | its expiry |",
  "| `BLOBS` | exports | 7 days | a lifecycle rule |",
  "| `Prober` | nothing | none | nothing |",
  "| `checks` | the settings | as long as the check is set | apply |",
  "| `results` | one row per run | 30 days | the daily sweep |",
  "| `alerts` | sent alerts | 90 days | the daily sweep |",
];

test("c-f-x check lifetimes fails on a sample with a store that has no row", async () => {
  const repo = path.join(scope.dir, "flagged");
  writeFiles(repo, {
    ...SAMPLE,
    "docs/data-model.md": table(...ROWS.filter((r) => !/`(BLOBS|alerts)`/.test(r))),
  });
  const { code, stderr } = await runCli(["check", "lifetimes"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /the R2 bucket `BLOBS` in wrangler\.jsonc has no lifetimes row/);
  assert.match(stderr, /the table `alerts` in the migrations has no lifetimes row/);
  assert.match(stderr, /check lifetimes: failed with 2 problems/);
});

test("c-f-x check lifetimes passes a sample where every store has its row", async () => {
  const repo = path.join(scope.dir, "clean");
  writeFiles(repo, { ...SAMPLE, "docs/data-model.md": table(...ROWS) });
  const { code, stdout, stderr } = await runCli(["check", "lifetimes"], repo, scope.dir);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /check lifetimes: passed/);
});

test("c-f-x check lifetimes fails when the data model has no lifetimes table", async () => {
  const repo = path.join(scope.dir, "no-table");
  writeFiles(repo, { ...SAMPLE, "docs/data-model.md": "# Data model\n\nTo be written.\n" });
  const { code, stderr } = await runCli(["check", "lifetimes"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /docs\/data-model\.md: has no table under "## Lifetimes"/);
});
