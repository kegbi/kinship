import { type RandomSource } from "../../public.ts";
import { AesGcmMfaSecretBox, decodeMfaEncryptionKeyset } from "./totp.ts";
import { assert, assertThrows } from "../../../../testing/assert.ts";

const deterministicRandom: RandomSource = {
  bytes(length) {
    return Uint8Array.from({ length }, (_, index) => index + 1);
  },
};

function encodedKey(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

Deno.test("MFA encryption keysets issue actively and retain bounded old-key decryption", async () => {
  const firstUserId = "00000000-0000-4000-8000-000000000001";
  const secondUserId = "00000000-0000-4000-8000-000000000002";
  const previous = decodeMfaEncryptionKeyset(JSON.stringify({
    activeKeyId: "previous",
    keys: { previous: encodedKey(1) },
  }));
  const oldBox = new AesGcmMfaSecretBox(previous, deterministicRandom);
  const oldCiphertext = await oldBox.encrypt(
    "JBSWY3DPEHPK3PXP",
    firstUserId,
  );
  assert(
    oldCiphertext.startsWith("v1.previous."),
    "ciphertext identifies the issuing key without exposing key material",
  );

  const rotated = decodeMfaEncryptionKeyset(JSON.stringify({
    activeKeyId: "current",
    keys: {
      current: encodedKey(2),
      previous: encodedKey(1),
    },
  }));
  const rotatedBox = new AesGcmMfaSecretBox(rotated, deterministicRandom);
  assert(
    await rotatedBox.decrypt(oldCiphertext, firstUserId) ===
      "JBSWY3DPEHPK3PXP",
    "retained previous key decrypts pre-rotation MFA material",
  );
  assert(
    (await rotatedBox.encrypt("JBSWY3DPEHPK3PXP", firstUserId)).startsWith(
      "v1.current.",
    ),
    "new MFA material uses only the active key",
  );
  assert(
    await rotatedBox.decrypt(oldCiphertext, secondUserId) === undefined,
    "ciphertext transplanted to another user must fail authentication",
  );

  for (
    const invalid of [
      "not-json",
      JSON.stringify({
        activeKeyId: "missing",
        keys: { current: encodedKey(2) },
      }),
      JSON.stringify({ activeKeyId: "current", keys: { current: "short" } }),
    ]
  ) {
    assertThrows(() => {
      decodeMfaEncryptionKeyset(invalid);
    }, "malformed MFA keysets fail closed");
  }
});
