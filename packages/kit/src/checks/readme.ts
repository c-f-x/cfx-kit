import { type Block, blocksOf, headingsOf, proseLines, section } from "./markdown.ts";

// The README every c-f-x repository shares (docs/conventions.md, section 16,
// rule 3): the title, one bold line, a short intro that ends with the family
// line, the screenshot, the shortest real example, then the same sections in
// the same order. `c-f-x check layout` runs it on a tool; the kit's own test
// runs the structure on the kit's README. New in the kit.

export const README = "README.md";
export const FAMILY_URL = "https://c-f-x.com";
export const SPONSOR = "https://buymeacoffee.com/jahala";
/** GitHub cuts a repository's description; standard-readme keeps it under 120 characters. */
export const BOLD_LINE_MAX = 120;
const DEPLOY_BUTTON = "deploy.workers.cloudflare.com";
const AGENTS_INSTALL = "AGENTS.md#install-and-set-up";

/** The `##` sections of every README, in order. An optional one may be left out. */
export const README_SECTIONS: readonly { title: string; optional: boolean }[] = [
  { title: "What it does", optional: false },
  { title: "What it does not do", optional: false },
  { title: "Install", optional: false },
  { title: "Use", optional: false },
  { title: "How it works", optional: true },
  { title: "Work on it", optional: false },
  { title: "Credits", optional: true },
  { title: "Support", optional: false },
  { title: "License", optional: false },
];

const SECTION_LIST = README_SECTIONS.map(
  ({ title, optional }) => `## ${title}${optional ? " (if any)" : ""}`,
);
const SECTIONS_RULE = `its sections must be ${SECTION_LIST.slice(0, -1).join(", ")} and ${SECTION_LIST.at(-1) ?? ""}, in that order`;

/** Whether the `##` titles follow README_SECTIONS: every required one, in order, nothing else. */
export function sectionsInOrder(titles: string[]): boolean {
  let at = 0;
  for (const title of titles) {
    while (at < README_SECTIONS.length && README_SECTIONS[at]?.title !== title) {
      if (README_SECTIONS[at]?.optional !== true) return false;
      at += 1;
    }
    if (at === README_SECTIONS.length) return false;
    at += 1;
  }
  return README_SECTIONS.slice(at).every((s) => s.optional);
}

const isScreenshot = (b: Block) =>
  b.kind === "picture" || (b.kind === "fence" && b.info === "console");

const LOCAL_SOURCE = /\b(?:srcset|src)="([^"]+)"/g;

