# cfx-kit: foundations and public readiness (2026-11-11)

The owner asked for /project-foundations, /test-setup and /oss-prep on cfx-kit before it goes public. This review is /project-foundations' first step and /test-setup's survey, taken on `master` at `10488f2`, and the gaps each skill finds. The same pull request closes the gaps it can and records the ground rules of D-8. What waits says why.

Every number below names the command that produced it. Machine: the owner's Mac, Node 26.8.1, pnpm 12.14.0, under other agents' load.

## Rules the docs stated, and whether they held

"Held" means a check fails when the rule breaks. "Untested" means nothing does. "False" means the doc said something that was not so.

| Rule (where stated) | At `10488f2` | Now |
|---|---|---|
| Docs name only paths that exist (`CLAUDE.md`, conventions 13) | held: `c-f-x check docs` | held |
| The agent brief has at most 150 lines (conventions 13) | held, on `CLAUDE.md` | held, on `AGENTS.md`, with the one-line `CLAUDE.md` and the test strategy heading |
| A run leaves nothing behind (conventions 12) | held: `c-f-x check run-scope` and `packages/kit/src/run-scope.test.ts` | held |
| `pnpm check` stops at its first failure | held: `packages/kit/src/ops/run-steps.test.ts` | held |
| No promise is left unawaited, types are strict | held: oxlint type-aware, `tsc` strict | held |
| The Worker entry reaches no `node:` module | held: `packages/kit/src/worker/entry.test.ts` | held |
| No vendor or competitor names (`CLAUDE.md`, conventions 14) | untested, said so | held: `c-f-x check names` |
| A check that reads source runs on a sample it must flag | untested: kept by habit in every check's test | untested |
| A rule written in a doc gets its check, or says none holds it | untested | untested |
| `@c-f-x/kit` stays `"private": true` until its first publish | untested | untested |
| Ported code keeps its notice in `THIRD_PARTY_NOTICES.md` | untested | untested |
| The kit holds only code that runs in a tool (D-5) | untested: a judgement | untested |
| Pull requests touch only their own files plus one registration line | untested | untested |
| The README and the brief list every check the command has | not stated; both lists were hand-written | held: `packages/kit/src/checks/index.test.ts` |
| Conventions: the shared repository is `c-f-x/cf-kit`, tools are `c-f-x/cf-status` and so on | false since D-9 | fixed: `cfx-` names |
| Conventions 1: cfx-analytics and cfx-mail are "today's" private repositories | false since they went public | fixed |
| Conventions 12: `CLAUDE.md` holds the test strategy table | became false in this change | fixed: `AGENTS.md` |
| Conventions 14: `names` waits for an owner decision | false: the owner ruled (D-8) | fixed |

Counts at `10488f2` (from the table, not counting the rows this change added): 6 held, 7 untested, 3 false. Now: 8 held, 6 untested, and none false that this review found.

## Test times and flaky tests

| Step | Command | Time |
|---|---|---|
| lint | `/usr/bin/time -p npx -y pnpm@12.14.0 lint` | 3.5 s |
| typecheck | `/usr/bin/time -p npx -y pnpm@12.14.0 typecheck` | 1.5 s |
| test | `/usr/bin/time -p npx -y pnpm@12.14.0 test` | 6.5 s: `node --test` reports 97 tests in 2.9 s, Vitest 21 tests in 1.9 s |
| build | `/usr/bin/time -p npx -y pnpm@12.14.0 build` | 0.8 s |

Load average 8.4 (`uptime`), at `10488f2`. After this change, `node --test` runs 144 tests; `AGENTS.md` holds the new times.

CI, from `gh run view <id> -R c-f-x/cfx-kit --json jobs`: the last four pull-request runs took 46 to 71 s from creation to verdict, of which 3 to 4 s queued. Of the last 21 runs (`gh run list -R c-f-x/cfx-kit --limit 50`), 20 passed and 1 failed. The failure, run 43084047393, was the run-scope race: one run's sweep trashed a folder another run had already removed. Commit `7742e32` fixed its cause, and no run has failed since. One run, 43098415146, has sat queued with no job since 20:50, for a branch already merged. Its cause was not looked into; the lead may cancel it.

No test was looped to look for flakiness in this pass. The suite has no retries and no skips.

