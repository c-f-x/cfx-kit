import { architecture } from "./architecture.ts";
import { docs } from "./docs.ts";
import { layout } from "./layout.ts";
import { lifetimes } from "./lifetimes.ts";
import { migrations } from "./migrations.ts";
import { names } from "./names.ts";
import { runScope } from "./run-scope.ts";
import type { Check } from "./types.ts";
import { wranglerConfig } from "./wrangler-config.ts";

/** Every `c-f-x check <name>`, in the order the usage lists them. */
export const CHECKS: readonly Check[] = [
  docs,
  runScope,
  architecture,
  layout,
  lifetimes,
  migrations,
  wranglerConfig,
  names,
];

export type { Check, CheckContext } from "./types.ts";