function pictureViolations(picture: string, exists: (p: string) => boolean): string[] {
  const problems: string[] = [];
  if (!/<source\b[^>]*media="\(prefers-color-scheme:\s*dark\)"[^>]*srcset="[^"]+"/.test(picture))
    problems.push(
      `${README}: the screenshot's <picture> needs a <source media="(prefers-color-scheme: dark)"> for dark mode`,
    );
  if (!/<img\b[^>]*\balt="[^"]*[^"\s][^"]*"/.test(picture))
    problems.push(`${README}: the screenshot's <img> needs alt text that says what it shows`);
  for (const [, source = ""] of picture.matchAll(LOCAL_SOURCE)) {
    if (!/^[a-z]+:/i.test(source) && !exists(source.replace(/^\.\//, "")))
      problems.push(`${README}: the screenshot ${source} does not exist`);
  }
  return problems;
}

/** The top of the README: title, bold line, intro, screenshot and example. */
function headViolations(text: string, name: string, exists: (p: string) => boolean): string[] {
  const problems: string[] = [];
  const blocks = blocksOf(text);
  const first = blocks[0];
  const titled = first?.kind === "heading" && first.level === 1;
  if (!titled || first.text !== name)
    problems.push(`${README} must start with the title # ${name}, the repository's name`);
  const rest = blocks.slice(titled ? 1 : 0);
  const end = rest.findIndex((b) => b.kind === "heading" && b.level <= 2);
  const head = end === -1 ? rest : rest.slice(0, end);

  const bold = head[0]?.kind === "paragraph" ? /^\*\*([^*\n]+)\*\*$/.exec(head[0].text) : null;
  if (bold === null)
    problems.push(
      `${README}: the line after the title must be one bold sentence, **like this**, the same words as the GitHub description`,
    );
  else if ((bold[1] ?? "").length >= BOLD_LINE_MAX)
    problems.push(
      `${README}: the bold line has ${(bold[1] ?? "").length} characters; keep it under ${BOLD_LINE_MAX}, as GitHub's description`,
    );

  const after = head.slice(head[0]?.kind === "paragraph" ? 1 : 0);
  const family = after.findIndex(
    (b) => b.kind === "paragraph" && b.text.includes(`](${FAMILY_URL})`),
  );
  const shot = after.findIndex(isScreenshot);
  const introEndsWithFamily =
    family !== -1 &&
    after.slice(0, family).every((b) => b.kind === "paragraph") &&
    (shot === -1 || shot === family + 1);
  if (!introEndsWithFamily)
    problems.push(
      `${README}: the intro must end with the line that ${name} is part of c-f-x, linked to ${FAMILY_URL}`,
    );
  const screenshot = shot === -1 ? undefined : after[shot];
  if (screenshot === undefined) {
    problems.push(
      `${README}: after the intro comes the screenshot: a <picture> with a dark source and alt text, or a \`\`\`console block of real terminal output`,
    );
    return problems;
  }
  if (screenshot.kind === "picture") problems.push(...pictureViolations(screenshot.text, exists));
  if (!after.slice(shot + 1).some((b) => b.kind === "fence"))
    problems.push(
      `${README}: after the screenshot comes the shortest real example of a product using it, in a code block, before the first ## section`,
    );
  return problems;
}

/** Badges, a table of contents and the deploy button, on lines outside code blocks. */
function lineViolations(text: string): string[] {
  const problems: string[] = [];
  const headings = headingsOf(text);
  const support = headings.find((h) => h.level === 2 && h.title === "Support");
  const supportEnd = headings.find(
    (h) => support !== undefined && h.line > support.line && h.level <= 2,
  );
  const inSupport = (line: number) =>
    support !== undefined &&
    line > support.line &&
    (supportEnd === undefined || line < supportEnd.line);
  for (const { text: line, line: at } of proseLines(text)) {
    if (line.includes(DEPLOY_BUTTON))
      problems.push(
        `${README}: links Cloudflare's deploy button, which is not offered yet (c-f-x conventions, section 11)`,
      );
    else if ((line.includes("[![") || line.includes("img.shields.io")) && !inSupport(at))
      problems.push(
        `${README}: a badge outside ## Support, ${line.trim()}; the README carries no badges`,
      );
    if (/^\s*(?:[-*+]|\d+\.)\s+\[[^\]]+\]\(#[^)]*\)/.test(line))
      problems.push(`${README}: a table of contents, ${line.trim()}; the README has none`);
  }
  return problems;
}

/**
 * The README's shape, which every c-f-x repository follows: the top, the
 * sections in order, and no badges, table of contents or deploy button.
 * `exists` says whether a repository path exists, for the screenshot's files.
 */
export function readmeStructureViolations(
  text: string,
  name: string,
  exists: (p: string) => boolean,
): string[] {
  const titles = headingsOf(text)
    .filter((h) => h.level === 2)
    .map((h) => h.title);
  return [
    ...headViolations(text, name, exists),
    ...(sectionsInOrder(titles)
      ? []
      : [`${README}: ${SECTIONS_RULE}; it has ${titles.join(", ") || "none"}`]),
    ...lineViolations(text),
  ];
}

/** A tool's README: its shape, what its Install section holds, and the sponsor badge. */
export function readmeViolations(
  text: string,
  name: string,
  exists: (p: string) => boolean,
): string[] {
  const problems = readmeStructureViolations(text, name, exists);
  // A README without its Install section breaks the section order, which says so.
  const install = section(text, "Install");
  if (install !== undefined) {
    const parts = ["Workers Paid", `npx skills add c-f-x/${name}`, `](${AGENTS_INSTALL})`];
    const at = parts.map((part) => install.indexOf(part));
    if (!at.every((i, n) => i !== -1 && (n === 0 || i > (at[n - 1] ?? -1))))
      problems.push(
        `${README}: its ## Install section must give, in this order, what you need (the Workers Paid plan), the agent route (\`npx skills add c-f-x/${name}\`) and the link to every step (${AGENTS_INSTALL})`,
      );
  }
  if (!(section(text, "Support") ?? "").includes(`](${SPONSOR})`))
    problems.push(
      `${README}: its ## Support section must hold the Buy Me A Coffee badge that links ${SPONSOR}`,
    );
  return problems;
}
