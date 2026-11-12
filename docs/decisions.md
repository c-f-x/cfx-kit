# Decisions

The decision log of the c-f-x family. One entry per decision. A decision is never changed in place; a later entry supersedes it, and both are marked. Each entry says who made it: the owner's rulings stand until the owner changes them, and the lead's decisions are open to the owner.

## D-1 · The name is c-f-x, and tools are cf-<job> · accepted, tool names superseded by D-9 (2026-11-11)

**Made by.** The owner. In the owner's words: "lets do c-f-x" and "we'll do cf-<name>".

**Context.** The family needed one name for its brand, its GitHub organisation, its npm scope and its domain, and a rule for naming each tool.

**Decision.** The brand, the GitHub organisation, the npm scope and the domain are all c-f-x. Each tool is named `cf-<job>`, for example cf-status.

**Consequences.** Packages are published as `@c-f-x/<name>`. Repositories are `c-f-x/cf-<job>`. Today's `jahala/cfanalytics` and `jahala/cfmail` become `cf-analytics` and `cf-mail` when they move.

## D-2 · One repository per tool, shared code as npm packages · accepted (2026-11-11)

**Made by.** The lead.

**Context.** The tools could live in one repository or in one each. `docs/conventions.md`, section 1, gives the reason that decides it: "Other people install one tool, not the family. Cloudflare's deploy button needs each app to be self-contained. Its docs say "Cloudflare does not fully support monorepos". They also say an app in a subdirectory "must be fully isolated within that subdirectory, including any dependencies. Otherwise, the build will fail."" A tool that depends on shared code as a published package builds alone. A tool that depends on it as a workspace folder does not.

**Decision.** Each tool has its own repository in the c-f-x organisation. Code that two or more tools share lives in this repository and reaches them as npm packages, installed at a pinned version.

**Consequences.** A change to a shared contract lands in two steps: a kit release first, then each tool. Contract tests live in the kit, so every tool runs the same test at the version it pins.

## D-3 · This repository is cf-kit · accepted, licence part superseded by D-6 (2026-11-11)

**Made by.** The lead, applying the owner's rule of D-1.

**Context.** The shared repository needed a name. The `cf-<job>` rule of D-1 covers it. The self-hosted CI runner is labelled with the repository's name, and a bare `kit` would give it a label too generic to tell apart from other projects' runners on the same Mac.

**Decision.** The repository is `c-f-x/cf-kit`, and its runner label is `cf-kit`. It publishes `@c-f-x/kit`. The package is marked private and is not published until the owner chooses a licence.

**Consequences.** `packages/kit/package.json` keeps `"private": true` until then, so `npm publish` refuses it. A published package is public whatever the repository's visibility, so the licence comes first.

## D-4 · CI runs on the Mac runner while the repository is private · accepted (2026-11-11)

**Made by.** The lead, under the owner's runner rules (the ci-runner skill).

**Context.** The owner's default is to run CI on self-hosted runners on the owner's Mac. A runner executes whatever a pull request contains, on that Mac, as the owner. That is safe only while everyone who can open a pull request is the owner or the owner's agents.

**Decision.** The one job, `check`, runs on a runner labelled `cf-kit`. Its `runs-on` reads the repository variable `CI_RUNS_ON`, and falls back to the Mac runner when the variable is unset. The workflow takes every tool from its setup steps, and shares nothing by a fixed name.

**Consequences.** CI runs only while the Mac is awake and logged in. Opening the repository means setting `CI_RUNS_ON` to `"ubuntu-latest"` and removing the runner in the same step. Because the workflow uses nothing that only the Mac has, it runs on GitHub's runners unchanged.

## D-5 · The kit holds only code extracted from tools that run today · accepted (2026-11-11)

**Made by.** The lead.

**Context.** Extracting a kit before a second tool uses it can freeze the wrong shapes.

**Decision.** Code moves into the kit only when it already runs in cfanalytics or cfmail, and each piece names its first consumer: the tool that will use it next, today cf-status. Nothing is written ahead of a user.

