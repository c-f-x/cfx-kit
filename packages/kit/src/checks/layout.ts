import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { groundRuleViolations, repoOnDisk } from "./ground-rules.ts";
import { DATA_MODEL, readLifetimes } from "./lifetimes.ts";
import { repoPath, withoutComments } from "./source.ts";
import { WRANGLER } from "./tool-config.ts";
import type { Check } from "./types.ts";

// `c-f-x check layout`: a tool repository has the files every tool keeps, a
// test that runs the kit's health contract on its Worker, and meets the ground
// rules (docs/conventions.md, sections 1, 6 and 16). New in the kit.

export const CONTRACT = "docs/contract.md";
export const BEHAVIOURS = "docs/spec/behaviours.md";

const CONTRACT_TEST = "checkHealthContract";
const KIT_WORKER = "@c-f-x/kit/worker";
const NO_CONTRACT_TEST = `no test runs the health contract: a *.test.ts file must import ${CONTRACT_TEST} from ${KIT_WORKER} and call it`;

// An import statement that names the contract test among its bindings, from
// the kit's Worker entry. Statements end with ";", so the lazy match stays
// inside one statement.
const IMPORTS_CONTRACT = new RegExp(
  `(?:^|\\n)\\s*import\\s*\\{[^;}]*\\b${CONTRACT_TEST}\\b[^;}]*\\}\\s*from\\s*["']${KIT_WORKER}["']`,
);
const CALLS_CONTRACT = new RegExp(`\\b${CONTRACT_TEST}\\s*\\(`);

/** Whether a test file's text imports the kit's health contract test and calls it. */
export function callsHealthContract(text: string): boolean {
  const code = withoutComments(text);
  return IMPORTS_CONTRACT.test(code) && CALLS_CONTRACT.test(code);
}

// Folders no tool's own test lives in: dependencies, builds and git's own.
const SKIPPED = new Set(["node_modules", "dist", ".git", ".wrangler"]);

/** The repository paths of the `*.test.ts` files under `root`, outside dependencies and builds. */
export function testFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        found.push(repoPath(root, full));
      }
    }
  };
  walk(root);
  return found;
}

/** The files a tool repository lacks, a data-model doc without its lifetimes table, and no contract test. */
export function layoutViolations(
  exists: (p: string) => boolean,
  hasLifetimes: boolean,
  hasContractTest: boolean,
): string[] {
  const missing = [WRANGLER, DATA_MODEL, CONTRACT, BEHAVIOURS]
    .filter((file) => !exists(file))
    .map((file) => `${file} is missing`);
  if (exists(DATA_MODEL) && !hasLifetimes) missing.push(`${DATA_MODEL} has no lifetimes table`);
  if (!hasContractTest) missing.push(NO_CONTRACT_TEST);
  return missing;
}

export const layout: Check = {
  name: "layout",
  summary: `a tool repository has ${WRANGLER}, ${DATA_MODEL} with a lifetimes table, ${CONTRACT}, ${BEHAVIOURS}, a test that runs the health contract, and meets the ground rules`,
  async run({ root }) {
    const hasContractTest = testFiles(root).some((file) =>
      callsHealthContract(readFileSync(path.join(root, file), "utf8")),
    );
    return [
      ...layoutViolations(
        (p) => existsSync(path.join(root, p)),
        readLifetimes(root).ok,
        hasContractTest,
      ),
      ...groundRuleViolations(repoOnDisk(root)),
    ];
  },
};
