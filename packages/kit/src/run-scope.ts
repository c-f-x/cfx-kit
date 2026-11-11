import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

// A run scope is the one place a run (tests, a script, a local server) keeps
// what it creates. The run removes it on every ending it can see. A run that is
// killed outright cannot clean up, so every new run first sweeps the scopes of
// runs that died: it stops the processes they recorded and moves their folders
// to the Trash. Ported from cfanalytics:scripts/lib/run-scope.mjs.

/** The name of the folder under the system temp folder that holds every run's scope. */
export const RUNS_FOLDER = "c-f-x-runs";

/** Where run scopes live by default. Read when called, so it follows `TMPDIR`. */
export function defaultRunsRoot(): string {
  return path.join(os.tmpdir(), RUNS_FOLDER);
}

const OWNER = "owner.json";
// A run's folder carries its pid in its name while it is being made
// (".pending-<pid>") and while it is being removed (".closing-<pid>-<id>"),
// the two moments it has no owner file a sweep can read.
const PENDING = ".pending-";
const CLOSING = ".closing-";
const POLL_MS = 20;
const GONE_TIMEOUT_MS = 10_000;

/** A process a run started and recorded. With `group`, it leads its own process group. */
export type ProcessRecord = { pid: number; startedAt: string | null; group: boolean };

type Owner = { pid: number; startedAt: string | null; children: ProcessRecord[] };

/** The system calls a scope makes. Passed in so a test can watch them. */
export type RunScopeSystem = {
  startTimeOf: (pid: number) => string | null;
  trash: (target: string) => void;
  kill: (pid: number, group: boolean) => void;
  groupAlive: (pgid: number) => boolean;
};

/**
 * When the process started, as `ps` prints it, or null when no such process
 * runs. A zombie has exited and only waits for its parent, so it counts as gone.
 */