**Consequences.** The kit starts small: the `c-f-x` command, its docs and run-scope checks, and the run-scope library. Admin sign-in and the UI kit wait until cf-status needs them. A pull request that adds to the kit names where the code came from and who uses it first.

## D-6 · The licence is MIT · accepted (2026-11-11)

**Made by.** The owner. In the owner's words: "yes, MIT".

**Context.** D-3 kept `@c-f-x/kit` unpublished until the owner chose a licence. The lead recommended MIT: cfmail must stay MIT because its upstream is MIT, the donors are MIT, and MIT lets the most people use the tools. Its cost is that anyone may sell a hosted copy, which only a licence like AGPL-3.0 would prevent, at the price of fewer people adopting the tools.

**Decision.** Every c-f-x repository is licensed MIT. The copyright line is the owner's, as in cfmail's licence. Code ported from another project keeps that project's notice in `THIRD_PARTY_NOTICES.md`.

**Consequences.** `LICENSE` and `THIRD_PARTY_NOTICES.md` are in this repository, and each `package.json` says `"license": "MIT"`. The package keeps `"private": true` until its first publish, which is its own step: it needs the owner's npm sign-in on this Mac, and it happens when the first tool needs the package. This supersedes D-3's wait for a licence. D-3's rest stands.

## D-7 · One deployment per tool, and products attach by hostname · accepted (2026-11-11)

**Made by.** The owner. In the owner's words: "we could forward that to our hub (like [the owner's analytics hub]) etc.. we dont want to run individual services per product unless its a very large product".

**Context.** A product agent asked that anything a browser talks to sit on the product's own domain, such as `status.<product>.com`. That could read as one deployment of each tool per product.

**Decision.** Each tool is one shared deployment, a hub, for all of the owner's products. A product's own hostname is a Custom Domain on the hub's Worker, as cfanalytics does with `e.<domain>` intake hosts. Only a very large product gets a deployment of its own, by the owner's decision.

**Consequences.** A tool's rows are keyed by product. Its site file lists the hostnames it serves. A product keeps its one-domain rule without a service of its own. Conventions section 3a says so.

*The owner's hub and the product's hostname in this entry were redacted for public release on 2026-11-11. The decision is unchanged.*

## D-8 · Ground rules for every repository · accepted (2026-11-11)

**Made by.** The owner. In the owner's words: "for all the products - we should expect some kind of way of installing each product, that is quite professional - and also expect an agents.md and a skill per product, so agents will know how to use it? etc... some ground rules across all products? ... and we also expect them all to follow /project-foundations /oss-prep /test-setup etc etc....". On the garden's tools: "the repos should also use the relevant plotplot tools and dogfeed them? hedge, tend, weeder etc?". On pages: "every repo will have a UI design and a landing page", and "we'll build a simple landing page, like plotplot.ai has for c-f-x.com ... and have github pages for the products for now. like plotplot has". On public text: "remove ... i meant, to not mention research done, competitive research etc". On sponsorship: "sponsor accounts on all - the same as tilth". On pleach: "we might use pleach when building out some of the tools".

**Context.** cfx-analytics and cfx-mail went public on 2026-11-11, and cfx-kit follows. Each tool had grown its own way of being installed, briefed to agents and checked. The owner asked for one set of rules every repository meets. The lead's reading of the ruling, and which of the garden's tools apply, follows plotplot's answer of 2026-11-11 on how each garden tool is set up in a repository.

**Decision.** Every c-f-x repository meets the ground rules of `docs/conventions.md`, section 16: it follows the setup skills; it has `AGENTS.md` as its one agent brief, a one-line `CLAUDE.md` that imports it, and a skill for agents that use it; its README shows three ways to install; it keeps the public files from day one; it adopts weeder, tend and petals and has a landing page on GitHub Pages; its public text names no vendor known only from research; it carries the owner's sponsor badge; and once public, it runs pull-request CI on GitHub's runners only. The lead chose how each rule is checked; the owner's words above are the ruling.

**Consequences.** `c-f-x check layout` holds the rules a tool's files can show, `c-f-x check docs` holds the agent brief for every repository, and `c-f-x check names` holds the public-text rule. Rules no file can show say so in section 16. The kit is not a tool, so `layout` does not run on it, but the kit meets the rules that apply to it. Its brand, its `.petalsrc` and its landing page come in their own pull request, after the owner's review.

