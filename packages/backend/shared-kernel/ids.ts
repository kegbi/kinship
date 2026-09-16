/**
 * Identifier contracts.
 *
 * Fresh identifiers come from an injected `IdGenerator` so a use case stays
 * reproducible. Idempotent writes need the opposite: the same request must
 * derive the same identifier on every retry, which is what
 * `deterministicId` does. People and planning each carried their own copy of
 * that derivation; this is the single one.
 */

/** The injected source of fresh identifiers. */
export interface IdGenerator {
  create(): string;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Derives a stable identifier from a namespace and the parts that identify the
 * request.
 *
 * The digest is rendered as a canonical UUID whose version nibble is 8, so a
 * derived identifier is distinguishable from a random v4 one and still fits a
 * `uuid` column. Parts are case-folded and separated by NUL, so `["ab", "c"]`
 * and `["a", "bc"]` cannot collide, and a client that re-sends a request
 * identifier in a different case still lands on the row it already created.
 */
export async function deterministicId(
  namespace: string,
  parts: readonly string[],
): Promise<string> {
  const material = [namespace, ...parts.map((part) => part.toLowerCase())]
    .join("\u0000");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)),
  );
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const rendered = hex(digest.slice(0, 16));
  return [
    rendered.slice(0, 8),
    rendered.slice(8, 12),
    rendered.slice(12, 16),
    rendered.slice(16, 20),
    rendered.slice(20),
  ].join("-");
}
