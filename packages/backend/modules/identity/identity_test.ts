import { type RandomSource } from "./public.ts";
import {
  AesGcmMfaSecretBox,
  decodeMfaEncryptionKeyset,
} from "./adapters/crypto/totp.ts";
import { Argon2idPasswordHasher } from "./adapters/crypto/argon2id.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const deterministicRandom: RandomSource = {
  bytes(length) {
    return Uint8Array.from({ length }, (_, index) => index + 1);
  },
};

Deno.test("registration password hashes use the versioned Argon2id format and verify", async () => {
  const hasher = new Argon2idPasswordHasher(deterministicRandom, {
    memoryKiB: 19_456,
    iterations: 2,
    parallelism: 1,
    saltLength: 16,
    hashLength: 32,
  });

  const encoded = await hasher.hash("correct horse battery staple");

  assert(
    encoded.startsWith("$kinship$argon2id$v=1$"),
    "hash must carry an owned format version",
  );
  assert(
    !encoded.includes("correct horse"),
    "hash must not contain password material",
  );
  assert(
    await hasher.verify("correct horse battery staple", encoded),
    "valid password must verify",
  );
  assert(
    !(await hasher.verify("wrong password", encoded)),
    "invalid password must fail",
  );
  assert(
    !(await hasher.verify("correct horse battery staple", "$2y$legacy")),
    "legacy hashes must never activate",
  );
  assert(
    !hasher.needsUpgrade(encoded),
    "current parameters must not need upgrade",
  );
});

Deno.test("malformed and weaker hashes are rejected or marked for upgrade", async () => {
  const hasher = new Argon2idPasswordHasher(deterministicRandom, {
    memoryKiB: 19_456,
    iterations: 2,
    parallelism: 1,
    saltLength: 16,
    hashLength: 32,
  });
  const current = await hasher.hash("a sufficiently long password");
  const weaker = current.replace("m=19456,t=2,p=1", "m=8192,t=1,p=1");

  assert(hasher.needsUpgrade(weaker), "weaker parameters must request upgrade");
  assert(
    !(await hasher.verify("a sufficiently long password", weaker)),
    "tampered parameters must not verify",
  );
  assert(
    !(await hasher.verify(
      "a sufficiently long password",
      "not-an-encoded-hash",
    )),
    "malformed hashes must fail closed",
  );
});

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
    let rejected = false;
    try {
      decodeMfaEncryptionKeyset(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, "malformed MFA keysets fail closed");
  }
});
