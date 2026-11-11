import { readFileSync, writeFileSync } from "node:fs";
import { nameList, researchNamesModule } from "../packages/kit/src/checks/names.ts";

// Writes packages/kit/src/checks/research-names.ts from research-only names,
// one per line on stdin, so the names never land in this repository:
//
//   node scripts/hash-names.mjs /usr/share/dict/words < names.txt
//
// It replaces the whole list, so give it every name each time.
// The word list (one word per line) marks a one-word name that is also a
// dictionary word, which `c-f-x check names` then finds only where prose
// writes it as a name. docs/conventions.md, section 14, says where the names
// come from.

const [dictionaryFile] = process.argv.slice(2);
if (dictionaryFile === undefined) {
  console.error("usage: node scripts/hash-names.mjs <word list> < names.txt");
  process.exit(2);
}
const words = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w !== "");
const dictionary = new Set(words(dictionaryFile));
const OUT = new URL("../packages/kit/src/checks/research-names.ts", import.meta.url);
const list = nameList(words(0), dictionary);
writeFileSync(OUT, researchNamesModule(list));
console.log(
  `research-names.ts: ${list.length} names, ${list.filter((e) => e.word).length} of them words`,
);
