import { openRunScope, type RunScope } from "../run-scope.ts";
import { deployPreconditions, type Git } from "./preconditions.ts";
import { type CommandStep, type Log, runSteps, type TaskStep } from "./run-steps.ts";

// An operation is one `pnpm ops <tool> <command> [--go]`: a list of steps,
// each with what undoes it. Without --go it prints the plan and changes
// nothing. With --go it runs the steps and stops at the first that fails.
// An operation that changes a deployment starts only from a clean checkout
// of current origin/master. Every run gets a scratch folder of its own from
// the run-scope library. Ported from `deploy`, `planText` and the deploy
// steps' shape in cfanalytics:scripts/ops.mjs and cfanalytics:scripts/lib/ops.mjs.

/**
 * One step of an operation. `undo` says how to reverse what the step changed,
 * or why there is nothing to undo. A task step's `does` is what the plan
 * shows it does.
 */
export type OpStep = (CommandStep | (TaskStep & { does: string })) & { undo: string };

/** An operation whose every step names its undo. Made only by `defineOperation`. */
export type Operation = { name: string; steps: readonly OpStep[] };

/**
 * The operation `name` with `steps`, or the steps it refuses: every step
 * must name its undo, even if only to say there is nothing to undo.
 */
export function defineOperation(
  name: string,
  steps: readonly OpStep[],
): { ok: true; value: Operation } | { ok: false; errors: string[] } {
  const errors = steps.flatMap((step, index) =>
    typeof step.undo === "string" && step.undo.trim() !== ""
      ? []
      : [`step ${String(index + 1)} ("${step.name}") names no undo`],
  );
  return errors.length === 0 ? { ok: true, value: { name, steps } } : { ok: false, errors };
}

/** What the plan shows a step runs. */
function shows(step: OpStep): string {
  return "task" in step ? `does: ${step.does}` : `runs: ${[step.command, ...step.args].join(" ")}`;
}

/** The plan a person reads before anything runs: each step, what it runs, and its undo. */
export function planText(operation: Operation): string {
  return operation.steps
    .map(
      (step, index) =>
        `${String(index + 1)}. ${step.name}\n   ${shows(step)}\n   undo: ${step.undo}`,
    )
    .join("\n");
}

/** What an operation is, before its steps exist. Its steps are made for each run. */
export type OperationSpec = {
  name: string;
  /** Whether it changes a deployment. Such an operation needs a clean checkout of current origin/master. */
  changesDeployment: boolean;
  /** The steps, given the run's scratch folder, which only this run uses. */
  steps: (run: { scratch: string }) => readonly OpStep[];
};

export type OperationOptions = {
  /** Without it, the plan is printed and nothing runs. */
  go: boolean;
  /** The tool's checkout, where the preconditions are read. */
  root: string;
  log?: Log;
  err?: Log;
  remote?: string;
  trunk?: string;
  git?: Git;
  spawn?: (step: CommandStep) => Promise<number>;
  /** Opens the run's scope. By default, a scope that also cleans up on SIGINT and SIGTERM. */
  openScope?: () => RunScope;
};

export type OperationResult =
  | { outcome: "refused"; reasons: string[] }
  | { outcome: "planned"; notes: string[] }
  | { outcome: "done" }
  | {
      outcome: "failed";
      failed: { name: string; code: number; reason: string | null };
      skipped: string[];
      /** The steps that ran, the failed one too, newest first, each with its undo. */
      toUndo: { name: string; undo: string }[];
    };

/** The exit code of a result: 0 when done or only planned, 1 otherwise. */
export function exitCodeOf(result: OperationResult): number {
  return result.outcome === "done" || result.outcome === "planned" ? 0 : 1;
}

/** The lines that report a failed run. */
function failureText(result: Extract<OperationResult, { outcome: "failed" }>): string[] {
  const { failed, skipped, toUndo } = result;
  const why = failed.reason === null ? "" : `: ${failed.reason}`;
  return [
    `\n"${failed.name}" failed with exit code ${String(failed.code)}${why}`,
    ...(skipped.length > 0 ? [`Not run: ${skipped.join(", ")}.`] : []),
    "Undo the steps that ran, newest first:",
    ...toUndo.map((step) => `- ${step.name}: ${step.undo}`),
  ];
}

async function planAndRun(
  spec: OperationSpec,
  scratch: string,
  options: OperationOptions,
): Promise<OperationResult> {
  const { go, root, log = console.log, err = console.error } = options;
  const defined = defineOperation(spec.name, spec.steps({ scratch }));
  if (!defined.ok) {
    for (const error of defined.errors) err(`${spec.name}: ${error}`);
    return { outcome: "refused", reasons: defined.errors };
  }
  const operation = defined.value;

  const reasons = spec.changesDeployment
    ? await deployPreconditions({
        root,
        ...(options.remote === undefined ? {} : { remote: options.remote }),
        ...(options.trunk === undefined ? {} : { trunk: options.trunk }),
        ...(options.git === undefined ? {} : { git: options.git }),
      })
    : [];
  if (go && reasons.length > 0) {
    err(`${spec.name}: refused before step 1:`);
    for (const reason of reasons) err(`- ${reason}`);
    return { outcome: "refused", reasons };
  }

  log(`Plan for ${spec.name}:\n\n${planText(operation)}`);
  if (!go) {
    for (const reason of reasons) log(`\nNote: --go would refuse: ${reason}`);
    log("\nNothing ran. Run again with --go to run it.");
    return { outcome: "planned", notes: reasons };
  }

  const result = await runSteps(operation.steps, {
    log,
    ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
  });
  if (result.ok) {
    log(`\n${spec.name}: every step passed.`);
    return { outcome: "done" };
  }
  const ran = operation.steps.length - result.skipped.length;
  const failed: OperationResult = {
    outcome: "failed",
    failed: result.failed,
    skipped: result.skipped,
    toUndo: operation.steps
      .slice(0, ran)
      .toReversed()
      .map((step) => ({ name: step.name, undo: step.undo })),
  };
  for (const line of failureText(failed)) err(line);
  return failed;
}

/**
 * Runs one operation: makes its steps in a scratch folder of this run's own,
 * refuses steps without an undo, checks the preconditions of a changing
 * operation, prints the plan, and with `go` runs the steps. The scratch
 * folder is removed at the end, whatever happened.
 */
export async function runOperation(
  spec: OperationSpec,
  options: OperationOptions,
): Promise<OperationResult> {
  const { err = console.error, openScope = () => openRunScope({ installExitHandlers: true }) } =
    options;
  const scope = openScope();
  try {
    return await planAndRun(spec, scope.dir, options);
  } finally {
    const { leftovers } = await scope.close();
    for (const leftover of leftovers) err(`${spec.name}: could not clean up ${leftover}`);
  }
}
