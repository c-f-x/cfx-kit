# cfx-kit

The shared repository of c-f-x, a family of self-hosted tools that run on Cloudflare. Each tool lives in its own repository and is named `cfx-<job>` (D-1, D-2). This repository releases `@c-f-x/kit`: the `c-f-x` command, which runs the rule checks every tool repository shares, and the code those tools have in common. The licence is MIT (D-6). Each version is a tarball attached to the GitHub release for its tag, and tools install it from that URL (D-10). It is not on npm: that publish needs the owner's npm sign-in.

**State (2026-11-11):** foundations, the ops runner, the guards for tool repositories, the runtime helpers and the ground rules every repository meets (D-8, `docs/conventions.md` section 16). The command has eight checks and one writing command, listed below. The package exports the run-scope library, the ops runner and the site-file schema. Its entry `@c-f-x/kit/worker` exports what a tool's Worker runs: the health handler and its contract test, `job`, `notify` and the key helpers. The first consumer of all of it is cfx-status.

## Start here

| Doc | Read it for |
|---|---|
| `docs/conventions.md` | The family rules every tool follows, each with the check that holds it |
| `docs/decisions.md` | Decisions already made, with reasons, and who made each. Check it before asking the owner. |
| `README.md` | What this is, as a product page |
| `skills/c-f-x/SKILL.md` | How an agent in a tool repository uses the kit. It is the skill `npx skills add c-f-x/cfx-kit` installs. |
| `docs/tend/` | The tend map: the kit's bets and the checks that prove them |
| `docs/reviews/2026-11-foundations-and-public-readiness.md` | What held, what did not, and what waits, before the kit goes public |

## Layout

| Path | Holds |
|---|---|
| `packages/kit/src/cli.ts` | The `c-f-x` command |
| `packages/kit/src/checks/` | One file per check, with its test. `packages/kit/src/checks/index.ts` lists them. `source.ts` reads source text and `tool-config.ts` reads a tool's `c-f-x.json` and `wrangler.jsonc`. `ground-rules.ts` holds the rules of section 16 that `layout` runs. `research-names.ts` is generated: never edit it by hand. |
| `packages/kit/src/test-support/` | Test helpers: run the command, write sample repositories, make a sample a git repository |
| `packages/kit/src/run-scope.ts` | The run-scope library: a folder per run, and the sweep of dead runs |
| `packages/kit/src/ops/` | The ops runner (`docs/conventions.md`, section 3): the step runner, operations with a plan and an undo per step, the deploy preconditions, and the bundle and health steps a deploy composes |
| `packages/kit/src/site.ts` | The site-file schema and loader (`docs/conventions.md`, section 4) |
| `packages/kit/src/worker/` | `@c-f-x/kit/worker`, the Worker helpers (sections 6 and 8). It imports no `node:` module. |
| `packages/kit/test/` | The Worker helpers' tests, run by Vitest inside workerd (`packages/kit/vitest.config.ts`), with the test Worker they call |
| `packages/kit/src/read.ts` | The kit's one result type: a value, or the problems |
| `scripts/check.mjs` | `pnpm check`, run by the kit's step runner from source (`packages/kit/src/ops/run-steps.ts`) |
| `scripts/hash-names.mjs` | Writes `research-names.ts` from research-only names on stdin (section 14). The names stay out of the repository. |
| `.github/workflows/release.yml` | A release: on a tag `v<version>`, checks the tag against the kit's version, runs `pnpm check`, then builds, packs and attaches the tarball to the tag's GitHub release |
| `docs/ideas/` | Ideas not yet shaped into a loop |

The kit is TypeScript, built by `tsc` into the package's `dist` folder. Tests run the source directly: Node 24 strips the types, so the source uses only erasable syntax. The Worker helpers' tests run the source inside workerd, through Vitest and `@cloudflare/vitest-plugin` at the versions cfanalytics pins.

## Hard rules

