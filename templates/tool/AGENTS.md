# cfx-example

Say in two sentences what cfx-example is and who uses it. This file is the one agent brief: it says how to install the tool and how to work on it. `CLAUDE.md` holds only `@AGENTS.md`, which imports it.

## Install and set up

This installs cfx-example on your own Cloudflare account. An agent can follow it without asking, and so can a person. Every command stops at its first failure; read its exit code before the next one.

### What you need

| Need | How to check it |
|---|---|
| A Cloudflare account on the Workers Paid plan | `npx wrangler whoami` names the account. The dashboard's Workers plans page says Paid. |
| A domain on Cloudflare for the tool's address | The dashboard lists the domain under the account, as Active. |
| Node 24 and pnpm 12.14 | `node --version` and `npx -y pnpm@12.14.0 --version` |
| The site file, outside this repository | `test -f "$CFX_SITE/cfx-example.jsonc"` exits 0 |

### The install command

```bash
pnpm ops cfx-example install
```

Without `--go` it prints the plan, each step with its undo, and changes nothing:

```console
Plan for install:

1. database
   runs: npx wrangler d1 create cfx-example
   undo: npx wrangler d1 delete cfx-example
...
Nothing ran. Run again with --go to run it.
```

With `--go` it creates each store in the site file's jurisdiction, puts the secrets without printing them, deploys, and ends with the health check. It stops at the first failing step and lists the undo of each step that ran, newest first.

### What only the owner can do

- Sign in to Cloudflare: `npx wrangler login` opens a browser.
- Make the OAuth client for admin sign-in in the Cloudflare dashboard (Manage account, OAuth clients): response type Code, grant type Authorization Code, token authentication Client Secret Basic, scope `user-details.read`, redirect `https://<admin host>/auth/callback`. Wrangler cannot make one.
- Choose the site file's values: copy `site.example.jsonc` to `$CFX_SITE/cfx-example.jsonc` and fill in the account, hostnames and addresses. Add `"jurisdiction": "eu"` to keep the data in the EU. It cannot change once the stores exist.

### Secrets

Each secret is piped into Wrangler, so its value never shows on screen. `read -rs` takes a pasted value without echoing it.

```bash
openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET --config wrangler.deploy.jsonc
read -rs v && printf '%s' "$v" | npx wrangler secret put CLOUDFLARE_CLIENT_ID --config wrangler.deploy.jsonc; unset v
read -rs v && printf '%s' "$v" | npx wrangler secret put CLOUDFLARE_CLIENT_SECRET --config wrangler.deploy.jsonc; unset v
```

### Check that it works

```bash
curl -fsS https://<admin host>/healthz
```

It answers status 200 and `{"ok":true,...}`. A 503 names each part that failed.

### Undo

`pnpm ops cfx-example uninstall` lists everything it will delete, and deletes it only with `--go`. By hand, undo each step below, newest first.

### By hand

When the install command fails or does not exist yet. Add `--jurisdiction eu` to steps 1 and 2 only when the site file says `"eu"`.

1. Create the database: `npx wrangler d1 create cfx-example`. Undo: `npx wrangler d1 delete cfx-example`.
2. Create the bucket: `npx wrangler r2 bucket create cfx-example`. Undo: `npx wrangler r2 bucket delete cfx-example`.
3. Write `wrangler.deploy.jsonc` beside `wrangler.jsonc`, which git ignores: a copy with `account_id`, the route for the tool's hostname, the ids from steps 1 and 2, and the site file's jurisdiction on each D1 and R2 binding. Undo: move it to the Trash.
4. Apply the schema: `npx wrangler d1 migrations apply DB --remote --config wrangler.deploy.jsonc`. Undo: step 1's undo.
5. Put the secrets, as under "Secrets". Undo: `npx wrangler secret delete <NAME> --config wrangler.deploy.jsonc`.
6. Deploy: `npx wrangler deploy --config wrangler.deploy.jsonc`. Undo: `npx wrangler delete --config wrangler.deploy.jsonc`.
7. Check that it works, as above.

## Test strategy

| Command | Checks | Time |
|---|---|---|
| `pnpm check` | Lint, types, every test and the build, stopping at the first failure | Measure it with `/usr/bin/time -p` and write it here. |
