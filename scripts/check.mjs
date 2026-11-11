import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { runSteps } from "../packages/kit/src/index.ts";

// `pnpm check`: every check, in order, stopping at the first failure. Ported
// from cfanalytics:scripts/check.mjs. After the build, the built command runs
// this repository's own docs, names and run-scope checks, the way a user runs it.

const KIT = path.resolve(import.meta.dirname, "../packages/kit");
const CLI = path.join(KIT, "dist/cli.js");

// The build writes the kit's dist folder. It is removed only when this run
// created it, so a developer's own build stays.
const DIST = path.join(KIT, "dist");
const distExisted = existsSync(DIST);

const pnpm = (...args) => ({ command: "pnpm", args });
const kit = (...args) => ({ command: process.execPath, args: [CLI, ...args] });

const steps = [
  { name: "lint", ...pnpm("lint") },
  { name: "typecheck", ...pnpm("typecheck") },
  { name: "test", ...pnpm("test") },
  { name: "build", ...pnpm("build") },
  { name: "docs", ...kit("check", "docs") },
  { name: "names", ...kit("check", "names") },
  // Runs `pnpm test` again, and fails when that run leaves anything behind.
  { name: "run-scope", ...kit("check", "run-scope") },
];

const result = await runSteps(steps);
// This run created the folder, so it may remove it outright.
if (!distExisted) rmSync(DIST, { recursive: true, force: true });
if (result.ok) {
  console.log("\ncheck: every step passed");
} else {
  console.error(`\ncheck: "${result.failed.name}" failed with exit code ${result.failed.code}.`);
  if (result.skipped.length > 0) console.error(`check: not run: ${result.skipped.join(", ")}`);
  process.exit(1);
}
