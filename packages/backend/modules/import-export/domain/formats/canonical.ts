/**
 * How this module renders a value it has to hash.
 *
 * Both halves of import-export sign what they moved: an import records the
 * fingerprint of the source it staged so the same file cannot be staged twice
 * under a different name, and an export records a digest of the rows it wrote
 * so a later read can prove it fetched what was written. A digest is only
 * worth anything while the text underneath it is derived the same way every
 * time, so the rendering is one function rather than the two near-copies the
 * two use cases each kept.
 *
 * Two details of that rendering are load-bearing and deliberately preserved.
 * Keys are sorted, so the same record hashes the same however the adapter
 * happened to build it. A property whose value is `undefined` is rendered as
 * the literal text `undefined` rather than dropped, because `JSON.stringify`
 * answers with nothing for it and the template that stitches the pairs
 * together turns that nothing into a word. That is what the fingerprints
 * already written to `import_runs` were computed over, so the suite beside
 * this file pins it with a fixed vector.
 */

const ENCODER = new TextEncoder();

/** The value as a plain record, or nothing when it is not one. */
export function jsonObject(
  value: unknown,
): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * The canonical text of a value: arrays in order, object keys sorted, and
 * everything else as JSON writes it.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = jsonObject(value);
  if (record) {
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

/**
 * The SHA-256 of some bytes or some text, as lower-case hexadecimal.
 *
 * `crypto.subtle` is a Web API rather than an I/O port — the shared kernel's
 * `deterministicId` already uses the same one — so the digest belongs beside
 * the rendering it signs instead of behind an adapter.
 */
export async function sha256Hex(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? ENCODER.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
