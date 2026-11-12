import assert from "node:assert/strict";
import { test } from "node:test";
import { parseToolConfig, parseWrangler, storeBindings } from "./tool-config.ts";

test("the layout config flags unknown keys, missing lists and folders that do not exist", () => {
  const read = parseToolConfig(
    JSON.stringify({ sources: ["src", "gone"], slices: "src/features", migration: [] }),
    (p) => p === "src",
  );
  assert.deepEqual(read, {
    ok: false,
    problems: [
      'c-f-x.json: unknown key "migration"; the keys are sources, slices, migrations, vendors, worker',
      'c-f-x.json: "sources" names gone, which does not exist',
      'c-f-x.json: "slices" must be a list of folders',
      'c-f-x.json: "migrations" must be a list of folders',
    ],
  });
});

test("the layout config gives each folder as a plain repository path", () => {
  const read = parseToolConfig(
    JSON.stringify({ sources: ["./src/"], slices: ["src/features/"], migrations: [] }),
    () => true,
  );
  assert.deepEqual(read, {
    ok: true,
    value: {
      sources: ["src"],
      slices: ["src/features"],
      migrations: [],
      vendors: [],
      worker: ".",
    },
  });
});

const inWorker = (p: string) => p === "apps/worker" || p === "apps/worker/src";

test("the layout config names the Worker's folder, which is the root when left out", () => {
  const folders = { sources: ["apps/worker/src"], slices: [], migrations: [] };
  const exists = inWorker;
  assert.deepEqual(
    parseToolConfig(JSON.stringify({ ...folders, worker: "./apps/worker/" }), exists),
    { ok: true, value: { ...folders, vendors: [], worker: "apps/worker" } },
  );
  assert.deepEqual(parseToolConfig(JSON.stringify(folders), exists), {
    ok: true,
    value: { ...folders, vendors: [], worker: "." },
  });
  assert.deepEqual(parseToolConfig(JSON.stringify({ ...folders, worker: "apps/api" }), exists), {
    ok: false,
    problems: ['c-f-x.json: "worker" names apps/api, which does not exist'],
  });
  assert.deepEqual(
    parseToolConfig(JSON.stringify({ ...folders, worker: ["apps/worker"] }), exists),
    {
      ok: false,
      problems: ['c-f-x.json: "worker" must be one folder, the one that holds wrangler.jsonc'],
    },
  );
});

test("the layout config takes an optional list of the vendors a tool integrates, as names", () => {
  const folders = { sources: ["src"], slices: [], migrations: [] };
  assert.deepEqual(
    parseToolConfig(JSON.stringify({ ...folders, vendors: ["Acme Mail"] }), (p) => p === "src"),
    { ok: true, value: { ...folders, vendors: ["Acme Mail"], worker: "." } },
  );
  assert.deepEqual(
    parseToolConfig(JSON.stringify({ ...folders, vendors: "Acme Mail" }), () => true),
    { ok: false, problems: ['c-f-x.json: "vendors" must be a list of names'] },
  );
});

test("the store list takes each binding once across blocks, and skips borrowed Durable Objects", () => {
  const read = parseWrangler(
    `{
    // A comment, and a trailing comma, as JSONC allows.
    "d1_databases": [{ "binding": "DB" }],
    "durable_objects": { "bindings": [
      { "name": "STORE", "class_name": "ProjectStore" },
      { "name": "OTHER", "class_name": "Other", "script_name": "cfx-other" },
    ] },
    "env": { "prod": { "d1_databases": [{ "binding": "DB" }], "kv_namespaces": [{ "binding": "CACHE" }] } },
  }`,
    "wrangler.jsonc",
  );
  assert.ok(read.ok);
  assert.deepEqual(storeBindings(read.value), [
    { kind: "D1 database", name: "DB" },
    { kind: "KV namespace", name: "CACHE" },
    { kind: "Durable Object class", name: "ProjectStore" },
  ]);
});
