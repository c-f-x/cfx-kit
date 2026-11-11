import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { writeFiles } from "../test-support/cli.ts";
import { bundleDifferences, bundleFiles, sameBundleStep } from "./bundle.ts";

// Ported from "two builds are the same only when every file and name
// matches" in cfanalytics:scripts/ops.test.mjs.

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

/** A bundle folder made in this file's scope from `files`. */
function make(name: string, files: Record<string, string>): string {
  const dir = path.join(scope.dir, name);
  writeFiles(dir, files);
  return dir;
}

const log = () => {};

const CHECKED = { "index.js": "a", "sub/x.sql": "b" };

function differences(files: Record<string, string>, name: string): string[] {
  return bundleDifferences(
    bundleFiles(make(`checked-${name}`, CHECKED)),
    bundleFiles(make(name, files)),
  );
}

test("two bundles are the same only when every file and name matches", () => {
  assert.deepEqual(differences({ "sub/x.sql": "b", "index.js": "a" }, "same"), []);
  assert.deepEqual(differences({ "index.js": "a!", "sub/x.sql": "b" }, "changed"), [
    "changed: index.js",
  ]);
  assert.deepEqual(differences({ "main.js": "a", "sub/x.sql": "b" }, "renamed"), [
    "only in the checked bundle: index.js",
    "only in the shipped bundle: main.js",
  ]);
  assert.deepEqual(differences({ ...CHECKED, y: "" }, "extra"), ["only in the shipped bundle: y"]);
});

test("the notes wrangler writes beside a bundle, and does not upload, are left out", () => {
  // They hold the output folder's own path, so they differ between two folders of one build.
  const notes = { ...CHECKED, "README.md": "/x", "index.js.map": "/x", "sub/README.md": "/x" };
  assert.deepEqual(differences(notes, "notes"), []);
});

test("the step passes when the shipped bundle is the checked one, and names the difference when not", async () => {
  const checked = make("step-checked", CHECKED);
  const same = sameBundleStep(checked, make("step-same", CHECKED));
  const changed = sameBundleStep(checked, make("step-changed", { ...CHECKED, "index.js": "z" }));
  assert.ok("task" in same && "task" in changed);
  assert.deepEqual(await same.task(log), { ok: true });
  assert.deepEqual(await changed.task(log), {
    ok: false,
    reason: "the shipped bundle differs from the checked one: changed: index.js",
  });
});
