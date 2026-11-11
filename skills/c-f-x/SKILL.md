---
name: c-f-x
description: Use when working in a c-f-x tool repository (a cfx-<job> tool on Cloudflare) that depends on @c-f-x/kit. Covers running the family's rule checks with `c-f-x check <name>` and fixing what they flag, defining an operation for `pnpm ops <tool> <command>` with a plan and an undo per step, using the Worker helpers (health handler and contract test, job, notify, keys), and loading the private site file. Also says what needs the owner.
---

# c-f-x: the kit every tool uses

`@c-f-x/kit` holds the rules the c-f-x tools share and the code that keeps them. A tool installs it at a pinned version. The rules themselves are in the kit's `docs/conventions.md`. Read the section a check names before you change code to satisfy it: a check holds a rule, and the rule is what matters.

The package is not on npm yet. Until it is, a tool cannot install it, and only the kit's own repository runs this code.

## The checks

Run each from the tool repository's own folder. Exit 0 passes, 1 fails with one line per problem, 2 is a misused command.

| Command | Fails when |
|---|---|
| `c-f-x check docs` | a doc names a path that does not exist, `AGENTS.md` is missing, longer than 150 lines or has no `## Test strategy`, or `CLAUDE.md` holds anything but `@AGENTS.md` |
| `c-f-x check names` | a tracked file names a vendor known only from research |
| `c-f-x check layout` | a file every tool keeps is missing, no test runs the health contract, or a ground rule is broken: the skill, the three ways to install, the public files, the weeder and petals jobs, the tend map, the landing page |
| `c-f-x check architecture` | `core/` does I/O, slices reach into each other, module state, mail sent outside one `mail.ts`, scheduled work outside `job`, a Durable Object outside the eu |
| `c-f-x check lifetimes` | a binding or table in `wrangler.jsonc` or the migrations has no row in `docs/data-model.md` |
| `c-f-x check migrations` | an applied schema step changed. `c-f-x lock-migrations` locks new steps. |
| `c-f-x check wrangler-config` | `wrangler.jsonc` holds an id, a real hostname, an email address or a secret, or binds D1 or R2 outside the eu |
| `c-f-x check run-scope` | `pnpm test` leaves a file, a repository file or a process behind |

`c-f-x.json` at the tool's root tells the checks where its code is: `{ "sources": ["src"], "slices": ["src/features"], "migrations": ["migrations"] }`. Add `"vendors": [...]` for the vendors the tool integrates, whose names its public text may use. Never add a name to `vendors` to silence `names` when the tool does not use that vendor's code or SDK; reword the text instead.

Fix what a check flags in the tool. Never weaken a check, add an exception to its sample, or edit `migrations.lock.json` by hand.

## The ops runner

Every operation is one command, `pnpm ops <tool> <command> [--go]`: `install`, `deploy`, `secrets`, `health`, `backup`, `restore`, `export`, `uninstall`. The tool's own script builds each from the kit:

```ts
import { healthStep, runOperation, sameBundleStep, exitCodeOf } from "@c-f-x/kit";

const result = await runOperation(
  {
    name: "deploy",
    changesDeployment: true,
    steps: ({ scratch }) => [
      { name: "bundle", command: "wrangler", args: ["deploy", "--dry-run", "--outdir", `${scratch}/checked`], undo: "nothing to undo: a dry run changes nothing" },
      // ...the upload, sameBundleStep(checked, shipped), then healthStep({ ... })
    ],
  },
  { go: process.argv.includes("--go"), root: process.cwd() },
);
process.exitCode = exitCodeOf(result);
```

Without `--go` it prints the plan and each step's undo, and changes nothing. A step without an undo is refused before the plan prints. An operation that changes a deployment starts only from a clean checkout equal to a freshly fetched `origin/master`. The run stops at its first failing step and lists the undo of each step that ran, newest first. CI never deploys.

## The Worker helpers

From `@c-f-x/kit/worker`, which a Worker can bundle:

- `healthHandler({ db: async () => ..., ... })` answers `GET /healthz`. A probe answers true when its part works.
- `checkHealthContract({ fetch, failing: [{ part, fetch }] })` is the test every tool's suite runs on its Worker. It resolves to the clauses broken; expect none.
- `job(name, work, { heartbeat })` runs scheduled work. It logs `job_done` or `job_failed` and never rejects. Every `scheduled` handler and Durable Object `alarm()` runs its work through it.
- `notify(binding, mail)` sends one plain-text mail through a `send_email` binding, from the tool's one `mail.ts`.
- `secretKeyFrom(prefix, bytes)`, `hashKey`, `keyMatches`, `bearerOf` and `isKeyShape` make and check machine keys. Store only the hash.

## The site file

The public repository holds no account id, hostname or email address. Those live in a private site folder named by `CFX_SITE`, one `<tool>.jsonc` per tool, checked by `loadSiteFile(tool, siteSchema.extend({...}), process.env.CFX_SITE)`. It answers the value or the problems, never a throw. Write a `site.example.jsonc` with `example.com` values for other people.

## What needs the owner

- Deploying to the owner's account, putting secrets and running `uninstall` with `--go`.
- Publishing `@c-f-x/kit` to npm, which needs the owner's npm sign-in.
- Making a repository public, which also moves its CI to GitHub's runners and removes the Mac runner.
- Approving a page, a colour or wording someone will see, and any decision `docs/decisions.md` marks as the owner's.

Everything else, such as fixing what a check flags, adding a step with its undo or writing a test, is the agent's to do.
