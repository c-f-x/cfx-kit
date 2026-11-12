import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { IMPORT_LINE, STRATEGY_HEADING } from "./checks/docs.ts";
import { openRunScope, type RunScope } from "./run-scope.ts";
import { writeFiles } from "./test-support/cli.ts";

// A tool installs the kit from the tarball each release attaches
// (.github/workflows/release.yml). This test makes that tarball the way the
// release does, `pnpm run build` then `pnpm pack`, installs it into a sample
// tool and runs what the tool runs. The build cannot write the package's own
// `dist`, a path every run would share, so it writes into a copy of the files
// `pnpm pack` reads: the workspace root's package.json, pnpm-workspace.yaml
// and LICENSE, and the kit's package.json.

const REPO = path.resolve(import.meta.dirname, "../../..");
const KIT = path.join(REPO, "packages/kit");

const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8"));
const kitVersion = String(json(path.join(KIT, "package.json")).version);
const packageManager = String(json(path.join(REPO, "package.json")).packageManager);

/** The name `pnpm pack` gives the kit's tarball: the scope and name joined, then the version. */
const TARBALL = `c-f-x-kit-${kitVersion}.tgz`;

/** The line every tool installs the kit with. README.md and the skill must show it. */
const INSTALL_LINE = `pnpm add -D https://github.com/c-f-x/cfx-kit/releases/download/v${kitVersion}/${TARBALL}`;

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

// Runs a command to its end, with the test's scope as its temp folder, and
// fails the test with its output when it exits non-zero.
function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, TMPDIR: scope.dir },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} exited ${result.status}${result.error ? ` (${result.error.message})` : ""}:\n${output}`,
  );
  return output;
}

/** Packs the kit as a release does, into `dest`, and answers the tarball's path. */
function packKit(dest: string): string {
  const stage = path.join(scope.dir, "stage");
  const stagedKit = path.join(stage, "packages/kit");
  mkdirSync(stagedKit, { recursive: true });
  for (const file of ["package.json", "pnpm-workspace.yaml", "LICENSE"])
    copyFileSync(path.join(REPO, file), path.join(stage, file));
  copyFileSync(path.join(KIT, "package.json"), path.join(stagedKit, "package.json"));
  run("pnpm", ["run", "build", "--outDir", path.join(stagedKit, "dist")], KIT);
  mkdirSync(dest, { recursive: true });
  run("pnpm", ["pack", "--pack-destination", dest], stagedKit);
  return path.join(dest, TARBALL);
}

test("the release tarball installs into a tool, and its command and entries run", () => {
  const tarball = packKit(path.join(scope.dir, "release"));
  assert.ok(existsSync(tarball), `pnpm pack did not write ${TARBALL}`);

  const tool = path.join(scope.dir, "cfx-sample");
  writeFiles(tool, {
    "package.json": JSON.stringify({ name: "cfx-sample", private: true, packageManager }),
    "AGENTS.md": `# cfx-sample\n\n${STRATEGY_HEADING}\n\nRun \`pnpm test\`.\n`,
    "CLAUDE.md": `${IMPORT_LINE}\n`,
  });
  // The kit's dependencies come from the store the workspace installed from.
  // pnpm asks the registry only for metadata it has not cached yet.
  run("pnpm", ["add", "-D", "--prefer-offline", tarball], tool);

  assert.match(run("pnpm", ["exec", "c-f-x", "check", "docs"], tool), /check docs: passed/);

  const entries = [
    "const kit = await import('@c-f-x/kit');",
    "const worker = await import('@c-f-x/kit/worker');",
    "console.log(typeof kit.runSteps, typeof worker.healthHandler);",
  ].join(" ");
  assert.equal(
    run(process.execPath, ["--input-type=module", "-e", entries], tool).trim(),
    "function function",
  );
});

test("README.md and the skill show the install line for this version's tarball", () => {
  for (const doc of ["README.md", "skills/c-f-x/SKILL.md"]) {
    const text = readFileSync(path.join(REPO, doc), "utf8");
    assert.ok(text.includes(INSTALL_LINE), `${doc} does not show \`${INSTALL_LINE}\``);
  }
});
