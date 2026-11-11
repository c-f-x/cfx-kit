import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isRecord } from "./tool-config.ts";

// The ground rules every tool repository meets (docs/conventions.md, section
// 16, the owner's ruling D-8): the files a public repository keeps from day
// one, the agent skill, the three ways to install, the garden's tools and the
// landing page. `c-f-x check layout` runs them. AGENTS.md and CLAUDE.md are
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
const SPONSOR = "https://buymeacoffee.com/jahala";
const WORKFLOWS = ".github/workflows";
const LANDING_PAGE = "docs/index.html";

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

/** The text of a `## <heading>` section, up to the next heading of that level or higher. */
export function section(markdown: string, heading: string): string | undefined {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,2} /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
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

// Addresses a public skill may show: the family's own, and the reserved examples.
const PUBLIC_ADDRESS = /@(c-f-x\.com|example\.(com|org|net))$/;

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
  return problems;
}

function readmeViolations(view: RepoView, name: string): string[] {
  const text = view.read("README.md");
  if (text === undefined) return ["README.md is missing"];
  const problems: string[] = [];
  const install = section(text, "Install");
  const ways = [
    `https://deploy.workers.cloudflare.com/?url=https://github.com/c-f-x/${name}`,
    `pnpm ops ${name} install`,
    `npx skills add c-f-x/${name}`,
  ];
  if (install === undefined) problems.push("README.md has no ## Install section");
  else {
    const at = ways.map((way) => install.indexOf(way));
    const inOrder = at.every((i, n) => i !== -1 && (n === 0 || i > (at[n - 1] ?? -1)));
    if (!inOrder)
      problems.push(
        `README.md: its ## Install section must show, in this order, Cloudflare's deploy button (${ways[0]}), \`${ways[1]}\` and \`${ways[2]}\``,
      );
  }
  if (!(section(text, "Support") ?? "").includes(`](${SPONSOR})`))
    problems.push(
      `README.md: its ## Support section must hold the Buy Me A Coffee badge that links ${SPONSOR}`,
    );
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

/** The ground rules `view` breaks, each as one problem. */
export function groundRuleViolations(view: RepoView): string[] {
  const name = toolName(view);
  const problems: string[] = [];
  if (name === undefined)
    problems.push("package.json must name the tool as cfx-<job>, the name of its repository");
  else problems.push(...skillViolations(view, name), ...readmeViolations(view, name));
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
  problems.push(...workflowViolations(view));
  if (view.list(".husky").length > 0)
    problems.push(
      ".husky/ is here: husky owns the git hooks, and weeder's guard refuses to install beside it",
    );
  if (!view.list("docs/tend").some((f) => f.endsWith(".tend.html")))
    problems.push("docs/tend/ holds no *.tend.html map: run `tend init`");
  if (view.read(".petalsrc") === undefined)
    problems.push(".petalsrc is missing: it names the family brand and the tool's layer");
  if (view.read(LANDING_PAGE) === undefined)
    problems.push(
      `${LANDING_PAGE} is missing: it is the landing page GitHub Pages publishes from /docs`,
    );
  if (view.read("docs/.nojekyll") === undefined)
    problems.push(
      "docs/.nojekyll is missing: without it, GitHub Pages runs Jekyll over every doc in /docs",
    );
  return problems;
}
