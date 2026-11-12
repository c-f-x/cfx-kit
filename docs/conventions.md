# c-f-x conventions

c-f-x is a family of self-hosted tools that run on Cloudflare, for a single developer or a small team. Each tool replaces a paid service. This document sets the rules every tool follows. Each rule names the check that holds it. A rule without a check says so.

The rules start from the two tools already running, cfanalytics and cfmail (see `cfos:docs/inventory.md`). Where they differ, cfanalytics' way wins, because it has the stronger guards.

This file and the family decision log, `docs/decisions.md`, live in `c-f-x/cfx-kit`. A bare path in them is in this repository. A path written `repo:path` is in another repository, and `tool:path` is in every tool's repository. `c-f-x check docs` fails when a bare path does not exist.

Today the kit has eight checks: `c-f-x check docs`, `names`, `run-scope`, `architecture`, `layout`, `lifetimes`, `migrations` and `wrangler-config`. It also has one command that writes, `c-f-x lock-migrations`, the ops runner of section 3, the site-file schema of section 4, and the Worker helpers of sections 6 and 8. The other checks named below are still to be built.

Cloudflare facts below were read on 2026-11-11 from the page named with each fact.

## 1. Repository layout

Each tool has its own repository in the `c-f-x` organisation on GitHub:
- `c-f-x/cfx-status`, `c-f-x/cfx-launch` and `c-f-x/cfx-errors`;
- `c-f-x/cfx-analytics` and `c-f-x/cfx-mail`, public since 2026-11-11, which began as `jahala/cfanalytics` and `jahala/cfmail` (`cfos:docs/owner-decisions.md`, section 10).

Every tool is named `cfx-<job>` (owner, 2026-11-11). Documents that cite today's repositories keep today's names and paths, because those are what exist.

Shared code lives in `c-f-x/cfx-kit` and is published to npm as two packages:
- `@c-f-x/kit` holds the ops runner, the site-file schema, admin sign-in, the lifetime sweep, and the guard checks, run as `c-f-x check <name>`. Its entry `@c-f-x/kit/worker` holds what a tool's Worker runs: the health handler and its contract test, `job`, `notify` and the key helpers. That entry imports no `node:` module, so a Worker can bundle it.
- `@c-f-x/ui` holds the web components and theme tokens.

Each repository installs these at a pinned version.

Reasons for one repository per tool:
- Other people install one tool, not the family. Cloudflare's deploy button needs each app to be self-contained. Its docs say "Cloudflare does not fully support monorepos". They also say an app in a subdirectory "must be fully isolated within that subdirectory, including any dependencies. Otherwise, the build will fail." (developers.cloudflare.com/workers/platform/deploy-buttons/, read 2026-11-11). A tool that depends on the kit as a published package builds alone. A tool that depends on it as a workspace folder does not.
- cfanalytics and cfmail already work this way. cfmail must stay separate anyway, because it merges from its upstream by hand.
- The code that exists twice today gets one home in the kit (`cfos:docs/inventory.md`, "What they share"). The UI kit has already been copied once (D-24 in cfanalytics). Three more tools would have meant three more copies.

The cost of this layout is that a change to a shared contract lands in two steps: a kit release first, then each tool. The health contract that cfx-status reads is an example. The contract tests live in the kit, so every tool runs the same test at the version it pins.

Each tool repository also keeps `tool:c-f-x.json`, which tells the checks where its code is. It has three lists of folders, given as repository paths, and every folder it names must exist:
- `sources`: the source code the architecture check reads (section 2);
- `slices`: the folders whose subfolders are slices;
- `migrations`: the folders of numbered `.sql` schema steps (section 5).

An optional fourth list, `vendors`, names the vendors the tool integrates, which its public text may name (section 14).

For example: `{ "sources": ["src"], "slices": ["src/features"], "migrations": ["migrations"] }`. The checks run from the tool repository's own folder.

**Checks:**
- `c-f-x check layout` fails when a tool repository lacks any of: `tool:wrangler.jsonc`, `tool:docs/data-model.md` with a lifetimes table (section 5), `tool:docs/contract.md` or `tool:docs/spec/behaviours.md`. It also fails when no test runs the health contract (section 6). A test runs it when a `*.test.ts` file imports `checkHealthContract` from `@c-f-x/kit/worker` and calls it. The check looks through the whole repository, except `node_modules`, `dist`, `.git` and `.wrangler`. It cannot see whether the test passes; the tool's own suite decides that. The same check holds the ground rules of section 16.
- A fresh-clone check in CI installs only from npm, then runs `wrangler deploy --dry-run`. It proves the repository builds alone.

## 2. Code style

