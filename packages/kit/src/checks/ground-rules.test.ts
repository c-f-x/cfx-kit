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

const INSTALL = `README.md: its ## Install section must give, in this order, what you need (the Workers Paid plan), the agent route (\`npx skills add c-f-x/${NAME}\`), getting the code (\`git clone https://github.com/c-f-x/${NAME}\`) and the link to every step (AGENTS.md#install-and-set-up)`;
const SECTIONS = (found: string) =>
  `README.md: its sections must be ## What it does, ## What it does not do, ## Install, ## Use, ## How it works (if any), ## Work on it, ## Credits (if any), ## Support and ## License, in that order; it has ${found}`;
const PARTS = (found: string) =>
  `AGENTS.md: ## Install and set up must have these parts, in this order: ### What you need, ### The install command, ### What only the owner can do, ### Secrets, ### Check that it works, ### Undo, ### By hand; it has ${found}`;
const ALL_PARTS = [
  "What you need",
  "The install command",
  "What only the owner can do",
  "Secrets",
  "Check that it works",
  "Undo",
  "By hand",
];
const BOLD =
  "**Say what cfx-sample is in one sentence, the same words as the repository's GitHub description.**";
const LINK = "[c-f-x](https://c-f-x.com)";
const PICTURE = (CLEAN["README.md"] ?? "").match(/<picture>[\s\S]*?<\/picture>\n\n/)?.[0] ?? "";
const EXAMPLE = (CLEAN["README.md"] ?? "").match(/A product uses it[\s\S]*?```\n\n/)?.[0] ?? "";
const SKILL = `skills/${NAME}/SKILL.md`;
const AGENTS_LINK = `https://github.com/c-f-x/${NAME}/blob/master/AGENTS.md#install-and-set-up`;

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
    without(SKILL),
    `${SKILL} is missing: it is the skill agents install with \`npx skills add c-f-x/${NAME}\``,
  ],
  [
    "a skill of another name",
    edited(SKILL, `name: ${NAME}`, "name: sample"),
    `${SKILL}: its frontmatter must say name: ${NAME}`,
  ],
  [
    "a skill with no description",
    edited(SKILL, /description: .*\n/.exec(CLEAN[SKILL] ?? "")?.[0] ?? "", ""),
    `${SKILL}: its frontmatter must have a description that says when to use it`,
  ],
  [
    "a skill with a description too long",
    edited(SKILL, "description: Use when", `description: ${"Use it well. ".repeat(80)}Use when`),
    `${SKILL}: its description has 1295 characters; the Agent Skills limit is 1024`,
  ],
  [
    "a skill with a body too long",
    edited(SKILL, "## What needs the owner", `${"A line.\n".repeat(480)}\n## What needs the owner`),
    `${SKILL}: its body has 505 lines; keep it under 500, with the rest in references/`,
  ],
  [
    "a skill that does not point to the install guide",
    edited(SKILL, AGENTS_LINK, "https://github.com/c-f-x"),
    `${SKILL}: must link ${AGENTS_LINK} for installing, instead of copying the steps`,
  ],
  [
    "a skill with an email address",
    edited(SKILL, `# ${NAME}`, `# ${NAME}\n\nAsk owner@realmail.net.`),
    `${SKILL}: names an email address, owner@realmail.net; a skill holds no personal data`,
  ],
  [
    "a skill with an account id",
    edited(SKILL, `# ${NAME}`, `# ${NAME}\n\nAccount 0123456789abcdef0123456789abcdef.`),
    `${SKILL}: holds an id, 0123456789abcdef0123456789abcdef; a skill holds no account or resource ids`,
  ],
  [
    "a skill with a deployment hostname",
    edited(SKILL, `# ${NAME}`, `# ${NAME}\n\nOpen https://analytics.tool.test/board.`),
    `${SKILL}: names the hostname analytics.tool.test; a skill holds no deployment hostname, so write example.com`,
  ],
  ["no README", without("README.md"), "README.md is missing"],
  [
    "a README titled otherwise",
    edited("README.md", `# ${NAME}\n`, "# Sample\n"),
    `README.md must start with the title # ${NAME}, the repository's name`,
  ],
  [
    "no bold line",
    edited("README.md", BOLD, BOLD.replaceAll("**", "")),
    "README.md: the line after the title must be one bold sentence, **like this**, the same words as the GitHub description",
  ],
  [
    "a bold line too long",
    edited("README.md", BOLD, `**${"A tool. ".repeat(16)}**`),
    "README.md: the bold line has 128 characters; keep it under 120, as GitHub's description",
  ],
  [
    "an intro without the family line",
    edited("README.md", LINK, "c-f-x"),
    `README.md: the intro must end with the line that ${NAME} is part of c-f-x, linked to https://c-f-x.com`,
  ],
  [
    "an intro that goes on after the family line",
    edited("README.md", "<picture>", "More words.\n\n<picture>"),
    `README.md: the intro must end with the line that ${NAME} is part of c-f-x, linked to https://c-f-x.com`,
  ],
  [
    "no screenshot",
    edited("README.md", PICTURE, ""),
    "README.md: after the intro comes the screenshot: a <picture> with a dark source and alt text, or a ```console block of real terminal output",
  ],
  [
    "a screenshot with no dark mode",
    edited("README.md", 'media="(prefers-color-scheme: dark)"', 'media="print"'),
    'README.md: the screenshot\'s <picture> needs a <source media="(prefers-color-scheme: dark)"> for dark mode',
  ],
  [
    "a screenshot with no alt text",
    edited("README.md", /alt="[^"]*"/.exec(CLEAN["README.md"] ?? "")?.[0] ?? "", 'alt=""'),
    "README.md: the screenshot's <img> needs alt text that says what it shows",
  ],
  [
    "a screenshot whose image is not in the repository",
    without(`docs/images/${NAME}-dark.png`),
    `README.md: the screenshot docs/images/${NAME}-dark.png does not exist`,
  ],
  [
    "no example",
    edited("README.md", EXAMPLE, ""),
    "README.md: after the screenshot comes the shortest real example of a product using it, in a code block, before the first ## section",
  ],
  [
    "a section renamed",
    edited("README.md", "## Work on it", "## Develop"),
    SECTIONS(
      "What it does, What it does not do, Install, Use, How it works, Develop, Support, License",
    ),
  ],
  [
    "sections out of order",
    edited("README.md", "## Use", "## Credits"),
    SECTIONS(
      "What it does, What it does not do, Install, Credits, How it works, Work on it, Support, License",
    ),
  ],
  [
    "no License section last",
    edited("README.md", "## License\n\nMIT. See [LICENSE](LICENSE).\n", ""),
    SECTIONS("What it does, What it does not do, Install, Use, How it works, Work on it, Support"),
  ],
  [
    "a badge",
    edited(
      "README.md",
      "## What it does\n",
      "## What it does\n\n[![CI](https://example.com/ci.svg)](https://example.com/ci)\n",
    ),
    "README.md: a badge outside ## Support, [![CI](https://example.com/ci.svg)](https://example.com/ci); the README carries no badges",
  ],
  [
    "a table of contents",
    edited("README.md", "## What it does\n", "## What it does\n\n- [Install](#install)\n"),
    "README.md: a table of contents, - [Install](#install); the README has none",
  ],
  [
    "a deploy button",
    edited(
      "README.md",
      "## Use",
      `[![Deploy](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/c-f-x/${NAME})\n\n## Use`,
    ),
    "README.md: links Cloudflare's deploy button, which is not offered yet (c-f-x conventions, section 11)",
  ],
  [
    "no Install section",
    edited("README.md", "## Install", "## Setup"),
    SECTIONS(
      "What it does, What it does not do, Setup, Use, How it works, Work on it, Support, License",
    ),
  ],
  ["no Workers Paid", edited("README.md", "Workers Paid plan", "right plan"), INSTALL],
  [
    "no agent route",
    edited("README.md", `npx skills add c-f-x/${NAME}`, "npx skills add"),
    INSTALL,
  ],
  [
    "no line to get the code",
    edited("README.md", `git clone https://github.com/c-f-x/${NAME}`, "git clone <the repository>"),
    INSTALL,
  ],
  [
    "no link to every step",
    edited("README.md", "(AGENTS.md#install-and-set-up)", "(AGENTS.md)"),
    INSTALL,
  ],
  [
    "the install parts out of order",
    edited(
      "README.md",
      "You need a Cloudflare account",
      "See [every step](AGENTS.md#install-and-set-up). You need a Cloudflare account",
    ),
    INSTALL,
  ],
  [
    "no Support badge",
    edited("README.md", "https://buymeacoffee.com/jahala", "https://example.com"),
    "README.md: its ## Support section must hold the Buy Me A Coffee badge that links https://buymeacoffee.com/jahala",
  ],
  [
    "no install guide in AGENTS.md",
    edited("AGENTS.md", "## Install and set up", "## Installing"),
    "AGENTS.md has no ## Install and set up section: it is how a person or an agent installs the tool",
  ],
  [
    "an install guide without a part",
    edited("AGENTS.md", "### Undo\n", ""),
    PARTS(ALL_PARTS.filter((p) => p !== "Undo").join(", ")),
  ],
  [
    "an install guide with an empty part",
    edited(
      "AGENTS.md",
      /### Undo\n\n[^\n]*\n/.exec(CLEAN["AGENTS.md"] ?? "")?.[0] ?? "",
      "### Undo\n\n",
    ),
    "AGENTS.md: ### Undo under ## Install and set up is empty",
  ],
  [
    "a need with no way to check it",
    edited("AGENTS.md", '| `test -f "$CFX_SITE/cfx-sample.jsonc"` exits 0 |', "|  |"),
    "AGENTS.md: ### What you need must be a table, | Need | How to check it |, with both cells filled in every row",
  ],
  [
    "a secret that is not piped",
    edited(
      "AGENTS.md",
      "openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET",
      "npx wrangler secret put AUTH_SECRET",
    ),
    "AGENTS.md: ### Secrets must pipe AUTH_SECRET into `wrangler secret put AUTH_SECRET`, so its value never shows on screen",
  ],
  [
    "no health check",
    edited(
      "AGENTS.md",
      "curl -fsS https://<admin host>/healthz",
      "curl -fsS https://<admin host>/",
    ),
    "AGENTS.md: ### Check that it works must show the request to /healthz that proves the install worked",
  ],
  [
    "a manual fallback that is not numbered",
    withFile("AGENTS.md", (CLEAN["AGENTS.md"] ?? "").replace(/^\d\. /gm, "- ")),
    "AGENTS.md: ### By hand must be a numbered list, one command per step",
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
    "no CONTRIBUTING.md",
    without("CONTRIBUTING.md"),
    "CONTRIBUTING.md is missing: it says how to propose a change",
  ],
  [
    "no issue templates",
    without(".github/ISSUE_TEMPLATE/bug.yml", ".github/ISSUE_TEMPLATE/idea.yml"),
    ".github/ISSUE_TEMPLATE/ holds no issue template",
  ],
  [
    "no .dev.vars.example",
    without(".dev.vars.example"),
    ".dev.vars.example is missing: it names the Worker's secrets, exactly those in wrangler.jsonc's secrets.required",
  ],
  [
    "no site.example.jsonc",
    without("site.example.jsonc"),
    "site.example.jsonc is missing: it is the site file other people copy, with example.com values",
  ],
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
];

