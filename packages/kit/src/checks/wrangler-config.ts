import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  configBlocks,
  isRecord,
  readToolConfig,
  readWrangler,
  WRANGLER,
  type Wrangler,
  workerPath,
} from "./tool-config.ts";
import type { Check } from "./types.ts";

// `c-f-x check wrangler-config`: the template `wrangler.jsonc` in a public
// repository holds no deployment value, no secret and no jurisdiction, and
// every block lists the Worker's secrets in `secrets.required`, as
// `.dev.vars.example` does.
// Deployment values, where data is stored among them, live in the private site
// file (docs/conventions.md, sections 4 and 5). Merged from cfanalytics:scripts/wrangler-config.test.mjs,
// cfanalytics:scripts/lib/wrangler-config.mjs and cfmail:scripts/wrangler-config.test.mjs.
// Both forbid a `vars` block, because each keeps its settings elsewhere; the
// family rule is narrower, so here `vars` may stay and its values are checked
// like every other value. cfmail's fixed list of its own secret names becomes
// the names the tool lists in `.dev.vars.example`.

export const DEV_VARS = ".dev.vars";
export const DEV_VARS_EXAMPLE = ".dev.vars.example";

/** A string somewhere in the config, with the path that reaches it. */
type Leaf = { at: string; key: string; value: string; inVars: boolean; inRoute: boolean };

type Node = { at: string; key: string; value: unknown; inVars: boolean; inRoute: boolean };

// Every key and string value, depth first, in the order the file holds them.
function walk(config: Wrangler): { keys: Node[]; leaves: Leaf[] } {
  const keys: Node[] = [];
  const leaves: Leaf[] = [];
  const visit = (node: Node) => {
    const { at, value, inVars, inRoute } = node;
    if (typeof value === "string") leaves.push({ ...node, value });
    else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        visit({ at: `${at}[${i}]`, key: node.key, value: item, inVars, inRoute });
      });
    } else if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        const next: Node = {
          at: at === "" ? key : `${at}.${key}`,
          key,
          value: child,
          inVars: inVars || key === "vars",
          inRoute: inRoute || key === "routes" || key === "route",
        };
        keys.push(next);
        visit(next);
      }
    }
  };
  visit({ at: "", key: "", value: config, inVars: false, inRoute: false });
  return { keys, leaves };
}

const ID_KEYS = new Set(["account_id", "zone_id"]);
const RESOURCE_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{32}\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const URL_HOST = /\b[a-z][a-z0-9+.-]*:\/\/([^/\s:?#"'@]+)/gi;
const BARE_HOST = /^(?:\*\.?)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/.*)?$/i;
const ROUTE_KEYS = new Set(["pattern", "zone_name", "routes", "route"]);

/** Whether a hostname is a documentation example: example.com or a name under it. */
export const isExampleHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "example.com" || h.endsWith(".example.com");
};

const CREDENTIAL = /(secret|token|password|api[_-]?key|private[_-]?key)/i;

/** Account ids, resource ids, real hostnames and email addresses in the config. */
export function deploymentValueViolations(config: Wrangler): string[] {
  const { keys, leaves } = walk(config);
  const found: string[] = [];
  for (const { at, key } of keys) {
    if (ID_KEYS.has(key))
      found.push(`${at} holds ${key === "account_id" ? "an account" : "a zone"} id`);
  }
  for (const { at, key, value, inVars, inRoute } of leaves) {
    if (ID_KEYS.has(key)) continue;
    if (RESOURCE_ID.test(value)) found.push(`${at} holds a resource id`);
    const emails = [...value.matchAll(EMAIL)];
    for (const [address, domain = ""] of emails) {
      if (!isExampleHost(domain))
        found.push(
          `${at} holds the email address ${address}; only example.com addresses are allowed`,
        );
    }
    const hosts = [...value.matchAll(URL_HOST)].map((m) => m[1] ?? "");
    const bare = BARE_HOST.exec(value)?.[1];
    if (bare !== undefined && emails.length === 0 && (inVars || (inRoute && ROUTE_KEYS.has(key))))
      hosts.push(bare);
    for (const host of new Set(hosts)) {
      if (!isExampleHost(host))
        found.push(`${at} names the real hostname ${host}; only example.com hostnames are allowed`);
    }
  }
  return found;
}

// An entry of Wrangler's list of the secrets a Worker needs.
const isDeclaredSecret = (at: string) => /(^|\.)secrets\.required\[\d+\]$/.test(at);

