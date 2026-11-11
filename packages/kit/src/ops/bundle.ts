import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { OpStep } from "./operation.ts";

// A deploy ships only the bundle it checked. The deploy bundles the Worker
// once into one folder after every check passed, uploads into another, and
// a step compares the two. Ported from cfanalytics:scripts/lib/ops.mjs
// (`buildDigest`) and the "same build" step of cfanalytics:scripts/ops.mjs.

/**
 * Files a bundle folder holds that are not uploaded. wrangler's `--outdir`
 * writes a README.md and source maps that hold the folder's own path, so two
 * folders of the same build differ in them.
 */
export function notUploaded(relativePath: string): boolean {
  return path.basename(relativePath) === "README.md" || relativePath.endsWith(".map");
}

/** Every file under `dir` with its SHA-256, by path relative to `dir`, sorted by path. */
export function bundleFiles(
  dir: string,
  skip: (relativePath: string) => boolean = notUploaded,
): Map<string, string> {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .filter((file) => !skip(file))
    .toSorted();
  return new Map(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(path.join(dir, file)))
        .digest("hex"),
    ]),
  );
}

/** How two bundles differ, one line per file. None means they are the same. */
export function bundleDifferences(
  checked: ReadonlyMap<string, string>,
  shipped: ReadonlyMap<string, string>,
): string[] {
  const names = [...new Set([...checked.keys(), ...shipped.keys()])].toSorted();
  return names.flatMap((name) => {
    const a = checked.get(name);
    const b = shipped.get(name);
    if (a === undefined) return [`only in the shipped bundle: ${name}`];
    if (b === undefined) return [`only in the checked bundle: ${name}`];
    return a === b ? [] : [`changed: ${name}`];
  });
}

/**
 * The step that fails unless the bundle in `shippedDir` is byte for byte the
 * one in `checkedDir`. It comes right after the deploy step.
 */
export function sameBundleStep(checkedDir: string, shippedDir: string): OpStep {
  return {
    name: "the shipped bundle is the checked one",
    does: `compare ${checkedDir} with ${shippedDir}`,
    undo: "Nothing to undo: it compares two local folders. If it fails, undo the deploy step.",
    task: async () => {
      const differences = bundleDifferences(bundleFiles(checkedDir), bundleFiles(shippedDir));
      return differences.length === 0
        ? { ok: true }
        : {
            ok: false,
            reason: `the shipped bundle differs from the checked one: ${differences.join("; ")}`,
          };
    },
  };
}
