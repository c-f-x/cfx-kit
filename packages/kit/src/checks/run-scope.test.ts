import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, processStartTime, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

// Processes a failing test might leave running, stopped after the tests.
const strays: number[] = [];
after(() => {
  for (const pid of strays) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, as it should be.
    }
  }
});

// A sample repository of this test's own, inside its scope. Git is the
// project's fixture here: the check reads what git counts as untracked.
function sampleRepo(name: string): string {
  const repo = path.join(scope.dir, name);
  writeFiles(repo, { "README.md": "A sample.\n" });
  execFileSync("git", ["init", "--quiet", repo]);
  return repo;
}

const node = (code: string) => ["--", process.execPath, "-e", code];
const RUN_SCOPE = new URL("../run-scope.ts", import.meta.url).href;

async function checkIn(repo: string, command: string[]) {
  return runCli(["check", "run-scope", ...command], repo, scope.dir);
}

test("c-f-x check run-scope flags a file left in the run's temp folder", async () => {
  const repo = sampleRepo("temp-leftover");
  const leaves = `require("node:fs").writeFileSync(require("node:path").join(require("node:os").tmpdir(), "left-behind.txt"), "x")`;
  const { code, stderr } = await checkIn(repo, node(leaves));
  assert.equal(code, 1);
  assert.match(stderr, /left in the temp folder: left-behind\.txt/);
});

test("c-f-x check run-scope flags a file left in the repository", async () => {
  const repo = sampleRepo("repo-leftover");
  const { code, stderr } = await checkIn(
    repo,
    node(`require("node:fs").writeFileSync("stray.log", "x")`),
  );
  assert.equal(code, 1);
  assert.match(stderr, /left in the repository: stray\.log/);
});

test("c-f-x check run-scope flags a process left running, and stops it", async () => {
  const repo = sampleRepo("process-leftover");
  const { code, stdout, stderr } = await checkIn(repo, [
    "--",
    "sh",
    "-c",
    "sleep 600 >/dev/null 2>&1 & echo $!",
  ]);
  const sleeper = Number(stdout.trim());
  strays.push(sleeper);
  assert.ok(Number.isInteger(sleeper) && sleeper > 0, `the sample printed its pid: ${stdout}`);
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`left running: process ${sleeper}`));
  assert.equal(processStartTime(sleeper), null, "the check stopped what the run left");
});

test("c-f-x check run-scope flags a run that fails", async () => {
  const repo = sampleRepo("failing");
  const { code, stderr } = await checkIn(repo, node("process.exit(3)"));
  assert.equal(code, 1);
  assert.match(stderr, /the run exited with code 3/);
});

test("c-f-x check run-scope passes a run that opens and closes its own scope", async () => {
  const repo = sampleRepo("clean");
  const code = `
    import { writeFileSync } from "node:fs";
    import path from "node:path";
    import { openRunScope } from ${JSON.stringify(RUN_SCOPE)};
    const scope = openRunScope();
    writeFileSync(path.join(scope.dir, "work.txt"), "x");
    const { leftovers } = await scope.close();
    if (leftovers.length > 0) process.exit(9);
  `;
  const result = await checkIn(repo, ["--", process.execPath, "--input-type=module", "-e", code]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /check run-scope: passed/);
});

test("c-f-x check run-scope refuses a folder that is not a git repository", async () => {
  const folder = path.join(scope.dir, "not-a-repo");
  mkdirSync(folder);
  // Git stops looking at the scope, so a repository further up cannot count.
  const { code, stderr } = await runCli(["check", "run-scope", ...node("")], folder, scope.dir, {
    GIT_CEILING_DIRECTORIES: scope.dir,
  });
  assert.equal(code, 1);
  assert.match(stderr, /not a git repository/);
});
