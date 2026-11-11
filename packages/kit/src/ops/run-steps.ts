import { spawn } from "node:child_process";

// Runs steps in order and stops at the first that fails. `pnpm check` uses it
// directly; an operation (./operation.ts) uses it to run its steps. Ported
// from cfanalytics:scripts/lib/run-steps.mjs.

/** Where a step writes its progress. */
export type Log = (line: string) => void;

/** A step that runs a command. It passes when the command exits 0. */
export type CommandStep = {
  name: string;
  command: string;
  args: readonly string[];
  /** The folder it runs in, the caller's own by default. */
  cwd?: string;
  /** Variables added to the caller's environment for this command. */
  env?: Readonly<Record<string, string>>;
};

/** What a task step found. A failure says why, in a line a person reads. */
export type TaskOutcome = { ok: true } | { ok: false; reason: string };

/** A step that runs a function. It passes when the function resolves to `{ ok: true }`. */
export type TaskStep = {
  name: string;
  task: (log: Log) => Promise<TaskOutcome>;
};

export type Step = CommandStep | TaskStep;

/** The failed step's exit code; a failed task counts as exit code 1, with its reason. */
export type StepsResult =
  | { ok: true }
  | {
      ok: false;
      failed: { name: string; code: number; reason: string | null };
      skipped: string[];
    };

export type RunStepsOptions = {
  /** Runs one command step and resolves to its exit code. */
  spawn?: (step: CommandStep) => Promise<number>;
  log?: Log;
};

/** Runs one command step with the terminal attached. Resolves to its exit code. */
export function spawnStep(step: CommandStep): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      stdio: "inherit",
      shell: false,
      ...(step.cwd === undefined ? {} : { cwd: step.cwd }),
      ...(step.env === undefined ? {} : { env: { ...process.env, ...step.env } }),
    });
    // A command that cannot start is a failure, with the shell's code for "not found".
    child.once("error", () => resolve(127));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function runOne(
  step: Step,
  spawnCommand: (step: CommandStep) => Promise<number>,
  log: Log,
): Promise<{ code: number; reason: string | null }> {
  if ("task" in step) {
    // A task that throws has failed like one that says so, and the run still stops there.
    const outcome = await step.task(log).catch(
      (error: unknown): TaskOutcome => ({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    return outcome.ok ? { code: 0, reason: null } : { code: 1, reason: outcome.reason };
  }
  return { code: await spawnCommand(step), reason: null };
}

/**
 * Runs steps in order and stops at the first that fails. Returns which step
 * failed, with its exit code, and which steps never ran.
 */
export async function runSteps(
  steps: readonly Step[],
  { spawn: spawnCommand = spawnStep, log = console.log }: RunStepsOptions = {},
): Promise<StepsResult> {
  for (const [index, step] of steps.entries()) {
    log(`\n▶ ${step.name}`);
    // The steps run one after another on purpose: a later step must not start
    // when an earlier one failed.
    // oxlint-disable-next-line no-await-in-loop
    const { code, reason } = await runOne(step, spawnCommand, log);
    if (code !== 0) {
      const skipped = steps.slice(index + 1).map((s) => s.name);
      return { ok: false, failed: { name: step.name, code, reason }, skipped };
    }
  }
  return { ok: true };
}
