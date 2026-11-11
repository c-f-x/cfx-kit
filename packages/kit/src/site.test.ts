import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { z } from "zod";
import { openRunScope, type RunScope } from "./run-scope.ts";
import { loadSiteFile, parseSiteFile, siteSchema } from "./site.ts";
import { writeFiles } from "./test-support/cli.ts";

// The site file (docs/conventions.md, section 4): what a deployment needs
// that the public repository may not hold.

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

const SITE = `{
  // The owner's deployment of cfx-sample.
  "account_id": "0123456789abcdef0123456789abcdef",
  "hostnames": { "admin": "status.example.com", "pages": "status.example.org" },
  "admin_emails": ["owner@example.com"],
  "alert_addresses": ["owner@example.com", "team@example.com"],
}
`;

test("a site file with every field is read, comments and trailing commas allowed", () => {
  assert.deepEqual(parseSiteFile("cfx-sample.jsonc", SITE, siteSchema), {
    ok: true,
    value: {
      account_id: "0123456789abcdef0123456789abcdef",
      hostnames: { admin: "status.example.com", pages: "status.example.org" },
      admin_emails: ["owner@example.com"],
      alert_addresses: ["owner@example.com", "team@example.com"],
    },
  });
});

test("each wrong field is named, with what is wrong with it", () => {
  const wrong = `{
    "account_id": "not-an-id",
    "hostnames": { "admin": "https://status.example.com" },
    "admin_emails": [],
    "alert_addresses": ["owner@example.com", "nobody"],
    "acount": "typo",
  }`;
  assert.deepEqual(parseSiteFile("cfx-sample.jsonc", wrong, siteSchema), {
    ok: false,
    problems: [
      "cfx-sample.jsonc: account_id: a Cloudflare account id is 32 lower-case hex characters",
      "cfx-sample.jsonc: hostnames.admin: a hostname is lower-case labels joined by dots, with no scheme or path",
      "cfx-sample.jsonc: admin_emails: name at least one address",
      "cfx-sample.jsonc: alert_addresses.1: not an email address",
      'cfx-sample.jsonc: unknown field "acount"',
    ],
  });
});

test("a missing field and a file that is not JSONC are named", () => {
  assert.deepEqual(parseSiteFile("cfx-sample.jsonc", '{ "account_id": "x" ', siteSchema), {
    ok: false,
    problems: ["cfx-sample.jsonc: does not parse: CloseBraceExpected at offset 20"],
  });
  const partial = parseSiteFile(
    "cfx-sample.jsonc",
    '{ "account_id": "0123456789abcdef0123456789abcdef" }',
    siteSchema,
  );
  assert.deepEqual(partial, {
    ok: false,
    problems: [
      "cfx-sample.jsonc: hostnames: missing",
      "cfx-sample.jsonc: admin_emails: missing",
      "cfx-sample.jsonc: alert_addresses: missing",
    ],
  });
});

test("a tool extends the schema with fields of its own, and they are checked too", () => {
  const status = siteSchema.extend({ probe_regions: z.array(z.enum(["weur", "enam"])).min(1) });
  const text = SITE.replace(/}\s*$/, '  "probe_regions": ["weur", "mars"],\n}\n');
  assert.deepEqual(parseSiteFile("cfx-status.jsonc", text, status), {
    ok: false,
    problems: ['cfx-status.jsonc: probe_regions.1: Invalid option: expected one of "weur"|"enam"'],
  });
  const ok = parseSiteFile("cfx-status.jsonc", text.replace('"mars"', '"enam"'), status);
  assert.equal(ok.ok && ok.value.probe_regions.join(","), "weur,enam");
});

test("the loader reads <tool>.jsonc from the folder CFX_SITE names", () => {
  const site = path.join(scope.dir, "site");
  writeFiles(site, { "cfx-sample.jsonc": SITE });
  const loaded = loadSiteFile("cfx-sample", siteSchema, site);
  assert.equal(loaded.ok && loaded.value.hostnames.admin, "status.example.com");
  assert.deepEqual(loadSiteFile("cfx-other", siteSchema, site), {
    ok: false,
    problems: [`${path.join(site, "cfx-other.jsonc")} is missing`],
  });
  assert.deepEqual(loadSiteFile("cfx-sample", siteSchema, undefined), {
    ok: false,
    problems: ["CFX_SITE is not set: it names the folder that holds each tool's site file"],
  });
});