## D-9 · Tools are named cfx-<job> · accepted (2026-11-11)

**Made by.** The owner. In the owner's words: "i just realized... the tools should be named cfx-<toolname> ... no? thats better?", then "go for cfx-<toolname>".

**Context.** D-1 named tools `cf-<job>`. "cf-" reads like one of Cloudflare's own products, collides with existing packages and repositories, and does not carry the family's name.

**Decision.** Every tool is named `cfx-<job>`: cfx-status, cfx-mail, cfx-analytics. This repository is `c-f-x/cfx-kit`. The brand, the org, the npm scope (`@c-f-x/kit`, `@c-f-x/ui`) and the domain stay c-f-x, as D-1 set. Key prefixes (`cfs_sk_` and the like) are unchanged.

**Consequences.** This supersedes D-1's tool-name rule; the rest of D-1 stands. The repositories were renamed on GitHub, which redirects the old URLs. The CI runner is labelled after the new name. Entries above keep their original words.

## D-10 · Each installation chooses where its data is stored · accepted (2026-11-12)

**Made by.** The owner. In the owner's words: "we cant really limit data just to EU - we might have US users using our tools etc.... so Im not sure why that is a 'thing' really?". The rule it replaces, every store in the EU, was an agent's proposal, never the owner's ruling.

**Context.** The conventions required every D1 database, R2 bucket and Durable Object to sit in Cloudflare's `eu` jurisdiction, and two checks held it. Someone who installs a tool for users elsewhere had no way to choose.

**Decision.** Where data is stored is a choice each installation makes once, in its site file: a `jurisdiction` field, left out for Cloudflare's default placement, or `"eu"`. Left out is the default. The public `wrangler.jsonc` names no jurisdiction, and Durable Object code reads the site's value from configuration. The lead chose how it is held: `c-f-x check wrangler-config` fails on a `jurisdiction` key in the config, and `c-f-x check architecture` on a `.jurisdiction(` call given a string written into the code.

**Consequences.** A deploy joins the site's jurisdiction into the config it generates. Cloudflare cannot change a store's jurisdiction after it is made, so a deployment keeps the one it was created with: the owner's deployments made in the EU stay there, and their site files say `"eu"`. The install command creates stores in the site file's jurisdiction. `docs/conventions.md` sections 2, 4, 5 and 11 say so.

## D-11 · One repository standard for every tool, held by the kit · accepted (2026-11-12)

**Made by.** The owner asked for it. In the owner's words: "the installs should perhaps be as standardised as possible - using common standards for open source projects? to ease setup and installation?", "the readmes should have a very clear structure that we reuse? i think a short intro, and a screenshot should be at the top?", and "how can we add all these points to the kit, so that agents will follow them?". The lead chose the standard and how it is checked.

**Context.** Each tool's README ordered its parts differently. cfx-analytics had no install guide for agents, and no tool shipped a skill another person's agent could install. The research behind the choices is `cfos:docs/research/install-standards.md`: standard-readme for the order, the Agent Skills format for the skill, and GitHub's community files.

**Decision.** Every tool's README follows one order, with a bold line, a short intro, a screenshot and the shortest example at the top. Its `AGENTS.md` holds `## Install and set up` with fixed parts. Its skill follows the Agent Skills format and links the install guide. Every tool keeps the same files, and its `wrangler.jsonc` lists its secrets in `secrets.required`, as `.dev.vars.example` does. The install command has one contract. The deploy button waits until a scratch-account test passes and the tool needs no site values the button cannot set. `docs/conventions.md` section 11 and section 16 rules 2 to 4 say so, and `templates/tool/` holds the files a new tool copies.

**Consequences.** `c-f-x check layout` holds the README, the install guide, the skill and the files, and `c-f-x check wrangler-config` holds `secrets.required`. Section 16's former rule 3, three ways to install with the deploy button first, is replaced. cfx-analytics and cfx-mail do not meet the standard yet; the lead files the work in their repositories.
