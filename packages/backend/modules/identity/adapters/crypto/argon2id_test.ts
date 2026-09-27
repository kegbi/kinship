import { type RandomSource } from "../../public.ts";
import { Argon2idPasswordHasher } from "./argon2id.ts";
import { assert } from "../../../../testing/assert.ts";

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