Side effects stay at the edge, dependencies are passed in, failures live in the return type, data flow is explicit, and functions can be replaced by their value. `c-f-x check architecture` holds the rules below. It comes from `cfanalytics:scripts/architecture.test.mjs` and reads the `sources` folders of `tool:c-f-x.json`, less tests and type declarations:
- Files under a folder named `core` do no I/O, read no clock or random source, and never throw. They import no `node:` or `cloudflare:` module and no `hono`, and a relative import must reach another file under `core`. A type-only import may come from anywhere.
- Slices of an app meet only through their `index.ts`. A slice is a subfolder of a `slices` folder.
- Each slice owns its SQL. Nothing holds this yet: cfanalytics' check names its own files, and the general form is still to be written.
- Scheduled work runs only through the kit's `job` (section 6).
- There is no module-level mutable state: no top-level `let` or `var`, and no top-level `Map`, `Set` or `Array` made with `new`.
- No jurisdiction is written into the code. Where data is stored is each installation's choice, in its site file (section 5). Wrangler's config cannot set a Durable Object's jurisdiction, so the code does: when the site names one, the Worker reads it from the var `JURISDICTION`, which the deploy sets from the site file, and makes its object ids on `.jurisdiction(env.JURISDICTION)`. The check fails on a `.jurisdiction(` call given a string written into the code. It cannot see whether every id that holds data goes through the site's value.
- No promise is left unawaited. This is held by oxlint `typescript/no-floating-promises` in type-aware mode, plus strict TypeScript with `noUncheckedIndexedAccess`.
- Each check that reads source text also runs on a sample it must flag.

Toolchain, the same pinned versions in every repository, set through shared config files in the kit: Node 24, pnpm 12.14, TypeScript 7, Biome, type-aware oxlint, Vitest 5 with `@cloudflare/vitest-plugin`, Hono, React 19, Vite, Tailwind, TanStack Router and Query. There is no ORM. SQL is written by hand with bound parameters, as in cfanalytics.

## 3. Deploy path

Every operation is one command: `pnpm ops <tool> <command> [--go]`. The runner is `packages/kit/src/ops/`, moved into `@c-f-x/kit` from `cfanalytics:scripts/lib/run-steps.mjs`, `cfanalytics:scripts/lib/ops.mjs` and `cfanalytics:scripts/ops.mjs`. A tool defines each operation as a list of steps. Each step runs a command or a function and names its undo:
- A step without an undo is refused when the operation is defined, before the plan prints.
- Without `--go`, the runner prints each step and how to undo it, and changes nothing.
- It stops at the first failing step. It names that step and its exit code, lists the steps not run, and lists the undo of each step that ran, newest first.
- An operation that changes a deployment starts only from a clean working tree whose `HEAD` equals `origin/master`, fetched first. Without `--go`, a tree that would be refused is a note on the plan.
- Every run gets a scratch folder of its own from the run-scope library, removed at the end.
- A deploy ships only the bundle it checked. The kit's same-bundle step compares the folder the checks bundled into with the folder the deploy uploaded from.
- A deploy waits for the tool's `/healthz` before it reports success. The kit's health step asks again until a deadline the tool passes in. When it gives up, it names the parts the last answer said failed.
- CI never deploys.

The kit holds the runner and these building blocks. Each tool's own `deploy` composes them with its wrangler commands, which the kit does not know.

Commands per tool: `install`, `deploy`, `secrets`, `health`, `backup`, `restore`, `export`, `uninstall`.

**Checks:** the kit's tests hold the runner's rules: `packages/kit/src/ops/operation.test.ts` (plan first, the first failure stops the run, every step names its undo, and the clean tree and current `origin/master`, on sample git repositories), `packages/kit/src/ops/run-steps.test.ts`, `packages/kit/src/ops/bundle.test.ts` and `packages/kit/src/ops/health.test.ts`. Nothing holds yet that each tool has every command above, that each runs through the kit's runner, or that CI never deploys.

## 3a. One deployment per tool, products attach by hostname

The owner's ruling (D-7): each tool runs as one shared deployment for all of the owner's products, a hub like cfanalytics at analytics.example.com. A product reaches it through its own hostname, attached to the hub's Worker as a Custom Domain: `e.<product domain>` for cfx-analytics, `status.<product domain>` for cfx-status. The browser then talks only to the product's domain, and there is still one Worker, one store and one place to look. A tool gets a deployment of its own for one product only when that product is very large, and that is the owner's call.

So each tool's data model keys its rows by project or product, and each tool's site file lists the product hostnames it serves (section 4).

**Check:** none yet. A tool's deploy fails if its site file names a hostname whose zone is not in the account, because Custom Domains need "An active Cloudflare zone" (developers.cloudflare.com/workers/configuration/routing/custom-domains/). Nothing checks that a tool has one deployment.

