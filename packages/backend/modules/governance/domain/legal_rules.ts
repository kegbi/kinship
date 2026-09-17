/**
 * What a legal document is, and what accepting one records.
 *
 * Governance keeps deliberately little here. Which documents a member still
 * owes is a question about rows — the repository answers it by comparing the
 * published versions against what the member has already signed — and this
 * module has no business second-guessing that in TypeScript. What is a rule is
 * the pair below: the two documents anybody may read without signing in, and
 * the fact that an acceptance records the address it was made from only when
 * there is one to record.
 *
 * The address is the subtle half. An acceptance is evidence, and evidence that
 * claims an empty address is worse than evidence that claims none, so a blank
 * one is dropped rather than stored.
 */

/** The documents a visitor may read before they have an account. */
export const PUBLIC_LEGAL_DOCUMENT_TYPES = ["privacy", "terms"] as const;
export type PublicLegalDocumentType =
  typeof PUBLIC_LEGAL_DOCUMENT_TYPES[number];

/** One published document, at the version it was published as. */
export interface LegalDocument {
  readonly content: string;
  readonly documentType: string;
  readonly id: string;
  readonly publishedAt?: string;
  readonly version: string;
}

/** What a member sends when they accept a document. */
export interface LegalAcceptanceInput {
  readonly documentId: string;
  readonly ipAddress?: string;
}

/** The acceptance the repository records. */
export interface LegalAcceptanceValues {
  readonly documentId: string;
  readonly ipAddress?: string;
}

/** The acceptance, with an address only when one was actually supplied. */
export function acceptanceValues(
  input: LegalAcceptanceInput,
): LegalAcceptanceValues {
  return {
    documentId: input.documentId,
    ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
  };
}
