import type { Clock } from "../../../shared-kernel/clock.ts";
import type {
  Failure,
  ValidationErrors,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import { isInstant, optionalText } from "../../../shared-kernel/validation.ts";
import type { PeopleActor, PeopleTransaction } from "./create_person.ts";

export type PersonLifecycleState = "active" | "archived" | "deleted";
export type PersonLifecycleAction = "archive" | "delete" | "edit" | "restore";

export interface PersonLifecycleRecord {
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isPartial: boolean;
  readonly lifecycle: PersonLifecycleState;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly updatedAt: string;
}

export type PersonLifecycleLock =
  | { readonly status: "forbidden" }
  | { readonly status: "not-found" }
  | { readonly person: PersonLifecycleRecord; readonly status: "ready" };

export interface EditPersonInput {
  readonly expectedUpdatedAt: string;
  readonly familyName?: string;
  readonly givenName: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

export interface PersonTransitionInput {
  readonly expectedUpdatedAt: string;
}

export interface DeletePersonInput extends PersonTransitionInput {
  readonly confirmation: string;
}

export interface PersonDeletionImpact {
  readonly confirmation: string;
  readonly dependentRecordPolicy: "retained";
  readonly person: PersonLifecycleRecord;
}

export interface PersonLifecycleRepository {
  lock(
    command: PeopleActor & {
      readonly action: PersonLifecycleAction;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonLifecycleLock>;
  mutate(
    command: PeopleActor & {
      readonly action: PersonLifecycleAction;
      readonly expectedUpdatedAt: string;
      readonly input?: Omit<EditPersonInput, "expectedUpdatedAt">;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonLifecycleRecord | undefined>;
  assertPostcondition(
    command: PeopleActor & {
      readonly action: PersonLifecycleAction;
      readonly before: PersonLifecycleRecord;
      readonly person: PersonLifecycleRecord;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface PersonLifecycleAudit {
  record(command: {
    readonly action: PersonLifecycleAction;
    readonly actor: PeopleActor;
    readonly before: PersonLifecycleRecord;
    readonly occurredAt: Date;
    readonly person: PersonLifecycleRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: PersonLifecycleAction;
    readonly actor: PeopleActor;
    readonly auditId: string;
    readonly before: PersonLifecycleRecord;
    readonly occurredAt: Date;
    readonly person: PersonLifecycleRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface PersonLifecycleDependencies {
  readonly audit: PersonLifecycleAudit;
  readonly clock: Clock;
  readonly repository: PersonLifecycleRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export type PersonLifecycleFailure = Failure<
  "forbidden" | "not-found",
  "stale"
>;

export type EditPersonResult =
  | PersonLifecycleFailure
  | Failure<"archived-write-rejected">
  | ValidationFailure
  | { readonly person: PersonLifecycleRecord; readonly status: "updated" };

export type TransitionPersonResult =
  | PersonLifecycleFailure
  | { readonly person: PersonLifecycleRecord; readonly status: "archived" }
  | { readonly person: PersonLifecycleRecord; readonly status: "restored" };

export type PreviewPersonDeletionResult =
  | PersonLifecycleFailure
  | { readonly impact: PersonDeletionImpact; readonly status: "ready" };

export type DeletePersonResult =
  | PersonLifecycleFailure
  | { readonly status: "confirmation-required" }
  | { readonly personId: string; readonly status: "deleted" };

function normalize(input: EditPersonInput): EditPersonInput {
  const familyName = optionalText(input.familyName);
  const middleName = optionalText(input.middleName);
  const nickname = optionalText(input.nickname);
  return {
    expectedUpdatedAt: input.expectedUpdatedAt,
    ...(familyName ? { familyName } : {}),
    givenName: input.givenName.trim(),
    isPartial: input.isPartial,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

function validate(input: EditPersonInput): ValidationErrors {
  if (!input.givenName && !input.familyName && !input.nickname) {
    return { givenName: "Enter a given name, family name, or nickname." };
  }
  if (!input.givenName && !input.isPartial) {
    return {
      isPartial: "Mark the person as partial when their given name is unknown.",
    };
  }
  if (!isInstant(input.expectedUpdatedAt)) {
    return { expectedUpdatedAt: "Refresh this person before saving." };
  }
  return {};
}

function displayName(person: PersonLifecycleRecord): string {
  const formal = [person.givenName, person.familyName].filter(Boolean).join(
    " ",
  );
  return formal || person.nickname || "Unnamed person";
}

function confirmation(person: PersonLifecycleRecord): string {
  return `DELETE ${displayName(person)}`;
}

function failure(lock: Exclude<PersonLifecycleLock, { status: "ready" }>) {
  return lock.status === "forbidden"
    ? { status: "forbidden" as const }
    : { status: "not-found" as const };
}

export function createPersonLifecycle(
  dependencies: PersonLifecycleDependencies,
) {
  const change = async (
    actor: PeopleActor,
    action: PersonLifecycleAction,
    before: PersonLifecycleRecord,
    expectedUpdatedAt: string,
    transaction: PeopleTransaction,
    input?: Omit<EditPersonInput, "expectedUpdatedAt">,
  ): Promise<PersonLifecycleRecord | undefined> => {
    const occurredAt = dependencies.clock.now();
    const person = await dependencies.repository.mutate({
      action,
      ...actor,
      expectedUpdatedAt,
      ...(input ? { input } : {}),
      occurredAt,
      personId: before.id,
      transaction,
    });
    if (!person) return undefined;
    const auditCommand = {
      action,
      actor,
      before,
      occurredAt,
      person,
      transaction,
    };
    const auditId = await dependencies.audit.record(auditCommand);
    await dependencies.repository.assertPostcondition({
      action,
      ...actor,
      before,
      person,
      transaction,
    });
    await dependencies.audit.assertPostcondition({ ...auditCommand, auditId });
    return person;
  };

  const inspectInTransaction = (
    actor: PeopleActor,
    personId: string,
    transaction: PeopleTransaction,
  ): Promise<PersonLifecycleLock> =>
    dependencies.repository.lock({
      action: "edit",
      ...actor,
      personId,
      transaction,
    });
  const editInTransaction = async (
    actor: PeopleActor,
    personId: string,
    rawInput: EditPersonInput,
    transaction: PeopleTransaction,
  ): Promise<EditPersonResult> => {
    const input = normalize(rawInput);
    const errors = validate(input);
    if (Object.keys(errors).length > 0) {
      return { errors, status: "validation-error" };
    }
    const locked = await dependencies.repository.lock({
      action: "edit",
      ...actor,
      personId,
      transaction,
    });
    if (locked.status !== "ready") return failure(locked);
    if (locked.person.lifecycle === "deleted") return { status: "not-found" };
    if (locked.person.lifecycle === "archived") {
      return { status: "archived-write-rejected" };
    }
    if (locked.person.updatedAt !== input.expectedUpdatedAt) {
      return { status: "stale" };
    }
    const { expectedUpdatedAt, ...identity } = input;
    const person = await change(
      actor,
      "edit",
      locked.person,
      expectedUpdatedAt,
      transaction,
      identity,
    );
    return person ? { person, status: "updated" } : { status: "stale" };
  };
  const transitionInTransaction = async (
    actor: PeopleActor,
    personId: string,
    input: PersonTransitionInput,
    action: "archive" | "restore",
    transaction: PeopleTransaction,
  ): Promise<TransitionPersonResult> => {
    const locked = await dependencies.repository.lock({
      action,
      ...actor,
      personId,
      transaction,
    });
    if (locked.status !== "ready") return failure(locked);
    if (locked.person.lifecycle === "deleted") return { status: "not-found" };
    if (
      action === "archive" && locked.person.lifecycle === "archived" ||
      action === "restore" && locked.person.lifecycle === "active"
    ) {
      return {
        person: locked.person,
        status: action === "archive" ? "archived" : "restored",
      };
    }
    if (locked.person.updatedAt !== input.expectedUpdatedAt) {
      return { status: "stale" };
    }
    const person = await change(
      actor,
      action,
      locked.person,
      input.expectedUpdatedAt,
      transaction,
    );
    return person
      ? { person, status: action === "archive" ? "archived" : "restored" }
      : { status: "stale" };
  };

  return {
    archiveInTransaction: (
      actor: PeopleActor,
      personId: string,
      input: PersonTransitionInput,
      transaction: PeopleTransaction,
    ) =>
      transitionInTransaction(actor, personId, input, "archive", transaction),
    editInTransaction,
    inspectInTransaction,
    restoreInTransaction: (
      actor: PeopleActor,
      personId: string,
      input: PersonTransitionInput,
      transaction: PeopleTransaction,
    ) =>
      transitionInTransaction(actor, personId, input, "restore", transaction),
    inspect: (
      actor: PeopleActor,
      personId: string,
    ): Promise<PersonLifecycleLock> =>
      dependencies.transaction.run((transaction) =>
        inspectInTransaction(actor, personId, transaction)
      ),
    edit: async (
      actor: PeopleActor,
      personId: string,
      rawInput: EditPersonInput,
    ): Promise<EditPersonResult> => {
      return await dependencies.transaction.run((transaction) =>
        editInTransaction(actor, personId, rawInput, transaction)
      );
    },
    archive: (
      actor: PeopleActor,
      personId: string,
      input: PersonTransitionInput,
    ): Promise<TransitionPersonResult> =>
      dependencies.transaction.run((transaction) =>
        transitionInTransaction(actor, personId, input, "archive", transaction)
      ),
    restore: (
      actor: PeopleActor,
      personId: string,
      input: PersonTransitionInput,
    ): Promise<TransitionPersonResult> =>
      dependencies.transaction.run((transaction) =>
        transitionInTransaction(actor, personId, input, "restore", transaction)
      ),
    previewDeletion: (
      actor: PeopleActor,
      personId: string,
    ): Promise<PreviewPersonDeletionResult> =>
      dependencies.transaction.run(async (transaction) => {
        const locked = await dependencies.repository.lock({
          action: "delete",
          ...actor,
          personId,
          transaction,
        });
        if (locked.status !== "ready") return failure(locked);
        if (locked.person.lifecycle === "deleted") {
          return { status: "not-found" };
        }
        return {
          impact: {
            confirmation: confirmation(locked.person),
            dependentRecordPolicy: "retained",
            person: locked.person,
          },
          status: "ready",
        };
      }),
    delete: (
      actor: PeopleActor,
      personId: string,
      input: DeletePersonInput,
    ): Promise<DeletePersonResult> =>
      dependencies.transaction.run(async (transaction) => {
        const locked = await dependencies.repository.lock({
          action: "delete",
          ...actor,
          personId,
          transaction,
        });
        if (locked.status !== "ready") return failure(locked);
        if (locked.person.lifecycle === "deleted") {
          return { personId, status: "deleted" };
        }
        if (input.confirmation !== confirmation(locked.person)) {
          return { status: "confirmation-required" };
        }
        if (locked.person.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const person = await change(
          actor,
          "delete",
          locked.person,
          input.expectedUpdatedAt,
          transaction,
        );
        return person ? { personId, status: "deleted" } : { status: "stale" };
      }),
  };
}

export type PersonLifecycle = Pick<
  ReturnType<typeof createPersonLifecycle>,
  "archive" | "delete" | "edit" | "previewDeletion" | "restore"
>;
