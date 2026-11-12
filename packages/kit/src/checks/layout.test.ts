import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import { initRepo } from "../test-support/git.ts";
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
    layoutViolations(".", () => false, false, false),
    [
      "wrangler.jsonc is missing",
      "docs/data-model.md is missing",
      "docs/contract.md is missing",
      "docs/spec/behaviours.md is missing",
      NO_CONTRACT_TEST,
    ],
  );
  assert.deepEqual(
    layoutViolations(".", () => true, false, true),
    ["docs/data-model.md has no lifetimes table"],
  );
  assert.deepEqual(
    layoutViolations(".", () => true, true, true),
    [],
  );
});

test("the layout check looks for wrangler.jsonc in the Worker's folder", () => {
  assert.deepEqual(
    layoutViolations("apps/worker", (p) => p !== "apps/worker/wrangler.jsonc", true, true),
    ["apps/worker/wrangler.jsonc is missing"],
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

// A tool whose Worker sits at the repository's root: c-f-x.json names no folder for it.
const ROOT_CONFIG = JSON.stringify({ sources: [], slices: [], migrations: [] });

// The files of sections 1 and 6 that a clean tool keeps.
const TOOL_FILES = {
  "c-f-x.json": ROOT_CONFIG,
  "wrangler.jsonc": "{}\n",
  "docs/data-model.md": `# Data model\n\n${LIFETIMES}`,
  "docs/contract.md": "# Contract\n",
  "docs/spec/behaviours.md": "# Behaviours\n",
  "test/health.test.ts": CONTRACT_TEST,
};

test("c-f-x check layout fails on a sample that lacks the tool files", async () => {
  const repo = path.join(scope.dir, "flagged");
  writeFiles(repo, {
    "c-f-x.json": ROOT_CONFIG,
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
  assert.match(stderr, /CONTRIBUTING\.md is missing/);
  assert.match(stderr, /\.github\/ISSUE_TEMPLATE\/ holds no issue template/);
  assert.match(stderr, /\.dev\.vars\.example is missing/);
  assert.match(stderr, /site\.example\.jsonc is missing/);
  assert.match(
    stderr,
    /no workflow in \.github\/workflows runs `weeder check --base origin\/master`/,
  );
  assert.match(stderr, /no workflow in \.github\/workflows runs `petals check` or `petals gate`/);
  assert.match(stderr, /docs\/tend\/ holds no \*\.tend\.html map/);
  assert.match(stderr, /\.petalsrc is missing/);
  assert.match(stderr, /docs\/index\.html is missing/);
  assert.match(stderr, /docs\/\.nojekyll is missing/);
  assert.match(stderr, /check layout: failed with 20 problems/);
});

test("c-f-x check layout reads the ground rules from the disk: a README in no shape of the standard", async () => {
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
  assert.match(stderr, /README\.md: the line after the title must be one bold sentence/);
  assert.match(
    stderr,
    /README\.md: the intro must end with the line that cfx-sample is part of c-f-x/,
  );
  assert.match(stderr, /README\.md: after the intro comes the screenshot/);
  assert.match(stderr, /README\.md: its sections must be ## What it does, .*; it has none/);
  assert.match(stderr, /README\.md: its ## Support section must hold the Buy Me A Coffee badge/);
  assert.match(stderr, /\.husky\/ is here/);
  assert.match(stderr, /check layout: failed with 6 problems/);
});

test("c-f-x check layout passes a sample with every tool file", async () => {
  const repo = path.join(scope.dir, "clean");
  writeFiles(repo, { ...TOOL_FILES, ...groundFiles("cfx-sample") });
  const { code, stdout, stderr } = await runCli(["check", "layout"], repo, scope.dir);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /check layout: passed/);
});

test("a tool started from templates/tool passes layout, docs and wrangler-config", async () => {
  const repo = path.join(scope.dir, "from-templates");
  writeFiles(repo, { ...TOOL_FILES, ...groundFiles("cfx-sample") });
  initRepo(repo);
  const checks = ["layout", "docs", "wrangler-config"];
  const runs = await Promise.all(checks.map((check) => runCli(["check", check], repo, scope.dir)));
  runs.forEach(({ code, stdout, stderr }, i) => {
    const check = checks[i] ?? "";
    assert.equal(stderr, "", check);
    assert.equal(code, 0, check);
    assert.match(stdout, new RegExp(`check ${check}: passed`));
  });
});

test("c-f-x check layout fails without a c-f-x.json to say where the Worker is", async () => {
  const repo = path.join(scope.dir, "unconfigured");
  const { "c-f-x.json": _config, ...files } = { ...TOOL_FILES, ...groundFiles("cfx-sample") };
  writeFiles(repo, files);
  const { code, stderr } = await runCli(["check", "layout"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /c-f-x\.json is missing/);
  assert.match(stderr, /check layout: failed with 1 problem$/m);
});

// A monorepo tool, as cfx-mail and cfx-analytics are: the Worker and its tests
// in apps/worker/, the repository's own files at the root.
const WORKER = "apps/worker";
const WORKER_FILES = new Set(["wrangler.jsonc", ".dev.vars.example", "test/health.test.ts"]);
const MONOREPO_CONFIG = JSON.stringify({
  sources: [`${WORKER}/src`],
  slices: [],
  migrations: [],
  worker: WORKER,
});

function monorepo(name: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [p, text] of Object.entries({ ...TOOL_FILES, ...groundFiles(name) }))
    files[WORKER_FILES.has(p) ? `${WORKER}/${p}` : p] = text;
  return {
    ...files,
    "c-f-x.json": MONOREPO_CONFIG,
    [`${WORKER}/src/index.ts`]: "export default {};\n",
  };
}

test("a monorepo tool with its Worker in apps/worker passes every check that reads the Worker", async () => {
  const repo = path.join(scope.dir, "monorepo");
  writeFiles(repo, monorepo("cfx-sample"));
  initRepo(repo);
  const checks = ["layout", "wrangler-config", "architecture", "lifetimes", "docs"];
  const runs = await Promise.all(checks.map((check) => runCli(["check", check], repo, scope.dir)));
  runs.forEach(({ code, stdout, stderr }, i) => {
    const check = checks[i] ?? "";
    assert.equal(stderr, "", check);
    assert.equal(code, 0, check);
    assert.match(stdout, new RegExp(`check ${check}: passed`));
  });
});

test("c-f-x check layout reads the Worker's files only in the folder c-f-x.json names", async () => {
  const repo = path.join(scope.dir, "monorepo-at-root");
  // c-f-x.json names apps/worker, but the Worker's files sit at the root: no guessing between them.
  writeFiles(repo, {
    ...TOOL_FILES,
    ...groundFiles("cfx-sample"),
    "c-f-x.json": MONOREPO_CONFIG,
    [`${WORKER}/src/index.ts`]: "export default {};\n",
  });
  const { code, stderr } = await runCli(["check", "layout"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /^apps\/worker\/wrangler\.jsonc is missing$/m);
  assert.match(
    stderr,
    /^apps\/worker\/\.dev\.vars\.example is missing: it names the Worker's secrets, exactly those in apps\/worker\/wrangler\.jsonc's secrets\.required$/m,
  );
  assert.match(
    stderr,
    /^no test runs the health contract: a \*\.test\.ts file under apps\/worker\/ must import checkHealthContract/m,
  );
  assert.match(stderr, /check layout: failed with 3 problems/);
});
