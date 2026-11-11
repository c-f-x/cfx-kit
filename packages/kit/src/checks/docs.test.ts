import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import {
  BRIEF_MAX_LINES,
  briefProblems,
  docsToCheck,
  IMPORT_LINE,
  importProblems,
  pathViolations,
  STRATEGY_HEADING,
  strategyProblems,
} from "./docs.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

const lines = (n: number) => `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

test("the path check flags missing paths and stale planned marks", () => {
  const text = [
    "See `docs/architecture.md` and `apps/worker/src/gone.ts`.",
    "Later: `apps/web/src/features/` (planned), and again `apps/web/src/features/`.",
    "Stale: `docs/design.md` (planned).",
    "Not paths: `/healthz`, `features/<slice>/`, `cfanalytics:scripts/x.mjs`, `$set`, `wrangler.jsonc`, `Europe/Oslo`, `@scope/pkg`, `typescript/no-floating-promises`.",
    "With a line number: `docs/data-model.md:12`.",
  ].join("\n");
  const existing = new Set(["docs/architecture.md", "docs/design.md", "docs/data-model.md"]);
  assert.deepEqual(
    pathViolations("sample.md", text, (p) => existing.has(p)),
    [
      'sample.md: docs/design.md exists, so drop its "(planned)"',
      "sample.md: apps/worker/src/gone.ts does not exist",
    ],
  );
});

test(`the brief check passes ${BRIEF_MAX_LINES} lines, and flags one more or no brief at all`, () => {
  assert.deepEqual(briefProblems(lines(BRIEF_MAX_LINES)), []);
  assert.deepEqual(briefProblems(lines(BRIEF_MAX_LINES + 1)), [
    `AGENTS.md: has ${BRIEF_MAX_LINES + 1} lines, more than ${BRIEF_MAX_LINES}`,
  ]);
  assert.deepEqual(briefProblems(undefined), [
    "AGENTS.md is missing: it is the agent brief of every c-f-x repository",
  ]);
});

test("the brief must hold the test strategy section", () => {
  assert.deepEqual(strategyProblems(`# cfx-sample\n\n${STRATEGY_HEADING}\n\n| Command |\n`), []);
  assert.deepEqual(strategyProblems("# cfx-sample\n\n## Testing\n"), [
    "AGENTS.md has no ## Test strategy section: /test-setup writes the commands, when each runs and their measured times there",
  ]);
  assert.deepEqual(strategyProblems(undefined), []);
});

test("CLAUDE.md passes only as the one line that imports AGENTS.md", () => {
  const only = `CLAUDE.md must hold only the line ${IMPORT_LINE}, which imports AGENTS.md`;
  assert.deepEqual(importProblems(`${IMPORT_LINE}\n`), []);
  assert.deepEqual(importProblems(IMPORT_LINE), []);
  assert.deepEqual(importProblems(undefined), [only]);
  assert.deepEqual(importProblems(""), [only]);
  assert.deepEqual(importProblems(`${IMPORT_LINE}\n\nAnd one rule more.\n`), [only]);
  assert.deepEqual(importProblems("# cfx-status\n\nThe brief, as it used to be.\n"), [only]);
});

test("the decision log and research notes are history, so their paths are not checked", () => {
  assert.deepEqual(
    docsToCheck([
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "docs/conventions.md",
      "docs/decisions.md",
      "docs/research/2026-11-11-survey.md",
      "docs/spec/behaviours.md",
      "docs/notes.txt",
    ]),
    ["AGENTS.md", "CLAUDE.md", "README.md", "docs/conventions.md", "docs/spec/behaviours.md"],
  );
});

test("c-f-x check docs fails on a sample with a missing path, a long brief and a CLAUDE.md of its own", async () => {
  const repo = path.join(scope.dir, "flagged");
  writeFiles(repo, {
    "AGENTS.md": `See \`docs/gone.md\`.\n${lines(BRIEF_MAX_LINES)}`,
    "CLAUDE.md": `${IMPORT_LINE}\nRead \`docs/guide.md\` first.\n`,
    "docs/guide.md": "Run `scripts/missing.mjs`, then read `docs/guide.md`.\n",
  });
  const { code, stderr } = await runCli(["check", "docs"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /AGENTS\.md: docs\/gone\.md does not exist/);
  assert.match(stderr, new RegExp(`AGENTS\\.md: has ${BRIEF_MAX_LINES + 1} lines`));
  assert.match(stderr, /CLAUDE\.md must hold only the line @AGENTS\.md/);
  assert.match(stderr, /docs\/guide\.md: scripts\/missing\.mjs does not exist/);
  assert.match(stderr, /AGENTS\.md has no ## Test strategy section/);
  assert.match(stderr, /check docs: failed with 5 problems/);
});

test("c-f-x check docs fails on a sample with no AGENTS.md", async () => {
  const repo = path.join(scope.dir, "no-brief");
  writeFiles(repo, { "CLAUDE.md": `${IMPORT_LINE}\n`, "README.md": "# sample\n" });
  const { code, stderr } = await runCli(["check", "docs"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /AGENTS\.md is missing/);
  assert.match(stderr, /check docs: failed with 1 problem$/m);
});

test("c-f-x check docs passes a sample whose paths all exist", async () => {
  const repo = path.join(scope.dir, "clean");
  writeFiles(repo, {
    "AGENTS.md": `Read \`docs/guide.md\`. Later, \`docs/ops.md\` (planned).\n\n${STRATEGY_HEADING}\n`,
    "CLAUDE.md": `${IMPORT_LINE}\n`,
    "docs/guide.md": "Back to `AGENTS.md`.\n",
    "docs/decisions.md": "Once there was `scripts/old.mjs`.\n",
  });
  const { code, stdout } = await runCli(["check", "docs"], repo, scope.dir);
  assert.equal(code, 0);
  assert.match(stdout, /check docs: passed/);
});
