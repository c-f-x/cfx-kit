import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { body, frontmatter, headingsOf, section } from "./markdown.ts";
import { readmeViolations } from "./readme.ts";
import { configBlocks, isRecord, parseWrangler, WRANGLER, workerPath } from "./tool-config.ts";
import { DEV_VARS_EXAMPLE, requiredSecrets } from "./wrangler-config.ts";

// The ground rules every tool repository meets (docs/conventions.md, section
// 16, the owner's ruling D-8): the files a public repository keeps from day
// one, the README's shape, the install guide in AGENTS.md, the agent skill,
// the garden's tools and the landing page. `c-f-x check layout` runs them. AGENTS.md and CLAUDE.md are
// held by `c-f-x check docs`, which every repository runs. New in the kit.

/** What the rules read of a repository: a file's text (undefined when absent), and the names in a folder. */
export type RepoView = {
  read: (p: string) => string | undefined;
  list: (dir: string) => string[];
};

/** A view of the repository at `root` on disk. */
export function repoOnDisk(root: string): RepoView {
  return {
    read: (p) => {
      const full = path.join(root, p);
      return existsSync(full) && statSync(full).isFile() ? readFileSync(full, "utf8") : undefined;
    },
    list: (dir) => {
      const full = path.join(root, dir);
      return existsSync(full) && statSync(full).isDirectory() ? readdirSync(full) : [];
    },
  };
}

const TOOL_NAME = /^cfx-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECURITY_ADDRESS = "security@c-f-x.com";
const WORKFLOWS = ".github/workflows";
const ISSUE_TEMPLATES = ".github/ISSUE_TEMPLATE";

function toolName(view: RepoView): string | undefined {
  const text = view.read("package.json");
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    const name = isRecord(value) ? value.name : undefined;
    return typeof name === "string" && TOOL_NAME.test(name) ? name : undefined;
  } catch {
    // A package.json that does not parse names no tool; the caller reports that.
    return undefined;
  }
}

// Addresses a public skill may show: the family's own, and the reserved examples.
const PUBLIC_ADDRESS = /@(c-f-x\.com|example\.(com|org|net))$/;
// Hostnames a public skill may name: the reserved examples, the family's own,
// and the platforms every tool runs on. Any other is someone's deployment.
const URL_HOST = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost)\b/gi;
const PUBLIC_HOST =
  /^(localhost|(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|c-f-x\.com|cloudflare\.com)|github\.com|(?:www\.)?npmjs\.com)$/;
// The Agent Skills format (agentskills.io/specification, read 2026-11-12).
const SKILL_DESCRIPTION_MAX = 1024;
const SKILL_BODY_MAX = 500;