## 4. Configuration and deployment values

The public repository holds no account id, hostname, resource id or email address. These deployment values live in a private site folder outside the repository, found through `CFX_SITE`: one file per tool, `<tool>.jsonc`, so work on two tools never edits the same file. For the owner, the folder is a checkout of the private repository `jahala/c-f-x-site` (created 2026-11-11). At deploy time, the runner joins the template `wrangler.jsonc` with the tool's site file into a generated config in the run's own scratch folder, and removes that file at the end.

Each site file is validated by a zod schema exported from `@c-f-x/kit`, `siteSchema`. It holds what every tool needs, and refuses a field it does not know:
- `account_id`: the Cloudflare account, 32 lower-case hex characters;
- `hostnames`: the tool's hostnames by role, at least one, for example `{ "admin": "status.example.com" }`;
- `admin_emails`: who may sign in as an admin (section 8), at least one;
- `alert_addresses`: who the tool's alerts and notices go to, at least one. Each must also be in the tool's `send_email` allowlist;
- `jurisdiction`: where the installation keeps its data (section 5). Left out, Cloudflare places it; `"eu"` keeps it in the EU.

A tool adds its own fields with `siteSchema.extend({...})`. `loadSiteFile(tool, schema, site)` reads `<tool>.jsonc` from the folder `site` names, the value of `CFX_SITE`, parses it as JSONC and checks it. It never throws. It answers the value, or the problems, each naming the file and the field that is wrong. The kit's test is `packages/kit/src/site.test.ts`. A wrong or missing value stops the deploy before any step runs. Nothing holds that yet: no tool's deploy loads its site file through the kit so far.

**Check:** `c-f-x check wrangler-config`, merged from `cfanalytics:scripts/wrangler-config.test.mjs` and `cfmail:scripts/wrangler-config.test.mjs`, reads `tool:wrangler.jsonc` with a JSONC parser. It fails on:
- an account id or zone id, and any value shaped like a resource id (a UUID or 32 hex characters);
- a real hostname in a URL, a route or a `vars` value, and any email address. Only `example.com` and the names under it are allowed;
- a secret: a value under a key named like a credential (secret, token, password, API key, private key), or the name of any secret the tool lists in `tool:.dev.vars.example`. Wrangler's `secrets.required` list may name them, because it holds no values;
- a key named `jurisdiction`, in any block. Where data is stored is the site file's value (section 5), which the deploy joins into the config it generates;
- a `.dev.vars` file that git does not ignore.

A `vars` block is allowed, and its values are checked like every other value. A Durable Object's jurisdiction is set in code, so `c-f-x check architecture` holds that no literal one is written there (section 2). Nothing holds yet that a deploy joins the site's jurisdiction in: no tool's deploy loads its site file through the kit so far.

## 5. Data stores and their lifetimes

Each store says what it keeps, how long, and what removes the rest, from day one. A change to the shape of stored data is a new numbered migration, never an edit to one already applied.

Each app's `tool:docs/data-model.md` has a heading `## Lifetimes`. The first table under it has exactly these columns, in this order: `Store | Holds | Lifetime | Removed by`. It has one row per store, and no cell is empty. The `Store` cell holds only the store's name, in backticks:
- a D1 database, R2 bucket or KV namespace by its binding name in `tool:wrangler.jsonc`;
- a Durable Object by its class name. A Durable Object that keeps no data says `nothing` under `Holds`;
- a table by the name the migrations give it. A table the migrations drop or rename needs no row under its old name.

For example:

| Store | Holds | Lifetime | Removed by |
|---|---|---|---|
| `DB` | the registry of checks and their results | as long as the tool runs | uninstall |
| `Prober` | nothing | none | nothing |
| `results` | one row per check run | 30 days | the daily sweep |

Where data is stored is a choice each installation makes once, in its site file's `jurisdiction` (section 4): left out, which is the default, Cloudflare places the data; `"eu"` keeps it in the EU. A tool may have users anywhere, so no tool fixes a region (owner, 2026-11-12, D-10). The public `wrangler.jsonc` names no jurisdiction. The deploy joins the site's value into each D1 and R2 binding of the config it generates, and into the var `JURISDICTION` that Durable Object code reads (section 2). Cloudflare says "Jurisdictions can only be set on database creation and cannot be added or updated after the database exists" (developers.cloudflare.com/d1/configuration/data-location/, read 2026-11-11). So `install` sets the jurisdiction when it creates each store, and a deployment keeps the jurisdiction it was created with: the owner's deployments made in the EU stay there, and their site files say `"eu"`.

