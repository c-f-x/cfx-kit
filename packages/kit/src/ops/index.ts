// The ops runner: what a tool's `pnpm ops <tool> <command> [--go]` is made
// of (docs/conventions.md, section 3).

export {
  bundleDifferences,
  bundleFiles,
  notUploaded,
  sameBundleStep,
} from "./bundle.ts";
export {
  askHealth,
  type Clock,
  type HealthVerdict,
  type HealthWait,
  type HealthWaitResult,
  healthStep,
  healthVerdict,
  systemClock,
  waitForHealth,
} from "./health.ts";
export {
  defineOperation,
  exitCodeOf,
  type Operation,
  type OperationOptions,
  type OperationResult,
  type OperationSpec,
  type OpStep,
  planText,
  runOperation,
} from "./operation.ts";
export {
  deployPreconditions,
  type Git,
  type GitAnswer,
  type PreconditionOptions,
  systemGit,
} from "./preconditions.ts";
export {
  type CommandStep,
  type Log,
  type RunStepsOptions,
  runSteps,
  type Step,
  type StepsResult,
  spawnStep,
  type TaskOutcome,
  type TaskStep,
} from "./run-steps.ts";
