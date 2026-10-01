import {
  createE2eTls,
  E2E_TLS_ROOT,
  removeE2eTls,
  selfSignedCertificate,
} from "./e2e_tls.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function derBytes(pem: string, label: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
}

/** One DER element: its tag, content bounds, and where the next one starts. */
function element(bytes: Uint8Array<ArrayBuffer>, offset: number) {
  const tag = bytes[offset]!;
  let length = bytes[offset + 1]!;
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = length * 256 + bytes[start + index]!;
    }
    start += count;
  }
  return {
    tag,
    start,
    end: start + length,
    whole: bytes.subarray(offset, start + length),
  };
}

function contains(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (
    let index = 0;
    index + needle.length <= haystack.length;
    index += 1
  ) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

Deno.test("the E2E certificate is a self-signed X.509 v3 for 127.0.0.1 and localhost", async () => {
  const material = await selfSignedCertificate(
    new Date("2026-10-01T12:00:00Z"),
  );
  const certificate = derBytes(material.certificatePem, "CERTIFICATE");
  const outer = element(certificate, 0);
  assert(
    outer.tag === 0x30 && outer.end === certificate.length,
    "one SEQUENCE",
  );
  const toBeSigned = element(certificate, outer.start);
  const algorithm = element(certificate, toBeSigned.end);
  const signature = element(certificate, algorithm.end);
  assert(toBeSigned.tag === 0x30, "the signed part is a SEQUENCE");
  assert(signature.tag === 0x03, "the signature is a BIT STRING");
  assert(signature.end === outer.end, "nothing follows the signature");

  const signed = toBeSigned.whole;
  // Version 3, the SAN extension with both names, and the validity window.
  assert(contains(signed, [0xa0, 0x03, 0x02, 0x01, 0x02]), "version 3");
  assert(contains(signed, [0x06, 0x03, 0x55, 0x1d, 0x11]), "subjectAltName");
  assert(
    contains(signed, [0x82, 9, ...new TextEncoder().encode("localhost")]),
    "the localhost DNS name",
  );
  assert(contains(signed, [0x87, 4, 127, 0, 0, 1]), "the 127.0.0.1 address");
  assert(
    contains(signed, [...new TextEncoder().encode("261001115900Z")]) &&
      contains(signed, [...new TextEncoder().encode("261001160000Z")]),
    "valid from a minute before for four hours",
  );

  // The private key it ships with signed it.
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    derBytes(material.privateKeyPem, "PRIVATE KEY"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );
  const {
    d: _d,
    p: _p,
    q: _q,
    dp: _dp,
    dq: _dq,
    qi: _qi,
    key_ops: _ops,
    ...jwk
  } = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"],
  );
  assert(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      certificate.subarray(signature.start + 1, signature.end),
      signed,
    ),
    "the signature verifies against the shipped key",
  );
});

Deno.test("a run's TLS directory is created once, under .tls/e2e, and removed exactly", async () => {
  const project = `kinship-e2e-${Deno.pid}-${Date.now()}`;
  const material = await createE2eTls(project);
  try {
    assert(
      material.directory.replaceAll("\\", "/").endsWith(
        `/${E2E_TLS_ROOT}/${project}-tls`,
      ),
      `the directory is run-scoped under ${E2E_TLS_ROOT}`,
    );
    assert(
      (await Deno.readTextFile(material.certificate)).startsWith(
        "-----BEGIN CERTIFICATE-----",
      ),
      "the certificate is PEM",
    );
    assert(
      (await Deno.readTextFile(material.privateKey)).startsWith(
        "-----BEGIN PRIVATE KEY-----",
      ),
      "the key is PKCS#8 PEM",
    );
    let refused = false;
    await createE2eTls(project).catch(() => (refused = true));
    assert(refused, "an existing directory is never reused");
    let unsafe = false;
    await removeE2eTls({ ...material, directory: `${material.directory}/..` })
      .catch(() => (unsafe = true));
    assert(unsafe, "a path outside the run directory is refused");
  } finally {
    await removeE2eTls(material);
  }
  let gone = false;
  await Deno.stat(material.directory).catch(() => (gone = true));
  assert(gone, "cleanup removes the directory");
  await removeE2eTls(material);
});

Deno.test("TLS material refuses a project name that is not a run's", async () => {
  let refused = false;
  await createE2eTls("../escape").catch(() => (refused = true));
  assert(refused, "an invalid project is refused");
});
