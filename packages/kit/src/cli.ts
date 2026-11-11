#!/usr/bin/env node
import { CHECKS, type Check } from "./checks/index.ts";
import { LOCK_FILE, lockMigrations } from "./checks/migrations.ts";

// The `c-f-x` command. `main` decides; the lines at the bottom do the I/O.

type Io = { out: (line: string) => void; err: (line: string) => void };

function usage(checks: readonly Check[]): string[] {
  const width = Math.max(...checks.map((c) => c.name.length));
  return [
    "usage: c-f-x check <name> [args]",
    `       c-f-x lock-migrations      adds new schema steps to ${LOCK_FILE}`,
    "",
    "checks:",
    ...checks.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
  ];
}

/** Runs the command line `argv` in `root`. Resolves to the exit code: 0 passed, 1 failed, 2 misused. */
async function main(
  argv: string[],
  root: string,
  io: Io,
  checks: readonly Check[] = CHECKS,
): Promise<number> {
  const [command, name, ...args] = argv;
  if (command === "lock-migrations" && name === undefined) {
    const locked = lockMigrations(root);
    if (!locked.ok) {
      for (const problem of locked.problems) io.err(problem);
      return 1;
    }
    io.out(locked.value.length > 0 ? `locked: ${locked.value.join(", ")}` : "no new steps");
    return 0;
  }
  if (command !== "check" || name === undefined) {
    for (const line of usage(checks)) io.err(line);
    return 2;
  }
  const check = checks.find((c) => c.name === name);
  if (check === undefined) {
    io.err(`c-f-x: unknown check "${name}"`);
    for (const line of usage(checks)) io.err(line);
    return 2;
  }
  const problems = await check.run({ root, args });
  if (problems.length === 0) {
    io.out(`check ${name}: passed`);
    return 0;
  }
  for (const problem of problems) io.err(problem);
  io.err(
    `check ${name}: failed with ${problems.length} problem${problems.length === 1 ? "" : "s"}`,
  );
  return 1;
}

process.exitCode = await main(process.argv.slice(2), process.cwd(), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
