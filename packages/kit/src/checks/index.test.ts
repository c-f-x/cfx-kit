import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CHECKS } from "./index.ts";

// The README and the agent brief each list the kit's checks by hand. This
// holds both lists to the code's, so a check added or renamed fixes them in
// the same change.

const ROOT = new URL("../../../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

test("README.md and AGENTS.md name every check the command has, and no other", () => {
  const names = CHECKS.map((c) => c.name).toSorted(byText);
  const readme = [...read("README.md").matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1] ?? "");
  assert.deepEqual(readme.toSorted(byText), names);
  const brief = new Set(
    [...read("AGENTS.md").matchAll(/`c-f-x check ([a-z-]+)`/g)].map((m) => m[1] ?? ""),
  );
  assert.deepEqual([...brief].toSorted(byText), names);
});
