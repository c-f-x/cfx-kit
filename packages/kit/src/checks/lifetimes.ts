import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Read } from "../read.ts";
import { stepFiles } from "./migrations.ts";
import {
  readToolConfig,
  readWrangler,
  type Store,
  storeBindings,
  WRANGLER,
} from "./tool-config.ts";
import type { Check } from "./types.ts";

// `c-f-x check lifetimes`: every store a tool keeps says what it holds, how
// long, and what removes the rest. A store is a binding in `wrangler.jsonc` or a
// table its migrations create, and each needs a row in the lifetimes table of
// `docs/data-model.md`. New in the kit: cfanalytics keeps the same table by hand.
// The table's format is docs/conventions.md, section 5.

export const DATA_MODEL = "docs/data-model.md";
export const LIFETIMES_HEADING = "## Lifetimes";
export const LIFETIMES_COLUMNS = ["Store", "Holds", "Lifetime", "Removed by"] as const;

export type LifetimeRow = { store: string; holds: string; lifetime: string; removedBy: string };

/** The rows of a lifetimes table, and what is wrong with its format. */
export type LifetimesTable = { rows: LifetimeRow[]; problems: string[] };

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

/**
 * The first table under the `## Lifetimes` heading of a data-model doc, or null
 * when the doc has no such heading or no table under it.
 */
export function lifetimesTable(doc: string, text: string): LifetimesTable | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === LIFETIMES_HEADING);
  if (start === -1) return null;
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    section.push(line);
  }
  const top = section.findIndex((line) => line.trim().startsWith("|"));
  if (top === -1) return null;
  const tableLines: string[] = [];
  for (const line of section.slice(top)) {
    if (!line.trim().startsWith("|")) break;
    tableLines.push(line);
  }

  const [header = "", , ...body] = tableLines;
  const columns = cellsOf(header);
  if (columns.join(" | ") !== LIFETIMES_COLUMNS.join(" | ")) {
    return {
      rows: [],
      problems: [
        `${doc}: the lifetimes table's columns must be ${LIFETIMES_COLUMNS.join(" | ")}, not ${columns.join(" | ")}`,
      ],
    };
  }
  const rows: LifetimeRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const line of body) {
    const cells = cellsOf(line);
    const [first = ""] = cells;
    if (cells.length !== LIFETIMES_COLUMNS.length) {
      problems.push(`${doc}: the lifetimes row "${line.trim()}" has ${cells.length} cells, not 4`);
      continue;
    }
    const name = /^`([^`]+)`$/.exec(first)?.[1];
    if (name === undefined) {
      problems.push(`${doc}: the lifetimes row "${line.trim()}" must name its store in backticks`);
      continue;
    }
    if (cells.some((cell) => cell === ""))
      problems.push(`${doc}: the lifetimes row for \`${name}\` has an empty cell`);
    if (seen.has(name)) problems.push(`${doc}: \`${name}\` has two lifetimes rows`);
    seen.add(name);
    const [, holds = "", lifetime = "", removedBy = ""] = cells;
    rows.push({ store: name, holds, lifetime, removedBy });
  }
  return { rows, problems };
}

const IDENT = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+)`;
const QUALIFIED = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;
const STATEMENT = new RegExp(
  [
    String.raw`\bCREATE\s+(TEMP\s+|TEMPORARY\s+)?(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${QUALIFIED}`,
    String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${QUALIFIED}`,
    String.raw`\bALTER\s+TABLE\s+${QUALIFIED}\s+RENAME\s+TO\s+${QUALIFIED}`,
  ].join("|"),
  "gi",
);

// The table's own name: the part after a schema name, without its quotes.
function tableName(token: string): string {
  const parts = token.match(new RegExp(IDENT, "g")) ?? [token];
  const last = parts.at(-1) ?? token;
  return /^["`[]/.test(last) ? last.slice(1, -1) : last;
}

/**
 * The tables that the schema steps leave behind, applied in order: created
 * tables, less the ones dropped, under their last name. Temporary tables are
 * not kept, so they are not stores.
 */
export function tablesOf(steps: string[]): string[] {
  const tables = new Set<string>();
  for (const sql of steps) {
    const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
    for (const m of code.matchAll(STATEMENT)) {
      const [, temp, created, dropped, from, to] = m;
      if (created !== undefined) {
        if (temp === undefined) tables.add(tableName(created));
      } else if (dropped !== undefined) tables.delete(tableName(dropped));
      else if (from !== undefined && to !== undefined && tables.delete(tableName(from)))
        tables.add(tableName(to));
    }
  }
  return [...tables];
}

/** Stores without a lifetimes row, and rows that name no store. */
export function lifetimeViolations(
  doc: string,
  rows: LifetimeRow[],
  bindings: Store[],
  tables: string[],
): string[] {
  const named = new Set(rows.map((r) => r.store));
  const stores = new Set([...bindings.map((b) => b.name), ...tables]);
  return [
    ...bindings
      .filter((b) => !named.has(b.name))
      .map((b) => `${doc}: the ${b.kind} \`${b.name}\` in ${WRANGLER} has no lifetimes row`),
    ...tables
      .filter((t) => !named.has(t))
      .map((t) => `${doc}: the table \`${t}\` in the migrations has no lifetimes row`),
    ...rows
      .filter((r) => !stores.has(r.store))
      .map((r) => `${doc}: the lifetimes row \`${r.store}\` names no binding or table`),
  ];
}

/** The lifetimes table of a tool repository, or why there is none. */
export function readLifetimes(root: string): Read<LifetimesTable> {
  const file = path.join(root, DATA_MODEL);
  if (!existsSync(file)) return { ok: false, problems: [`${DATA_MODEL} is missing`] };
  const table = lifetimesTable(DATA_MODEL, readFileSync(file, "utf8"));
  return table === null
    ? { ok: false, problems: [`${DATA_MODEL}: has no table under "${LIFETIMES_HEADING}"`] }
    : { ok: true, value: table };
}

export const lifetimes: Check = {
  name: "lifetimes",
  summary: `every binding and table has a row in the lifetimes table of ${DATA_MODEL}`,
  async run({ root }) {
    const config = readToolConfig(root);
    const wrangler = readWrangler(root);
    const table = readLifetimes(root);
    if (!config.ok || !wrangler.ok || !table.ok) {
      return [config, wrangler, table].flatMap((read) => (read.ok ? [] : read.problems));
    }
    const steps = stepFiles(root, config.value.migrations).map((f) =>
      readFileSync(path.join(root, f), "utf8"),
    );
    return [
      ...table.value.problems,
      ...lifetimeViolations(
        DATA_MODEL,
        table.value.rows,
        storeBindings(wrangler.value),
        tablesOf(steps),
      ),
    ];
  },
};
