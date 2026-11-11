import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Read } from "../read.ts";
import { isRecord, readToolConfig } from "./tool-config.ts";
import type { Check } from "./types.ts";

// `c-f-x check migrations`: a schema step that has been applied never changes.
// A deployment that already ran a step never runs it again, so an edited step
// leaves old databases on the old shape and new ones on the new. Every step's
// hash is locked in `migrations.lock.json` the day it is added, by
// `c-f-x lock-migrations`. Ported from cfanalytics:scripts/lib/migrations.mjs,
// cfanalytics:scripts/migrations.test.mjs and cfanalytics:scripts/migrations-lock.mjs,
// with the step folders read from the tool's c-f-x.json. cfmail seals the same
// hashes keyed by migration name (cfmail:packages/db/drizzle/sealed.json); a
// repository path keys them here, so two folders may hold steps of one name.

export const LOCK_FILE = "migrations.lock.json";
export const LOCK_COMMAND = "c-f-x lock-migrations";
export const MAIN_LINE = "origin/master";

/** Step file (repository path) to the SHA-256 hex of its bytes. */
export type Lock = Record<string, string>;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The `.sql` schema steps in each folder, as repository paths, in the order they apply. */
export function stepFiles(root: string, folders: string[]): string[] {
  return folders.flatMap((folder) => {
    const dir = path.join(root, folder);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .toSorted(byText)
      .map((name) => `${folder}/${name}`);
  });
}

export const hashOf = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

export function currentHashes(root: string, folders: string[]): Lock {
  return Object.fromEntries(
    stepFiles(root, folders).map((f) => [f, hashOf(readFileSync(path.join(root, f)))]),
  );
}

/**
 * Compares the steps on disk with the lock. A locked step that changed or
 * disappeared breaks the rule; so does an unlocked step, and a new step that
 * sorts before a locked step in the same folder.
 */
export function lockViolations(lock: Lock, current: Lock): string[] {
  const found: string[] = [];
  for (const [file, hash] of Object.entries(lock)) {
    if (!(file in current)) found.push(`${file} is locked but missing`);
    else if (current[file] !== hash)
      found.push(`${file} changed after it was locked; add a new step instead`);
  }
  for (const file of Object.keys(current)) {
    if (file in lock) continue;
    found.push(`${file} is not locked; run ${LOCK_COMMAND}`);
    const folder = path.posix.dirname(file);
    const later = Object.keys(lock)
      .filter((f) => path.posix.dirname(f) === folder && f > file)
      .toSorted(byText);
    if (later.length > 0) found.push(`${file} sorts before the locked ${later[0]}`);
  }
  return found;
}

/** Locked entries of the main line that the branch removed or changed. */
export function baseViolations(baseLock: Lock, lock: Lock): string[] {
  return Object.entries(baseLock)
    .filter(([file, hash]) => lock[file] !== hash)
    .map(([file]) => `${file} was locked on the main line and its lock entry changed`);
}

/** The lock with every new step added. A step already locked keeps its entry. */
export function addNewSteps(lock: Lock, current: Lock): { lock: Lock; added: string[] } {
  const added = Object.keys(current).filter((file) => !(file in lock));
  const next: Lock = { ...lock };
  for (const file of added) next[file] = current[file] ?? "";
  return { lock: next, added };
}

const isLock = (value: unknown): value is Lock =>
  isRecord(value) && Object.values(value).every((v) => typeof v === "string");

/** A lock file's text, as an object of step paths to hex hashes. */
export function parseLock(where: string, text: string): Read<Lock> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`${where}: does not parse: ${String(error)}`] };
  }
  return isLock(value)
    ? { ok: true, value }
    : { ok: false, problems: [`${where}: must map each step's path to its hash`] };
}

export const lockText = (lock: Lock): string => `${JSON.stringify(lock, null, 2)}\n`;

/** The lock on disk. No lock file is an empty lock: nothing is locked yet. */
export function readLock(root: string): Read<Lock> {
  const file = path.join(root, LOCK_FILE);
  if (!existsSync(file)) return { ok: true, value: {} };
  return parseLock(LOCK_FILE, readFileSync(file, "utf8"));
}

const gitOut = (root: string, args: string[]): string | null => {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

/**
 * The lock as it stands where this branch left the main line. A main line from
 * before the lock file existed has nothing locked.
 */
export function readBaseLock(root: string): Read<Lock> {
  const base = gitOut(root, ["merge-base", "HEAD", MAIN_LINE]);
  if (base === null) {
    return {
      ok: false,
      problems: [
        `cannot find where this branch left ${MAIN_LINE}; a CI checkout must fetch it (fetch-depth: 0)`,
      ],
    };
  }
  const shown = gitOut(root, ["show", `${base.trim()}:${LOCK_FILE}`]);
  return shown === null ? { ok: true, value: {} } : parseLock(`${MAIN_LINE}:${LOCK_FILE}`, shown);
}

/**
 * `c-f-x lock-migrations`: adds every new step to the lock and writes it. It
 * never changes an entry that is already locked, so an edited step stays a
 * failing check.
 */
export function lockMigrations(root: string): Read<string[]> {
  const config = readToolConfig(root);
  const lock = readLock(root);
  if (!config.ok || !lock.ok)
    return {
      ok: false,
      problems: [config, lock].flatMap((read) => (read.ok ? [] : read.problems)),
    };
  const next = addNewSteps(lock.value, currentHashes(root, config.value.migrations));
  writeFileSync(path.join(root, LOCK_FILE), lockText(next.lock));
  return { ok: true, value: next.added };
}

export const migrations: Check = {
  name: "migrations",
  summary: `no applied schema step changes: each is locked by its hash in ${LOCK_FILE}`,
  async run({ root }) {
    const config = readToolConfig(root);
    const lock = readLock(root);
    const base = readBaseLock(root);
    if (!config.ok || !lock.ok || !base.ok)
      return [config, lock, base].flatMap((read) => (read.ok ? [] : read.problems));
    return [
      ...lockViolations(lock.value, currentHashes(root, config.value.migrations)),
      ...baseViolations(base.value, lock.value),
    ];
  },
};
