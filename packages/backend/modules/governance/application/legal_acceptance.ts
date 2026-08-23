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
  requirements(actor: LegalActor): Promise<
    | { readonly documents: readonly LegalDocument[]; readonly status: "ready" }
    | { readonly status: "forbidden" }
  >;
  publicDocument(documentType: "privacy" | "terms"): Promise<
    | { readonly document: LegalDocument; readonly status: "ready" }
    | { readonly status: "not-found" }
  >;
  accept(
    command: LegalActor & {
      readonly acceptanceId: string;
      readonly documentId: string;
      readonly ipAddress?: string;
      readonly now: Date;
    },
  ): Promise<
    | {
      readonly acceptedAt: string;
      readonly documentId: string;
      readonly status: "accepted" | "already-accepted";
    }
    | { readonly status: "forbidden" | "superseded-version" }
  >;
}

export interface LegalAcceptanceDependencies {
  readonly clock: { now(): Date };
  readonly ids: { next(): string };
  readonly repository: LegalAcceptanceRepository;
}

export function createLegalAcceptance(
  dependencies: LegalAcceptanceDependencies,
) {
  return {
    requirements: async (actor: LegalActor) => {
      try {
        return await dependencies.repository.requirements(actor);
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
        return await dependencies.repository.accept({
          ...actor,
          acceptanceId: dependencies.ids.next(),
          documentId: input.documentId,
          ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
          now: dependencies.clock.now(),
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
  };
}

export type LegalAcceptance = ReturnType<typeof createLegalAcceptance>;
