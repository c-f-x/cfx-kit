# cfx-kit

**The shared rules and code of c-f-x: self-hosted tools that run on Cloudflare, for a solo developer or a small team.**

Each c-f-x tool lives in its own repository and does one job. cfx-kit is what they have in common: the `c-f-x` command, which checks that a tool keeps the family's rules, and the code every tool runs. Below, it checks a tool repository that has only started. cfx-kit is part of [c-f-x](https://c-f-x.com).

```console
$ c-f-x check layout
docs/data-model.md is missing
docs/contract.md is missing
docs/spec/behaviours.md is missing
no test runs the health contract: a *.test.ts file must import checkHealthContract from @c-f-x/kit/worker and call it
skills/cfx-status/SKILL.md is missing: it is the skill agents install with `npx skills add c-f-x/cfx-status`
README.md: the line after the title must be one bold sentence, **like this**, the same words as the GitHub description
...
docs/.nojekyll is missing: without it, GitHub Pages runs Jekyll over every doc in /docs
check layout: failed with 25 problems
```

Every problem names the file and the rule. A tool's Worker answers its health check with the kit's handler:

```ts
import { healthHandler } from "@c-f-x/kit/worker";

export default {
  fetch: (request: Request, env: { DB: D1Database }) =>
    healthHandler({ db: async () => (await env.DB.prepare("SELECT 1").all()).success })(request),
};
```

## What it does

**Eight checks**, each run as `c-f-x check <name>`:

| Check | Fails when |
|---|---|
| `docs` | a doc names a path that does not exist, or the agent brief `AGENTS.md` is missing, too long or has no test strategy |
| `names` | a tracked file names a vendor known only from research |
| `layout` | a tool lacks a file every tool keeps, its agent skill, its install guide, or its public files, or its README breaks the family's order |
| `architecture` | pure code does I/O, parts reach into each other, or scheduled work runs outside `job` |
| `lifetimes` | a store has no written rule for what it keeps and what removes the rest |
| `migrations` | a schema step that already ran was edited |
| `wrangler-config` | the Wrangler config holds an id, a real hostname, an email address, a secret or a jurisdiction, or lists other secrets than `.dev.vars.example` |
| `run-scope` | the test run leaves a file or a process behind |

Each check is tested on a sample repository it must flag and one it must pass.

**The templates.** A new tool starts from `templates/tool/`: its README, agent brief with the install guide, skill, contributing guide, secrets list and issue templates. A tool made from them passes the checks.

**The ops runner.** Every operation on a tool is one command, `pnpm ops <tool> <command>`. Without `--go` it prints the plan and how to undo each step, and changes nothing. With `--go` it stops at the first failing step and lists what to undo. A deploy starts only from a clean checkout of the main line, ships only the bundle it checked, and waits for the tool's health.

**The Worker helpers**, from `@c-f-x/kit/worker`: the `/healthz` handler and the contract test every tool runs on it, `job` for scheduled work that records its outcome and pings a heartbeat, `notify` for plain-text mail, and the helpers that make and check machine keys.

**The site file.** A public tool repository holds no account id, hostname or email address. Those live in a private file per tool, which `loadSiteFile` reads and checks before a deploy starts. It also says where the installation keeps its data.

## What it does not do

- It is not on npm. Each version is a tarball attached to the kit's GitHub release for that version, and a tool installs it from there.
- It does not deploy anything itself. Each tool composes the runner's steps with its own Wrangler commands.
- A check reads files. It cannot see whether a test passes, a page looks right or a sentence is true. The tool's own suite and its reviewers decide those.

## Install

For agents working in a c-f-x tool, the skill says how to use the kit: the checks, the templates, the ops runner, the Worker helpers and the site file.

```bash
npx skills add c-f-x/cfx-kit
```

For a tool, from the tarball the kit's release for that version carries:

```bash
pnpm add -D https://github.com/c-f-x/cfx-kit/releases/download/v0.3.0/c-f-x-kit-0.3.0.tgz
```

The URL pins the version. A later version is the same line with its number in both places.

## Use

Run each check from the tool repository's own folder. Exit 0 passes, and 1 fails with one line per problem:

```bash
pnpm exec c-f-x check layout
```

The rules are written once, in `docs/conventions.md`, each with the check that holds it.

## Work on it

With Node 24 and pnpm 12.14:

```bash
pnpm install
pnpm check
```

`pnpm check` runs lint, types, every test and the build, then the kit's own checks on itself, and stops at the first failure.

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/jahala)

## License

MIT. See `LICENSE`, and `THIRD_PARTY_NOTICES.md` for the code ported from other projects.
