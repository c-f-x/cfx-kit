# Security

Please report a vulnerability by email to security@c-f-x.com, not in a public issue.

Send what you found, how to reproduce it, and what an attacker could do with it. A proof of concept against your own copy helps. Never test against someone else's deployment of a c-f-x tool.

Only the newest commit on `master` is supported. A fix lands there, and the report is credited in the commit unless you ask otherwise.

## What matters most

Every c-f-x tool runs the kit's code, so a flaw here reaches all of them. These come first:

- the key helpers in `packages/kit/src/worker/keys.ts` accepting a key they should refuse, or leaking time that tells a key apart;
- the health handler or `notify` revealing why a part failed, or a secret, to the caller;
- the ops runner changing anything without `--go`, or deploying a bundle other than the one it checked;
- the site-file loader accepting a value it should refuse;
- a guard check passing a tool repository that breaks the rule it holds, such as a real hostname or a secret in `wrangler.jsonc`.
