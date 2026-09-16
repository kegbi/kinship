import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface LegalTransaction {
  readonly opaque: unknown;
}

export interface LegalActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface LegalDocument {
  readonly content: string;
  readonly documentType: string;
  readonly id: string;
  readonly publishedAt?: string;
  readonly version: string;
}

export interface LegalAcceptanceRepository {
  requirements(
    command: LegalActor & { readonly transaction: LegalTransaction },
  ): Promise<
    | { readonly documents: readonly LegalDocument[]; readonly status: "ready" }
    | Failure<"forbidden">
  >;
  publicDocument(documentType: "privacy" | "terms"): Promise<
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

export interface LegalAcceptanceDependencies {
  readonly actors: ActorRevalidation;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly repository: LegalAcceptanceRepository;
  readonly transaction: {
    run<T>(work: (transaction: LegalTransaction) => Promise<T>): Promise<T>;
  };
}

export function createLegalAcceptance(
  dependencies: LegalAcceptanceDependencies,
) {
  return {
    requirements: async (actor: LegalActor) => {
      try {
        return await dependencies.transaction.run(async (transaction) => {
          const standing = await dependencies.actors.revalidate({
            ...actor,
            lock: false,
            transaction,
          });
          if (standing === "revoked") return { status: "forbidden" as const };
          return await dependencies.repository.requirements({
            ...actor,
            transaction,
          });
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
    publicDocument: async (documentType: "privacy" | "terms") => {
      try {
        return await dependencies.repository.publicDocument(documentType);
      } catch {
        return { status: "unavailable" as const };
      }
    },
    accept: async (
      actor: LegalActor,
      input: { readonly documentId: string; readonly ipAddress?: string },
    ) => {
      try {
        return await dependencies.transaction.run(async (transaction) => {
          const standing = await dependencies.actors.revalidate({
            ...actor,
            lock: true,
            transaction,
          });
          if (standing === "revoked") return { status: "forbidden" as const };
          return await dependencies.repository.accept({
            ...actor,
            acceptanceId: dependencies.ids.next(),
            documentId: input.documentId,
            ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
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
