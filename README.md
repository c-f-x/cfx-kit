# cfx-kit

**The shared rules and code of c-f-x, a family of self-hosted tools that run on Cloudflare.** Each c-f-x tool lives in its own repository and does one job, for a solo developer or a small team. cfx-kit is what they have in common: the `c-f-x` command, which checks that a tool keeps the family's rules, and the code every tool runs.

A tool runs the checks from its own folder. Here is a new tool repository that has only started:

```
$ c-f-x check layout
docs/data-model.md is missing
docs/contract.md is missing
docs/spec/behaviours.md is missing
no test runs the health contract: a *.test.ts file must import checkHealthContract from @c-f-x/kit/worker and call it
skills/cfx-status/SKILL.md is missing: it is the skill agents install with `npx skills add c-f-x/cfx-status`
README.md has no ## Install section
...
docs/tend/ holds no *.tend.html map: run `tend init`
check layout: failed with 17 problems
```

Every problem names the file and the rule. The rules are written once, in `docs/conventions.md`, each with the check that holds it.

## What is in it

**Eight checks**, each run as `c-f-x check <name>`:

| Check | Fails when |
|---|---|
| `docs` | a doc names a path that does not exist, or the agent brief `AGENTS.md` is missing, too long or has no test strategy |
| `names` | a tracked file names a vendor known only from research |
| `layout` | a tool lacks a file every tool keeps, its agent skill, its three ways to install, or its public files |
| `architecture` | pure code does I/O, parts reach into each other, or scheduled work runs outside `job` |
| `lifetimes` | a store has no written rule for what it keeps and what removes the rest |
| `migrations` | a schema step that already ran was edited |
| `wrangler-config` | the Wrangler config holds an id, a real hostname, an email address, a secret or a jurisdiction |
| `run-scope` | the test run leaves a file or a process behind |

Each check is tested on a sample repository it must flag and one it must pass.

**The ops runner.** Every operation on a tool is one command, `pnpm ops <tool> <command>`. Without `--go` it prints the plan and how to undo each step, and changes nothing. With `--go` it stops at the first failing step and lists what to undo. A deploy starts only from a clean checkout of the main line, ships only the bundle it checked, and waits for the tool's health.

**The Worker helpers**, from `@c-f-x/kit/worker`: the `/healthz` handler and the contract test every tool runs on it, `job` for scheduled work that records its outcome and pings a heartbeat, `notify` for plain-text mail, and the helpers that make and check machine keys.

**The site file.** A public tool repository holds no account id, hostname or email address. Those live in a private file per tool, which `loadSiteFile` reads and checks before a deploy starts.

## What it doesn't do

- It is not published yet. `@c-f-x/kit` goes to npm when the first tool needs it, so today no tool can install it.
- It does not deploy anything itself. Each tool composes the runner's steps with its own Wrangler commands.
- A check reads files. It cannot see whether a test passes, a page looks right or a sentence is true. The tool's own suite and its reviewers decide those.

## Install

For agents working in a c-f-x tool, the skill says how to use the kit: the checks, the ops runner, the Worker helpers and the site file.

```
npx skills add c-f-x/cfx-kit
```

For a tool, once the package is on npm:

```
pnpm add -D @c-f-x/kit
pnpm exec c-f-x check layout
```

To work on the kit itself, with Node 24 and pnpm 12.14:

```
pnpm install
pnpm check
```

`pnpm check` runs lint, types, every test and the build, then the kit's own checks on itself, and stops at the first failure.

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/jahala)

## License

MIT. See `LICENSE`, and `THIRD_PARTY_NOTICES.md` for the code ported from other projects.
