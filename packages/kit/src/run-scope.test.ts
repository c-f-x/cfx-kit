import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { openRunScope, processStartTime, sweepDeadRuns } from "./run-scope.ts";

// This test file's own root. It is created here and removed here, so the
// sweeps below act only on folders this file made.
const ROOT = path.join(os.tmpdir(), `c-f-x-run-scope-test-${randomUUID()}`);
const BIN = path.join(ROOT, "bin");
mkdirSync(BIN, { recursive: true });
after(() => rmSync(ROOT, { recursive: true, force: true }));

// Processes a failing test might leave running. Each test that starts one adds
// it here, so a failure still leaves nothing behind.
const strays: number[] = [];
const stopAfterTests = (pid: number) => strays.push(pid);
after(() => {
  for (const pid of strays) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, as it should be.
    }
  }
});

// Moves a folder into this test's own bin instead of the owner's Trash. The
// sweep still really moves it; only the destination differs.
function trashIntoBin(target: string): void {
  renameSync(target, path.join(BIN, randomUUID()));
}

const RUN_SCOPE = new URL("./run-scope.ts", import.meta.url).href;

// A shell, started as the leader of its own process group, that starts a long
// sleep in the background and prints the sleep's pid. With `leaderStays` the
// shell waits for the sleep; without, it exits at once and leaves the sleep
// behind, as a launcher script does when it starts a server and returns.
// wrangler dev is like this: the server it starts outlives a killed parent.
const GROUP_SCRIPT = {
  leaderStays: "sleep 600 >/dev/null 2>&1 & echo $!; wait",
  leaderExits: "sleep 600 >/dev/null 2>&1 & echo $!",
};

type ChildRun = { child: ChildProcess; dir: string; sleeper: number; grandchild: number };

