import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Check } from "./types.ts";

// `c-f-x check docs`: docs name only paths that exist, the agent brief is
// AGENTS.md and stays short, and CLAUDE.md only imports it
// (docs/conventions.md, sections 13 and 16). Ported from
// cfanalytics:scripts/lib/docs.mjs and cfanalytics:scripts/docs.test.mjs.

export const BRIEF = "AGENTS.md";
export const BRIEF_MAX_LINES = 150;
export const CLAUDE = "CLAUDE.md";
/** The one line of CLAUDE.md. Claude Code reads it as an import of AGENTS.md. */
export const IMPORT_LINE = "@AGENTS.md";
/** The brief's section that /test-setup writes: each kind of test, when it runs, and its time. */
export const STRATEGY_HEADING = "## Test strategy";

const PLANNED = " (planned)";
const REPO_ROOTS = /^(apps|packages|scripts|docs|\.github)\//;
const FILE_EXT = /\.(md|ts|tsx|mjs|js|json|jsonc|sql|ya?ml|toml)$/;

// The decision log is history, and research notes describe other projects, so
// the paths they name need not exist here.
const NOT_CHECKED = [/^docs\/decisions\.md$/, /^docs\/research\//];

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The Markdown files at the top of a repository that say what holds now.
const TOP = [BRIEF, CLAUDE, "README.md"];

export type NamedPath = { path: string; planned: boolean };

/**
 * Repo paths a doc names in backticks: a token with a slash that starts at a
 * top-level folder or ends in a file extension. URL paths ("/s/"), templates
 * ("<slice>"), globs, package names and other repos' paths ("repo:path") are
 * not this repo's files. A path followed by "(planned)" is not built yet.
 */
export function namedPaths(text: string): NamedPath[] {
  const paths: NamedPath[] = [];
  for (const m of text.matchAll(/`([^`\s]+)`( \(planned\))?/g)) {
    const token = (m[1] ?? "").replace(/:\d+(-\d+)?$/, "");
    if (!token.includes("/") || /^[/@]/.test(token) || /[<>*:{}()$]/.test(token)) continue;
    if (!REPO_ROOTS.test(token) && !FILE_EXT.test(token)) continue;
    paths.push({ path: token.replace(/\/$/, ""), planned: m[2] === PLANNED });
  }
  return paths;
}

/** Paths a doc names that do not exist, and paths marked planned that now exist. */
export function pathViolations(
  doc: string,
  text: string,
  exists: (p: string) => boolean,
): string[] {
  const found: string[] = [];
  const named = namedPaths(text);
  const planned = new Set(named.filter((n) => n.planned).map((n) => n.path));
  for (const p of planned)
    if (exists(p)) found.push(`${doc}: ${p} exists, so drop its "(planned)"`);
  for (const { path: p } of named) {
    if (!planned.has(p) && !exists(p)) found.push(`${doc}: ${p} does not exist`);
  }
  return [...new Set(found)];
}

/**
 * A problem when the brief is missing, or has more than BRIEF_MAX_LINES lines.
 * `text` is undefined when the file does not exist. A final newline ends the last line.
 */
export function briefProblems(text: string | undefined): string[] {
  if (text === undefined)
    return [`${BRIEF} is missing: it is the agent brief of every c-f-x repository`];
  const count = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
  return count > BRIEF_MAX_LINES
    ? [`${BRIEF}: has ${count} lines, more than ${BRIEF_MAX_LINES}`]
    : [];
}

/** A problem when the brief has no test strategy section. A missing brief is briefProblems' to report. */
export function strategyProblems(text: string | undefined): string[] {
  return text === undefined || text.split("\n").some((l) => l.trim() === STRATEGY_HEADING)
    ? []
    : [
        `${BRIEF} has no ${STRATEGY_HEADING} section: /test-setup writes the commands, when each runs and their measured times there`,
      ];
}

/** A problem unless CLAUDE.md holds only the import line. `text` is undefined when the file does not exist. */
export function importProblems(text: string | undefined): string[] {
  return text?.trim() === IMPORT_LINE
    ? []
    : [`${CLAUDE} must hold only the line ${IMPORT_LINE}, which imports ${BRIEF}`];
}

/**
 * The docs that say what holds in a repository now, from its Markdown files:
 * `AGENTS.md`, `CLAUDE.md`, `README.md` and everything under `docs/`, less the history.
 */
export function docsToCheck(files: string[]): string[] {
  return files
    .filter((f) => TOP.includes(f) || (f.startsWith("docs/") && f.endsWith(".md")))
    .filter((f) => !NOT_CHECKED.some((rule) => rule.test(f)))
    .toSorted(byText);
}

// The repository's Markdown files at the top and under docs/, as repo paths.
function markdownFiles(root: string): string[] {
  const top = TOP.filter((f) => existsSync(path.join(root, f)));
  const docs = path.join(root, "docs");
  if (!existsSync(docs)) return top;
  const nested = readdirSync(docs, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
  return [...top, ...nested];
}

export const docs: Check = {
  name: "docs",
  summary: `docs name only paths that exist, ${BRIEF} has at most ${BRIEF_MAX_LINES} lines and a test strategy, and ${CLAUDE} only imports it`,
  async run({ root }) {
    const exists = (p: string) => existsSync(path.join(root, p));
    const read = (p: string) => (exists(p) ? readFileSync(path.join(root, p), "utf8") : undefined);
    const brief = read(BRIEF);
    const problems = [
      ...briefProblems(brief),
      ...strategyProblems(brief),
      ...importProblems(read(CLAUDE)),
    ];
    for (const doc of docsToCheck(markdownFiles(root))) {
      problems.push(...pathViolations(doc, read(doc) ?? "", exists));
    }
    return problems;
  },
};
