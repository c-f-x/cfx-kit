import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Test support: runs the command the way a user does, from its source, and
// writes sample repositories. Not part of the build.

const CLI = new URL("../cli.ts", import.meta.url).pathname;

export type CliResult = { code: number | null; stdout: string; stderr: string };

/**
 * Runs `c-f-x <args>` in `cwd` and resolves when it exits. `tmp` becomes the
 * command's temp folder, so its own run scope stays inside the test's.
 */
export function runCli(
  args: string[],
  cwd: string,
  tmp: string,
  env: Record<string, string> = {},
): Promise<CliResult> {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, TMPDIR: tmp, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve) => {
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Writes `files` (repository path to text) under `root`. */
export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
}
