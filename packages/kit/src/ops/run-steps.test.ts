import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runSteps } from "./run-steps.ts";

// Moved from scripts/check.test.mjs with the runner, ported from
// cfanalytics:scripts/check.test.mjs.

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

const node = (code: string) => ({ command: process.execPath, args: ["-e", code] });
const quiet = { log: () => {} };

test("a step made to fail stops the run before anything after it runs", async () => {
  // A marker file exists only if the step after the failure ran.
  const marker = path.join(scope.dir, "command-marker");
  const result = await runSteps(
    [
      { name: "passes", ...node("process.exit(0)") },
      { name: "fails", ...node("process.exit(3)") },
      {
        name: "must not run",
        ...node(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`),
      },
    ],
    quiet,
  );
  assert.deepEqual(result, {
    ok: false,
    failed: { name: "fails", code: 3, reason: null },
    skipped: ["must not run"],
  });
  assert.equal(existsSync(marker), false);
});

test("a failing task stops the run with its reason, and counts as exit code 1", async () => {
  const marker = path.join(scope.dir, "task-marker");
  const result = await runSteps(
    [
      { name: "finds a fault", task: async () => ({ ok: false, reason: "the bundles differ" }) },
      {
        name: "must not run",
        task: async () => {
          writeFileSync(marker, "ran");
          return { ok: true };
        },
      },
    ],
    quiet,
  );
  assert.deepEqual(result, {
    ok: false,
    failed: { name: "finds a fault", code: 1, reason: "the bundles differ" },
    skipped: ["must not run"],
  });
  assert.equal(existsSync(marker), false);
});

test("a task that throws fails like one that says so", async () => {
  const result = await runSteps(
    [
      {
        name: "throws",
        task: async () => {
          throw new Error("no such folder");
        },
      },
      { name: "must not run", task: async () => ({ ok: true }) },
    ],
    quiet,
  );
  assert.deepEqual(result, {
    ok: false,
    failed: { name: "throws", code: 1, reason: "no such folder" },
    skipped: ["must not run"],
  });
});

test("a run where every step passes reports ok", async () => {
  const result = await runSteps(
    [
      { name: "passes", ...node("process.exit(0)") },
      { name: "task passes", task: async () => ({ ok: true }) },
    ],
    quiet,
  );
  assert.deepEqual(result, { ok: true });
});

test("a command that cannot start counts as a failure", async () => {
  const result = await runSteps(
    [{ name: "missing", command: path.join(scope.dir, "no-such-command"), args: [] }],
    quiet,
  );
  if (result.ok) assert.fail("a command that cannot start passed");
  assert.equal(result.failed.name, "missing");
  assert.equal(result.failed.code, 127);
});

test("a command step runs in its folder with its added variables", async () => {
  const marker = path.join(scope.dir, "env-marker");
  const code = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.cwd() + "|" + process.env.CFX_STEP_TEST)`;
  const result = await runSteps(
    [{ name: "writes", ...node(code), cwd: scope.dir, env: { CFX_STEP_TEST: "set" } }],
    quiet,
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(readFileSync(marker, "utf8"), `${realpathSync(scope.dir)}|set`);
});
