# cfx-example

**Say what cfx-example is in one sentence, the same words as the repository's GitHub description.**

Say who it is for and what it does for them, in one or two sentences. Say what it runs on: one Cloudflare Worker and the stores it keeps. cfx-example is part of [c-f-x](https://c-f-x.com), a family of self-hosted tools that run on Cloudflare.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/cfx-example-dark.png">
  <img alt="Say what the main screen shows, and that the data in it is made up." src="docs/images/cfx-example-light.png">
</picture>

A product uses it with one request:

```bash
curl -sS https://tool.example.com/api/hello \
  -H "Authorization: Bearer $CFX_EXAMPLE_KEY"
# 200 {"ok":true}
```

## What it does

- One line per thing a person can do with it, in their words.

## What it does not do

- One line per thing a reader might expect and will not find, with the reason when it helps.

## Install

You need a Cloudflare account on the Workers Paid plan, which starts at $5 a month, and a domain on Cloudflare for the tool's address.

The easy way is to let your coding agent do it. Add this tool's skill, then ask the agent to install cfx-example:

```bash
npx skills add c-f-x/cfx-example
```

Or run the install command yourself. It prints its plan and how to undo each step, and changes nothing until you add `--go`:

```bash
pnpm ops cfx-example install
```

Every step, what only you can do, and how to undo it are in [`AGENTS.md`, "Install and set up"](AGENTS.md#install-and-set-up).

## Use

Show how a product connects, and the one call or screen most people need first.

## How it works

Say what runs where: the Worker, each store and what it keeps, and any scheduled job.

## Work on it

With Node 24 and pnpm 12.14:

```bash
pnpm install
pnpm check
```

`CONTRIBUTING.md` says how to propose a change.

## Support

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/jahala)

## License

MIT. See [LICENSE](LICENSE).
