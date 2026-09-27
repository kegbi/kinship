import { AesGcmDavSecretBox } from "./dav_secret_box.ts";
import { decodeDavEncryptionKeyset } from "./dav_secret_box.ts";
import { assert } from "../../../../testing/assert.ts";

Deno.test("DAV credentials use authenticated encryption and reject another key", async () => {
  const box = new AesGcmDavSecretBox({
    activeKeyId: "v1",
    keys: new Map([["v1", new Uint8Array(32).fill(7)]]),
  });
  const encrypted = await box.seal("remote-secret");
  assert(!encrypted.includes("remote-secret"), "plaintext must not be stored");
  assert(await box.open(encrypted) === "remote-secret", "secret must decrypt");
  const other = new AesGcmDavSecretBox({
    activeKeyId: "v1",
    keys: new Map([["v1", new Uint8Array(32).fill(8)]]),
  });
  try {
    await other.open(encrypted);
    throw new Error("expected key rejection");
  } catch (error) {
    assert(error instanceof Error, "expected decryption error");
  }
});

Deno.test("DAV encryption key configuration rejects malformed or incomplete material", async () => {
  const encoded = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const decoded = decodeDavEncryptionKeyset(JSON.stringify({
    activeKeyId: "primary",
    keys: { primary: encoded },
  }));
  assert(decoded.keys.get("primary")?.length === 32, "valid keyset decoded");
  for (
    const value of [
      "not-json",
      "{}",
      JSON.stringify({
        activeKeyId: "missing",
        keys: { primary: encoded },
      }),
      JSON.stringify({ activeKeyId: "primary", keys: { primary: "short" } }),
    ]
  ) {
    try {
      decodeDavEncryptionKeyset(value);
      throw new Error("expected invalid keyset");
    } catch (error) {
      assert(error instanceof Error, "invalid keyset rejected");
    }
  }
  const box = new AesGcmDavSecretBox(decoded);
  try {
    await box.open("malformed");
    throw new Error("expected malformed cipher rejection");
  } catch (error) {
    assert(error instanceof Error, "malformed cipher rejected");
  }
});