// A child run: opens a scope under `root`, starts a long sleep it records as
// its own process, and a process group with a grandchild sleep it records as
// a group. Prints both pids and waits to be killed.
function startChildRun(root: string): Promise<ChildRun> {
  const code = `
    import { spawn } from "node:child_process";
    import { openRunScope } from ${JSON.stringify(RUN_SCOPE)};
    const scope = openRunScope({ root: ${JSON.stringify(root)}, trash: () => {} });
    const sleeper = spawn("sleep", ["600"], { stdio: "ignore" });
    scope.recordChild(sleeper.pid);
    const group = spawn("sh", ["-c", ${JSON.stringify(GROUP_SCRIPT.leaderStays)}], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    scope.recordChild(group.pid, { group: true });
    group.stdout.once("data", (chunk) => {
      const grandchild = Number(String(chunk).trim());
      console.log(JSON.stringify({ dir: scope.dir, sleeper: sleeper.pid, grandchild }));
    });
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const line = out.split("\n")[0] ?? "";
      if (out.includes("\n")) resolve({ child, ...JSON.parse(line) });
    });
    child.once("exit", (exit) => reject(new Error(`child run exited early with ${exit}`)));
  });
}

// A killed process this test did not start sends no event here, so its end is
// seen by asking until it is gone. The timeout catches a hang.
async function gone(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processStartTime(pid) !== null) {
    if (Date.now() > deadline) return false;
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
}

function pidOf(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error("the process did not start");
  return child.pid;
}

test("a run killed part-way leaves nothing after the next run", async () => {
  const root = path.join(ROOT, "killed");
  const { child, dir, sleeper, grandchild } = await startChildRun(root);
  stopAfterTests(grandchild);
  assert.ok(existsSync(dir), "the child run created its scope");
  assert.notEqual(processStartTime(sleeper), null, "the child's process runs");

  child.removeAllListeners("exit");
  child.kill("SIGKILL");
  await waitForExit(child);
  assert.ok(existsSync(dir), "a killed run cannot clean up after itself");

  const next = openRunScope({ root, trash: trashIntoBin });
  assert.deepEqual(next.swept, [dir]);
  assert.equal(existsSync(dir), false, "the next run swept the dead run's folder");
  assert.ok(await gone(sleeper), "the next run stopped the dead run's process");
  assert.ok(await gone(grandchild), "the next run stopped every process in the dead run's group");

  assert.deepEqual((await next.close()).leftovers, []);
  assert.deepEqual(readdirSync(root), [], "nothing is left under the root");
});

test("a run that ends normally removes its own folder and processes", async () => {
  const root = path.join(ROOT, "normal");
  const scope = openRunScope({ root, trash: trashIntoBin });
  const sleeper = spawn("sleep", ["600"], { stdio: "ignore" });
  scope.recordChild(pidOf(sleeper));
  assert.ok(existsSync(scope.dir));

  assert.deepEqual((await scope.close()).leftovers, []);
  assert.equal(existsSync(scope.dir), false);
  assert.equal(processStartTime(pidOf(sleeper)), null);
});

// Starts a process group whose leader exits at once, leaving its grandchild
// sleep running. Resolves with the leader's and the grandchild's pids.
function startLeftBehindGroup(): Promise<{ leader: number; grandchild: number }> {
  const leader = spawn("sh", ["-c", GROUP_SCRIPT.leaderExits], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return new Promise((resolve) => {
    leader.stdout.once("data", (chunk) => {
      resolve({ leader: pidOf(leader), grandchild: Number(String(chunk).trim()) });
    });
  });
}

test("a run that ends normally stops a recorded group's processes, even after its leader exited", async () => {
  const root = path.join(ROOT, "group");
  const scope = openRunScope({ root, trash: trashIntoBin });
  const { leader, grandchild } = await startLeftBehindGroup();
  stopAfterTests(grandchild);
  scope.recordChild(leader, { group: true });
  assert.ok(await gone(leader), "the leader exits on its own");
  assert.notEqual(processStartTime(grandchild), null, "its grandchild still runs");

  assert.deepEqual((await scope.close()).leftovers, []);
  assert.ok(await gone(grandchild), "closing the scope stopped the grandchild");
});

test("a live run's folder is never swept", async () => {
  const root = path.join(ROOT, "live");
  const first = openRunScope({ root, trash: trashIntoBin });
  const second = openRunScope({ root, trash: trashIntoBin });
  assert.deepEqual(second.swept, []);
  assert.ok(existsSync(first.dir));
  await first.close();
  await second.close();
});

test("a recorded pid now used by another process is not killed", () => {
  const root = path.join(ROOT, "reused");
  const killed: number[] = [];
  const scope = openRunScope({ root, trash: trashIntoBin });
  // Pretend the run died and its child's pid now belongs to this test process,
  // which started at a different time than the one recorded.
  scope.recordChild(process.pid);
  const swept = sweepDeadRuns(root, {
    startTimeOf: (pid) => (pid === process.pid ? "a different start time" : null),
    trash: trashIntoBin,
    kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(swept, [scope.dir]);
  assert.deepEqual(killed, []);
});

test("a recorded group whose leader pid is now another process's is not killed", () => {
  const root = path.join(ROOT, "reused-group");
  const killed: number[] = [];
  const scope = openRunScope({ root, trash: trashIntoBin });
  scope.recordChild(process.pid, { group: true });
  const swept = sweepDeadRuns(root, {
    startTimeOf: (pid) => (pid === process.pid ? "a different start time" : null),
    trash: trashIntoBin,
    kill: (pid) => killed.push(pid),
    groupAlive: () => true,
  });
  assert.deepEqual(swept, [scope.dir]);
  assert.deepEqual(killed, []);
});

// Runs `code` as an ES module in a child process and resolves to its exit code.
function runModule(code: string): Promise<number | null> {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  return new Promise((resolve) => child.once("exit", (exitCode) => resolve(exitCode)));
}

test("a sweep that meets a folder removed under it skips it, and does not throw", () => {
  const root = path.join(ROOT, `vanish-${randomUUID()}`);
  const dead = path.join(root, randomUUID());
  mkdirSync(dead, { recursive: true });
  // A run that is long gone: no process has this pid with this start time.
  writeFileSync(
    path.join(dead, "owner.json"),
    JSON.stringify({ pid: 2_147_483_000, startedAt: "never", children: [] }),
  );
  // Another run removes the folder between the sweep's listing and its trash.
  const swept = sweepDeadRuns(root, {
    trash: (target) => {
      rmSync(target, { recursive: true, force: true });
      throw new Error(`trash: ${target}: no such file or directory`);
    },
  });
  assert.deepEqual(swept, []);
});

test("a sweep leaves alone a folder its live run is closing, and sweeps a dead run's", () => {
  const root = path.join(ROOT, `closing-${randomUUID()}`);
  // A closing run renames its folder to ".closing-<pid>-<id>" before it removes it.
  const live = path.join(root, `.closing-${process.pid}-${randomUUID()}`);
  const dead = path.join(root, `.closing-2147483000-${randomUUID()}`);
  mkdirSync(live, { recursive: true });
  mkdirSync(dead, { recursive: true });
  const swept = sweepDeadRuns(root, { trash: trashIntoBin });
  assert.deepEqual(swept, [dead]);
  assert.ok(existsSync(live), "the closing run's folder is still there");
});

test("runs that open and close scopes at the same time never fail", async () => {
  const root = path.join(ROOT, `busy-${randomUUID()}`);
  const bin = path.join(ROOT, `busy-bin-${randomUUID()}`);
  mkdirSync(bin, { recursive: true });
  const code = `
    import { randomUUID } from "node:crypto";
    import { renameSync } from "node:fs";
    import path from "node:path";
    import { openRunScope } from ${JSON.stringify(RUN_SCOPE)};
    const trash = (target) => renameSync(target, path.join(${JSON.stringify(bin)}, randomUUID()));
    for (let i = 0; i < 60; i += 1) {
      const scope = openRunScope({ root: ${JSON.stringify(root)}, trash });
      const { leftovers } = await scope.close();
      if (leftovers.length > 0) process.exit(3);
    }
  `;
  const codes = await Promise.all([1, 2, 3, 4].map(() => runModule(code)));
  assert.deepEqual(codes, [0, 0, 0, 0]);
  assert.deepEqual(readdirSync(bin), [], "no live run's folder was swept");
});

test("a sweep never takes the folder of a live run that is recording processes", async () => {
  const root = path.join(ROOT, `recording-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  const stop = path.join(root, "..", `recording-stop-${randomUUID()}`);
  // The live run records the same long sleep over and over, so its owner file
  // is rewritten while this test sweeps the root beside it.
  const code = `
    import { spawn } from "node:child_process";
    import { existsSync } from "node:fs";
    import { openRunScope } from ${JSON.stringify(RUN_SCOPE)};
    const scope = openRunScope({ root: ${JSON.stringify(root)}, trash: () => {} });
    const sleeper = spawn("sleep", ["600"], { stdio: "ignore" });
    let i = 0;
    while (!existsSync(${JSON.stringify(stop)})) {
      scope.recordChild(sleeper.pid);
      i += 1;
      if (i % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    const { leftovers } = await scope.close();
    process.exit(leftovers.length === 0 ? 0 : 3);
  `;
  const exited = runModule(code);
  // Wait for the live run's folder to appear, by looking, not by a fixed time.
  while (readdirSync(root).filter((n) => !n.startsWith(".")).length === 0) {
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }
  const taken: string[] = [];
  for (let i = 0; i < 200; i += 1) taken.push(...sweepDeadRuns(root, { trash: trashIntoBin }));
  writeFileSync(stop, "");
  const exitCode = await exited;
  rmSync(stop, { force: true });
  assert.deepEqual(taken, [], "the live run's folder was swept");
  assert.equal(exitCode, 0);
});