test("the ground rules pass a tool repository that keeps every one", () => {
  assert.deepEqual(groundRuleViolations(view(CLEAN), "."), []);
});

// D-13: a tool's product page lives at c-f-x.com/<tool>/, so the ground rules ask
// no page of a tool repository, and an old page left in one is no problem either.
test("the ground rules ask no product page of a tool repository", () => {
  assert.equal(CLEAN["docs/index.html"], undefined);
  assert.equal(CLEAN["docs/.nojekyll"], undefined);
  assert.deepEqual(groundRuleViolations(view(CLEAN), "."), []);
});

test("the ground rules let an old GitHub Pages page stay in a tool repository", () => {
  const withOldPage = { ...CLEAN, "docs/index.html": "<!doctype html>\n", "docs/.nojekyll": "" };
  assert.deepEqual(groundRuleViolations(view(withOldPage), "."), []);
});

for (const [name, files, problem] of BREAKS) {
  test(`the ground rules flag ${name}`, () => {
    assert.deepEqual(groundRuleViolations(view(files), "."), [problem]);
  });
}

test("the ground rules read the install lines only inside the Install section", () => {
  const moved = edited("README.md", `\`\`\`bash\nnpx skills add c-f-x/${NAME}\n\`\`\`\n`, "");
  const text = (moved["README.md"] ?? "").replace(
    "## Use\n",
    `## Use\n\nnpx skills add c-f-x/${NAME}\n`,
  );
  assert.deepEqual(groundRuleViolations(view({ ...moved, "README.md": text }), "."), [INSTALL]);
});

