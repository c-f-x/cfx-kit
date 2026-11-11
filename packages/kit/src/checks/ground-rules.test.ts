import assert from "node:assert/strict";
import { test } from "node:test";
import { groundFiles } from "../test-support/tool-repo.ts";
import { groundRuleViolations, type RepoView } from "./ground-rules.ts";

// The ground rules every tool repository meets (docs/conventions.md, section
// 16), on a sample held in memory. The clean sample passes. Each break below
// changes one file and must give exactly one problem.

const NAME = "cfx-sample";
const CLEAN = groundFiles(NAME);

/** A repository held in memory, as the check sees one. */
function view(files: Record<string, string>): RepoView {
  return {
    read: (p) => files[p],
    list: (dir) => [
      ...new Set(
        Object.keys(files)
          .filter((f) => f.startsWith(`${dir}/`))
          .map((f) => f.slice(dir.length + 1).split("/")[0] ?? ""),
      ),
    ],
  };
}

const without = (...paths: string[]) =>
  Object.fromEntries(Object.entries(CLEAN).filter(([p]) => !paths.includes(p)));
const withFile = (p: string, text: string) => ({ ...CLEAN, [p]: text });
const edited = (p: string, from: string, to: string) => {
  const text = CLEAN[p] ?? "";
  assert.ok(text.includes(from), `${p} holds ${from}`);
  return withFile(p, text.replace(from, to));
};

const INSTALL = `README.md: its ## Install section must show, in this order, Cloudflare's deploy button (https://deploy.workers.cloudflare.com/?url=https://github.com/c-f-x/${NAME}), \`pnpm ops ${NAME} install\` and \`npx skills add c-f-x/${NAME}\``;

