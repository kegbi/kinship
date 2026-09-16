import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  deterministicId,
  type IdGenerator,
} from "../../../shared-kernel/ids.ts";
import type {
  Failure,
  ValidationErrors,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import { optionalText } from "../../../shared-kernel/validation.ts";

/** The namespace that makes a person creation idempotent across retries. */
const PERSON_ID_NAMESPACE = "kinship.people.external-id.v1";

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
  lockRequest(command: {
    readonly id: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
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
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly repository: PeopleRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export interface TransactionalPeopleCreation {
  createInTransaction(
    actor: PeopleActor,
    input: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<CreatePersonResult>;
}

export type CreatePersonResult =
  | ValidationFailure
  | {
    readonly duplicates: readonly PossibleDuplicate[];
    readonly status: "possible-duplicate";
  }
  | Failure<"forbidden">
  | { readonly person: PersonIdentity; readonly status: "created" };

export type EnsurePersonResult =
  | ValidationFailure
  | Failure<"forbidden", "idempotency-conflict">
  | { readonly person: PersonIdentity; readonly status: "ready" };

function sameIdentity(left: PersonIdentity, right: CreatePersonInput): boolean {
  return left.givenName === right.givenName &&
    left.familyName === right.familyName &&
    left.middleName === right.middleName && left.nickname === right.nickname &&
    left.isPartial === right.isPartial;
}

export type GetPersonResult = PersonIdentityLookup;

function normalize(input: CreatePersonInput): CreatePersonInput {
  const familyName = optionalText(input.familyName);
  const middleName = optionalText(input.middleName);
  const nickname = optionalText(input.nickname);
  return {
    ...(input.duplicateOverride ? { duplicateOverride: true } : {}),
    ...(familyName ? { familyName } : {}),
    givenName: input.givenName.trim(),
    isPartial: input.isPartial,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

function validate(input: CreatePersonInput): ValidationErrors {
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
  const createInTransaction = async (
    actor: PeopleActor,
    rawInput: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<CreatePersonResult> => {
    const input = normalize(rawInput);
    const errors = validate(input);
    if (Object.keys(errors).length > 0) {
      return { errors, status: "validation-error" };
    }
    const authorized = await dependencies.repository
      .revalidateAndLockCreateContext({ ...actor, transaction });
    if (!authorized) return { status: "forbidden" };
    const duplicates = await dependencies.repository.findPossibleDuplicates({
      ...actor,
      ...input,
      transaction,
    });
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
    const auditCommand = { actor, occurredAt, person: created, transaction };
    await dependencies.audit.record(auditCommand);
    await dependencies.repository.assertCreatedPostcondition({
      ...actor,
      ...created,
      transaction,
    });
    await dependencies.audit.assertPostcondition(auditCommand);
    return { person: created, status: "created" };
  };
  const ensureInTransaction = async (
    actor: PeopleActor,
    requestId: string,
    rawInput: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<EnsurePersonResult> => {
    const input = normalize(rawInput);
    const errors = validate(input);
    if (Object.keys(errors).length > 0) {
      return { errors, status: "validation-error" };
    }
    const id = await deterministicId(PERSON_ID_NAMESPACE, [
      actor.workspaceId,
      requestId,
    ]);
    if (
      !await dependencies.repository.revalidateAndLockCreateContext({
        ...actor,
        transaction,
      })
    ) return { status: "forbidden" };
    await dependencies.repository.lockRequest({ id, transaction });
    const existing = await dependencies.repository.getIdentity({
      ...actor,
      personId: id,
      transaction,
    });
    if (existing.status === "ready" || existing.status === "archived") {
      return sameIdentity(existing.person, input)
        ? { person: existing.person, status: "ready" }
        : { status: "idempotency-conflict" };
    }
    if (existing.status === "forbidden") return { status: "forbidden" };
    const person: PersonIdentity = { id, ...input };
    const created = await dependencies.repository.create({
      ...actor,
      ...person,
      transaction,
    });
    if (!created) return { status: "forbidden" };
    const occurredAt = dependencies.clock.now();
    const auditCommand = { actor, occurredAt, person: created, transaction };
    await dependencies.audit.record(auditCommand);
    await dependencies.repository.assertCreatedPostcondition({
      ...actor,
      ...created,
      transaction,
    });
    await dependencies.audit.assertPostcondition(auditCommand);
    return { person: created, status: "ready" };
  };
  return {
    createInTransaction,
    ensureInTransaction,
    ensure: async (
      actor: PeopleActor,
      requestId: string,
      rawInput: CreatePersonInput,
    ): Promise<EnsurePersonResult> => {
      return await dependencies.transaction.run((transaction) =>
        ensureInTransaction(actor, requestId, rawInput, transaction)
      );
    },
    create: async (
      actor: PeopleActor,
      rawInput: CreatePersonInput,
    ): Promise<CreatePersonResult> => {
      const input = normalize(rawInput);
      const errors = validate(input);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run((transaction) =>
        createInTransaction(actor, input, transaction)
      );
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

export type PeopleManagement = Pick<
  ReturnType<typeof createPeopleManagement>,
  "create" | "get"
>;