function skillViolations(view: RepoView, name: string): string[] {
  const file = `skills/${name}/SKILL.md`;
  const text = view.read(file);
  if (text === undefined)
    return [
      `${file} is missing: it is the skill agents install with \`npx skills add c-f-x/${name}\``,
    ];
  const problems: string[] = [];
  const fields = frontmatter(text);
  if (fields?.get("name") !== name)
    problems.push(`${file}: its frontmatter must say name: ${name}`);
  if ((fields?.get("description") ?? "") === "")
    problems.push(`${file}: its frontmatter must have a description that says when to use it`);
  for (const [address] of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    if (!PUBLIC_ADDRESS.test(address))
      problems.push(`${file}: names an email address, ${address}; a skill holds no personal data`);
  }
  for (const [id] of text.matchAll(
    /\b(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g,
  ))
    problems.push(`${file}: holds an id, ${id}; a skill holds no account or resource ids`);
  for (const host of new Set([...text.matchAll(URL_HOST)].map((m) => (m[1] ?? "").toLowerCase()))) {
    if (!PUBLIC_HOST.test(host))
      problems.push(
        `${file}: names the hostname ${host}; a skill holds no deployment hostname, so write example.com`,
      );
  }
  const description = fields?.get("description") ?? "";
  if (description.length > SKILL_DESCRIPTION_MAX)
    problems.push(
      `${file}: its description has ${description.length} characters; the Agent Skills limit is ${SKILL_DESCRIPTION_MAX}`,
    );
  const lines = body(text).replace(/\n$/, "").split("\n").length;
  if (lines >= SKILL_BODY_MAX)
    problems.push(
      `${file}: its body has ${lines} lines; keep it under ${SKILL_BODY_MAX}, with the rest in references/`,
    );
  const guide = `https://github.com/c-f-x/${name}/blob/master/AGENTS.md#install-and-set-up`;
  if (!text.includes(guide))
    problems.push(`${file}: must link ${guide} for installing, instead of copying the steps`);
  return problems;
}

/** The parts of AGENTS.md's install guide, in order (docs/conventions.md, section 16, rule 2). */
export const INSTALL_PARTS = [
  "What you need",
  "The install command",
  "What only the owner can do",
  "Secrets",
  "Check that it works",
  "Undo",
  "By hand",
] as const;
const INSTALL_GUIDE = "Install and set up";

// The secrets every block of the Worker's wrangler.jsonc requires.
function secretsOf(view: RepoView, worker: string): string[] {
  const file = workerPath(worker, WRANGLER);
  const config = parseWrangler(view.read(file) ?? "{}", file);
  if (!config.ok) return [];
  return [...new Set(configBlocks(config.value).flatMap(([, b]) => requiredSecrets(b) ?? []))];
}

const NEEDS_HEADER = /^\|\s*Need\s*\|\s*How to check it\s*\|\s*$/;

// Whether the needs are a two-column table with both cells filled in every row.
function needsTable(part: string): boolean {
  const rows = part.split("\n").filter((l) => l.trim().startsWith("|"));
  if (rows.length < 3 || !NEEDS_HEADER.test(rows[0] ?? "")) return false;
  return rows.slice(2).every((row) => {
    const cells = row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|");
    return cells.length === 2 && cells.every((c) => c.trim() !== "");
  });
}

/** AGENTS.md's `## Install and set up`, with its parts. A missing AGENTS.md is `c-f-x check docs`' to report. */
function installGuideViolations(view: RepoView, worker: string): string[] {
  const brief = view.read("AGENTS.md");
  if (brief === undefined) return [];
  const guide = section(brief, INSTALL_GUIDE);
  if (guide === undefined)
    return [
      `AGENTS.md has no ## ${INSTALL_GUIDE} section: it is how a person or an agent installs the tool`,
    ];
  const problems: string[] = [];
  const parts = headingsOf(guide)
    .filter((h) => h.level === 3)
    .map((h) => h.title);
  if (parts.join("\n") !== INSTALL_PARTS.join("\n"))
    problems.push(
      `AGENTS.md: ## ${INSTALL_GUIDE} must have these parts, in this order: ${INSTALL_PARTS.map((p) => `### ${p}`).join(", ")}; it has ${parts.join(", ") || "none"}`,
    );
  const part = (title: string) => section(guide, title, 3);
  for (const title of parts) {
    if ((part(title) ?? "").trim() === "")
      problems.push(`AGENTS.md: ### ${title} under ## ${INSTALL_GUIDE} is empty`);
  }
  const needs = part("What you need");
  if (needs !== undefined && needs.trim() !== "" && !needsTable(needs))
    problems.push(
      "AGENTS.md: ### What you need must be a table, | Need | How to check it |, with both cells filled in every row",
    );
  const secrets = part("Secrets");
  if (secrets !== undefined) {
    for (const name of secretsOf(view, worker)) {
      if (!new RegExp(`\\|[^|\\n]*\\bwrangler secret put ${name}\\b`).test(secrets))
        problems.push(
          `AGENTS.md: ### Secrets must pipe ${name} into \`wrangler secret put ${name}\`, so its value never shows on screen`,
        );
    }
  }
  const works = part("Check that it works");
  if (works !== undefined && works.trim() !== "" && !works.includes("/healthz"))
    problems.push(
      "AGENTS.md: ### Check that it works must show the request to /healthz that proves the install worked",
    );
  const byHand = part("By hand");
  if (byHand !== undefined && byHand.trim() !== "" && !/^\d+\.\s/m.test(byHand))
    problems.push("AGENTS.md: ### By hand must be a numbered list, one command per step");
  return problems;
}

function workflowViolations(view: RepoView): string[] {
  const files = view
    .list(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .toSorted()
    .map((f) => ({ file: `${WORKFLOWS}/${f}`, text: view.read(`${WORKFLOWS}/${f}`) ?? "" }));
  const all = files.map((f) => f.text).join("\n");
  const problems: string[] = [];
  if (!/\bweeder check\b[^\n]*--base origin\/master\b/.test(all))
    problems.push(`no workflow in ${WORKFLOWS} runs \`weeder check --base origin/master\``);
  if (!/\bpetals (check|gate)\b/.test(all))
    problems.push(`no workflow in ${WORKFLOWS} runs \`petals check\` or \`petals gate\``);
  for (const { file, text } of files) {
    text.split("\n").forEach((line, i) => {
      // A YAML comment may mention a runner without naming one.
      const code = line.replace(/(^|\s)#.*$/, "");
      if (code.includes("self-hosted") && !code.includes("vars.CI_RUNS_ON ||"))
        problems.push(
          `${file}:${i + 1}: a self-hosted runner must be named only as the fallback of vars.CI_RUNS_ON, so a public repository can move to GitHub's runners`,
        );
    });
  }
  return problems;
}

/**
 * The ground rules `view` breaks, each as one problem. `worker` is the folder
 * that holds the Worker's `wrangler.jsonc` and `.dev.vars.example`, from the
 * tool's `c-f-x.json`; every other file is read at the root.
 */
export function groundRuleViolations(view: RepoView, worker: string): string[] {
  const name = toolName(view);
  const problems: string[] = [];
  if (name === undefined)
    problems.push("package.json must name the tool as cfx-<job>, the name of its repository");
  else {
    const readme = view.read("README.md");
    problems.push(
      ...skillViolations(view, name),
      ...(readme === undefined
        ? ["README.md is missing"]
        : readmeViolations(readme, name, (p) => view.read(p) !== undefined)),
    );
  }
  problems.push(...installGuideViolations(view, worker));
  if (!(view.read("LICENSE") ?? "").startsWith("MIT License"))
    problems.push("LICENSE is missing or is not the MIT License (D-6)");
  if (!(view.read("SECURITY.md") ?? "").includes(SECURITY_ADDRESS))
    problems.push(`SECURITY.md is missing, or does not name ${SECURITY_ADDRESS}`);
  const dependabot = view.read(".github/dependabot.yml") ?? "";
  if (
    !["npm", "github-actions"].every((e) =>
      new RegExp(`package-ecosystem:\\s*["']?${e}["']?\\s*$`, "m").test(dependabot),
    )
  )
    problems.push(
      ".github/dependabot.yml is missing, or does not update both npm and github-actions",
    );
  if (!/^buy_me_a_coffee:\s*jahala\s*$/m.test(view.read(".github/FUNDING.yml") ?? ""))
    problems.push(".github/FUNDING.yml is missing, or does not say buy_me_a_coffee: jahala");
  if (view.read("docs/decisions.md") === undefined) problems.push("docs/decisions.md is missing");
  if (view.read("CONTRIBUTING.md") === undefined)
    problems.push("CONTRIBUTING.md is missing: it says how to propose a change");
  if (
    !view.list(ISSUE_TEMPLATES).some((f) => /\.(md|ya?ml)$/.test(f) && !/^config\.ya?ml$/.test(f))
  )
    problems.push(`${ISSUE_TEMPLATES}/ holds no issue template`);
  const example = workerPath(worker, DEV_VARS_EXAMPLE);
  if (view.read(example) === undefined)
    problems.push(
      `${example} is missing: it names the Worker's secrets, exactly those in ${workerPath(worker, WRANGLER)}'s secrets.required`,
    );
  if (view.read("site.example.jsonc") === undefined)
    problems.push(
      "site.example.jsonc is missing: it is the site file other people copy, with example.com values",
    );
  problems.push(...workflowViolations(view));
  if (view.list(".husky").length > 0)
    problems.push(
      ".husky/ is here: husky owns the git hooks, and weeder's guard refuses to install beside it",
    );
  if (!view.list("docs/tend").some((f) => f.endsWith(".tend.html")))
    problems.push("docs/tend/ holds no *.tend.html map: run `tend init`");
  if (view.read(".petalsrc") === undefined)
    problems.push(".petalsrc is missing: it names the family brand and the tool's layer");
  return problems;
}
