/**
 * The legal acceptance use case.
 *
 * All three paths orchestrate and nothing else: establish the caller's
 * standing inside the transaction the work will happen in, ask the repository,
 * and hand back what it said. Reading what is outstanding takes no lock;
 * accepting does, because it writes evidence against the member's row.
 *
 * Each path turns a thrown failure into `unavailable`. That is the one place
 * this module departs from letting a failure travel: the consent gate sits in
 * front of every other request, so a database that is briefly unreachable has
 * to say so rather than let an exception escape into a middleware that would
 * read it as a refusal to consent.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  acceptanceValues,
  type LegalAcceptanceInput,
  type PublicLegalDocumentType,
} from "../domain/legal_rules.ts";
import type { LegalAcceptanceRepository } from "../ports/legal_acceptance_repository.ts";
import type {
  LegalActor,
  LegalTransaction,
  LegalTransactionRunner,
} from "../ports/context.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface LegalAcceptanceDependencies {
  readonly actors: ActorRevalidation;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly repository: LegalAcceptanceRepository;
  readonly transaction: LegalTransactionRunner;
}

export function createLegalAcceptance(
  dependencies: LegalAcceptanceDependencies,
) {
  /** The actor's standing, asked first inside the caller's transaction. */
  const revoked = async (
    actor: LegalActor,
    transaction: LegalTransaction,
    lock: boolean,
  ): Promise<boolean> =>
    await dependencies.actors.revalidate({ ...actor, lock, transaction }) ===
      "revoked";

  return {
    requirements: async (actor: LegalActor) => {
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (await revoked(actor, transaction, false)) {
            return { status: "forbidden" as const };
          }
          return await dependencies.repository.requirements({
            ...actor,
            transaction,
          });
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
    publicDocument: async (documentType: PublicLegalDocumentType) => {
      try {
        return await dependencies.repository.publicDocument(documentType);
      } catch {
        return { status: "unavailable" as const };
      }
    },
    accept: async (actor: LegalActor, input: LegalAcceptanceInput) => {
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (await revoked(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          return await dependencies.repository.accept({
            ...actor,
            acceptanceId: dependencies.ids.next(),
            ...acceptanceValues(input),
            now: dependencies.clock.now(),
            transaction,
          });
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
  };
}

export type LegalAcceptance = ReturnType<typeof createLegalAcceptance>;
