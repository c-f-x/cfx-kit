// Reading the Markdown of a README, an agent brief or a skill for the ground
// rules. A line inside a fenced code block is code, never a heading, so a `#`
// comment in a shell example neither starts nor ends a section. New in the kit.

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/** For each line, the number of the fenced code block it is part of, its fence lines included, or undefined. */
export function fenceIds(lines: string[]): (number | undefined)[] {
  let open: string | undefined;
  let id = -1;
  return lines.map((line) => {
    const m = FENCE.exec(line);
    if (open === undefined) {
      if (m === null) return undefined;
      open = m[1] ?? "";
      id += 1;
      return id;
    }
    if (m !== null && (m[1] ?? "").startsWith(open) && (m[2] ?? "").trim() === "") open = undefined;
    return id;
  });
}

/** For each line, whether it is part of a fenced code block, its fence lines included. */
export function fencedLines(lines: string[]): boolean[] {
  return fenceIds(lines).map((id) => id !== undefined);
}

export type Heading = { level: number; title: string; line: number };

/** The headings outside code blocks, with their 0-based line numbers. */
export function headingsOf(markdown: string): Heading[] {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  const found: Heading[] = [];
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m !== null && !fenced[i])
      found.push({ level: (m[1] ?? "").length, title: m[2] ?? "", line: i });
  });
  return found;
}

/**
 * The text under the heading `title` of `level` (2 for `##`), up to the next
 * heading of that level or higher, or undefined when there is no such heading.
 */
export function section(markdown: string, title: string, level = 2): string | undefined {
  const lines = markdown.split("\n");
  const headings = headingsOf(markdown);
  const start = headings.find((h) => h.level === level && h.title === title);
  if (start === undefined) return undefined;
  const end = headings.find((h) => h.line > start.line && h.level <= level);
  return lines.slice(start.line + 1, end?.line).join("\n");
}

/** The `key: value` lines of a Markdown file's frontmatter, or undefined when it has none. */
export function frontmatter(text: string): Map<string, string> | undefined {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (m === null) return undefined;
  const fields = new Map<string, string>();
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv !== null) fields.set(kv[1] ?? "", (kv[2] ?? "").trim().replace(/^["']|["']$/g, ""));
  }
  return fields;
}

/** The text after a Markdown file's frontmatter: all of it when there is none. */
export function body(text: string): string {
  const m = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text);
  return m === null ? text : text.slice(m[0].length);
}

/** The lines outside code blocks, each with its 0-based line number. */
export function proseLines(markdown: string): { text: string; line: number }[] {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  return lines.flatMap((text, line) => (fenced[line] ? [] : [{ text, line }]));
}

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "fence"; info: string; text: string }
  | { kind: "picture"; text: string }
  | { kind: "paragraph"; text: string };

/** The blocks of a Markdown text, in order: headings, code blocks, `<picture>` elements and paragraphs. */
export function blocksOf(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const ids = fenceIds(lines);
  const fenced = ids.map((id) => id !== undefined);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const id = ids[i];
    if (id !== undefined) {
      const start = i;
      while (i < lines.length && ids[i] === id) i += 1;
      const text = lines.slice(start, i).join("\n");
      blocks.push({ kind: "fence", info: (FENCE.exec(line)?.[2] ?? "").trim(), text });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      blocks.push({ kind: "heading", level: (heading[1] ?? "").length, text: heading[2] ?? "" });
      i += 1;
      continue;
    }
    if (/^\s*<picture[\s>]/.test(line)) {
      const start = i;
      while (i < lines.length && !(lines[i] ?? "").includes("</picture>")) i += 1;
      i += 1;
      blocks.push({ kind: "picture", text: lines.slice(start, i).join("\n") });
      continue;
    }
    const start = i;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !fenced[i] &&
      !/^#{1,6}\s/.test(lines[i] ?? "") &&
      !/^\s*<picture[\s>]/.test(lines[i] ?? "")
    )
      i += 1;
    blocks.push({ kind: "paragraph", text: lines.slice(start, i).join("\n") });
  }
  return blocks;
}
