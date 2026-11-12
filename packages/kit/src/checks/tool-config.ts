import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import type { Read } from "../read.ts";

// What the tool checks read from a tool repository: its small layout config,
// `c-f-x.json`, and its `wrangler.jsonc`. Reading the JSONC with a real parser
// follows cfanalytics:scripts/lib/wrangler-config.mjs.

export const TOOL_CONFIG = "c-f-x.json";
export const WRANGLER = "wrangler.jsonc";

/**
 * Where a tool keeps its code, as repository paths.
 * - `sources`: folders of source code that the architecture check reads.
 * - `slices`: folders whose subfolders are slices, which meet only through their `index.ts`.
 * - `migrations`: folders of numbered `.sql` schema steps.
 * - `vendors`: the vendors the tool integrates, whose names its public text
 *   may use (`c-f-x check names`). Optional, and empty when left out.
 * - `worker`: the folder that holds the Worker: its `wrangler.jsonc`,
 *   `.dev.vars.example` and tests. Optional; left out, it is the root, ".".
 */
export type ToolConfig = {
  sources: string[];
  slices: string[];
  migrations: string[];
  vendors: string[];
  worker: string;
};

const FOLDER_KEYS = ["sources", "slices", "migrations"] as const;
const KEYS = [...FOLDER_KEYS, "vendors", "worker"] as const;
const ROOT = ".";

// A folder is a repository path, compared as text, so "src/" and "./src" become "src".
const cleanFolder = (folder: string): string => path.posix.normalize(folder).replace(/\/$/, "");

/** The repository path of `file` in the Worker's folder. */
export const workerPath = (worker: string, file: string): string => path.posix.join(worker, file);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/** The layout config from its text. Every folder it names must exist. */
export function parseToolConfig(text: string, exists: (p: string) => boolean): Read<ToolConfig> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`${TOOL_CONFIG}: does not parse: ${String(error)}`] };
  }
  if (!isRecord(value))
    return { ok: false, problems: [`${TOOL_CONFIG}: must be an object of folder lists`] };
  const problems: string[] = [];
  for (const key of Object.keys(value)) {
    if (!(KEYS as readonly string[]).includes(key))
      problems.push(`${TOOL_CONFIG}: unknown key "${key}"; the keys are ${KEYS.join(", ")}`);
  }
  const lists = FOLDER_KEYS.map((key) => {
    const folders = value[key];
    if (!isStrings(folders)) {
      problems.push(`${TOOL_CONFIG}: "${key}" must be a list of folders`);
      return [];
    }
    const clean = folders.map(cleanFolder);
    for (const folder of clean) {
      if (!exists(folder))
        problems.push(`${TOOL_CONFIG}: "${key}" names ${folder}, which does not exist`);
    }
    return clean;
  });
  const [sources = [], slices = [], migrations = []] = lists;
  const vendors = value.vendors ?? [];
  if (!isStrings(vendors)) problems.push(`${TOOL_CONFIG}: "vendors" must be a list of names`);
  const worker = typeof value.worker === "string" ? cleanFolder(value.worker) : ROOT;
  if (value.worker !== undefined && typeof value.worker !== "string")
    problems.push(`${TOOL_CONFIG}: "worker" must be one folder, the one that holds ${WRANGLER}`);
  else if (worker !== ROOT && !exists(worker))
    problems.push(`${TOOL_CONFIG}: "worker" names ${worker}, which does not exist`);
  return problems.length > 0 || !isStrings(vendors)
    ? { ok: false, problems }
    : { ok: true, value: { sources, slices, migrations, vendors, worker } };
}

export function readToolConfig(root: string): Read<ToolConfig> {
  const file = path.join(root, TOOL_CONFIG);
  if (!existsSync(file)) return { ok: false, problems: [`${TOOL_CONFIG} is missing`] };
  return parseToolConfig(readFileSync(file, "utf8"), (p) => existsSync(path.join(root, p)));
}

/** A parsed `wrangler.jsonc`. */
export type Wrangler = Record<string, unknown>;

/**
 * The Wrangler config from its JSONC text, with `file` its repository path for
 * the problems. A syntax error is a problem, not a guess.
 */
export function parseWrangler(text: string, file: string): Read<Wrangler> {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const where = errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`);
    return { ok: false, problems: [`${file}: does not parse: ${where.join(", ")}`] };
  }
  if (!isRecord(value)) return { ok: false, problems: [`${file}: must be an object`] };
  return { ok: true, value };
}

/** The `wrangler.jsonc` in the Worker's folder, `worker`, a repository path. */
export function readWrangler(root: string, worker: string): Read<Wrangler> {
  const file = workerPath(worker, WRANGLER);
  const full = path.join(root, file);
  if (!existsSync(full)) return { ok: false, problems: [`${file} is missing`] };
  return parseWrangler(readFileSync(full, "utf8"), file);
}

/** The top-level block and each deployment block under "env", each with its name. */
export function configBlocks(config: Wrangler): [string, Record<string, unknown>][] {
  const env = isRecord(config.env) ? config.env : {};
  return [
    ["top level", config],
    ...Object.entries(env)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      .map(([name, block]): [string, Record<string, unknown>] => [`env.${name}`, block]),
  ];
}

/** The objects in the list `block[key]`. */
export function entries(block: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const list = block[key];
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export type StoreKind = "D1 database" | "R2 bucket" | "KV namespace" | "Durable Object class";

/** A store a Worker binds: a D1 database, R2 bucket or KV namespace by binding name, a Durable Object by class. */
export type Store = { kind: StoreKind; name: string };

/** A Durable Object binding this Worker defines itself, not one borrowed from another Worker. */
export type DurableObjectBinding = { name: string; className: string };

export function durableObjectBindings(config: Wrangler): DurableObjectBinding[] {
  const found = new Map<string, DurableObjectBinding>();
  for (const [, block] of configBlocks(config)) {
    const objects = isRecord(block.durable_objects) ? block.durable_objects : {};
    for (const binding of entries(objects, "bindings")) {
      const name = text(binding.name);
      const className = text(binding.class_name);
      if (name === null || className === null || binding.script_name !== undefined) continue;
      found.set(`${name} ${className}`, { name, className });
    }
  }
  return [...found.values()];
}

/** Every store the config binds, once each, across all blocks. */
export function storeBindings(config: Wrangler): Store[] {
  const found = new Map<string, Store>();
  const add = (kind: StoreKind, name: string | null) => {
    if (name !== null) found.set(`${kind} ${name}`, { kind, name });
  };
  for (const [, block] of configBlocks(config)) {
    for (const db of entries(block, "d1_databases")) add("D1 database", text(db.binding));
    for (const bucket of entries(block, "r2_buckets")) add("R2 bucket", text(bucket.binding));
    for (const kv of entries(block, "kv_namespaces")) add("KV namespace", text(kv.binding));
  }
  for (const { className } of durableObjectBindings(config)) add("Durable Object class", className);
  return [...found.values()];
}

/** The names of the `send_email` bindings, across all blocks. */
export function emailBindings(config: Wrangler): string[] {
  const names = new Set<string>();
  for (const [, block] of configBlocks(config)) {
    for (const binding of entries(block, "send_email")) {
      const name = text(binding.name);
      if (name !== null) names.add(name);
    }
  }
  return [...names];
}