What goes where:
- Per-project data that grows (errors, results) goes in a SQLite Durable Object, as in cfanalytics. Cloudflare's page says Workers "may still access Durable Objects constrained to a jurisdiction from anywhere in the world", and that the object id "will be logged outside of the specified jurisdiction for billing and debugging purposes" (developers.cloudflare.com/durable-objects/reference/data-location/).
- Small shared registries (projects, keys, pages) and modest time series go in D1. The D1 size limit is 10 GB on Workers Paid (developers.cloudflare.com/d1/platform/limits/).
- Blobs go in R2. Each bucket also gets a lifecycle rule as a backstop. Cloudflare says objects "will typically be removed from a bucket within 24 hours" of expiry (developers.cloudflare.com/r2/buckets/object-lifecycles/).

Each tool runs one daily sweep, which logs `sweep_done` with counts per store.

**Checks:**
- `c-f-x check lifetimes` fails when a D1, R2 or KV binding or a Durable Object class in `tool:wrangler.jsonc`, or a table in the migrations, has no row in the lifetimes table. It also fails on a row that names no store, and on a table that breaks the format above. A Durable Object bound from another Worker is that Worker's store.
- Each lifetime rule has a behaviour test that ages fixture rows and expects them gone.
- `c-f-x check migrations`, from `cfanalytics:scripts/migrations.test.mjs`, fails when an applied migration changes. `tool:migrations.lock.json` holds the SHA-256 of every `.sql` step in the `migrations` folders of `tool:c-f-x.json`. The check fails on a locked step that changed or is missing, on a step that is not locked, and on a new step that sorts before a locked one. It also fails when the branch changed an entry that the lock held where the branch left `origin/master`, so a CI checkout must fetch the main line (`fetch-depth: 0`). `c-f-x lock-migrations` adds new steps to the lock and never changes an entry already there.

## 6. Health, background work and alerts

Every tool answers `GET /healthz` with `{"ok":true,"parts":{"db":"ok",...}}` and status 200, or status 503 with `"ok":false` and every part that failed marked `"failed"`. It sends `Cache-Control: no-store` and refuses other methods with 405. `@c-f-x/kit/worker` exports the handler, `healthHandler(probes)`. Each probe is an async function the tool passes in, which answers true when its part answered. A probe that answers false or throws marks its part failed. The handler logs why as a `health_failed` line, and the caller sees only `"failed"`.

Background work records its outcome. Each scheduled job runs through `job(name, fn, options)` from `@c-f-x/kit/worker`. It logs one JSON line, `job_done` or `job_failed`, with the job's name and its duration in milliseconds. It never rejects, so one job's failure never stops the others. When the tool passes a heartbeat address, `job` pings it with POST after every run: as it is on success, and with `status=fail` added on failure, which cfx-status marks down at once instead of waiting for the window to pass. The address holds a token, so it is a secret of the tool, put there by cfx-status's `heartbeat` command (`cfos:docs/cf-status.md`, section 7), never a site-file value. A ping that fails is logged on the outcome line and changes nothing else. Someone who installs one tool without cfx-status still gets the logged outcome. A heartbeat that misses its window raises an alert. This covers jobs that crash silently, as well as backups and sweeps. A Durable Object alarm that runs through `job` never throws, so the runtime does not retry it; a job that must be retried schedules its next alarm itself.

cfx-status is the one path for health alerts. No other tool mails the owner about its own health. Product notifications are a tool's feature and go through `notify(binding, mail)` from `@c-f-x/kit/worker`, for example cfx-errors' new-issue mail or cfx-launch's digest. It sends one plain-text mail through the `send_email` binding the tool passes in, and answers the message id or the binding's refusal, never a throw. cfx-status and `notify` both send through a `send_email` binding to verified addresses, the same way cfanalytics' watcher does (D-30), so an alert does not depend on cfmail. Cloudflare says sending to verified destination addresses "is free on Workers Free and Paid plans" (developers.cloudflare.com/email-service/, read 2026-11-11). Something outside Cloudflare watches cfx-status, because a monitor on Cloudflare cannot report a Cloudflare-wide outage. Choosing that outside watcher is an owner decision.

