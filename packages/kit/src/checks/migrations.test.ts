import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import { commitAsMainLine, initRepo } from "../test-support/git.ts";
import { addNewSteps, baseViolations, hashOf, LOCK_FILE, lockViolations } from "./migrations.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

test("the lock check flags an edited, missing, unlocked or out-of-order step", () => {
  const locked = { "m/0001-a.sql": "h1", "m/0003-c.sql": "h3" };
  const now = { "m/0001-a.sql": "changed", "m/0002-b.sql": "h2" };
  assert.deepEqual(lockViolations(locked, now), [
    "m/0001-a.sql changed after it was locked; add a new step instead",
    "m/0003-c.sql is locked but missing",
    "m/0002-b.sql is not locked; run c-f-x lock-migrations",
    "m/0002-b.sql sorts before the locked m/0003-c.sql",
  ]);
});

test("the base check flags a lock entry the branch changed or removed", () => {
  assert.deepEqual(
    baseViolations({ "m/0001-a.sql": "h1", "m/0002-b.sql": "h2" }, { "m/0001-a.sql": "h9" }),
    [
      "m/0001-a.sql was locked on the main line and its lock entry changed",
      "m/0002-b.sql was locked on the main line and its lock entry changed",
    ],
  );
});

test("locking adds new steps and never changes a locked one", () => {
  const { lock, added } = addNewSteps(
    { "m/0001-a.sql": "h1" },
    { "m/0001-a.sql": "edited", "m/0002-b.sql": "h2" },
  );
  assert.deepEqual(lock, { "m/0001-a.sql": "h1", "m/0002-b.sql": "h2" });
  assert.deepEqual(added, ["m/0002-b.sql"]);
});

const FIRST = "CREATE TABLE checks (id TEXT PRIMARY KEY);\n";
const SECOND = "CREATE TABLE results (check_id TEXT, at INTEGER);\n";

// A tool repository whose main line has two locked steps, one in each folder.
async function lockedRepo(name: string): Promise<string> {
  const repo = path.join(scope.dir, name);
  writeFiles(repo, {
    "c-f-x.json": JSON.stringify({
      sources: [],
      slices: [],
      migrations: ["migrations", "src/schema"],
    }),
    "migrations/0001_checks.sql": FIRST,
    "src/schema/0001_results.sql": SECOND,
  });
  initRepo(repo);
  const locked = await runCli(["lock-migrations"], repo, scope.dir);
  assert.equal(locked.code, 0, locked.stderr);
  assert.match(
    locked.stdout,
    /locked: migrations\/0001_checks\.sql, src\/schema\/0001_results\.sql/,
  );
  commitAsMainLine(repo, [
    "c-f-x.json",
    "migrations/0001_checks.sql",
    "src/schema/0001_results.sql",
    LOCK_FILE,
  ]);
  return repo;
}

test("c-f-x lock-migrations writes each step's hash and keeps what is locked", async () => {
  const repo = await lockedRepo("lock");
  const lock: unknown = JSON.parse(readFileSync(path.join(repo, LOCK_FILE), "utf8"));
  assert.deepEqual(lock, {
    "migrations/0001_checks.sql": hashOf(FIRST),
    "src/schema/0001_results.sql": hashOf(SECOND),
  });
  writeFiles(repo, { "migrations/0001_checks.sql": `${FIRST}-- edited\n` });
  const again = await runCli(["lock-migrations"], repo, scope.dir);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /no new steps/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(repo, LOCK_FILE), "utf8")), lock);
});

test("c-f-x check migrations fails on a sample whose applied step changed", async () => {
  const repo = await lockedRepo("edited");
  writeFiles(repo, {
    "migrations/0001_checks.sql": "CREATE TABLE checks (id TEXT PRIMARY KEY, name TEXT);\n",
    "migrations/0002_keys.sql": "CREATE TABLE keys (id TEXT);\n",
  });
  const { code, stderr } = await runCli(["check", "migrations"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /migrations\/0001_checks\.sql changed after it was locked/);
  assert.match(stderr, /migrations\/0002_keys\.sql is not locked; run c-f-x lock-migrations/);
  assert.match(stderr, /check migrations: failed with 2 problems/);
});

test("c-f-x check migrations fails when the lock was edited to match a changed step", async () => {
  const repo = await lockedRepo("relocked");
  const edited = "CREATE TABLE checks (id TEXT PRIMARY KEY, name TEXT);\n";
  writeFiles(repo, {
    "migrations/0001_checks.sql": edited,
    [LOCK_FILE]: JSON.stringify({
      "migrations/0001_checks.sql": hashOf(edited),
      "src/schema/0001_results.sql": hashOf(SECOND),
    }),
  });
  const { code, stderr } = await runCli(["check", "migrations"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(
    stderr,
    /migrations\/0001_checks\.sql was locked on the main line and its lock entry changed/,
  );
});

test("c-f-x check migrations passes a sample with a new step locked", async () => {
  const repo = await lockedRepo("clean");
  writeFiles(repo, { "migrations/0002_keys.sql": "CREATE TABLE keys (id TEXT);\n" });
  const locked = await runCli(["lock-migrations"], repo, scope.dir);
  assert.equal(locked.code, 0, locked.stderr);
  const { code, stdout, stderr } = await runCli(["check", "migrations"], repo, scope.dir);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /check migrations: passed/);
});

test("c-f-x check migrations fails when it cannot find the main line", async () => {
  const repo = path.join(scope.dir, "no-main-line");
  writeFiles(repo, { "c-f-x.json": JSON.stringify({ sources: [], slices: [], migrations: [] }) });
  initRepo(repo);
  const { code, stderr } = await runCli(["check", "migrations"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /cannot find where this branch left origin\/master/);
});
