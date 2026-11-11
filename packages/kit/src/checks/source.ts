import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Reading a tool's source text for the checks that look at code. Ported from
// cfanalytics:scripts/lib/source.mjs, with paths taken relative to the tool's
// own folder instead of a fixed root.

/** One source file: its repository path, with "/" between folders, and its text. */
export type Source = { file: string; text: string };

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The repository path of `file` under `root`, with "/" between folders. */
export function repoPath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * Source files under `dir` (a repository path), without type declarations,
 * tests, generated files and dependencies, as repository paths. Empty when
 * `dir` does not exist.
 */
export function sourceFiles(root: string, dir: string): string[] {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(full, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const file = repoPath(root, path.join(entry.parentPath, entry.name));
    if (/\.d\.ts$|\.test\.tsx?$|\.gen\.ts$/.test(file) || file.split("/").includes("node_modules"))
      continue;
    out.push(file);
  }
  return out.toSorted(byText);
}

export function readSources(root: string, files: string[]): Source[] {
  return files.map((file) => ({ file, text: readFileSync(path.join(root, file), "utf8") }));
}

/** The text without comments, so a rule that reads calls is not fooled by prose. */
export function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export type Import = { spec: string; typeOnly: boolean };

/**
 * Every module specifier a file imports or re-exports, and whether the whole
 * statement is type-only. Statements end with ";" (Biome enforces it), so a
 * lazy match up to `from "x"` spans multi-line import lists.
 */
export function importsOf(text: string): Import[] {
  const out: Import[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const m of text.matchAll(statement)) out.push({ spec: m[3] ?? "", typeOnly: Boolean(m[2]) });
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g))
    out.push({ spec: m[1] ?? "", typeOnly: false });
  return out;
}

/** The repository path a relative import in `file` points at. */
export function resolveImport(file: string, spec: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
}