export function processStartTime(pid: number): string | null {
  try {
    const line = execFileSync("ps", ["-o", "stat=,lstart=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    if (line === "" || line.startsWith("Z")) return null;
    return line.slice(line.indexOf(" ") + 1).trim();
  } catch {
    return null;
  }
}

/** Moves a path to the Trash. Folders of other runs are never deleted outright. */
export function trashPath(target: string): void {
  execFileSync("trash", [target]);
}

/** Whether any process still belongs to process group `pgid`. */
export function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

// A group record is killed through its group id, so a grandchild whose parent
// has already died is stopped too.
function killProcess(pid: number, group = false): void {
  try {
    process.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    // It ended between the check and the kill.
  }
}

const SYSTEM: RunScopeSystem = {
  startTimeOf: processStartTime,
  trash: trashPath,
  kill: killProcess,
  groupAlive: processGroupAlive,
};

// A recorded process is ours only while it runs with the start time we
// recorded. A pid the system has given to another process is left alone.
function isSame(record: { pid: number; startedAt: string | null }, sys: RunScopeSystem): boolean {
  return record.startedAt !== null && sys.startTimeOf(record.pid) === record.startedAt;
}

// A recorded group is ours while its leader runs with the recorded start time,
// or, once the leader is gone, while any process is left in the group. The
// system gives no new process the group's id while the group exists. A leader
// pid now used by another process means the group is not ours.
function isRunning(record: ProcessRecord, sys: RunScopeSystem): boolean {
  if (!record.group) return isSame(record, sys);
  const leader = sys.startTimeOf(record.pid);
  if (leader !== null) return record.startedAt !== null && leader === record.startedAt;
  return sys.groupAlive(record.pid);
}

// A process this run did not start sends no exit event, so its end is seen by
// asking `ps` until it is gone. The timeout catches a process that will not die.
async function waitUntilGone(records: ProcessRecord[], sys: RunScopeSystem): Promise<void> {
  const deadline = Date.now() + GONE_TIMEOUT_MS;
  while (records.some((r) => isRunning(r, sys)) && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStartedAt = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function isProcessRecord(value: unknown): value is ProcessRecord {
  return (
    isRecord(value) &&
    typeof value.pid === "number" &&
    isStartedAt(value.startedAt) &&
    typeof value.group === "boolean"
  );
}

function isOwner(value: unknown): value is Owner {
  return (
    isRecord(value) &&
    typeof value.pid === "number" &&
    isStartedAt(value.startedAt) &&
    Array.isArray(value.children) &&
    value.children.every(isProcessRecord)
  );
}

// Writes the owner file whole: to a file of its own, then renamed over the
// old one. A rename is atomic, so a sweep reading beside it sees the old file
// or the new one, never a half-written one it would take for a dead run's.
function writeOwner(dir: string, owner: Owner): void {
  const draft = path.join(dir, `${OWNER}.${randomUUID()}.tmp`);
  writeFileSync(draft, JSON.stringify(owner));
  renameSync(draft, path.join(dir, OWNER));
}

// The pid in a pending or closing folder's name, or NaN for any other name.
function pidInName(name: string): number {
  for (const prefix of [PENDING, CLOSING]) {
    if (name.startsWith(prefix)) return Number(name.slice(prefix.length).split("-")[0]);
  }
  return Number.NaN;
}

// Trashes a dead run's folder, unless it is already gone: another run may
// remove a folder between a sweep's listing and its trash. True when this
// sweep moved it. A trash that fails while the folder is still there throws.
function trashIfPresent(dir: string, sys: RunScopeSystem): boolean {
  if (!existsSync(dir)) return false;
  try {
    sys.trash(dir);
    return true;
  } catch (error) {
    if (!existsSync(dir)) return false;
    throw error;
  }
}

// The owner file of a scope, or null when it is missing or not one this
// library wrote. A folder without a readable owner is a dead run's.
function readOwner(dir: string): Owner | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(dir, OWNER), "utf8"));
    return isOwner(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Sweeps the scopes under `root` whose run has died. Returns the folders it
 * moved to the Trash. The system calls are passed in so a test can watch them;
 * by default they act on the real system.
 */
export function sweepDeadRuns(root: string, system: Partial<RunScopeSystem> = {}): string[] {
  const sys = { ...SYSTEM, ...system };
  if (!existsSync(root)) return [];
  const swept: string[] = [];
  for (const name of readdirSync(root)) {
    const dir = path.join(root, name);
    const owner = readOwner(dir);
    if (owner === null) {
      // A folder being made or removed has its run's pid in its name, and is
      // left alone while that run lives. Any other folder without a readable
      // owner is a dead run's, or was removed while this sweep read it.
      const pid = pidInName(name);
      if (Number.isInteger(pid) && sys.startTimeOf(pid) !== null) continue;
      if (trashIfPresent(dir, sys)) swept.push(dir);
      continue;
    }
    if (isSame(owner, sys)) continue;
    for (const child of owner.children) {
      if (isRunning(child, sys)) sys.kill(child.pid, child.group);
    }
    if (trashIfPresent(dir, sys)) swept.push(dir);
  }
  return swept;
}

export type RunScope = {
  /** The folder only this run uses. */
  dir: string;
  /** The dead runs' folders this run swept when it opened. */
  swept: string[];
  /**
   * Records a process this run started. With `group`, the process leads its
   * own process group (spawned with `detached: true`), and the whole group is
   * stopped with it: use this for anything that starts processes of its own,
   * such as wrangler dev.
   */
  recordChild: (pid: number, options?: { group?: boolean }) => void;
  /** Stops this run's processes, removes its folder, and reports anything left. */
  close: () => Promise<{ leftovers: string[] }>;
};

export type RunScopeOptions = Partial<RunScopeSystem> & {
  root?: string;
  installExitHandlers?: boolean;
};

/**
 * Opens this run's scope: sweeps dead runs, then creates a folder that only
 * this run uses. Await `close()` at the end; `installExitHandlers` also stops
 * the run's processes and removes its folder on a normal exit, SIGINT or SIGTERM.
 */
export function openRunScope(options: RunScopeOptions = {}): RunScope {
  const { root = defaultRunsRoot(), installExitHandlers = false, ...system } = options;
  const sys = { ...SYSTEM, ...system };
  mkdirSync(root, { recursive: true });
  const swept = sweepDeadRuns(root, sys);

  const owner: Owner = { pid: process.pid, startedAt: sys.startTimeOf(process.pid), children: [] };
  const pending = path.join(root, `${PENDING}${process.pid}`);
  const dir = path.join(root, randomUUID());
  mkdirSync(pending);
  writeOwner(pending, owner);
  renameSync(pending, dir);
  const closing = path.join(root, `${CLOSING}${process.pid}-${randomUUID()}`);

  let stopped = false;

  function recordChild(pid: number, { group = false }: { group?: boolean } = {}): void {
    owner.children.push({ pid, startedAt: sys.startTimeOf(pid), group });
    writeOwner(dir, owner);
  }

  // Kills this run's processes and removes its folder. Synchronous, so the
  // process "exit" handler can use it.
  function stop(): void {
    if (stopped) return;
    stopped = true;
    for (const child of owner.children) {
      if (isRunning(child, sys)) sys.kill(child.pid, child.group);
    }
    // First the folder takes a closing name with this run's pid, so a sweep
    // beside it does not take it for a dead run's while its files go. This
    // run created the folder, so it may then remove it outright.
    let target = dir;
    try {
      renameSync(dir, closing);
      target = closing;
    } catch {
      // Already gone: nothing to rename.
    }
    rmSync(target, { recursive: true, force: true });
  }

  async function close(): Promise<{ leftovers: string[] }> {
    stop();
    await waitUntilGone(owner.children, sys);
    const leftovers: string[] = [];
    for (const folder of [dir, closing]) if (existsSync(folder)) leftovers.push(folder);
    for (const child of owner.children) {
      if (isRunning(child, sys)) {
        leftovers.push(`${child.group ? "process group" : "process"} ${child.pid}`);
      }
    }
    return { leftovers };
  }

  if (installExitHandlers) {
    process.once("exit", () => stop());
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        stop();
        process.exit(signal === "SIGINT" ? 130 : 143);
      });
    }
  }

  return { dir, swept, recordChild, close };
}
