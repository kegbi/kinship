/**
 * The E2E gateway's throwaway TLS material, made with WebCrypto alone so the
 * launcher runs the same on Linux, macOS, Windows, and CI containers without
 * PowerShell or OpenSSL.
 *
 * A run writes one self-signed RSA-2048 certificate for `127.0.0.1` and
 * `localhost`, valid for four hours, into its own directory under the
 * ignored `.tls/e2e/` folder, which Docker bind-mounts into the gateway.
 */

const PROJECT_PATTERN = /^kinship-e2e-\d+-\d+$/;
const TLS_DIRECTORY_PATTERN = /^kinship-e2e-\d+-\d+-tls$/;

/** The folder every run's TLS directory lives in, relative to the repo. */
export const E2E_TLS_ROOT = ".tls/e2e";

export interface E2eTlsMaterial {
  readonly certificate: string;
  readonly directory: string;
  readonly privateKey: string;
}

export interface SelfSignedCertificate {
  readonly certificatePem: string;
  readonly privateKeyPem: string;
}

// --- DER encoding -----------------------------------------------------------

type Bytes = Uint8Array<ArrayBuffer>;

function concat(parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function derLength(length: number): Bytes {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function tlv(tag: number, ...content: readonly Bytes[]): Bytes {
  const body = concat(content);
  return concat([Uint8Array.of(tag), derLength(body.length), body]);
}

const sequence = (...items: readonly Bytes[]) => tlv(0x30, ...items);
const set = (...items: readonly Bytes[]) => tlv(0x31, ...items);
const explicit = (tag: number, ...items: readonly Bytes[]) =>
  tlv(0xa0 | tag, ...items);

function oid(dotted: string): Bytes {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first! * 40 + second!];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) {
      chunk.unshift(0x80 | (value & 0x7f));
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(bytes));
}

/** A positive INTEGER from big-endian bytes. */
function integer(bytes: Bytes): Bytes {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const trimmed = bytes.subarray(start);
  return tlv(
    0x02,
    trimmed[0]! & 0x80 ? concat([Uint8Array.of(0), trimmed]) : trimmed,
  );
}

function utcTime(date: Date): Bytes {
  const two = (value: number) => String(value).padStart(2, "0");
  const text = `${two(date.getUTCFullYear() % 100)}${
    two(date.getUTCMonth() + 1)
  }${two(date.getUTCDate())}${two(date.getUTCHours())}${
    two(date.getUTCMinutes())
  }${two(date.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(text));
}

function pem(label: string, der: Bytes): string {
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${
    lines.join("\n")
  }\n-----END ${label}-----\n`;
}

// --- Certificate --------------------------------------------------------------

const SHA256_WITH_RSA = sequence(oid("1.2.840.113549.1.1.11"), tlv(0x05));
const COMMON_NAME = "127.0.0.1";

/**
 * A self-signed X.509 v3 certificate for `127.0.0.1` and `localhost`, valid
 * from a minute before `now` for four hours, and its PKCS#8 private key.
 */
export async function selfSignedCertificate(
  now: Date = new Date(),
): Promise<SelfSignedCertificate> {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("spki", keys.publicKey),
  );
  const privateKey = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keys.privateKey),
  );
  const name = sequence(
    set(
      sequence(
        oid("2.5.4.3"),
        tlv(0x0c, new TextEncoder().encode(COMMON_NAME)),
      ),
    ),
  );
  const subjectAltName = sequence(
    oid("2.5.29.17"),
    tlv(
      0x04,
      sequence(
        tlv(0x82, new TextEncoder().encode("localhost")),
        tlv(0x87, Uint8Array.of(127, 0, 0, 1)),
      ),
    ),
  );
  const serial = crypto.getRandomValues(new Uint8Array(16));
  serial[0] = serial[0]! & 0x7f || 1;
  const toBeSigned = sequence(
    explicit(0, integer(Uint8Array.of(2))),
    integer(serial),
    SHA256_WITH_RSA,
    name,
    sequence(
      utcTime(new Date(now.getTime() - 60_000)),
      utcTime(new Date(now.getTime() + 4 * 60 * 60_000)),
    ),
    name,
    publicKey,
    explicit(3, sequence(subjectAltName)),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      toBeSigned,
    ),
  );
  const certificate = sequence(
    toBeSigned,
    SHA256_WITH_RSA,
    tlv(0x03, Uint8Array.of(0), signature),
  );
  return {
    certificatePem: pem("CERTIFICATE", certificate),
    privateKeyPem: pem("PRIVATE KEY", privateKey),
  };
}

// --- Files --------------------------------------------------------------------

function filePath(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  return Deno.build.os === "windows"
    ? path.replace(/^\/([A-Za-z]:)/, "$1").replaceAll("/", "\\")
    : path;
}

function rootUrl(root: URL | undefined): URL {
  return root ?? new URL(`../${E2E_TLS_ROOT}/`, import.meta.url);
}

/**
 * Writes a run's certificate and key into a new `<project>-tls` directory
 * under `root` (the repository's `.tls/e2e/` by default) and returns their
 * absolute paths. An existing directory is refused, never reused.
 */
export async function createE2eTls(
  project: string,
  root?: URL,
): Promise<E2eTlsMaterial> {
  if (!PROJECT_PATTERN.test(project)) {
    throw new Error("Refusing to create TLS material for an invalid project.");
  }
  const base = rootUrl(root);
  const directoryUrl = new URL(`${project}-tls/`, base);
  await Deno.mkdir(base, { recursive: true });
  try {
    await Deno.mkdir(directoryUrl);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new Error("Unsafe or existing E2E TLS directory.");
    }
    throw error;
  }
  try {
    const material = await selfSignedCertificate();
    const certificate = new URL("gateway.crt", directoryUrl);
    const privateKey = new URL("gateway.key", directoryUrl);
    await Deno.writeTextFile(certificate, material.certificatePem);
    await Deno.writeTextFile(privateKey, material.privateKeyPem);
    if (Deno.build.os !== "windows") {
      // The unprivileged gateway must read both throwaway files. Creation
      // modes are filtered by umask, so set permissions after writing them.
      // The key lives four hours in an ignored, run-scoped directory.
      await Deno.chmod(certificate, 0o644);
      await Deno.chmod(privateKey, 0o644);
    }
    return {
      certificate: filePath(certificate),
      directory: filePath(directoryUrl).replace(/[\\/]$/, ""),
      privateKey: filePath(privateKey),
    };
  } catch (error) {
    await Deno.remove(directoryUrl, { recursive: true }).catch(() => {});
    throw error;
  }
}

/**
 * Removes exactly one run's TLS directory, refusing any path that is not a
 * `kinship-e2e-<pid>-<time>-tls` child of `root`.
 */
export async function removeE2eTls(
  material: E2eTlsMaterial,
  root?: URL,
): Promise<void> {
  const base = filePath(rootUrl(root)).replace(/[\\/]$/, "");
  const directory = material.directory.replace(/[\\/]$/, "");
  const separator = Math.max(
    directory.lastIndexOf("/"),
    directory.lastIndexOf("\\"),
  );
  const parent = directory.slice(0, separator);
  const name = directory.slice(separator + 1);
  if (parent !== base || !TLS_DIRECTORY_PATTERN.test(name)) {
    throw new Error("Refusing unsafe E2E TLS cleanup.");
  }
  try {
    await Deno.remove(directory, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
