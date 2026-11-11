import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "./run-scope.ts";
import { runCli } from "./test-support/cli.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

test("an unknown check exits non-zero and lists the known checks", async () => {
  const { code, stderr } = await runCli(["check", "nope"], scope.dir, scope.dir);
  assert.equal(code, 2);
  assert.match(stderr, /unknown check "nope"/);
  assert.match(stderr, /docs +docs name only paths that exist/);
  assert.match(stderr, /run-scope +a run leaves nothing behind/);
});

test("check without a name exits non-zero and lists the known checks", async () => {
  const { code, stderr } = await runCli(["check"], scope.dir, scope.dir);
  assert.equal(code, 2);
  assert.match(stderr, /usage: c-f-x check <name>/);
  assert.match(stderr, /c-f-x lock-migrations +adds new schema steps to migrations\.lock\.json/);
  for (const name of [
    "docs",
    "run-scope",
    "architecture",
    "layout",
    "lifetimes",
    "migrations",
    "wrangler-config",
  ])
    assert.match(stderr, new RegExp(`\\n  ${name} +`));
});

test("an unknown command exits non-zero with the usage", async () => {
  const { code, stderr } = await runCli(["deploy"], scope.dir, scope.dir);
  assert.equal(code, 2);
  assert.match(stderr, /usage: c-f-x check <name>/);
});
