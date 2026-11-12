import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readmeStructureViolations, sectionsInOrder } from "./readme.ts";

// The README's shape (docs/conventions.md, section 16, rule 3). The tool
// rules run in ground-rules.test.ts on a sample built from the templates.
// The kit is not a tool, so here only the shape runs, on the kit's own README.

const KIT = path.resolve(import.meta.dirname, "../../../..");

test("the kit's own README follows the family's order", () => {
  const text = readFileSync(path.join(KIT, "README.md"), "utf8");
  assert.deepEqual(
    readmeStructureViolations(text, "cfx-kit", (p) => existsSync(path.join(KIT, p))),
    [],
  );
});

test("the sections follow the order, with the optional ones left out or in their place", () => {
  const required = [
    "What it does",
    "What it does not do",
    "Install",
    "Use",
    "Work on it",
    "Support",
    "License",
  ];
  assert.equal(sectionsInOrder(required), true);
  assert.equal(sectionsInOrder(required.toSpliced(4, 0, "How it works")), true);
  assert.equal(sectionsInOrder(required.toSpliced(5, 0, "Credits")), true);
  // Not allowed: a section twice, an optional one out of its place, one missing, one of its own.
  assert.equal(sectionsInOrder(required.toSpliced(1, 0, "What it does")), false);
  assert.equal(sectionsInOrder(required.toSpliced(1, 0, "Credits")), false);
  assert.equal(sectionsInOrder(required.slice(0, -1)), false);
  assert.equal(sectionsInOrder([...required, "FAQ"]), false);
});
