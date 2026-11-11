// `@c-f-x/kit/worker`: the helpers a tool's Worker runs. This entry imports no
// `node:` module, so a Worker can bundle it; the package's main entry holds
// what runs on a machine (the checks, the ops runner, the run scope).

export {
  type HealthBody,
  type HealthLine,
  type HealthOptions,
  healthHandler,
  type Probe,
} from "./health.ts";
export {
  checkHealthContract,
  type HealthContractTarget,
  type WorkerFetch,
} from "./health-contract.ts";
export {
  failPing,
  HEARTBEAT_TIMEOUT_MS,
  type JobLine,
  type JobOptions,
  type JobOutcome,
  job,
} from "./job.ts";
export {
  bearerOf,
  bytesToBase64url,
  equalInConstantTime,
  hashKey,
  isKeyShape,
  KEY_BYTES,
  type KeyKind,
  keyMatches,
  publicTokenFrom,
  secretKeyFrom,
} from "./keys.ts";
export { type MailBinding, notify, type PlainMail } from "./notify.ts";