/**
 * Secrets in the config: a credential-named key holding a value, and any
 * secret the tool names in `.dev.vars.example`, as a key or inside a value. A
 * value is never printed. Wrangler's own `secrets.required` list names the
 * secrets a Worker needs without holding them, so it may name them.
 */
export function secretViolations(config: Wrangler, secretNames: string[]): string[] {
  const { keys, leaves } = walk(config);
  const found = leaves
    .filter(({ key }) => CREDENTIAL.test(key))
    .map(({ at }) => `${at} holds a secret; put it with wrangler secret put`);
  for (const name of secretNames) {
    const where = [
      ...keys.filter((k) => k.key === name).map((k) => k.at),
      ...leaves.filter((l) => l.value.includes(name) && !isDeclaredSecret(l.at)).map((l) => l.at),
    ];
    for (const at of new Set(where))
      found.push(`${at} names the secret ${name}; its value belongs in ${DEV_VARS}`);
  }
  return found;
}

/**
 * A jurisdiction written into the config, under any key of that name in any
 * block. Where data is stored is each installation's choice, in its site file,
 * and the deploy joins it into the config it generates (docs/conventions.md,
 * section 5).
 */
export function literalJurisdictionViolations(config: Wrangler): string[] {
  return walk(config)
    .keys.filter(({ key }) => key.toLowerCase() === "jurisdiction")
    .map(
      ({ at }) =>
        `${at} hard-codes a jurisdiction; the deploy takes it from the site file's jurisdiction field`,
    );
}

/** The names a block's `secrets.required` lists, or undefined when it declares no such list. */
export function requiredSecrets(block: Record<string, unknown>): string[] | undefined {
  const required = isRecord(block.secrets) ? block.secrets.required : undefined;
  return Array.isArray(required) && required.every((n) => typeof n === "string")
    ? required
    : undefined;
}

/**
 * Every block, the top level and each `env.<name>`, declares `secrets.required`,
 * because Wrangler does not inherit it, and each list names exactly the
 * secrets `.dev.vars.example` names (docs/conventions.md, section 4).
 */
export function requiredSecretViolations(config: Wrangler, secretNames: string[]): string[] {
  const found: string[] = [];
  for (const [name, block] of configBlocks(config)) {
    const required = requiredSecrets(block);
    if (required === undefined) {
      found.push(
        `${name} declares no secrets.required: list the Worker's secrets there, [] when it has none; Wrangler does not inherit it from the top level`,
      );
      continue;
    }
    for (const secret of required.filter((n) => !secretNames.includes(n)))
      found.push(`${name}: secrets.required names ${secret}, which ${DEV_VARS_EXAMPLE} does not`);
    for (const secret of secretNames.filter((n) => !required.includes(n)))
      found.push(`${name}: ${DEV_VARS_EXAMPLE} names ${secret}, which secrets.required does not`);
  }
  return found;
}

/** The secret names a `.dev.vars.example` lists, one `NAME=` per line. */
export function secretNamesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

// Whether git ignores the path: null when the folder is not a git repository.
function ignoredByGit(root: string, file: string): boolean | null {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--git-dir"], { stdio: "ignore" });
  } catch {
    return null;
  }
  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", file], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const wranglerConfig: Check = {
  name: "wrangler-config",
  summary: `the Worker's ${WRANGLER} holds no ids, real hostnames, email addresses or secrets, writes in no jurisdiction, and lists its secrets as ${DEV_VARS_EXAMPLE} does`,
  async run({ root }) {
    const tool = readToolConfig(root);
    if (!tool.ok) return tool.problems;
    const { worker } = tool.value;
    const config = readWrangler(root, worker);
    if (!config.ok) return config.problems;
    const example = path.join(root, workerPath(worker, DEV_VARS_EXAMPLE));
    const secretNames = existsSync(example) ? secretNamesOf(readFileSync(example, "utf8")) : [];
    const problems = [
      ...deploymentValueViolations(config.value),
      ...secretViolations(config.value, secretNames),
      ...literalJurisdictionViolations(config.value),
      ...requiredSecretViolations(config.value, secretNames),
    ].map((p) => `${workerPath(worker, WRANGLER)}: ${p}`);
    const devVars = workerPath(worker, DEV_VARS);
    const ignored = ignoredByGit(root, devVars);
    if (ignored === null)
      problems.push(`${root} is not a git repository, so ${devVars} cannot be shown ignored`);
    else if (!ignored)
      problems.push(`${devVars} is not ignored by git, so its secrets could be committed`);
    return problems;
  },
};
