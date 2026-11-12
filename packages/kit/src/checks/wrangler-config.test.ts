import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import { initRepo } from "../test-support/git.ts";
import {
  deploymentValueViolations,
  literalJurisdictionViolations,
  requiredSecretViolations,
  secretNamesOf,
  secretViolations,
} from "./wrangler-config.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

// Real-looking values, made up: `.test` is a reserved name that no one owns,
// and the ids are random hex.
const ACCOUNT = "3f2a9c41d8e07b65a1c4f09e2d7b8a36";
const DATABASE = "8c1e4b27-5d9a-4f3e-b602-71a9e4c3d815";

test("the deployment-value check flags ids, real hostnames and email addresses", () => {
  const found = deploymentValueViolations({
    $schema: "node_modules/wrangler/config-schema.json",
    main: "src/index.ts",
    account_id: ACCOUNT,
    vars: {
      FROM: "alerts@tool.test",
      ORIGIN: "https://status.tool.test/",
      HOST: "pages.tool.test",
    },
    routes: [{ pattern: "status.tool.test", custom_domain: true }, "*.tool.test/*"],
    d1_databases: [{ binding: "DB", database_id: DATABASE }],
    env: {
      demo: {
        // Allowed: example.com, its names and its addresses, and a local id.
        routes: [{ pattern: "status.example.com", custom_domain: true }],
        vars: { FROM: "alerts@example.com", ORIGIN: "https://example.com" },
        d1_databases: [{ binding: "DB", database_id: "local" }],
      },
    },
  });
  assert.deepEqual(found, [
    "account_id holds an account id",
    "vars.FROM holds the email address alerts@tool.test; only example.com addresses are allowed",
    "vars.ORIGIN names the real hostname status.tool.test; only example.com hostnames are allowed",
    "vars.HOST names the real hostname pages.tool.test; only example.com hostnames are allowed",
    "routes[0].pattern names the real hostname status.tool.test; only example.com hostnames are allowed",
    "routes[1] names the real hostname tool.test; only example.com hostnames are allowed",
    "d1_databases[0].database_id holds a resource id",
  ]);
});

test("the secrets check flags credential-named keys and the tool's own secret names", () => {
  const found = secretViolations(
    {
      vars: { BASE: "x", SESSION_KEY: "abc" },
      // Allowed: Wrangler's list of the secrets a Worker needs.
      secrets: { required: ["AUTH_SECRET", "SESSION_KEY"] },
      env: { prod: { vars: { SETUP_TOKEN: "abc" }, SIGNING: "AUTH_SECRET" } },
    },
    secretNamesOf("# Worker secrets\nAUTH_SECRET=\nexport SESSION_KEY=\n"),
  );
  assert.deepEqual(found, [
    "env.prod.vars.SETUP_TOKEN holds a secret; put it with wrangler secret put",
    "env.prod.SIGNING names the secret AUTH_SECRET; its value belongs in .dev.vars",
    "vars.SESSION_KEY names the secret SESSION_KEY; its value belongs in .dev.vars",
  ]);
});

test("the jurisdiction check flags a jurisdiction written into the config, in any block", () => {
  const found = literalJurisdictionViolations({
    d1_databases: [{ binding: "DB", jurisdiction: "eu" }],
    r2_buckets: [{ binding: "BLOBS" }],
    vars: { JURISDICTION: "eu" },
    env: {
      prod: {
        d1_databases: [{ binding: "DB" }],
        r2_buckets: [{ binding: "BLOBS", jurisdiction: "fedramp" }],
      },
    },
  });
  assert.deepEqual(found, [
    "d1_databases[0].jurisdiction hard-codes a jurisdiction; the deploy takes it from the site file's jurisdiction field",
    "vars.JURISDICTION hard-codes a jurisdiction; the deploy takes it from the site file's jurisdiction field",
    "env.prod.r2_buckets[0].jurisdiction hard-codes a jurisdiction; the deploy takes it from the site file's jurisdiction field",
  ]);
});

