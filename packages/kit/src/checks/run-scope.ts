import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { openRunScope, processStartTime, RUNS_FOLDER } from "../run-scope.ts";
import type { Check } from "./types.ts";

// `c-f-x check run-scope [-- <command>]`: runs a command, `pnpm test` unless
// another is named, and fails when the run leaves something behind. The run
// gets a temp folder of its own and leads a process group of its own, so the
// check counts only what this run made. How a run cleans up on every ending,
// even when killed, is the library's job and its test's (../run-scope.ts),
// ported from cfanalytics:scripts/run-scope.test.mjs.

const DEFAULT_COMMAND = ["pnpm", "test"];

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Outcome =
  | { started: true; code: number | null; signal: string | null }
  | { started: false; error: string };

/**
 * What a run left in its temp folder. The folder of run scopes is shared by
 * design, so only what is inside it counts: a scope a run did not close.
 */
function tempLeftovers(entries: { name: string; children: string[] | null }[]): string[] {
  return entries
    .flatMap((e) =>
      e.name === RUNS_FOLDER && e.children !== null
        ? e.children.map((c) => `${RUNS_FOLDER}/${c}`)
        : [e.name],
    )
    .toSorted(byText);
}

/** Paths in `after` that were not in `before`. */
function newPaths(before: string[], after: string[]): string[] {
  const seen = new Set(before);
  return after.filter((p) => !seen.has(p)).toSorted(byText);
}

/** The problems of one run, from what was observed after it ended. */
function runProblems(observed: {
  outcome: Outcome;
  running: number[];
  temp: string[];
  repo: string[];
  scope: string[];
}): string[] {
  const { outcome } = observed;
  const problems: string[] = [];
  if (!outcome.started) problems.push(`the run could not start: ${outcome.error}`);
  else if (outcome.code !== 0) {
    problems.push(
      outcome.signal === null
        ? `the run exited with code ${outcome.code}`
        : `the run was stopped by ${outcome.signal}`,
    );
  }
  for (const pid of observed.running) problems.push(`left running: process ${pid}`);
  for (const p of observed.temp) problems.push(`left in the temp folder: ${p}`);
  for (const p of observed.repo) problems.push(`left in the repository: ${p}`);
  for (const p of observed.scope) problems.push(`the check could not clean up: ${p}`);
  return problems;
}

// What git counts as untracked under `root`, ignored folders included, or
// null when `root` is not in a git repository.
function untracked(root: string): string[] | null {
  const list = (extra: string[]) =>
    execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard", ...extra], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter((line) => line !== "");
  try {
    return [...list([]), ...list(["--ignored", "--directory"])];
  } catch {
    return null;
  }
}

// The live processes in process group `pgid`. A zombie has exited, so it is not counted.
function groupMembers(pgid: number): number[] {
  try {
    return execFileSync("pgrep", ["-g", String(pgid)], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line !== "")
      .map(Number)
      .filter((pid) => processStartTime(pid) !== null);
  } catch {
    // pgrep exits 1 when the group is empty.
    return [];
  }
}

function tempEntries(tmp: string): { name: string; children: string[] | null }[] {
  if (!existsSync(tmp)) return [];
  return readdirSync(tmp, { withFileTypes: true }).map((e) => ({
    name: e.name,
    children: e.isDirectory() ? readdirSync(path.join(tmp, e.name)) : null,
  }));
}

// Runs the command as the leader of its own process group, with `tmp` as its
// temp folder, and resolves when the leader exits.
function runCommand(
  command: string[],
  root: string,
  tmp: string,
  record: (pid: number) => void,
): Promise<{ outcome: Outcome; pgid: number | null }> {
  const [file = "", ...args] = command;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: root,
      env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const pgid = child.pid ?? null;
    if (pgid !== null) record(pgid);
    child.once("error", (error) =>
      resolve({ outcome: { started: false, error: error.message }, pgid }),
    );
    child.once("exit", (code, signal) =>
      resolve({ outcome: { started: true, code, signal }, pgid }),
    );
  });
}

export const runScope: Check = {
  name: "run-scope",
  summary: "a run leaves nothing behind: no temp files, no repository files, no processes",
  async run({ root, args }) {
    const named = args[0] === "--" ? args.slice(1) : args;
    const command = named.length > 0 ? named : DEFAULT_COMMAND;
    const before = untracked(root);
    if (before === null)
      return [`${root} is not a git repository, so the check cannot see what a run leaves in it`];

    const scope = openRunScope({ installExitHandlers: true });
    const tmp = path.join(scope.dir, "tmp");
    mkdirSync(tmp);
    const { outcome, pgid } = await runCommand(command, root, tmp, (pid) =>
      scope.recordChild(pid, { group: true }),
    );
    const running = pgid === null ? [] : groupMembers(pgid);
    const temp = tempLeftovers(tempEntries(tmp));
    const after = untracked(root);
    // Closing the scope stops what the run left running and removes its temp folder.
    const { leftovers } = await scope.close();
    const problems = runProblems({
      outcome,
      running,
      temp,
      repo: after === null ? [] : newPaths(before, after),
      scope: leftovers,
    });
    return after === null
      ? [...problems, `${root} could not be listed after the run, so its leftovers are unknown`]
      : problems;
  },
};
