import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";
import type { Read } from "./read.ts";

// The site file (docs/conventions.md, section 4): the deployment values the
// public repository may not hold, one file per tool, `<tool>.jsonc`, in the
// folder CFX_SITE names. New in the kit: the conventions require it, and
// cfx-status is its first user. The JSONC is read with the parser the checks
// use (./checks/tool-config.ts).

/** The variable that names the folder of site files. */
export const SITE_ENV = "CFX_SITE";

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

const email = z.email({ error: "not an email address" });
const addresses = z.array(email).min(1, { error: "name at least one address" });

/**
 * What every tool's site file holds. A tool adds its own fields with
 * `siteSchema.extend({...})`. An unknown field is refused, so a misspelt
 * field name is caught before a deploy.
 */
export const siteSchema = z.strictObject({
  /** The Cloudflare account the tool deploys to. */
  account_id: z
    .string()
    .regex(/^[0-9a-f]{32}$/, { error: "a Cloudflare account id is 32 lower-case hex characters" }),
  /** The tool's hostnames by role, for example `{ "admin": "status.example.com" }`. */
  hostnames: z
    .record(
      z.string(),
      z.string().regex(HOSTNAME, {
        error: "a hostname is lower-case labels joined by dots, with no scheme or path",
      }),
    )
    .refine((hosts) => Object.keys(hosts).length > 0, { error: "name at least one hostname" }),
  /** Who may sign in as an admin (conventions, section 8). */
  admin_emails: addresses,
  /** Who the tool's alerts and notices go to. Each must be in its send_email binding's allowlist. */
  alert_addresses: addresses,
  /**
   * Where this installation keeps its data: left out for Cloudflare's default
   * placement, or `"eu"`. Chosen once: Cloudflare cannot change a store's
   * jurisdiction after it is made (conventions, section 5).
   */
  jurisdiction: z
    .literal("eu", { error: 'leave it out for Cloudflare\'s default placement, or say "eu"' })
    .optional(),
});

/** What every site file holds. */
export type Site = z.infer<typeof siteSchema>;

/** One zod issue as a sentence that names its field. */
function problemOf(file: string, issue: z.core.$ZodIssue): string[] {
  const field = issue.path.map(String).join(".");
  if (issue.code === "unrecognized_keys")
    return issue.keys.map((key) => `${file}: unknown field "${field ? `${field}.` : ""}${key}"`);
  if (issue.code === "invalid_type" && issue.input === undefined)
    return [`${file}: ${field}: missing`];
  return [`${file}: ${field || "the file"}: ${issue.message}`];
}

/** The site file `file` from its JSONC text, checked against `schema`. */
export function parseSiteFile<S extends z.ZodType>(
  file: string,
  text: string,
  schema: S,
): Read<z.infer<S>> {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const where = errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`);
    return { ok: false, problems: [`${file}: does not parse: ${where.join(", ")}`] };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, problems: parsed.error.issues.flatMap((issue) => problemOf(file, issue)) };
}

/**
 * Reads `<tool>.jsonc` from the folder `site` names, the value of CFX_SITE,
 * and checks it against `schema`. A missing folder, file or field is a
 * problem in the answer, never a throw.
 */
export function loadSiteFile<S extends z.ZodType>(
  tool: string,
  schema: S,
  site: string | undefined,
): Read<z.infer<S>> {
  if (site === undefined || site === "")
    return {
      ok: false,
      problems: [`${SITE_ENV} is not set: it names the folder that holds each tool's site file`],
    };
  const file = path.join(site, `${tool}.jsonc`);
  if (!existsSync(file)) return { ok: false, problems: [`${file} is missing`] };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return { ok: false, problems: [`${file} cannot be read: ${String(error)}`] };
  }
  return parseSiteFile(file, text, schema);
}
