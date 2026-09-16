/**
 * Pagination primitives.
 *
 * A cursor is opaque to the client: it carries the keyset anchor a listing
 * resumes from, never an offset. Two codecs live here because two needs do.
 *
 * `encodeCursor`/`decodeCursor` are the plain opaque pair, for a listing whose
 * anchor is re-validated against the rows the caller is allowed to see anyway,
 * so forging one buys nothing. `signCursor`/`verifyCursor` add an HMAC for a
 * listing whose filters live inside the cursor, where a forged body would
 * otherwise widen the query. Both were copied per module before the kernel.
 *
 * Decoding never throws: an unreadable cursor is `undefined`, which callers
 * report as a stale cursor rather than as a server fault.
 */

const BASE64_URL = /^[A-Za-z0-9_-]*$/;
const KEY_LABEL = /^v([1-9][0-9]*)$/;
const SIGNATURE_BYTES = 32;

/** Renders bytes as unpadded base64url. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

/**
 * Reads unpadded base64url, or `undefined` when the text is not exactly what
 * `encodeBase64Url` would have produced. The round-trip check refuses the
 * padded and non-canonical spellings that would otherwise give one anchor
 * several cursors.
 */
export function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!BASE64_URL.test(value)) return undefined;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  try {
    const decoded = Uint8Array.from(
      atob(padded),
      (character) => character.charCodeAt(0),
    );
    return encodeBase64Url(decoded) === value ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function encodeBody(body: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(body)));
}

function decodeBody(encoded: string): unknown {
  const bytes = decodeBase64Url(encoded);
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return undefined;
  }
}

/** Encodes an anchor as one opaque, url-safe cursor. */
export function encodeCursor(body: unknown): string {
  return encodeBody(body);
}

/**
 * Reads an opaque cursor back. The caller still checks the decoded shape: this
 * proves the text is a cursor, not that it is the right one.
 */
export function decodeCursor(value: string): unknown {
  return decodeBody(value);
}

/** The signing keys a cursor domain publishes, newest first by version. */
export interface CursorKeyset {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Uint8Array>;
}

function hmacKey(
  bytes: Uint8Array,
  usage: "sign" | "verify",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes).buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    [usage],
  );
}

function signedMessage(
  domain: string,
  signed: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${domain}\n${signed}`);
}

/**
 * Signs an anchor with the keyset's active key.
 *
 * `domain` separates one listing's cursors from another's, so a cursor minted
 * for tasks cannot be replayed against audit history. The key version travels
 * in the cursor, which is what lets a key rotate without invalidating the
 * cursors already in flight. A missing active key is a misconfiguration, not a
 * bad request, so it throws.
 */
export async function signCursor(
  domain: string,
  body: unknown,
  keyset: CursorKeyset,
): Promise<string> {
  const keyBytes = keyset.keys.get(keyset.activeVersion);
  if (!keyBytes) throw new Error("The active cursor key is unavailable.");
  const signed = `v1.v${keyset.activeVersion}.${encodeBody(body)}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(keyBytes, "sign"),
    signedMessage(domain, signed),
  );
  return `${signed}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verifies a signed cursor and returns its body, or `undefined` when the
 * cursor is malformed, signed for another domain, signed with a key this
 * keyset no longer publishes, or tampered with.
 */
export async function verifyCursor(
  domain: string,
  cursor: string,
  keyset: CursorKeyset,
): Promise<unknown> {
  const [format, keyLabel, encodedBody, encodedSignature, extra] = cursor
    .split(".");
  const keyMatch = KEY_LABEL.exec(keyLabel ?? "");
  if (
    format !== "v1" || !keyMatch || !encodedBody || !encodedSignature || extra
  ) return undefined;
  const keyBytes = keyset.keys.get(Number(keyMatch[1]));
  const signature = decodeBase64Url(encodedSignature);
  if (!keyBytes || signature?.length !== SIGNATURE_BYTES) return undefined;
  const authentic = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(keyBytes, "verify"),
    new Uint8Array(signature).buffer,
    signedMessage(domain, `${format}.${keyLabel}.${encodedBody}`),
  );
  return authentic ? decodeBody(encodedBody) : undefined;
}
