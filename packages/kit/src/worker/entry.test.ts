import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { importsOf } from "../checks/source.ts";

// `@c-f-x/kit/worker` is what a tool's Worker bundles, so nothing it reaches
// may import a `node:` module or the machine-side half of the kit. The Worker
// tests cannot hold this: the Workers test pool needs nodejs_compat, which
// would let a `node:` import through.

const SRC = path.resolve(import.meta.dirname, "..");
const ENTRY = "worker/index.ts";
// What the Worker entry may reach besides its own folder.
const SHARED = new Set(["read.ts"]);

/** What the modules reached from `entry` import that a Worker must not: as "<file> imports <spec>". */
function workerEntryViolations(entry: string, read: (file: string) => string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { spec, typeOnly } of importsOf(read(file))) {
      if (!spec.startsWith(".")) {
        if (!typeOnly) found.push(`${file} imports ${spec}`);
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (!target.startsWith("worker/") && !SHARED.has(target))
        found.push(`${file} imports ${spec}`);
      else visit(target);
    }
  };
  visit(entry);
  return found;
}

test("the Worker entry reaches no node: module and nothing outside src/worker but read.ts", () => {
  assert.deepEqual(
    workerEntryViolations(ENTRY, (file) => readFileSync(path.join(SRC, file), "utf8")),
    [],
  );
});

test("the entry check flags a node: module, a package and the machine side, through any depth", () => {
  const sample: Record<string, string> = {
    "worker/index.ts": 'export { a } from "./a.ts";\nexport { job } from "./job.ts";',
    "worker/a.ts":
      'import { readFileSync } from "node:fs";\nimport type { Read } from "../read.ts";',
    "worker/job.ts": 'import { z } from "zod";\nimport { trashPath } from "../run-scope.ts";',
    "read.ts": "export type Read = 1;",
  };
  assert.deepEqual(
    workerEntryViolations("worker/index.ts", (file) => sample[file] ?? ""),
    [
      "worker/a.ts imports node:fs",
      "worker/job.ts imports zod",
      "worker/job.ts imports ../run-scope.ts",
    ],
  );
});
