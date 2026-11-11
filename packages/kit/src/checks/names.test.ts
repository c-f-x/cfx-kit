import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { openRunScope, type RunScope } from "../run-scope.ts";
import { runCli, writeFiles } from "../test-support/cli.ts";
import { git, initRepo } from "../test-support/git.ts";
import {
  findNames,
  nameHash,
  nameList,
  namesCheck,
  normalName,
  researchNamesModule,
} from "./names.ts";
import { RESEARCH_NAMES } from "./research-names.ts";

let scope: RunScope;

before(() => {
  scope = openRunScope({ installExitHandlers: true });
});

after(async () => {
  const { leftovers } = await scope.close();
  assert.deepEqual(leftovers, []);
});

// Invented names, so this public test spells out no real research name. The
// real list is hashes only (research-names.ts). "Lantern" is a dictionary
// word, so it is found only where it is written as a name.
const LIST = nameList(
  ["Zorblat", "Acme Mail (hosted)", "quux.io", "Lantern"],
  new Set(["lantern"]),
);

const found = (text: string, prose = true) =>
  findNames(text, LIST, prose).map((f) => `${f.line}:${f.written}`);

test("a name is lower-cased, loses its notes in brackets, and keeps its dots and hyphens", () => {
  assert.equal(normalName("Acme  Mail (hosted, eu)"), "acme mail");
  assert.equal(normalName("Quux.io (heartbeats)"), "quux.io");
  assert.equal(normalName("Ghost(Pro)"), "ghost");
  assert.equal(normalName("zip-ZAP"), "zip-zap");
  assert.equal(nameHash("zorblat"), nameHash(normalName("ZORBLAT")));
});

test("the name scan finds a name in any case, across words, and inside a dotted or hyphenated word", () => {
  assert.deepEqual(found("We replace ZORBLAT here."), ["1:ZORBLAT"]);
  assert.deepEqual(found("line one\nlike Acme   Mail does"), ["2:Acme   Mail"]);
  assert.deepEqual(found("see Quux.io, or zorblat-cloud"), ["1:Quux.io", "1:zorblat"]);
  assert.deepEqual(found('import x from "@zorblat/node";'), ["1:zorblat"]);
  assert.deepEqual(found("ZORBLAT_DSN=1"), ["1:ZORBLAT"]);
});

test("the name scan does not join words across a line or punctuation, or match part of a word", () => {
  assert.deepEqual(found("Acme\nMail"), []);
  assert.deepEqual(found("Acme, Mail"), []);
  assert.deepEqual(found("zorblatted, quux, quux io"), []);
});

test("a name that is also a word is found only where it is written as a name, mid-sentence", () => {
  assert.deepEqual(found("unlike Lantern, we"), ["1:Lantern"]);
  assert.deepEqual(found("unlike Lantern."), ["1:Lantern"]);
  // The word itself, a sentence, line or table cell that starts with it, and code.
  assert.deepEqual(found("a lantern on the table"), []);
  assert.deepEqual(found("Lantern light. Lantern again\n| Lantern |"), []);
  assert.deepEqual(found("return Lantern.from(x); new Lantern(); (x: Lantern)"), []);
  assert.deepEqual(found("const LANTERN = 1; use LANTERN_LIGHT"), []);
  // In code, a capitalised word is far more often a type than a name.
  assert.deepEqual(found("interface Tally { by: Lantern }\nnew Map<string, Lantern>()", false), []);
  assert.deepEqual(found("unlike Lantern or Zorblat", false), ["1:Zorblat"]);
});

test("the list holds each name once, flagged as a word from the dictionary, and its module holds hashes only", () => {
  const list = nameList(["Zorblat", "Lantern", "zorblat", "Loops"], new Set(["lantern", "loop"]));
  const words = new Set([nameHash("lantern"), nameHash("loops")]);
  assert.deepEqual(
    list.map((e) => e.word),
    list.map((e) => words.has(e.sha256)),
  );
  assert.equal(list.length, 3);
  const text = researchNamesModule(list);
  assert.doesNotMatch(text, /zorblat|lantern|loops/i);
  const lines = text.split("\n").filter((l) => l.includes("sha256"));
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => l.includes(nameHash("lantern")) && l.includes("word: true")));
  assert.ok(lines.some((l) => l.includes(nameHash("zorblat")) && l.includes("word: false")));
});

test("the real list is hashes only, one entry per name", () => {
  assert.ok(RESEARCH_NAMES.length > 100);
  for (const entry of RESEARCH_NAMES) assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  assert.equal(new Set(RESEARCH_NAMES.map((e) => e.sha256)).size, RESEARCH_NAMES.length);
});

// A sample repository whose tracked files are the ones git was told about.
function sample(
  name: string,
  files: Record<string, string>,
  untracked: Record<string, string> = {},
) {
  const repo = path.join(scope.dir, name);
  writeFiles(repo, files);
  initRepo(repo);
  git(repo, "add", "--", ...Object.keys(files));
  writeFiles(repo, untracked);
  return repo;
}

test("the names check flags each tracked file that names one, and lets a tool name the vendors it integrates", async () => {
  const repo = sample(
    "flagged",
    {
      "README.md": "# cfx-sample\n\nCheaper than Zorblat, and like Acme Mail.\n",
      "src/mail.ts": "// Sends through quux.io, unlike Lantern.\nexport const x = 1;\n",
      "docs/notes.md": "We chose this over Lantern, for its price.\n",
      // A binary file is not text, whatever bytes it happens to hold.
      "assets/logo.png": "\u0000PNG Zorblat",
      "c-f-x.json": JSON.stringify({
        sources: ["src"],
        slices: [],
        migrations: [],
        vendors: ["Quux.io"],
      }),
    },
    { "notes.md": "Zorblat, untracked.\n" },
  );
  const problems = await namesCheck(LIST).run({ root: repo, args: [] });
  assert.deepEqual(problems, [
    'README.md:3: names "Zorblat", which is known only from research (docs/conventions.md, section 14)',
    'README.md:3: names "Acme Mail", which is known only from research (docs/conventions.md, section 14)',
    'docs/notes.md:1: names "Lantern", which is known only from research (docs/conventions.md, section 14)',
  ]);
});

test("the names check refuses a folder that is not a git repository, and a c-f-x.json it cannot read", async () => {
  const plain = path.join(scope.dir, "plain");
  writeFiles(plain, { "README.md": "# plain\n" });
  assert.deepEqual(await namesCheck(LIST).run({ root: plain, args: [] }), [
    "names: not a git repository, so the tracked files are unknown",
  ]);
  const broken = sample("broken-config", { "c-f-x.json": '{ "vendors": "Zorblat" }' });
  const problems = await namesCheck(LIST).run({ root: broken, args: [] });
  assert.ok(problems.includes('c-f-x.json: "vendors" must be a list of names'));
});

test("c-f-x check names passes a sample that names no research name", async () => {
  const repo = sample("clean", { "README.md": "# cfx-sample\n\nRuns on Cloudflare.\n" });
  const { code, stdout, stderr } = await runCli(["check", "names"], repo, scope.dir);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  assert.match(stdout, /check names: passed/);
});