- The trunk is `master`. Work on a branch and open a pull request. The lead merges.
- `@c-f-x/kit` keeps `"private": true` until its first publish, which is its own pull request and needs the owner's npm sign-in (D-6).
- Code ported from another project keeps that project's licence notice in `THIRD_PARTY_NOTICES.md`, added in the same change.
- The kit holds only code that already runs in a tool, and each piece names its first consumer (D-5).
- This file is the one agent brief. `CLAUDE.md` holds only `@AGENTS.md`, which imports it.
- Public text names no vendor known only from research (D-8, `docs/conventions.md` section 14). `c-f-x check names` holds it. Never commit a plain research name, even in a test: tests use invented names.
- A check that reads source text also runs on a sample it must flag.
- A rule written in a doc gets its check in the same change, or says that nothing holds it yet.
- A change fixes every doc it makes false, in the same pull request.
- The root files (`package.json`, the configs, `.github/workflows/ci.yml`) belong to the foundations. A pull request that adds a check touches its own files under `packages/kit/src/` and adds one entry to `packages/kit/src/checks/index.ts`.

## Checks this repository runs on itself

| Rule | Guard |
|---|---|
| Docs name only paths that exist, `AGENTS.md` has at most 150 lines and a test strategy, and `CLAUDE.md` holds only `@AGENTS.md` | `c-f-x check docs`, run by `pnpm check` after the build |
| No tracked file names a research-only vendor | `c-f-x check names`, run by `pnpm check` |
| A pull request does not weaken tests, add stubs, swallow errors or carry secrets | weeder: the `weeder` CI job, and the git hooks of `weeder guard install --protect master` in each clone |
| Each loop's code checks hold | `tend gate --base origin/master --runner "node --test --test-reporter=tap {evidence}"`, run by the agent before each merge. Nothing in CI runs it until tend is released. |
| A run leaves nothing behind | `c-f-x check run-scope`, run by `pnpm check`: it runs `pnpm test` again with a temp folder of its own, and fails on any file, repository file or process the run leaves |
| The release tarball installs into a tool, its `c-f-x` command and both entries run, and `README.md` and the skill show this version's install line | `packages/kit/src/release.test.ts`, which packs the kit as the release does |
| A release's tag names the kit's version | the first step of `.github/workflows/release.yml` |
| A run killed part-way leaves nothing after the next run | `packages/kit/src/run-scope.test.ts` |
| `pnpm check` stops at its first failing step | `packages/kit/src/ops/run-steps.test.ts`, on the runner `scripts/check.mjs` uses |
| No promise is left unawaited | oxlint `typescript/no-floating-promises`, type-aware. `test()` from `node:test` is exempt, because the runner awaits it. |
| The Worker entry reaches no `node:` module and nothing of the machine side | `packages/kit/src/worker/entry.test.ts` |
| Types are strict, with no unchecked index access | `tsc` with `strict` and `noUncheckedIndexedAccess`, and the scripts with `checkJs` |

## Checks for tool repositories

A tool runs these from its own folder, with `docs` and `run-scope` above. Each rule, and the tool's `c-f-x.json` that says where its code is, is in `docs/conventions.md`. This repository is not a tool, so it does not run the tool checks on itself.

| Command | Holds (conventions section) |
|---|---|
| `c-f-x check architecture` | `core/` is pure, slices meet through `index.ts`, no module state, one `mail.ts`, scheduled work only through `job`, Durable Objects in the eu (2, 5, 6, 9) |
| `c-f-x check layout` | The files every tool keeps, a test that runs the health contract, and the ground rules (1, 6, 16) |
| `c-f-x check names` | No research-only vendor names in tracked files (14). The kit runs it on itself too. |
| `c-f-x check lifetimes` | Every binding and table has a lifetimes row (5) |
| `c-f-x check migrations` | No applied schema step changes (5). `c-f-x lock-migrations` locks new steps. |
| `c-f-x check wrangler-config` | No ids, real hostnames, email addresses or secrets in `wrangler.jsonc`, and D1 and R2 in the eu (4) |

Each check's test builds a sample tool repository it must flag and one it must pass, inside the test's run scope.

## Test strategy

Measured on the owner's Mac on 2026-11-11, with a load average near 9 to 13 from other work, on Node 26.8 and pnpm 12.14.0, each with `/usr/bin/time -p`. CI runs Node 24. Measure again when the suite grows. How each number was taken: `docs/reviews/2026-11-foundations-and-public-readiness.md`.

