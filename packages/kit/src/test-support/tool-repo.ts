// Test support: the files a tool repository keeps under the ground rules
// (docs/conventions.md, section 16), for the samples the checks' tests build.
// Not part of the build.

/** Every file the ground rules ask of a tool named `name`, each holding what the rules read. */
export function groundFiles(name: string): Record<string, string> {
  const README = [
    `# ${name}`,
    "",
    `${name} is a sample tool that runs on Cloudflare.`,
    "",
    "## Install",
    "",
    `[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/c-f-x/${name})`,
    "",
    "```",
    `pnpm ops ${name} install`,
    "```",
    "",
    "```",
    `npx skills add c-f-x/${name}`,
    "```",
    "",
    "## Support",
    "",
    '[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/jahala)',
    "",
  ].join("\n");

  const SKILL = [
    "---",
    `name: ${name}`,
    "description: Use when a product needs a sample.",
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n");

  const CI = [
    "jobs:",
    "  check:",
    "    # On a self-hosted runner, the temp folder is the job's own.",
    `    runs-on: \${{ fromJSON(vars.CI_RUNS_ON || '["self-hosted", "macOS", "${name}"]') }}`,
    "    steps:",
    "      - run: petals check docs/index.html",
    "  weeder:",
    "    steps:",
    "      - run: weeder check --base origin/master --strict",
    "",
  ].join("\n");

  return {
    "package.json": JSON.stringify({ name }),
    "README.md": README,
    [`skills/${name}/SKILL.md`]: SKILL,
    LICENSE: "MIT License\n\nCopyright (c) 2026 The Owner\n",
    "SECURITY.md": "# Security\n\nReport a vulnerability to security@c-f-x.com.\n",
    ".github/dependabot.yml":
      "version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n  - package-ecosystem: npm\n    directory: /\n",
    ".github/FUNDING.yml": "buy_me_a_coffee: jahala\n",
    ".github/workflows/ci.yml": CI,
    "docs/decisions.md": "# Decisions\n",
    [`docs/tend/${name}.tend.html`]: "<!doctype html>\n",
    "docs/index.html": "<!doctype html>\n",
    "docs/.nojekyll": "",
    ".petalsrc": `brand:\n  product: ${name}\n`,
  };
}
