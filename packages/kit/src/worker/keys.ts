import type { Read } from "../read.ts";

// Machine keys and public tokens (docs/conventions.md, section 8). Pure: the
// random bytes come from the caller, so a test can name them. Ported from
// cfanalytics:apps/worker/src/features/projects/core.ts (tokenFrom,
// secretKeyFrom, bearerOf), `hashKey` in
// cfanalytics:apps/worker/src/features/projects/store.ts,
// cfanalytics:packages/shared/src/base64url.ts, and cfmail's `randomToken`
// (cfmail:apps/worker/src/lib/encoding.ts) and `sha256Hex`
// (cfmail:apps/worker/src/api/svc.ts). What changed: the tool prefix is a
// parameter, and `keyMatches` compares a presented key with a stored hash in
// constant time, for a tool that reads the hash before it compares.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** `bytes` as base64url text (RFC 4648, section 5), with no padding. */
export function bytesToBase64url(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const group = (first << 16) | (second << 8) | third;
    const left = bytes.length - index;
    text += ALPHABET[(group >> 18) & 63] ?? "";
    text += ALPHABET[(group >> 12) & 63] ?? "";
    if (left > 1) text += ALPHABET[(group >> 6) & 63] ?? "";
    if (left > 2) text += ALPHABET[group & 63] ?? "";
  }
  return text;
}

/** How many random bytes a key carries: 256 bits, 43 base64url characters. */
export const KEY_BYTES = 32;

/** A secret key (`sk`), which the server stores only as a hash, or a public token (`pk`). */
export type KeyKind = "sk" | "pk";

const TOOL_PREFIX = /^[a-z][a-z0-9]*$/;

function keyFrom(prefix: string, kind: KeyKind, bytes: Uint8Array): Read<string> {
  if (!TOOL_PREFIX.test(prefix))
    return {
      ok: false,
      problems: [`"${prefix}" is not a tool prefix: use lower-case letters and digits`],
    };
  if (bytes.length !== KEY_BYTES)
    return {
      ok: false,
      problems: [`a key needs ${KEY_BYTES} random bytes, and got ${bytes.length}`],
    };
  return { ok: true, value: `${prefix}_${kind}_${bytesToBase64url(bytes)}` };
}

/**
 * A secret key: the tool prefix, `_sk_`, and 43 base64url characters from 32
 * random bytes, for example `cfs_sk_...`. Pass `crypto.getRandomValues(new Uint8Array(32))`.
 */
export function secretKeyFrom(prefix: string, bytes: Uint8Array): Read<string> {
  return keyFrom(prefix, "sk", bytes);
}

/** A public token, made like a secret key, with `_pk_`. It is not secret by design. */
export function publicTokenFrom(prefix: string, bytes: Uint8Array): Read<string> {
  return keyFrom(prefix, "pk", bytes);
}

/** Whether `key` has the shape of the tool's key of `kind`. Anything else can be refused before a lookup. */
export function isKeyShape(prefix: string, kind: KeyKind, key: string): boolean {
  const rest = `${prefix}_${kind}_`;
  return key.startsWith(rest) && /^[A-Za-z0-9_-]{43}$/.test(key.slice(rest.length));
}

/** SHA-256 of a key, as 64 lower-case hex characters. The server stores only this. */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether two texts are equal, in time that depends only on their length. A
 * stored hash always has 64 characters, so the length tells a caller nothing.
 */
export function equalInConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** Whether a presented key is the one whose hash is stored, compared in constant time. */
export async function keyMatches(presented: string, storedHash: string): Promise<boolean> {
  return equalInConstantTime(await hashKey(presented), storedHash);
}

/** The Bearer credential of an Authorization header, the scheme read in any case; null otherwise. */
export function bearerOf(authorization: string | null): string | null {
  const match = authorization === null ? null : /^Bearer +(\S+)$/i.exec(authorization);
  return match?.[1] ?? null;
}
