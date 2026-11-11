import { describe, expect, test } from "vitest";
import {
  bearerOf,
  bytesToBase64url,
  hashKey,
  isKeyShape,
  keyMatches,
  publicTokenFrom,
  secretKeyFrom,
} from "../src/worker/index.ts";

// The key helpers (docs/conventions.md, section 8), on the Workers runtime
// that checks the keys.

const bytes = (fill: (index: number) => number, length = 32) =>
  Uint8Array.from({ length }, (_, index) => fill(index));

describe("key helpers", () => {
  test("base64url matches the runtime's own base64, in the URL alphabet, unpadded", () => {
    for (const length of [0, 1, 2, 3, 31, 32, 33]) {
      const sample = bytes((i) => (i * 97 + 251) % 256, length);
      const viaRuntime = btoa(String.fromCharCode(...sample))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      expect(bytesToBase64url(sample)).toBe(viaRuntime);
    }
  });

  test("a secret key is the tool prefix, _sk_, and 43 base64url characters from 32 bytes", () => {
    const key = secretKeyFrom(
      "cfs",
      bytes(() => 255),
    );
    expect(key).toEqual({ ok: true, value: `cfs_sk_${"_".repeat(42)}8` });
    const random = secretKeyFrom("cfs", crypto.getRandomValues(new Uint8Array(32)));
    expect(random.ok && /^cfs_sk_[A-Za-z0-9_-]{43}$/.test(random.value)).toBe(true);
  });

  test("a public token is made the same way, with _pk_", () => {
    expect(
      publicTokenFrom(
        "cfl",
        bytes(() => 0),
      ),
    ).toEqual({
      ok: true,
      value: `cfl_pk_${"A".repeat(43)}`,
    });
  });

  test("a key is refused for the wrong number of bytes or a prefix that is not a tool's", () => {
    expect(
      secretKeyFrom(
        "cfs",
        bytes(() => 1, 31),
      ),
    ).toEqual({
      ok: false,
      problems: ["a key needs 32 random bytes, and got 31"],
    });
    for (const prefix of ["", "CFS", "cfs_", "c f"]) {
      expect(
        publicTokenFrom(
          prefix,
          bytes(() => 1),
        ),
      ).toEqual({
        ok: false,
        problems: [`"${prefix}" is not a tool prefix: use lower-case letters and digits`],
      });
    }
  });

  test("the shape check knows a key of its own prefix and kind only", () => {
    const key = secretKeyFrom(
      "cfs",
      bytes((i) => i),
    );
    if (!key.ok) throw new Error(key.problems.join(", "));
    expect(isKeyShape("cfs", "sk", key.value)).toBe(true);
    expect(isKeyShape("cfs", "pk", key.value)).toBe(false);
    expect(isKeyShape("cfl", "sk", key.value)).toBe(false);
    expect(isKeyShape("cfs", "sk", `${key.value}x`)).toBe(false);
  });

  test("a key hashes to the lower-case SHA-256 hex", async () => {
    // SHA-256 of "abc", from FIPS 180-2, appendix B.1.
    expect(await hashKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("a presented key matches only its own stored hash", async () => {
    const stored = await hashKey("cfs_sk_right");
    expect(await keyMatches("cfs_sk_right", stored)).toBe(true);
    expect(await keyMatches("cfs_sk_wrong", stored)).toBe(false);
    expect(await keyMatches("cfs_sk_right", stored.toUpperCase())).toBe(false);
    expect(await keyMatches("cfs_sk_right", stored.slice(0, 63))).toBe(false);
    expect(await keyMatches("cfs_sk_right", "")).toBe(false);
  });

  test("the bearer credential is read from an Authorization header, the scheme in any case", () => {
    expect(bearerOf("Bearer cfs_sk_abc")).toBe("cfs_sk_abc");
    expect(bearerOf("bearer   cfs_sk_abc")).toBe("cfs_sk_abc");
    expect(bearerOf("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerOf("Bearer")).toBeNull();
    expect(bearerOf("Bearer two words")).toBeNull();
    expect(bearerOf(null)).toBeNull();
  });
});
