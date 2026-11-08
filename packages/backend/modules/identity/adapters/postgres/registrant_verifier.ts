/**
 * Where the registering browser's verifier is kept (SECA-01, AUD-A1).
 *
 * Schema v13 has no column for it, so the verifier's digest is a sibling row
 * of the pending user's verification tokens, with a `token_hash` prefixed
 * `registrant:`. A token digest is base64url and never contains `:`, so the
 * row can never be found by a verification lookup, and the raw verifier
 * — which lives only in the registrant's cookie — can never be spent as a
 * verification link. The row shares the user's lifecycle: verification marks
 * it used with the tokens, and discarding the pending user deletes it.
 */

import type { IdentityTokenService } from "../../ports/password_recovery.ts";

/** The `token_hash` prefix that marks a registrant verifier row. */
export const REGISTRANT_VERIFIER_PREFIX = "registrant:";

/** A `LIKE` pattern matching every registrant verifier row. */
export const REGISTRANT_VERIFIER_PATTERN = `${REGISTRANT_VERIFIER_PREFIX}%`;

/** The stored form of a raw registrant verifier. */
export async function registrantVerifierDigest(
  tokens: Pick<IdentityTokenService, "hash">,
  raw: string,
): Promise<string> {
  return `${REGISTRANT_VERIFIER_PREFIX}${await tokens.hash(raw)}`;
}