test("a heading inside a code block is not a section, and does not end one", () => {
  const fenced = edited(
    "README.md",
    `npx skills add c-f-x/${NAME}\n`,
    `npx skills add c-f-x/${NAME}\n## not a section\n`,
  );
  assert.deepEqual(groundRuleViolations(view(fenced), "."), []);
});

test("the optional sections may be left out or added, in their place", () => {
  const lean = (CLEAN["README.md"] ?? "").replace(/## How it works\n\n[^\n]*\n\n/, "");
  const credits = lean.replace(
    "## Support",
    "## Credits\n\nThe projects this stands on.\n\n## Support",
  );
  assert.deepEqual(groundRuleViolations(view(withFile("README.md", credits)), "."), []);
});

test("a tool with no screen shows real terminal output instead of a picture", () => {
  const terminal = edited(
    "README.md",
    PICTURE,
    `\`\`\`console\n$ ${NAME} status\nall parts ok\n\`\`\`\n\n`,
  );
  const files = Object.fromEntries(
    Object.entries(terminal).filter(([p]) => !p.startsWith("docs/images/")),
  );
  assert.deepEqual(groundRuleViolations(view(files), "."), []);
});

// A monorepo tool keeps its Worker in apps/worker/: its config and secrets list sit there.
const WORKER = "apps/worker";
const MONOREPO = Object.fromEntries(
  Object.entries(CLEAN).map(([p, text]) => [
    p === "wrangler.jsonc" || p === ".dev.vars.example" ? `${WORKER}/${p}` : p,
    text,
  ]),
);

test("the ground rules read the Worker's config and secrets list in its folder", () => {
  assert.deepEqual(groundRuleViolations(view(MONOREPO), WORKER), []);
  const { [`${WORKER}/.dev.vars.example`]: _example, ...noExample } = MONOREPO;
  assert.deepEqual(groundRuleViolations(view(noExample), WORKER), [
    "apps/worker/.dev.vars.example is missing: it names the Worker's secrets, exactly those in apps/worker/wrangler.jsonc's secrets.required",
  ]);
  const wrangler = (MONOREPO[`${WORKER}/wrangler.jsonc`] ?? "").replace(
    '"AUTH_SECRET",',
    '"AUTH_SECRET", "SESSION_KEY",',
  );
  assert.deepEqual(
    groundRuleViolations(view({ ...MONOREPO, [`${WORKER}/wrangler.jsonc`]: wrangler }), WORKER),
    [
      "AGENTS.md: ### Secrets must pipe SESSION_KEY into `wrangler secret put SESSION_KEY`, so its value never shows on screen",
    ],
  );
});