## Gaps against /project-foundations

- **Step 2, docs.** The brief, conventions and the decision log exist. There is no separate architecture doc: `AGENTS.md`'s layout table is the kit's map, which suits a library this size. A table copied from code: the check lists in `README.md` and `AGENTS.md`. Closed by `packages/kit/src/checks/index.test.ts`.
- **Step 3, guards.** The six untested rules above. Each waits: three are judgements a reviewer makes (D-5, the one-home rule, "a rule gets its check"); `"private": true` and `THIRD_PARTY_NOTICES.md` are cheap to check and wait only because this pull request is already wide; the file-scope rule is weeder's C1 and guardrail paths, once the kit names them in a `weeder.toml`.
- **Step 4, the assembled program.** `packages/kit/src/cli.test.ts` and every check's CLI test run the real command. Held.
- **Steps 5 to 7.** The kit keeps no store, makes no metered call and has no schema. They apply to the tools, and conventions 5, 7 and 9 say so.
- **Step 8, tests catch breaks.** Every new rule in this change was broken once in its code and turned its test red. The older checks' tests were not re-broken in this pass, and no mutation tool runs on a schedule. Waits until the suite or the stakes grow.
- **Step 10, what ships is what was checked.** `pnpm check` runs the built command on the kit. There is no release yet, so no release check. Waits for the first publish.

## Gaps against /test-setup

- Steps 1 to 3 hold: the suite takes seconds, so every pull request runs it whole, and so does every push to `master`. It needs no changed-only selection.
- **One runtime version.** `.node-version` says 24 and CI reads it, but local runs on the owner's Mac use Node 26.8, and nothing stops a run on another major. Waits: enforcing it now would stop every local run on this Mac. That is the lead's call.

## Gaps against /ci-runner

- The runner's idle size is not written down. Measuring it needs `check-runners.sh` outside this repository. Waits, and may never be needed: the runner is removed when the repository goes public.

## Gaps against /oss-prep

- **README:** rewritten as a product page, after tilth's: what it is, real output, what is in it, what it does not do, install, support, licence. The usage example cannot run for an outside reader until `@c-f-x/kit` is on npm. The README says so.
- **Licence:** MIT, settled (D-6).
- **CI:** build, lint and test on every push and pull request. Added a weeder job.
- **FUNDING and Support:** added, after tilth's.
- **Dependabot:** added, for npm and github-actions.
- **Description and topics:** the description stands. Topics added: cloudflare, cloudflare-workers, self-hosted, typescript, developer-tools, guardrails.
- **Versions in sync:** the root `package.json` and `packages/kit/package.json` both say 0.0.0, and `pnpm install --frozen-lockfile` passes. No tag yet; the first tag comes with the first publish.
- **History**, all 26 commits (`git log --all -p`):
  - no secret-shaped strings: no private key block and no token prefix of the common providers;
  - no personal paths: no `/Users/` or `/home/` in any change;
  - the owner's hub hostname appears 4 times and a product's hostname once, in D-7 and conventions 3a. Redacted in this change. The fresh history the lead makes when the repository opens leaves them out;
  - every commit's author email is the owner's personal address. If the owner would rather not publish it, the fresh history can use the owner's GitHub noreply address. That is the owner's call;
  - conventions 4 names the owner's private site repository. Kept: a private repository's name reveals nothing, and agents need to know where the site folder lives.

## Ground rules (D-8) on the kit

The kit is not a tool, so `c-f-x check layout` does not run on it. It now meets the rules that apply: `AGENTS.md` and a one-line `CLAUDE.md`, the skill `skills/c-f-x/SKILL.md`, `SECURITY.md`, dependabot, FUNDING and the Support badge, weeder's guard and CI job, and a tend map in `docs/tend/`. Two wait for the brand's own pull request, because the brand will live in the kit's `.brand/`: `.petalsrc`, and a landing page.

Measured on the two public tools, by cloning each and running the kit's command from source: `c-f-x check layout` finds 16 problems in cfx-mail and 12 in cfx-analytics, and `c-f-x check names` finds 7 and 958. The 958 are almost all the analytics vendor whose SDKs cfx-analytics accepts, which its `vendors` list will allow. The rest are real names in comments, docs and a vendored script, each for the tool to reword or list.
