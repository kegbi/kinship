import {
  AuthenticationSubjectDigester,
  decodeAuthenticationSubjectKeyset,
} from "../public.ts";
import { assert, assertThrows } from "../../../testing/assert.ts";

function encoded(byte: number): string {
  const binary = String.fromCharCode(...new Uint8Array(32).fill(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

Deno.test("authentication subject digests are versioned, keyed, stable, and opaque", async () => {
  const keyset = decodeAuthenticationSubjectKeyset(JSON.stringify({
    activeVersion: 2,
    keys: { v1: encoded(0x11), v2: encoded(0x22) },
  }));
  const digester = new AuthenticationSubjectDigester(keyset);
  const digests = await digester.digestCandidates(
    "password",
    "Owner@Example.Test",
  );
  assert(digests.length === 2, "rotation retains both digest candidates");
  assert(
    /^hmac-sha256:v2:[0-9a-f]{64}$/.test(digests[0] ?? ""),
    "active version is recorded first",
  );
  assert(
    digests.every((value) =>
      !value.includes("owner") && !value.includes("example")
    ),
    "raw subject never appears in a digest",
  );
  assert(
    JSON.stringify(digests) === JSON.stringify(
      await digester.digestCandidates("password", "owner@example.test"),
    ),
    "password subjects normalize case",
  );
  assert(
    digests[0] !==
      (await digester.digestCandidates("mfa", "owner@example.test"))[0],
    "purpose scopes cannot be correlated by equal digest",
  );
});

Deno.test("authentication subject keysets fail closed", () => {
  for (
    const value of [
      "",
      "{}",
      JSON.stringify({ activeVersion: 0, keys: { v0: encoded(1) } }),
      JSON.stringify({ activeVersion: 1, keys: { v1: "raw-subject" } }),
      JSON.stringify({ activeVersion: 2, keys: { v1: encoded(1) } }),
    ]
  ) {
    assertThrows(() => {
      decodeAuthenticationSubjectKeyset(value);
    }, `invalid keyset ${value} must fail closed`);
  }
});

Deno.test("authentication subject key versions are canonical safe integers", () => {
  const unsafeVersion = Number.MAX_SAFE_INTEGER + 1;
  for (
    const value of [
      JSON.stringify({
        activeVersion: 1e21,
        keys: { v1: encoded(1), v1e21: encoded(2) },
      }),
      JSON.stringify({
        activeVersion: unsafeVersion,
        keys: { [`v${unsafeVersion}`]: encoded(1) },
      }),
      JSON.stringify({
        activeVersion: 1,
        keys: { v1: encoded(1), v01: encoded(2) },
      }),
    ]
  ) {
    assertThrows(() => {
      decodeAuthenticationSubjectKeyset(value);
    }, `non-canonical keyset ${value} must fail closed`);
  }
});
