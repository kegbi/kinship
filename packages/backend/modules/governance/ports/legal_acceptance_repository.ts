/**
 * How the module stores legal documents and what has been accepted.
 *
 * `requirements` is scoped to the actor because what a member still owes
 * depends on what that member has already signed. `publicDocument` is the one
 * method that takes no actor at all: the privacy notice and the terms are
 * readable by anybody, including somebody who has not signed in, so it takes
 * no transaction either.
 *
 * `accept` answers with `already-accepted` rather than failing, because a
 * member who clicks twice has still accepted, and with `superseded-version`
 * when the document moved on while the page was open — which is a different
 * thing from a refusal and is shown differently.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  LegalDocument,
  PublicLegalDocumentType,
} from "../domain/legal_rules.ts";
import type { LegalActor, LegalTransaction } from "./context.ts";

export interface LegalAcceptanceRepository {
  requirements(
    command: LegalActor & { readonly transaction: LegalTransaction },
  ): Promise<
    | { readonly documents: readonly LegalDocument[]; readonly status: "ready" }
    | Failure<"forbidden">
  >;
  publicDocument(documentType: PublicLegalDocumentType): Promise<
    | { readonly document: LegalDocument; readonly status: "ready" }
    | Failure<"not-found">
  >;
  accept(
    command: LegalActor & {
      readonly acceptanceId: string;
      readonly documentId: string;
      readonly ipAddress?: string;
      readonly now: Date;
      readonly transaction: LegalTransaction;
    },
  ): Promise<
    | {
      readonly acceptedAt: string;
      readonly documentId: string;
      readonly status: "accepted" | "already-accepted";
    }
    | Failure<"forbidden", "superseded-version">
  >;
}