**Checks:**
- The health contract test, `checkHealthContract` from `@c-f-x/kit/worker`, runs in each app's own suite against its Worker. The tool passes its Worker's fetch, and for at least one part, the Worker reached with that part's probe failing. The test answers the clauses the Worker breaks: 200 with `"ok":true` and every part `"ok"` when healthy, 503 with `"ok":false` and the part marked `"failed"`, `no-store` on every answer, and 405 for POST. `c-f-x check layout` fails a tool whose tests never call it (section 1).
- Scheduled work runs only through `job`. `c-f-x check architecture` reads the body of each `scheduled` handler and each Durable Object `alarm()`, leaves out every `job(...)` call, and fails on any call left over. `Promise.all`, `Promise.allSettled`, `waitUntil` and `map` may gather jobs, and the calls inside them are read too. A handler given by name, as in `scheduled: onCron`, must be defined in the same file, or the check fails because it cannot read it.
- The kit's own tests of the handler, the contract test, `job` and `notify` run on the real Workers runtime with real D1, KV and `send_email` bindings: `packages/kit/test/`.

## 7. Backups and restore

Each tool has `backup <folder>` and `restore <folder>`. Restore goes only into a deployment that holds no data. Repeat runs fetch only what is new and add nothing twice.

Cloudflare's own recovery is the first line: 30 days of point-in-time recovery for Durable Objects (cfanalytics D-9 and `cfanalytics:docs/data-model.md`; not re-read on Cloudflare's pages in this pass), and D1 Time Travel "up to 30 days in the past (Workers Paid plan)" (developers.cloudflare.com/d1/reference/time-travel/). It does not cover R2, and it does not survive the loss of the account. A weekly job on the owner's Mac runs every tool's backup into one encrypted folder and pings a cfx-status heartbeat, so a missed backup raises an alert.

**Check:** a round-trip slow test per tool: back up, restore into a fresh local deployment, compare every row and object. It runs in CI on pushes to `master`, as `cfmail:scripts/backup/roundtrip.slowtest.mjs` does.

## 8. Sign-in and keys

- **Admins** sign in with their Cloudflare account through OAuth, as in cfanalytics D-27. Only the emails listed in the site file are admitted. The session is an HMAC-signed cookie, so nothing is stored server-side. The code moves from `cfanalytics:apps/worker/src/platform/sign-in.ts` and `cfanalytics:apps/worker/src/platform/session.ts` into `@c-f-x/kit`.
- **Machines** use a secret key: a tool prefix plus 43 base64url characters from 32 random bytes. The prefixes are `cfs_sk_`, `cfl_sk_` and `cfe_sk_`, so secret scanners can recognise a leaked key. The server stores only the SHA-256 hex, with a label and the last-used day. A key is shown once. Each reader gets its own key, and a key is revoked by its id.
- **Public tokens** (`cfl_pk_`, and the public key in an error DSN) are not secret by design. Daily caps limit abuse.
- The key helpers are in `@c-f-x/kit/worker`, from cfanalytics' registry and cfmail's service keys. `secretKeyFrom(prefix, bytes)` and `publicTokenFrom(prefix, bytes)` make a key from 32 random bytes the caller passes in, for example `secretKeyFrom("cfs", crypto.getRandomValues(new Uint8Array(32)))`. `hashKey` gives the lower-case SHA-256 hex. `keyMatches(presented, storedHash)` compares in constant time. `bearerOf` reads `Authorization: Bearer`, and `isKeyShape` refuses a key of the wrong shape before any lookup. Their test is `packages/kit/test/keys.test.ts`.

**Checks:**
- A route walk, from `cfmail:apps/worker/test/api/route-walk.test.ts`, refuses an anonymous caller on every route not on the public list.
- A guard proof, from `cfanalytics:scripts/guard-proof.test.mjs`, removes each access check in a scratch copy and expects a named test to fail.

## 9. Metered calls

Every metered call goes through one door, which reserves the estimated cost before it sends. In these three tools, the only metered call is mail to recipients who are not verified addresses. That is cfx-launch's confirmation mail. Cloudflare Email Sending includes "3,000 included per month, then $0.35 per 1,000 emails" (developers.cloudflare.com/email-service/platform/pricing/). That mail goes through cfmail's `POST /api/svc/send`, which is the door.

cfmail limits a mailbox to 600 sends an hour, but it reserves no monthly budget. Adding a monthly budget counter to cfmail, shared by every service mailbox, is a task for cfmail. It is listed in `cfos:docs/owner-decisions.md` under work outside the family's repositories.

Checks run by cfx-status are outgoing fetches. Cloudflare counts them as subrequests: "10,000 (up to 10M)" per invocation on Paid (developers.cloudflare.com/workers/platform/limits/). They are not billed per call.

**Check:** `c-f-x check architecture` fails when a tool has more than one module named `mail.ts`, or when any other module sends mail. Sending means calling `.send(` on a `send_email` binding named in `tool:wrangler.jsonc`, importing `cloudflare:email`, naming cfmail's `/api/svc/send`, or importing `notify` from `@c-f-x/kit/worker`. Another module may still pass the binding to `mail.ts`. So a tool calls `notify` from its `mail.ts`. The kit's own `notify` module calls `.send(` itself. It is not under this check, because the check reads a tool's sources, not its dependencies.

