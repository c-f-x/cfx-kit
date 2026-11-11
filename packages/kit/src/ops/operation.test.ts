import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { writeFiles } from "../test-support/cli.ts";
import { git } from "../test-support/git.ts";
import {
  defineOperation,
  exitCodeOf,
  type OperationOptions,
  type OpStep,
  planText,
  runOperation,
} from "./operation.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

let made = 0;
/** A new folder inside this test file's scope. */
function folder(name: string): string {
  made += 1;
  const dir = path.join(scope.dir, `${String(made)}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The lines an operation printed, out and err together, in order. */
function capture(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

/**
 * Options for a run in `root`. Each run's own scope sits under this file's
 * scope, so its sweep sees only runs this file made.
 */
function options(root: string, go: boolean, out = capture()): OperationOptions {
  const runs = path.join(scope.dir, "runs");
  return {
    go,
    root,
    log: out.log,
    err: out.log,
    openScope: () => openRunScope({ root: runs }),
  };
}

/** A command step that writes `marker`, so a test can see whether it ran. */
function writes(name: string, marker: string): OpStep {
  return {
    name,
    command: process.execPath,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
    undo: `delete ${marker}`,
  };
}

/** A task step that writes `marker`. */
function taskWrites(name: string, marker: string): OpStep {
  return {
    name,
    does: `write ${marker}`,
    undo: `delete ${marker}`,
    task: async () => {
      writeFileSync(marker, "ran");
      return { ok: true };
    },
  };
}

const fails = (code: number): OpStep => ({
  name: `exits ${String(code)}`,
  command: process.execPath,
  args: ["-e", `process.exit(${String(code)})`],
  undo: "Nothing to undo: it changes nothing.",
});

// ── plan first ──────────────────────────────────────────────────────────────

test("without --go, the plan names every step and its undo, and nothing runs", async () => {
  const dir = folder("plan");
  const [command, task] = [path.join(dir, "command"), path.join(dir, "task")];
  const out = capture();
  const result = await runOperation(
    {
      name: "deploy",
      changesDeployment: false,
      steps: () => [writes("write by command", command), taskWrites("write by task", task)],
    },
    options(dir, false, out),
  );
  assert.deepEqual(result, { outcome: "planned", notes: [] });
  assert.equal(exitCodeOf(result), 0);
  assert.equal(existsSync(command), false, "the command step ran without --go");
  assert.equal(existsSync(task), false, "the task step ran without --go");
  const printed = out.lines.join("\n");
  assert.match(printed, /1\. write by command\n {3}runs: .+\n {3}undo: delete .+command/);
  assert.match(printed, /2\. write by task\n {3}does: write .+task\n {3}undo: delete .+task/);
  assert.match(printed, /Nothing ran\. Run again with --go/);
});

test("with --go, every step runs, in order, in the run's own scratch folder", async () => {
  const dir = folder("go");
  let scratch = "";
  const result = await runOperation(
    {
      name: "deploy",
      changesDeployment: false,
      steps: (run) => {
        scratch = run.scratch;
        return [
          writes("first", path.join(run.scratch, "a")),
          taskWrites("second", path.join(dir, "b")),
        ];
      },
    },
    options(dir, true),
  );
  assert.deepEqual(result, { outcome: "done" });
  assert.ok(existsSync(path.join(dir, "b")));
  assert.notEqual(scratch, "");
  assert.equal(existsSync(scratch), false, "the run's scratch folder is removed at the end");
});

// ── stop at the first failing step ──────────────────────────────────────────

test("a failing step stops the run, names its exit code, and the steps after it never run", async () => {
  const dir = folder("failing");
  const ran = path.join(dir, "ran");
  const afterCommand = path.join(dir, "after-command");
  const afterTask = path.join(dir, "after-task");
  const out = capture();
  const result = await runOperation(
    {
      name: "deploy",
      changesDeployment: false,
      steps: () => [
        writes("migrate", ran),
        fails(4),
        writes("deploy", afterCommand),
        taskWrites("check health", afterTask),
      ],
    },
    options(dir, true, out),
  );
  assert.deepEqual(result, {
    outcome: "failed",
    failed: { name: "exits 4", code: 4, reason: null },
    skipped: ["deploy", "check health"],
    toUndo: [
      { name: "exits 4", undo: "Nothing to undo: it changes nothing." },
      { name: "migrate", undo: `delete ${ran}` },
    ],
  });
  assert.equal(exitCodeOf(result), 1);
  assert.ok(existsSync(ran), "the step before the failure ran");
  assert.equal(existsSync(afterCommand), false, "a command after the failure ran");
  assert.equal(existsSync(afterTask), false, "a task after the failure ran");
  const printed = out.lines.join("\n");
  assert.match(printed, /"exits 4" failed with exit code 4/);
  assert.match(printed, /Not run: deploy, check health\./);
  assert.match(printed, /newest first:\n- exits 4: .+\n- migrate: delete /);
});

// ── every step names its undo ───────────────────────────────────────────────

test("a step without an undo is refused when the operation is defined", () => {
  const good = fails(0);
  assert.equal(defineOperation("deploy", [good]).ok, true);
  for (const undo of ["", "   "]) {
    assert.deepEqual(defineOperation("deploy", [good, { ...good, name: "bare", undo }]), {
      ok: false,
      errors: ['step 2 ("bare") names no undo'],
    });
  }
  // A caller in plain JavaScript can leave the field out altogether.
  const noField: OpStep = { ...good };
  Reflect.deleteProperty(noField, "undo");
  assert.deepEqual(defineOperation("deploy", [noField]), {
    ok: false,
    errors: ['step 1 ("exits 0") names no undo'],
  });
});

test("an operation with a step without an undo runs nothing and prints no plan", async () => {
  const dir = folder("no-undo");
  const marker = path.join(dir, "ran");
  const out = capture();
  const result = await runOperation(
    {
      name: "deploy",
      changesDeployment: false,
      steps: () => [writes("first", marker), { ...fails(0), undo: "" }],
    },
    options(dir, true, out),
  );
  assert.deepEqual(result, { outcome: "refused", reasons: ['step 2 ("exits 0") names no undo'] });
  assert.equal(existsSync(marker), false);
  assert.doesNotMatch(out.lines.join("\n"), /Plan for/);
});

test("the plan text shows each step's command or what its task does", () => {
  const defined = defineOperation("deploy", [fails(0), taskWrites("t", "/x")]);
  assert.ok(defined.ok);
  assert.equal(
    planText(defined.value),
    `1. exits 0\n   runs: ${process.execPath} -e process.exit(0)\n   undo: Nothing to undo: it changes nothing.\n2. t\n   does: write /x\n   undo: delete /x`,
  );
});

// ── a changing operation starts only from a clean checkout of origin/master ──

function commit(repo: string, file: string, text: string): void {
  writeFiles(repo, { [file]: text });
  git(repo, "add", file);
  git(repo, "commit", "--quiet", "-m", `write ${file}`);
}

/**
 * A sample remote with one commit on master, and a clone of it, both inside
 * this file's scope. Git is the fixture: the preconditions read what git says.
 */
function sampleCheckout(name: string): { remote: string; checkout: string } {
  const dir = folder(name);
  const remote = path.join(dir, "remote");
  const checkout = path.join(dir, "checkout");
  mkdirSync(remote);
  git(remote, "init", "--quiet", "--initial-branch=master");
  commit(remote, "README.md", "A sample tool.\n");
  git(dir, "clone", "--quiet", remote, checkout);
  return { remote, checkout };
}

/** A deploy whose one step writes a marker in the checkout's parent folder. */
async function deployFrom(checkout: string, go = true) {
  const marker = path.join(path.dirname(checkout), "deployed");
  const out = capture();
  const result = await runOperation(
    { name: "deploy", changesDeployment: true, steps: () => [writes("deploy", marker)] },
    options(checkout, go, out),
  );
  return { result, ran: existsSync(marker), printed: out.lines.join("\n") };
}

test("a clean checkout of current origin/master deploys", async () => {
  const { checkout } = sampleCheckout("clean");
  const { result, ran } = await deployFrom(checkout);
  assert.deepEqual(result, { outcome: "done" });
  assert.equal(ran, true);
});

test("a dirty tree stops a changing operation before step 1", async () => {
  const { checkout } = sampleCheckout("dirty");
  writeFiles(checkout, { "README.md": "Changed, not committed.\n" });
  const { result, ran, printed } = await deployFrom(checkout);
  assert.equal(result.outcome, "refused");
  assert.equal(ran, false, "step 1 ran from a dirty tree");
  assert.match(printed, /refused before step 1/);
  assert.match(printed, /the working tree has changes \( ?M README\.md\)/);
});

test("an untracked file also makes the tree dirty", async () => {
  const { checkout } = sampleCheckout("untracked");
  writeFiles(checkout, { "notes.txt": "x\n" });
  const { result, ran } = await deployFrom(checkout);
  assert.equal(result.outcome, "refused");
  assert.equal(ran, false);
});

test("a HEAD behind origin/master stops a changing operation, found by fetching first", async () => {
  const { remote, checkout } = sampleCheckout("behind");
  // The remote moves on after the clone. The checkout's own copy of
  // origin/master still equals its HEAD, so only a fetch shows it is behind.
  commit(remote, "CHANGELOG.md", "A newer commit.\n");
  const { result, ran, printed } = await deployFrom(checkout);
  assert.equal(result.outcome, "refused");
  assert.equal(ran, false, "step 1 ran from a HEAD behind origin/master");
  assert.match(printed, /HEAD is [0-9a-f]{12}, but origin\/master is [0-9a-f]{12}/);
});

test("a HEAD ahead of origin/master, with commits not merged, is refused too", async () => {
  const { checkout } = sampleCheckout("ahead");
  commit(checkout, "local.md", "Not merged.\n");
  const { result, ran } = await deployFrom(checkout);
  assert.equal(result.outcome, "refused");
  assert.equal(ran, false);
});

test("without --go, a dirty tree is a note on the plan, and nothing runs", async () => {
  const { checkout } = sampleCheckout("dirty-plan");
  writeFiles(checkout, { "README.md": "Changed.\n" });
  const { result, ran, printed } = await deployFrom(checkout, false);
  assert.equal(result.outcome, "planned");
  assert.equal(ran, false);
  assert.match(printed, /Note: --go would refuse: the working tree has changes/);
});

test("an operation that changes no deployment runs from any tree", async () => {
  const dir = folder("not-a-checkout");
  const marker = path.join(dir, "backed-up");
  const result = await runOperation(
    { name: "backup", changesDeployment: false, steps: () => [writes("backup", marker)] },
    options(dir, true),
  );
  assert.deepEqual(result, { outcome: "done" });
  assert.equal(existsSync(marker), true);
});
