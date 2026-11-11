import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import { groundFiles } from "../test-support/tool-repo.ts";
import { callsHealthContract, layoutViolations } from "./layout.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

const NO_CONTRACT_TEST =
  "no test runs the health contract: a *.test.ts file must import checkHealthContract from @c-f-x/kit/worker and call it";

test("the layout check names each missing file, a data model without its table, and no contract test", () => {
  assert.deepEqual(
    layoutViolations(() => false, false, false),
    [
      "wrangler.jsonc is missing",
      "docs/data-model.md is missing",
      "docs/contract.md is missing",
      "docs/spec/behaviours.md is missing",
      NO_CONTRACT_TEST,
    ],
  );
  assert.deepEqual(
    layoutViolations(() => true, false, true),
    ["docs/data-model.md has no lifetimes table"],
  );
  assert.deepEqual(
    layoutViolations(() => true, true, true),
    [],
  );
});

test("a test runs the health contract only when it imports it from the kit and calls it", () => {
  const imports = 'import { checkHealthContract } from "@c-f-x/kit/worker";\n';
  const calls = "expect(await checkHealthContract({ fetch, failing })).toEqual([]);\n";
  assert.equal(callsHealthContract(imports + calls), true);
  assert.equal(
    callsHealthContract(
      'import {\n  type WorkerFetch,\n  checkHealthContract,\n} from "@c-f-x/kit/worker";\n' +
        calls,
    ),
    true,
  );
  // Not enough: an import never called, a call to a function of its own, a
  // call left in a comment, and the name imported from somewhere else.
  assert.equal(callsHealthContract(imports), false);
  assert.equal(callsHealthContract(calls), false);
  assert.equal(callsHealthContract(`${imports}// ${calls}`), false);
  assert.equal(
    callsHealthContract(`import { checkHealthContract } from "./contract.ts";\n${calls}`),
    false,
  );
});

const LIFETIMES = "## Lifetimes\n\n| Store | Holds | Lifetime | Removed by |\n|---|---|---|---|\n";

const CONTRACT_TEST = [
  'import { checkHealthContract } from "@c-f-x/kit/worker";',
  'test("healthz-01", async () => {',
  '  expect(await checkHealthContract({ fetch: app, failing: [{ part: "db", fetch: broken }] })).toEqual([]);',
  "});",
  "",
].join("\n");

// The files of sections 1 and 6 that a clean tool keeps.
const TOOL_FILES = {
  "wrangler.jsonc": "{}\n",
  "docs/data-model.md": `# Data model\n\n${LIFETIMES}`,
  "docs/contract.md": "# Contract\n",
  "docs/spec/behaviours.md": "# Behaviours\n",
  "test/health.test.ts": CONTRACT_TEST,
};

test("c-f-x check layout fails on a sample that lacks the tool files", async () => {
  const repo = path.join(scope.dir, "flagged");
  writeFiles(repo, {
    "wrangler.jsonc": "{}\n",
    "docs/data-model.md": "# Data model\n",
    "docs/spec/notes.md": "Behaviours, some day.\n",
    // The contract test in a file that is not a test, and in a dependency.
    "src/health.ts": CONTRACT_TEST,
    "node_modules/@c-f-x/kit/health.test.ts": CONTRACT_TEST,
  });
  const { code, stderr } = await runCli(["check", "layout"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /docs\/data-model\.md has no lifetimes table/);
  assert.match(stderr, /docs\/contract\.md is missing/);
  assert.match(stderr, /docs\/spec\/behaviours\.md is missing/);
  assert.match(stderr, /no test runs the health contract/);
  // The ground rules of section 16: every file is missing, so each says so.
  assert.match(stderr, /package\.json must name the tool as cfx-<job>/);
  assert.match(stderr, /LICENSE is missing or is not the MIT License/);
  assert.match(stderr, /SECURITY\.md is missing/);
  assert.match(stderr, /\.github\/dependabot\.yml is missing/);
  assert.match(stderr, /\.github\/FUNDING\.yml is missing/);
  assert.match(stderr, /docs\/decisions\.md is missing/);
  assert.match(
    stderr,
    /no workflow in \.github\/workflows runs `weeder check --base origin\/master`/,
  );
  assert.match(stderr, /no workflow in \.github\/workflows runs `petals check` or `petals gate`/);
  assert.match(stderr, /docs\/tend\/ holds no \*\.tend\.html map/);
  assert.match(stderr, /\.petalsrc is missing/);
  assert.match(stderr, /docs\/index\.html is missing/);
  assert.match(stderr, /docs\/\.nojekyll is missing/);
  assert.match(stderr, /check layout: failed with 16 problems/);
});

test("c-f-x check layout reads the ground rules from the disk: a README without its three ways to install", async () => {
  const repo = path.join(scope.dir, "no-install");
  const files = groundFiles("cfx-sample");
  writeFiles(repo, {
    ...TOOL_FILES,
    ...files,
    "README.md": "# cfx-sample\n\ncfx-sample is a sample tool.\n",
    ".husky/pre-commit": "npx lint-staged\n",
  });
  const { code, stderr } = await runCli(["check", "layout"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /README\.md has no ## Install section/);
  assert.match(stderr, /README\.md: its ## Support section must hold the Buy Me A Coffee badge/);
  assert.match(stderr, /\.husky\/ is here/);
  assert.match(stderr, /check layout: failed with 3 problems/);
});

test("c-f-x check layout passes a sample with every tool file", async () => {
  const repo = path.join(scope.dir, "clean");
  writeFiles(repo, { ...TOOL_FILES, ...groundFiles("cfx-sample") });
  const { code, stdout, stderr } = await runCli(["check", "layout"], repo, scope.dir);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /check layout: passed/);
});