## 10. Cost at small scale

Every tool runs on one Cloudflare account on Workers Paid. Cloudflare charges a "minimum charge of $5 USD per month for an account" (developers.cloudflare.com/workers/platform/pricing/). The owner already pays it for cfanalytics and cfmail. Each spec gives its own monthly estimate against the included amounts. At the sizes in the specs, all three fit inside them, so the added cost is $0. Each spec names the size at which that stops.

**No check yet.** A cost estimate is arithmetic in a document. Each spec's size test (section 12) proves the query and row budgets the estimate assumes.

## 11. Installing by someone else

A person needs a Cloudflare account on Workers Paid and one zone.

The quick path is Cloudflare's deploy button in each tool's README. Cloudflare "clones your source repository into the user's GitHub/GitLab account". It provisions the resources the Wrangler config asks for, including "KV namespaces, D1 databases, R2 buckets" and "Durable Objects" (developers.cloudflare.com/workers/platform/deploy-buttons/, read 2026-11-11). Worker secrets are named in `.dev.vars.example`.

The maintained path is `pnpm ops <tool> install` with a site file written from `site.example.jsonc`. Its plan creates the stores in the site file's jurisdiction (section 5), puts the secrets (drawn and piped, never printed), deploys and waits for health. `uninstall` lists everything it will delete and needs `--go`.

**Checks:**
- An install test runs `install`, `health` and `uninstall` against local Workers with a throwaway site file, and expects nothing to be left behind (section 12).
- The fresh-clone check of section 1 proves that the button's build works.

## 12. Tests

- Specs come first. Every test names a behaviour id from the app's `tool:docs/spec/behaviours.md`.
- Tests run on the real Workers runtime, with real Durable Objects, D1 and R2. Nothing of our own is mocked.
- Every list or loop is tested at the size it will meet. These are the `*.size.test.ts` files.
- A run leaves nothing behind. This is held by `c-f-x check run-scope`, from `cfanalytics:scripts/run-scope.test.mjs`.
- Each repository's `AGENTS.md` holds the test strategy, under `## Test strategy`, with the command for each kind of test and its measured time. `c-f-x check docs` fails when the heading is missing. It cannot see whether the times are current.
- While a repository is private, CI runs on self-hosted runners on the owner's Mac, set up through /ci-runner, with a `CI_RUNS_ON` override. A public repository runs on GitHub's runners (section 16, rule 7).

## 13. Docs and decisions

- Each app has `tool:docs/decisions.md`, with entries headed `## D-<n> · <title> · <status> (<date>)`. A later entry supersedes an earlier one, and both are marked.
- Docs name only paths that exist. This is held by `c-f-x check docs`, from `cfanalytics:scripts/docs.test.mjs`.
- Generated tables are current. Nothing holds this yet: the kit has not ported cfanalytics' generated blocks.
- `AGENTS.md` is the agent brief and stays within 150 lines, and `CLAUDE.md` holds only `@AGENTS.md`, held by the same check (section 16, rule 2).
- A change fixes every doc it makes false, in the same pull request.

## 14. Public text

Plain language: short sentences, no em dashes, no hype.

The owner's ruling (D-8): public text names no vendor that is known only from research. Competitor comparisons, prices, "replaces X" lines and market notes stay in private planning docs, such as `cfos:docs/candidates.md`. A vendor stays named where the repository uses its code or SDK, or is compatible with it, and wherever a licence notice requires it. Platforms stay named: Cloudflare, GitHub, npm and Paddle.

