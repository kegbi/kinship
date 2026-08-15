export interface PeopleTransaction {
  readonly opaque: unknown;
}

export interface PeopleActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface CreatePersonInput {
  readonly duplicateOverride?: boolean;
  readonly familyName?: string;
  readonly givenName: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

export interface PersonIdentity {
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

export interface PossibleDuplicate {
  readonly displayName: string;
  readonly id: string;
}

export type PersonIdentityLookup =
  | { readonly person: PersonIdentity; readonly status: "ready" }
  | { readonly person: PersonIdentity; readonly status: "archived" }
  | { readonly status: "not-found" }
  | { readonly status: "forbidden" };

export interface PeopleRepository {
  revalidateAndLockCreateContext(
    command: PeopleActor & { readonly transaction: PeopleTransaction },
  ): Promise<boolean>;
  findPossibleDuplicates(
    command: PeopleActor & CreatePersonInput & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly PossibleDuplicate[]>;
  getIdentity(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonIdentityLookup>;
  create(
    command: PeopleActor & PersonIdentity & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonIdentity | undefined>;
  assertCreatedPostcondition(
    command: PeopleActor & PersonIdentity & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface PersonCreatedAudit {
  record(command: {
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly person: PersonIdentity;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
  assertPostcondition(command: {
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly person: PersonIdentity;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface PeopleManagementDependencies {
  readonly audit: PersonCreatedAudit;
  readonly clock: { now(): Date };
  readonly ids: { create(): string };
  readonly repository: PeopleRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export type CreatePersonResult =
  | {
    readonly errors: Readonly<Record<string, string>>;
    readonly status: "validation-error";
  }
  | {
    readonly duplicates: readonly PossibleDuplicate[];
    readonly status: "possible-duplicate";
  }
  | { readonly status: "forbidden" }
  | { readonly person: PersonIdentity; readonly status: "created" };

export type GetPersonResult = PersonIdentityLookup;

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalize(input: CreatePersonInput): CreatePersonInput {
  const familyName = optional(input.familyName);
  const middleName = optional(input.middleName);
  const nickname = optional(input.nickname);
  return {
    ...(input.duplicateOverride ? { duplicateOverride: true } : {}),
    ...(familyName ? { familyName } : {}),
    givenName: input.givenName.trim(),
    isPartial: input.isPartial,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

function validate(
  input: CreatePersonInput,
): Readonly<Record<string, string>> {
  if (!input.givenName && !input.familyName && !input.nickname) {
    return {
      givenName: "Enter a given name, family name, or nickname.",
    };
  }
  if (!input.givenName && !input.isPartial) {
    return {
      isPartial: "Mark the person as partial when their given name is unknown.",
    };
  }
  return {};
}

export function createPeopleManagement(
  dependencies: PeopleManagementDependencies,
) {
  return {
    create: async (
      actor: PeopleActor,
      rawInput: CreatePersonInput,
    ): Promise<CreatePersonResult> => {
      const input = normalize(rawInput);
      const errors = validate(input);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const authorized = await dependencies.repository
          .revalidateAndLockCreateContext({ ...actor, transaction });
        if (!authorized) return { status: "forbidden" };
        const duplicates = await dependencies.repository.findPossibleDuplicates(
          { ...actor, ...input, transaction },
        );
        if (duplicates.length > 0 && !input.duplicateOverride) {
          return { duplicates, status: "possible-duplicate" };
        }
        const person: PersonIdentity = {
          ...(input.familyName ? { familyName: input.familyName } : {}),
          givenName: input.givenName,
          id: dependencies.ids.create(),
          isPartial: input.isPartial,
          ...(input.middleName ? { middleName: input.middleName } : {}),
          ...(input.nickname ? { nickname: input.nickname } : {}),
        };
        const created = await dependencies.repository.create({
          ...actor,
          ...person,
          transaction,
        });
        if (!created) return { status: "forbidden" };
        const occurredAt = dependencies.clock.now();
        const auditCommand = {
          actor,
          occurredAt,
          person: created,
          transaction,
        };
        await dependencies.audit.record(auditCommand);
        await dependencies.repository.assertCreatedPostcondition({
          ...actor,
          ...created,
          transaction,
        });
        await dependencies.audit.assertPostcondition(auditCommand);
        return { person: created, status: "created" };
      });
    },
    get: (
      actor: PeopleActor,
      personId: string,
    ): Promise<GetPersonResult> =>
      dependencies.transaction.run((transaction) =>
        dependencies.repository.getIdentity({
          ...actor,
          personId,
          transaction,
        })
      ),
  };
}

export type PeopleManagement = ReturnType<typeof createPeopleManagement>;