| Command | Checks | Time |
|---|---|---|
| `pnpm lint` | oxlint (type-aware) and Biome. tend's renderer, `docs/tend/loop.js`, is left out: tend writes it. | about 3.5 s |
| `pnpm typecheck` | `tsc` on the kit, once with Node's types and once on the Worker code and its tests with the Workers types, and the scripts with `checkJs` | about 1.5 s |
| `pnpm test` | The kit's tests: first `node --test`, then Vitest for the Worker helpers inside workerd (`packages/kit/test/`). The check tests run the command on sample repositories, which is most of the time. | about 5 to 6.5 s. The runners report 146 tests in 3.5 s for `node --test` and 21 in 0.4 s for Vitest (2026-11-12). The slowest file, `release.test.ts`, takes about 1.5 s: it builds, packs and installs the kit. |
| `pnpm build` | `tsc` builds the kit | about 0.8 s |
| `pnpm check` | Lint, typecheck, test and build in order, then the built command's docs, names and run-scope checks on this repository, stopping at the first failure. It removes the build when it made it. | about 10 to 18 s; 17.7 s on 2026-11-12, at a load average near 9 |

When each runs:
- **Every pull request:** `pnpm check`, locally before pushing and in CI on the pull request's merge result. The suite takes seconds, so it always runs whole. The first pull request's CI took 51 s from opening to verdict: 9 s queued, then 42 s on the runner, of which `pnpm check` took 7 s and the setup and install the rest (2026-11-11).
- **The main line after each merge:** CI runs `pnpm check` on every push to `master`.
- **Heavy tests:** none yet.
- **A release:** the lead bumps `version` in `packages/kit/package.json` and the install lines in `README.md` and the skill in one pull request (`release.test.ts` fails until they agree), merges it, then pushes the tag `v<version>`. The release workflow runs `pnpm check` again before it packs. Nothing goes to npm (D-10).

While working, run one test file from `packages/kit`: `node --test src/checks/docs.test.ts`, or `npx vitest run test/job.test.ts` for a Worker helper. Check each command's exit code; never filter its output to decide whether it passed.

Known noise: the Vitest run prints one `uncaught exception ... email to someone@example.org not allowed` stack. It comes from Miniflare's local `send_email` binding, which logs its own refusal before `notify` catches it. The `notify` test provokes that refusal on purpose (`packages/kit/test/notify.test.ts`). Any other stack in the output is a real problem.

## CI

CI runs on GitHub's hosted runners: the repository variable `CI_RUNS_ON` is `"ubuntu-latest"`, and a public repository never runs CI on the owner's Mac (section 16, rule 7). Two jobs in `.github/workflows/ci.yml`: `check` runs `pnpm check`, and on pull requests `weeder` installs weeder v0.5.0 from its release and judges the diff. The workflow takes every tool from its setup steps and shares nothing by a fixed name. Its `runs-on` still falls back to the Mac runner of D-4 when the variable is unset; never unset it. The release workflow, `.github/workflows/release.yml`, runs on `ubuntu-latest` only, and only it may write to the repository, to create the release. Still to come: the weeder job's switch to SARIF and code scanning.

## Tooling

pnpm is pinned in `packageManager`. If the installed pnpm differs, run it through `npx -y pnpm@12.14.0`. Node is pinned in `.node-version`.

weeder's hooks are installed in this clone's shared git folder, so every worktree runs them. Check with `weeder guard status`. tend infers Vitest for a `.test.ts` file, but the kit's checks are `node --test` files, so pass the runner: `tend verify docs/tend/checks.tend.html --runner "node --test --test-reporter=tap {evidence}"`. The project loop's human check waits for the owner.

<!-- tend:begin -->
## tend — this project plans on loops

- Orient first: `tend next docs/tend` (or the `loop_next` MCP tool) — next up, running now, needs-you, gone stale.
- Nothing gets built that is not a loop first: shape the goal and its checks on the map before any code.
- Only `tend verify` writes a pass. Never hand-flip a checkbox — a naked [x] renders claimed, not proven.
- Done is what the checks say: a loop is done when every check on it carries a verified pass, and not one commit sooner.
- Record decisions, scope-outs and dead ends in the loop's `## Tried` — append-only memory for whoever comes next.
- The map holds bets, not maybes: ideas attached to a loop park in its `## Tried`; free-standing ideas park in `docs/ideas/`; shaping is the only transition onto the map.
- The by-laws are `docs/tend/practices.md` — the lessons this repository earned, carried into every work order. A line enters it by citing the `## Tried` entries that paid for it.
<!-- tend:end -->
