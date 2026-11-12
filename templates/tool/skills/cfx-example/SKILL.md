---
name: cfx-example
description: Use when a product or a person needs cfx-example, a self-hosted tool on Cloudflare. Covers connecting a product to it, reading its data, checking that it works, and what needs the owner. For installing it, follow the tool's AGENTS.md, "Install and set up".
---

# cfx-example

Say in two sentences what cfx-example does, and for whom.

## Install

Installing is in the tool's [`AGENTS.md`, "Install and set up"](https://github.com/c-f-x/cfx-example/blob/master/AGENTS.md#install-and-set-up). Follow it there; this skill does not copy it.

## Connect a product

Show the one call or setting a product needs, with `example.com` values. Say where the key comes from and that it is shown once.

## Check that it works

`GET https://<the tool's host>/healthz` answers status 200 and `{"ok":true,...}`. A 503 names each part that failed.

## What needs the owner

- Signing in to Cloudflare and making the OAuth client for admin sign-in.
- Choosing the site file's values, and where the data is stored.
- Anything that deletes data, such as `uninstall --go`.

Everything else, such as connecting a product or reading its data with a key the owner gave, is the agent's to do.
