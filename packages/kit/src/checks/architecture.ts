import path from "node:path";
import { readLifetimes } from "./lifetimes.ts";
import {
  importsOf,
  readSources,
  resolveImport,
  type Source,
  sourceFiles,
  withoutComments,
} from "./source.ts";
import {
  type DurableObjectBinding,
  durableObjectBindings,
  emailBindings,
  readToolConfig,
  readWrangler,
} from "./tool-config.ts";
import type { Check } from "./types.ts";

// `c-f-x check architecture`: the code rules no linter knows. Each function
// takes source texts and returns what breaks its rule, so a test can feed it a
// sample. Ported from cfanalytics:scripts/lib/architecture.mjs and
// cfanalytics:scripts/architecture.test.mjs. Where cfanalytics names its own
// folders and files, the folders here come from the tool's c-f-x.json, and a
// pure file is any file under a folder named `core`.

/** Whether a repository path sits under a folder named `core`. */
export const isCore = (file: string): boolean => file.split("/").slice(0, -1).includes("core");

const IO_MODULE = /^(hono(\/|$)|cloudflare:|node:)/;
const IMPURE_CALL =
  /\bDate\.now\(|\bnew Date\(\s*\)|\bMath\.random\(|\bcrypto\.(randomUUID|getRandomValues)\(|\bperformance\.now\(|(^|[^.\w])fetch\(/m;
const THROW = /\bthrow\b/;

/** Files under `core/` do no I/O, read no clock or random source, and never throw. */
export function coreViolations(sources: Source[]): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    if (!isCore(file)) continue;
    for (const { spec, typeOnly } of importsOf(text)) {
      if (IO_MODULE.test(spec)) found.push(`${file} imports ${spec}`);
      else if (spec.startsWith(".") && !typeOnly && !isCore(resolveImport(file, spec)))
        found.push(`${file} imports ${spec}, which is outside core/`);
    }
    const code = withoutComments(text);
    if (IMPURE_CALL.test(code)) found.push(`${file} reads a clock, a random source or the network`);
    if (THROW.test(code)) found.push(`${file} throws`);
  }
  return found;
}

/** The slice a file belongs to under the slices folder `folder`, or null when it is outside. */
export function sliceOf(file: string, folder: string): string | null {
  const parts = path.posix.relative(folder, file).split("/");
  return parts[0] === ".." || parts.length < 2 ? null : (parts[0] ?? null);
}

/** Slices meet only through their `index.ts`. */
export function crossSliceViolations(sources: Source[], sliceFolders: string[]): string[] {
  const found: string[] = [];
  for (const folder of sliceFolders) {
    for (const { file, text } of sources) {
      const from = sliceOf(file, folder);
      if (from === null) continue;
      for (const { spec } of importsOf(text)) {
        if (!spec.startsWith(".")) continue;
        const target = resolveImport(file, spec);
        const to =
          sliceOf(target, folder) ??
          (path.posix.dirname(target) === folder ? path.posix.basename(target) : null);
        if (to === null || to === from) continue;
        const entry = `${folder}/${to}`;
        if (target !== `${entry}/index.ts` && target !== entry)
          found.push(`${file} imports ${spec}`);
      }
    }
  }
  return found;
}

// Module-level mutable state: a top-level let or var, or a top-level
// collection made with a constructor (Map, Set, Array), which requests on one
// isolate would share. Constant lists written as literals are allowed.
const MODULE_STATE =
  /^(export\s+)?(let|var)\s|^(export\s+)?const\s+\w+(\s*:[^=]+)?\s*=\s*new\s+(Map|Set|WeakMap|WeakSet|Array)\b/m;

export function moduleStateViolations(sources: Source[]): string[] {
  return sources
    .filter(({ text }) => MODULE_STATE.test(withoutComments(text)))
    .map(({ file }) => `${file} keeps module-level mutable state`);
}

const escapeRegExp = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const MAIL_MODULE = "mail.ts";
const MAIL_SERVICE = "/api/svc/send";
/** The kit's Worker entry, which holds `job` and `notify`. */
export const KIT_WORKER = "@c-f-x/kit/worker";
const IMPORTS_NOTIFY = new RegExp(
  `(?:^|\\n)\\s*import\\s*\\{[^;}]*\\bnotify\\b[^;}]*\\}\\s*from\\s*["']${escapeRegExp(KIT_WORKER)}["']`,
);

/**
 * Only one module, named `mail.ts`, sends mail: through cfmail's send API, a
 * `send_email` binding, the runtime's email module, or the kit's `notify`.
 */
export function mailViolations(sources: Source[], bindings: string[]): string[] {
  const found: string[] = [];
  const mailModules = sources.filter(({ file }) => path.posix.basename(file) === MAIL_MODULE);
  if (mailModules.length > 1) {
    found.push(
      `a tool has one ${MAIL_MODULE}, and this one has ${mailModules.length}: ${mailModules.map((s) => s.file).join(", ")}`,
    );
  }
  const sends = bindings.map((name) => ({
    name,
    call: new RegExp(`\\b${escapeRegExp(name)}\\s*\\.\\s*send\\s*\\(`),
  }));
  for (const { file, text } of sources) {
    if (path.posix.basename(file) === MAIL_MODULE) continue;
    const code = withoutComments(text);
    if (importsOf(text).some(({ spec }) => spec === "cloudflare:email"))
      found.push(`${file} imports cloudflare:email; only ${MAIL_MODULE} sends mail`);
    if (code.includes(MAIL_SERVICE))
      found.push(`${file} calls cfmail; only ${MAIL_MODULE} sends mail`);
    if (IMPORTS_NOTIFY.test(code))
      found.push(`${file} imports notify from ${KIT_WORKER}; only ${MAIL_MODULE} sends mail`);
    for (const { name, call } of sends) {
      if (call.test(code))
        found.push(
          `${file} sends through the email binding ${name}; only ${MAIL_MODULE} sends mail`,
        );
    }
  }
  return found;
}

// Scheduled work runs only through the kit's `job` (docs/conventions.md,
// section 6). New in the kit. The check reads the body of each `scheduled`
// handler and each Durable Object `alarm()`, cuts out every `job(...)` call,
// and flags any call left over: that work would run without its outcome
// being logged. Promise.all, Promise.allSettled, waitUntil and map may
// gather jobs; the calls inside them are read too.

/** The code with the text of plain string literals blanked, so a string is never read as a call. */
const withoutStrings = (code: string): string =>
  code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');

const OPENS = "([{";
const CLOSES = ")]}";

/** The index just past the bracket that closes the one at `open`, or the end of the code. */
function pastClosing(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    const char = code.charAt(index);
    if (OPENS.includes(char)) depth += 1;
    else if (CLOSES.includes(char)) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return code.length;
}

/** The end of an arrow function's expression body that starts at `start`. */
function expressionEnd(code: string, start: number): number {
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    const char = code.charAt(index);
    if (OPENS.includes(char)) depth += 1;
    else if (CLOSES.includes(char)) {
      if (depth === 0) return index;
      depth -= 1;
    } else if (depth === 0 && (char === "," || char === ";")) return index;
  }
  return code.length;
}

// After a parameter list: an optional return type, then `{` or `=>`.
const AFTER_PARAMS = /^\s*(?::\s*[^{=;]+?(?=\s*(?:\{|=>)))?\s*(=>)?\s*/;

/**
 * The bodies of the functions named `name` that `code` defines: a method,
 * a function, or a property or variable holding one. A call or a signature
 * without a body is not a definition.
 */
function bodiesOf(code: string, name: string): string[] {
  const definition = new RegExp(
    `(?<![.\\w$])(?:function\\s+)?${name}\\s*(?:[:=]\\s*(?:async\\s*)?(?:function\\s*)?)?(?=\\()`,
    "g",
  );
  const bodies: string[] = [];
  for (const m of code.matchAll(definition)) {
    const paramsEnd = pastClosing(code, m.index + m[0].length);
    const after = AFTER_PARAMS.exec(code.slice(paramsEnd));
    const start = paramsEnd + (after?.[0].length ?? 0);
    if (code.charAt(start) === "{")
      bodies.push(code.slice(start + 1, pastClosing(code, start) - 1));
    else if (after?.[1] !== undefined) bodies.push(code.slice(start, expressionEnd(code, start)));
  }
  return bodies;
}

/** The body without its `job(...)` calls. */
function withoutJobs(body: string): string {
  const call = /(?<![.\w$])job\s*\(/g;
  let rest = body;
  for (let m = call.exec(rest); m !== null; m = call.exec(rest)) {
    const open = m.index + m[0].length - 1;
    rest = rest.slice(0, m.index) + rest.slice(pastClosing(rest, open));
    call.lastIndex = m.index;
  }
  return rest;
}

const CALL = /(?<![\w$])((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*)\s*\(/g;
const NOT_CALLS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "await"]);
const GATHERS = /^Promise\.(all|allSettled)$|(^|\.)(waitUntil|map)$/;

/** The calls a handler body makes outside `job`, each once, as written. */
function callsOutsideJob(body: string): string[] {
  const calls = new Set<string>();
  for (const m of withoutJobs(body).matchAll(CALL)) {
    const name = (m[1] ?? "").replace(/\s+/g, "");
    if (!NOT_CALLS.has(name) && !GATHERS.test(name)) calls.add(name);
  }
  return [...calls];
}

// `scheduled: name` or `{ ..., scheduled }`: a handler defined by name.
const NAMED_HANDLER =
  /(?<![.\w$])scheduled\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,}\n]|$)|[{,]\s*(scheduled)\s*(?=[,}])/g;
const LITERALS = new Set(["true", "false", "null", "undefined"]);

/**
 * Work a `scheduled` handler or a Durable Object `alarm()` runs outside the
 * kit's `job`. A handler given by name must be defined in the same file, so
 * the check can read it.
 */
export function scheduledWorkViolations(sources: Source[]): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    const code = withoutStrings(withoutComments(text));
    const handlers: [string, string][] = [
      ...bodiesOf(code, "scheduled").map((body): [string, string] => ["scheduled handler", body]),
      ...bodiesOf(code, "alarm").map((body): [string, string] => ["alarm", body]),
    ];
    for (const m of code.matchAll(NAMED_HANDLER)) {
      const name = m[1] ?? m[2] ?? "";
      if (LITERALS.has(name) || name === "scheduled") {
        if (name === "scheduled" && bodiesOf(code, name).length === 0)
          found.push(
            `${file} names scheduled as its scheduled handler, which it does not define, so the check cannot see that it runs only through job`,
          );
        continue;
      }
      const bodies = bodiesOf(code, escapeRegExp(name));
      if (bodies.length === 0)
        found.push(
          `${file} names ${name} as its scheduled handler, which it does not define, so the check cannot see that it runs only through job`,
        );
      for (const body of bodies) handlers.push(["scheduled handler", body]);
    }
    for (const [label, body] of handlers)
      for (const call of callsOutsideJob(body))
        found.push(`${file} runs ${call}( in its ${label} outside job`);
  }
  return found;
}

