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
      'c-f-x.json: unknown key "migration"; the keys are sources, slices, migrations, vendors',
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
    value: { sources: ["src"], slices: ["src/features"], migrations: [], vendors: [] },
  });
});

test("the layout config takes an optional list of the vendors a tool integrates, as names", () => {
  const folders = { sources: ["src"], slices: [], migrations: [] };
  assert.deepEqual(
    parseToolConfig(JSON.stringify({ ...folders, vendors: ["Acme Mail"] }), (p) => p === "src"),
    { ok: true, value: { ...folders, vendors: ["Acme Mail"] } },
  );
  assert.deepEqual(
    parseToolConfig(JSON.stringify({ ...folders, vendors: "Acme Mail" }), () => true),
    { ok: false, problems: ['c-f-x.json: "vendors" must be a list of names'] },
  );
});

test("the store list takes each binding once across blocks, and skips borrowed Durable Objects", () => {
  const read = parseWrangler(`{
    // A comment, and a trailing comma, as JSONC allows.
    "d1_databases": [{ "binding": "DB" }],
    "durable_objects": { "bindings": [
      { "name": "STORE", "class_name": "ProjectStore" },
      { "name": "OTHER", "class_name": "Other", "script_name": "cfx-other" },
    ] },
    "env": { "prod": { "d1_databases": [{ "binding": "DB" }], "kv_namespaces": [{ "binding": "CACHE" }] } },
  }`);
  assert.ok(read.ok);
  assert.deepEqual(storeBindings(read.value), [
    { kind: "D1 database", name: "DB" },
    { kind: "KV namespace", name: "CACHE" },
    { kind: "Durable Object class", name: "ProjectStore" },
  ]);
});