**Check:** `c-f-x check names` reads every file git tracks and fails on a research-only name. The names are stored as SHA-256 hashes in `packages/kit/src/checks/research-names.ts`, so the public repository does not spell them out. `scripts/hash-names.mjs` writes that file from a list of names; today's list is every `market[].service` of the family's private survey (`cfos:docs/research/survey/evaluated.jsonl`), less npm, GitHub Gist and GitHub Packages, which are platforms. A tool lists the vendors it integrates under `vendors` in `tool:c-f-x.json`, and may name those. How it matches:
- A name is lower-cased, loses any note in brackets, and is matched as whole words, up to four, on one line. "Acme Mail (hosted)" matches "acme mail" and "Acme  Mail", and a part of a joined word, as in `acme.io`, `acme-cloud` or `ACME_KEY`.
- A one-word name that is also a dictionary word (macOS's `/usr/share/dict/words`, alone or as a plural) is matched only in prose files (Markdown, HTML and text), only with a capital and then lower case, and only mid-sentence, after a lower-case word or a comma. In code, such a word is far more often a type than a name.
- So it misses a word-name at the start of a sentence or in a code comment, and an alias written only in brackets. A reviewer still reads for those.

## 15. The contract each tool fills

The plotplot garden reaches these tools only through contracts, so every garden tool stays usable on another stack. Each app's `tool:docs/contract.md` states the inputs, the outputs and the API, with the key each call needs. Each contract has a contract test written against the API only. A different implementation of the same contract could pass the same test.

**Check:** `c-f-x check layout` (section 1) requires `tool:docs/contract.md`. The contract test is part of each app's suite.

## 16. Ground rules for every repository

The owner's ruling (D-8): every c-f-x repository can be installed the way a professional tool is, tells agents how to work on it and how to use it, and follows the owner's setup skills. The rules below are the lead's reading of that ruling. Each names its check, or says that nothing holds it.

`c-f-x check layout` holds the rules a tool's files can show. Each rule it holds has a sample in `packages/kit/src/checks/ground-rules.test.ts` that must give exactly that rule's problem. The kit is not a tool, so `layout` does not run on it; the kit meets the rules that apply to it, and says below where it does not yet.

**1. The setup skills.** Every repository follows /project-foundations, /test-setup and /ci-runner from its first week, and /oss-prep before it goes public. What each asks is already written in this document:
- /project-foundations: a few docs and a decision log (section 13), a guard for every rule (each section's **Check**), stores with lifetimes (section 5), one door for metered calls (section 9), operations that stop at their first failure (section 3), and runs that leave nothing behind (section 12).
- /test-setup: the test strategy in `AGENTS.md` (section 12).
- /ci-runner: CI on the owner's Mac while a repository is private, with the way back of rule 7.
- /oss-prep: the public files of rule 4, a README that reads as a product page, the repository's description and topics, dependabot, versions in sync, the sponsor badge of rule 6, and a check of the history for secrets and personal paths before it opens.

Check: only in part. Following a skill is a judgement no file shows. `c-f-x check docs` holds that the test strategy section exists, and `layout` holds the files of rules 2 to 6. Nothing checks the history, the description and topics, or whether versions agree.

**2. Two agent guides, for two audiences.**
- `AGENTS.md` is the brief for agents working on the repository, and its one home. `CLAUDE.md` holds exactly one line, `@AGENTS.md`, which Claude Code reads as an import.
- `tool:skills/<repo>/SKILL.md` is for agents using the tool: how to connect a product, read its data and run it, and what needs the owner. Its frontmatter `name` is the folder's name and the repository's, and its `description` says when to use it. It holds no personal data, account ids or hostnames. Agents install it with `npx skills add c-f-x/<repo>`; that installer finds `skills/<name>/SKILL.md` in a repository (`vercel-labs/skills:docs/creating-skills.md`, "Skill Discovery", read 2026-11-11).

Check: `c-f-x check docs` fails, in every repository, on a missing `AGENTS.md`, one longer than 150 lines, and a `CLAUDE.md` that holds anything else. `layout` fails on a missing skill, a frontmatter `name` that is not the repository's, no `description`, an email address outside `c-f-x.com` and the example domains, and a 32-character hex id or a UUID. The repository's name is the `name` in its root `package.json`, which must be `cfx-<job>`. Nothing checks a skill for hostnames.

The kit's skill is `skills/c-f-x/SKILL.md`, named for the `c-f-x` command it teaches, and installed with `npx skills add c-f-x/cfx-kit` once the repository is public.

**3. A professional install.** The README's `## Install` section shows three ways, in this order:
- Cloudflare's deploy button (section 11), linking `https://deploy.workers.cloudflare.com/?url=https://github.com/c-f-x/<tool>`;
- `pnpm ops <tool> install`, with its plan and the undo of each step (section 3);
- `npx skills add c-f-x/<tool>`, for agents.

Check: `layout` fails unless all three appear, in that order, inside the section. It cannot see that the plan and undo are shown. The kit is a library, so its README shows the skill, the package and the commands to work on it.

**4. Public-repository files from day one.** `LICENSE` (MIT, D-6), `SECURITY.md` naming `security@c-f-x.com`, `.github/dependabot.yml` updating npm and github-actions, `docs/decisions.md`, and a README whose first line says what the tool is.

Check: `layout` fails on each file that is missing, a `LICENSE` that does not begin `MIT License`, a `SECURITY.md` without the address, and a dependabot config without both ecosystems. Whether the README's first line says what the tool is, a reviewer decides.

**5. The garden's tools, adopted and dogfooded.** plotplot's answer of 2026-11-11 says which of the owner's tools apply to a c-f-x repository.
- **weeder**, in every repository. Run `weeder guard install --protect master` in each clone. Add a CI job that installs weeder from its pinned release and runs `weeder check --base origin/master --strict` on each pull request, as `jahala/weeder:examples/ci/github.yml` does. weeder's guard refuses to install where husky owns the hooks, so a repository uses no husky. While a repository is private, the job writes its findings as text (`--format table`, because weeder writes SARIF whenever its output is not a terminal) and fails when weeder blocks (exit 2) or cannot judge (exit 3). When it goes public, the job writes SARIF and uploads it to code scanning: GitHub says code scanning is "enabled for public repositories by default", and a private repository needs a paid GitHub Code Security product (docs.github.com/en/get-started/learning-about-github/about-github-advanced-security, read 2026-11-11). Check: `layout` fails without a workflow that runs `weeder check --base origin/master`, and on a `.husky/` folder. Nothing in a repository can see whether a clone installed the guard; `weeder guard status` says so per clone.
- **tend**, in every repository. Run `tend init`, which writes `tool:docs/tend/` and a block in `AGENTS.md`. A map holds a few loops with checks that can fail, never one page per capability. Before each merge, the agent runs `tend lint docs/tend`, `tend verify` on the loops the change touches, and `tend gate --base origin/master`. Check: `layout` fails without a `tool:docs/tend/*.tend.html` page. Nothing in CI runs tend until it is released, because CI takes every toolchain from its setup steps and never from the Mac.
- **petals**, in every repository. Each keeps `.petalsrc`, naming the family brand (the kit's `.brand/` at a pinned tag) and the tool's product layer, and CI runs `petals check` on its HTML. The brand is not settled: it comes in its own pull request, from petals' draft and the owner's review. Until it exists, petals answers that it cannot judge (exit 3), so a tool passes its petals job once the brand exists. Check: `layout` fails without `.petalsrc`, and without a workflow that runs `petals check` or `petals gate`.
- **A landing page** for every tool, on GitHub Pages, at `c-f-x.github.io/<tool>`, built with the family's tokens. It publishes from the default branch's `/docs` folder: GitHub Pages can publish "the root of the repository (`/`) on the source branch or a `/docs` folder" (docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site, read 2026-11-11), and `/docs` keeps the page beside the docs and the root free for the code. The page is `tool:docs/index.html`, beside an empty `tool:docs/.nojekyll`, so Pages serves the files as they are instead of running Jekyll over every doc. The `c-f-x` organisation is on GitHub's free plan, which offers "GitHub Pages in public repositories" only (docs.github.com/en/get-started/learning-about-github/githubs-plans, read 2026-11-11), so a tool's page goes live when its repository goes public. Check: `layout` fails without `tool:docs/index.html` or `tool:docs/.nojekyll`. Whether the page uses the tokens, petals decides once the brand exists. The family's own site, `c-f-x.com`, is a separate small site, built after the brand.
- **pleach** is used per build, through the /pleach-plan skill, when a tool is built through verified agent work. Nothing in a repository sets it up.
- **Per machine, nothing in the repository:** hedge, tilth, mycelium, and well for paid calls made on the Mac.
- **Left out:** plotplot's stem, because c-f-x is not a garden bed and the stem refuses self-hosted runners; coldframe, because it does nothing yet; pollen, because it is a caller of cfx-launch; copeca, because it is a benchmark.
- Each friction with one of these tools is filed on that tool's own repository: reproduced, checked for duplicates, one problem per issue.

The kit itself has weeder's guard and job and a tend map. Its `.petalsrc` and its landing page come with the brand's pull request, because the brand will live in the kit's `.brand/`.

**6. Public text and sponsorship.** Public text follows section 14. Every repository has `.github/FUNDING.yml` saying `buy_me_a_coffee: jahala`, and a README `## Support` section with the badge tilth's README ends with, linking `https://buymeacoffee.com/jahala`. Check: `c-f-x check names` holds section 14, and `layout` fails without the funding file or the badge.

**7. Pull-request CI on GitHub's runners once public.** A self-hosted runner executes whatever a pull request contains, on the owner's Mac. So a public repository runs pull-request CI on GitHub's hosted runners only, or requires approval before an outside contributor's workflow runs. This restates D-4 as a rule every repository meets: while private, CI may run on the Mac runner; going public means setting the repository variable `CI_RUNS_ON` to `"ubuntu-latest"` and removing the runner (/ci-runner's `remove-runners.sh`) in the same step. Check: `layout` fails on a workflow line that names `self-hosted` anywhere but as the fallback of `vars.CI_RUNS_ON`, so the switch is always one variable. A file cannot show whether a repository is public; /ci-runner's setup script refuses to install a runner on a public one.