const BREAKS: [string, Record<string, string>, string][] = [
  [
    "no tool name",
    withFile("package.json", "{}"),
    "package.json must name the tool as cfx-<job>, the name of its repository",
  ],
  [
    "a package name that is not cfx-<job>",
    withFile("package.json", JSON.stringify({ name: "sample" })),
    "package.json must name the tool as cfx-<job>, the name of its repository",
  ],
  [
    "no skill",
    without(`skills/${NAME}/SKILL.md`),
    `skills/${NAME}/SKILL.md is missing: it is the skill agents install with \`npx skills add c-f-x/${NAME}\``,
  ],
  [
    "a skill of another name",
    edited(`skills/${NAME}/SKILL.md`, `name: ${NAME}`, "name: sample"),
    `skills/${NAME}/SKILL.md: its frontmatter must say name: ${NAME}`,
  ],
  [
    "a skill with no description",
    edited(`skills/${NAME}/SKILL.md`, "description: Use when a product needs a sample.\n", ""),
    `skills/${NAME}/SKILL.md: its frontmatter must have a description that says when to use it`,
  ],
  [
    "a skill with an email address",
    edited(`skills/${NAME}/SKILL.md`, `# ${NAME}`, `# ${NAME}\n\nAsk owner@realmail.net.`),
    `skills/${NAME}/SKILL.md: names an email address, owner@realmail.net; a skill holds no personal data`,
  ],
  [
    "a skill with an account id",
    edited(
      `skills/${NAME}/SKILL.md`,
      `# ${NAME}`,
      `# ${NAME}\n\nAccount 0123456789abcdef0123456789abcdef.`,
    ),
    `skills/${NAME}/SKILL.md: holds an id, 0123456789abcdef0123456789abcdef; a skill holds no account or resource ids`,
  ],
  ["no README", without("README.md"), "README.md is missing"],
  [
    "no Install section",
    edited("README.md", "## Install", "## Setup"),
    "README.md has no ## Install section",
  ],
  [
    "no deploy button",
    edited("README.md", "deploy.workers.cloudflare.com/?url", "example.com/?url"),
    INSTALL,
  ],
  ["no ops install", edited("README.md", `pnpm ops ${NAME} install`, "pnpm install"), INSTALL],
  [
    "no skill install",
    edited("README.md", `npx skills add c-f-x/${NAME}`, "npx skills add"),
    INSTALL,
  ],
  [
    "the three ways out of order",
    edited(
      "README.md",
      `pnpm ops ${NAME} install\n\`\`\`\n\n\`\`\`\nnpx skills add c-f-x/${NAME}`,
      `npx skills add c-f-x/${NAME}\n\`\`\`\n\n\`\`\`\npnpm ops ${NAME} install`,
    ),
    INSTALL,
  ],
  [
    "no Support badge",
    edited("README.md", "https://buymeacoffee.com/jahala", "https://example.com"),
    "README.md: its ## Support section must hold the Buy Me A Coffee badge that links https://buymeacoffee.com/jahala",
  ],
  ["no LICENSE", without("LICENSE"), "LICENSE is missing or is not the MIT License (D-6)"],
  [
    "a LICENSE that is not MIT",
    withFile("LICENSE", "Apache License\nVersion 2.0\n"),
    "LICENSE is missing or is not the MIT License (D-6)",
  ],
  [
    "no SECURITY.md",
    without("SECURITY.md"),
    "SECURITY.md is missing, or does not name security@c-f-x.com",
  ],
  [
    "a SECURITY.md without the address",
    edited("SECURITY.md", "security@c-f-x.com", "the owner"),
    "SECURITY.md is missing, or does not name security@c-f-x.com",
  ],
  [
    "no dependabot",
    without(".github/dependabot.yml"),
    ".github/dependabot.yml is missing, or does not update both npm and github-actions",
  ],
  [
    "a dependabot without npm",
    edited(".github/dependabot.yml", "package-ecosystem: npm", "package-ecosystem: pip"),
    ".github/dependabot.yml is missing, or does not update both npm and github-actions",
  ],
  [
    "no funding",
    without(".github/FUNDING.yml"),
    ".github/FUNDING.yml is missing, or does not say buy_me_a_coffee: jahala",
  ],
  ["no decision log", without("docs/decisions.md"), "docs/decisions.md is missing"],
  [
    "no weeder job",
    edited(".github/workflows/ci.yml", "weeder check --base", "weeder scan --base"),
    "no workflow in .github/workflows runs `weeder check --base origin/master`",
  ],
  [
    "no petals check",
    edited(".github/workflows/ci.yml", "petals check", "echo"),
    "no workflow in .github/workflows runs `petals check` or `petals gate`",
  ],
  [
    "a runner with no way back",
    edited(
      ".github/workflows/ci.yml",
      `\${{ fromJSON(vars.CI_RUNS_ON || '["self-hosted", "macOS", "${NAME}"]') }}`,
      `[self-hosted, macOS, ${NAME}]`,
    ),
    ".github/workflows/ci.yml:4: a self-hosted runner must be named only as the fallback of vars.CI_RUNS_ON, so a public repository can move to GitHub's runners",
  ],
  [
    "husky",
    withFile(".husky/pre-commit", "npx lint-staged\n"),
    ".husky/ is here: husky owns the git hooks, and weeder's guard refuses to install beside it",
  ],
  [
    "no tend map",
    without("docs/tend/cfx-sample.tend.html"),
    "docs/tend/ holds no *.tend.html map: run `tend init`",
  ],
  [
    ".petalsrc missing",
    without(".petalsrc"),
    ".petalsrc is missing: it names the family brand and the tool's layer",
  ],
  [
    "no landing page",
    without("docs/index.html"),
    "docs/index.html is missing: it is the landing page GitHub Pages publishes from /docs",
  ],
  [
    "no .nojekyll",
    without("docs/.nojekyll"),
    "docs/.nojekyll is missing: without it, GitHub Pages runs Jekyll over every doc in /docs",
  ],
];

test("the ground rules pass a tool repository that keeps every one", () => {
  assert.deepEqual(groundRuleViolations(view(CLEAN)), []);
});

for (const [name, files, problem] of BREAKS) {
  test(`the ground rules flag ${name}`, () => {
    assert.deepEqual(groundRuleViolations(view(files)), [problem]);
  });
}

test("the ground rules read the install lines only inside the Install section", () => {
  const moved = edited("README.md", `\`\`\`\nnpx skills add c-f-x/${NAME}\n\`\`\`\n`, "");
  const text = `${moved["README.md"] ?? ""}\n## Usage\n\nnpx skills add c-f-x/${NAME}\n`;
  assert.deepEqual(groundRuleViolations(view({ ...moved, "README.md": text })), [INSTALL]);
});