test("every block declares secrets.required, naming exactly the secrets of .dev.vars.example", () => {
  const found = requiredSecretViolations(
    {
      secrets: { required: ["AUTH_SECRET", "OLD_KEY"] },
      env: {
        // Wrangler does not inherit secrets from the top level.
        prod: {},
        demo: { secrets: { required: ["AUTH_SECRET", "SESSION_KEY"] } },
        bare: { secrets: { required: "AUTH_SECRET" } },
      },
    },
    ["AUTH_SECRET", "SESSION_KEY"],
  );
  assert.deepEqual(found, [
    "top level: secrets.required names OLD_KEY, which .dev.vars.example does not",
    "top level: .dev.vars.example names SESSION_KEY, which secrets.required does not",
    "env.prod declares no secrets.required: list the Worker's secrets there, [] when it has none; Wrangler does not inherit it from the top level",
    "env.bare declares no secrets.required: list the Worker's secrets there, [] when it has none; Wrangler does not inherit it from the top level",
  ]);
  assert.deepEqual(requiredSecretViolations({ secrets: { required: [] } }, []), []);
});

const CLEAN_WRANGLER = `{
  // The template: deployment values come from the site file.
  "name": "cfx-sample",
  "main": "src/index.ts",
  "d1_databases": [{ "binding": "DB", "database_name": "cfx-sample" }],
  "r2_buckets": [{ "binding": "BLOBS", "bucket_name": "cfx-sample" },],
  "routes": [{ "pattern": "status.example.com", "custom_domain": true }],
  "secrets": { "required": ["AUTH_SECRET"] },
}
`;

test("c-f-x check wrangler-config fails on a sample with deployment values, a secret and a written-in jurisdiction", async () => {
  const repo = path.join(scope.dir, "flagged");
  writeFiles(repo, {
    "wrangler.jsonc": `{
      "name": "cfx-sample",
      "account_id": "${ACCOUNT}",
      "vars": { "AUTH_SECRET": "x" },
      "routes": [{ "pattern": "status.tool.test", "custom_domain": true }],
      "d1_databases": [{ "binding": "DB", "database_id": "${DATABASE}" }],
      "r2_buckets": [{ "binding": "BLOBS", "bucket_name": "cfx-sample", "jurisdiction": "eu" }]
    }`,
    ".dev.vars.example": "AUTH_SECRET=\n",
  });
  initRepo(repo);
  const { code, stderr } = await runCli(["check", "wrangler-config"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /wrangler\.jsonc: account_id holds an account id/);
  assert.match(
    stderr,
    /wrangler\.jsonc: routes\[0\]\.pattern names the real hostname status\.tool\.test/,
  );
  assert.match(stderr, /wrangler\.jsonc: d1_databases\[0\]\.database_id holds a resource id/);
  assert.match(stderr, /wrangler\.jsonc: vars\.AUTH_SECRET holds a secret/);
  assert.match(stderr, /wrangler\.jsonc: vars\.AUTH_SECRET names the secret AUTH_SECRET/);
  assert.match(stderr, /wrangler\.jsonc: r2_buckets\[0\]\.jurisdiction hard-codes a jurisdiction/);
  assert.match(stderr, /wrangler\.jsonc: top level declares no secrets\.required/);
  assert.match(stderr, /\.dev\.vars is not ignored by git/);
  assert.match(stderr, /check wrangler-config: failed with 8 problems/);
});

test("c-f-x check wrangler-config passes a template with only example values", async () => {
  const repo = path.join(scope.dir, "clean");
  writeFiles(repo, {
    "wrangler.jsonc": CLEAN_WRANGLER,
    ".dev.vars.example": "AUTH_SECRET=\n",
    ".gitignore": ".dev.vars\n",
  });
  initRepo(repo);
  const { code, stdout, stderr } = await runCli(["check", "wrangler-config"], repo, scope.dir);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /check wrangler-config: passed/);
});

test("c-f-x check wrangler-config fails on JSONC that does not parse", async () => {
  const repo = path.join(scope.dir, "broken");
  writeFiles(repo, { "wrangler.jsonc": '{ "name": "cfx-sample" "main": "x" }' });
  const { code, stderr } = await runCli(["check", "wrangler-config"], repo, scope.dir);
  assert.equal(code, 1);
  assert.match(stderr, /wrangler\.jsonc: does not parse: CommaExpected/);
});