const MAKES_ID = /\.\s*(idFromName|idFromString|newUniqueId|getByName)\s*\(/g;
const IN_EU = /\.\s*jurisdiction\(\s*["']eu["']\s*\)\s*$/;
const LAST_NAME = /([A-Za-z_$][\w$]*)\s*$/;

/**
 * Every Durable Object that holds data is addressed in the `eu` jurisdiction:
 * each call that makes an object id is made on `.jurisdiction("eu")`. Wrangler's
 * config cannot set a Durable Object's jurisdiction, so the code must. A
 * namespace whose class keeps nothing (`keepsNothing`, binding names) may be
 * addressed anywhere, for example to run where a location hint asks.
 */
export function durableObjectJurisdictionViolations(
  sources: Source[],
  keepsNothing: string[],
): string[] {
  const found: string[] = [];
  for (const { file, text } of sources) {
    const code = withoutComments(text);
    for (const m of code.matchAll(MAKES_ID)) {
      const before = code.slice(0, m.index);
      if (IN_EU.test(before)) continue;
      const receiver = LAST_NAME.exec(before)?.[1];
      if (receiver !== undefined && keepsNothing.includes(receiver)) continue;
      found.push(`${file} makes a Durable Object id outside the eu jurisdiction (${m[1]})`);
    }
  }
  return found;
}

/** The binding names of the Durable Object classes whose lifetimes row says they hold `nothing`. */
export function bindingsThatKeepNothing(
  bindings: DurableObjectBinding[],
  rows: { store: string; holds: string }[],
): string[] {
  const empty = new Set(
    rows.filter((r) => r.holds.trim().toLowerCase() === "nothing").map((r) => r.store),
  );
  return bindings.filter((b) => empty.has(b.className)).map((b) => b.name);
}

export const architecture: Check = {
  name: "architecture",
  summary:
    "core/ is pure, slices meet through index.ts, no module state, one mail.ts, scheduled work through job, Durable Objects in the eu",
  async run({ root }) {
    const config = readToolConfig(root);
    const wrangler = readWrangler(root);
    if (!config.ok || !wrangler.ok)
      return [config, wrangler].flatMap((read) => (read.ok ? [] : read.problems));
    const files = [...new Set(config.value.sources.flatMap((dir) => sourceFiles(root, dir)))];
    const sources = readSources(root, files);
    // Without a lifetimes table, no class is known to keep nothing, so every
    // Durable Object must be in the eu. The lifetimes check reports the table.
    const table = readLifetimes(root);
    const keepsNothing = bindingsThatKeepNothing(
      durableObjectBindings(wrangler.value),
      table.ok ? table.value.rows : [],
    );
    return [
      ...coreViolations(sources),
      ...crossSliceViolations(sources, config.value.slices),
      ...moduleStateViolations(sources),
      ...mailViolations(sources, emailBindings(wrangler.value)),
      ...scheduledWorkViolations(sources),
      ...durableObjectJurisdictionViolations(sources, keepsNothing),
    ];
  },
};
