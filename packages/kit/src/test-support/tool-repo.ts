import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Test support: the files a tool repository keeps under the ground rules
// (docs/conventions.md, section 16), for the samples the checks' tests build.
// The files a new tool copies come from the kit's own templates/tool/, so the
// clean sample passing is the proof that the templates pass. Not part of the build.

/** The folder a new tool copies its first files from. */
export const TEMPLATES = path.resolve(import.meta.dirname, "../../../../templates/tool");

/** The tool name the templates use, which a new tool replaces with its own. */
export const TEMPLATE_NAME = "cfx-example";

/** The files under templates/tool/, as repository paths, with `cfx-example` replaced by `name`. */
export function templateFiles(name: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(TEMPLATES, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const repoPath = path.relative(TEMPLATES, full).split(path.sep).join("/");
    files[repoPath.replaceAll(TEMPLATE_NAME, name)] = readFileSync(full, "utf8").replaceAll(
      TEMPLATE_NAME,
      name,
    );
  }
  return files;
}

/** Every file the ground rules ask of a tool named `name`, each holding what the rules read. */
export function groundFiles(name: string): Record<string, string> {
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

  const WRANGLER = [
    "{",
    `  "name": "${name}",`,
    '  "main": "src/index.ts",',
    '  "secrets": { "required": ["AUTH_SECRET", "CLOUDFLARE_CLIENT_ID", "CLOUDFLARE_CLIENT_SECRET"] },',
    "}",
    "",
  ].join("\n");

  const SITE = [
    "{",
    '  "account_id": "00000000000000000000000000000000",',
    '  "hostnames": { "admin": "tool.example.com" },',
    '  "admin_emails": ["owner@example.com"],',
    '  "alert_addresses": ["owner@example.com"],',
    "}",
    "",
  ].join("\n");

  return {
    ...templateFiles(name),
    "package.json": JSON.stringify({ name }),
    "wrangler.jsonc": WRANGLER,
    "site.example.jsonc": SITE,
    [`docs/images/${name}-light.png`]: "",
    [`docs/images/${name}-dark.png`]: "",
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
    ".gitignore": ".dev.vars\nwrangler.deploy.jsonc\n",
  };
}
