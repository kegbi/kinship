/**
 * Recording a person, once.
 *
 * Two entry points create a person and they differ only in what makes them
 * safe to retry. `create` is a member typing a name, so it looks for people
 * who already carry that name and hands them back for a decision unless the
 * member has already overridden the warning. `ensure` is a machine replaying a
 * request — a DAV sync, an import — so it derives the person's identifier from
 * the request instead of generating one, locks that identifier, and returns
 * the person the first attempt created rather than a second copy.
 *
 * Every rule about the names themselves lives in `domain/person_identity.ts`.
 * What is left here is the order of the steps: normalize, validate,
 * revalidate the actor under lock, write, audit, and read both back before the
 * transaction is allowed to commit.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import {
  type CreatePersonInput,
  derivePersonId,
  normalizeCreatePersonInput,
  type PersonIdentity,
  personIdentityFrom,
  type PossibleDuplicate,
  sameIdentity,
  validateCreatePersonInput,
} from "../domain/person_identity.ts";
import type { PersonCreatedAudit } from "../ports/audit.ts";
import type {
  PeopleActor,
  PeopleTransaction,
  PeopleTransactionRunner,
} from "../ports/context.ts";
import type {
  PeopleRepository,
  PersonIdentityLookup,
} from "../ports/person_repository.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface PeopleManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: PersonCreatedAudit;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly repository: PeopleRepository;
  readonly transaction: PeopleTransactionRunner;
}

/** Creating a person inside a transaction somebody else opened. */
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

export type GetPersonResult = PersonIdentityLookup;

export function createPeopleManagement(
  dependencies: PeopleManagementDependencies,
) {
  /** Writes the person, records the event, and reads both back. */
  const persist = async (
    actor: PeopleActor,
    person: PersonIdentity,
    transaction: PeopleTransaction,
  ): Promise<PersonIdentity | undefined> => {
    const created = await dependencies.repository.create({
      ...actor,
      ...person,
      transaction,
    });
    if (!created) return undefined;
    const occurredAt = dependencies.clock.now();
    const auditCommand = { actor, occurredAt, person: created, transaction };
    await dependencies.audit.record(auditCommand);
    await dependencies.repository.assertCreatedPostcondition({
      ...actor,
      ...created,
      transaction,
    });
    await dependencies.audit.assertPostcondition(auditCommand);
    return created;
  };
  const createInTransaction = async (
    actor: PeopleActor,
    rawInput: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<CreatePersonResult> => {
    const input = normalizeCreatePersonInput(rawInput);
    const errors = validateCreatePersonInput(input);
    if (Object.keys(errors).length > 0) {
      return { errors, status: "validation-error" };
    }
    const standing = await dependencies.actors.revalidate({
      ...actor,
      lock: true,
      transaction,
    });
    if (standing === "revoked") return { status: "forbidden" };
    const duplicates = await dependencies.repository.findPossibleDuplicates({
      ...actor,
      ...input,
      transaction,
    });
    if (duplicates.length > 0 && !input.duplicateOverride) {
      return { duplicates, status: "possible-duplicate" };
    }
    const created = await persist(
      actor,
      personIdentityFrom(dependencies.ids.create(), input),
      transaction,
    );
    return created
      ? { person: created, status: "created" }
      : { status: "forbidden" };
  };
  const ensureInTransaction = async (
    actor: PeopleActor,
    requestId: string,
    rawInput: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<EnsurePersonResult> => {
    const input = normalizeCreatePersonInput(rawInput);
    const errors = validateCreatePersonInput(input);
    if (Object.keys(errors).length > 0) {
      return { errors, status: "validation-error" };
    }
    const id = await derivePersonId(actor.workspaceId, requestId);
    const standing = await dependencies.actors.revalidate({
      ...actor,
      lock: true,
      transaction,
    });
    if (standing === "revoked") return { status: "forbidden" };
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
    const created = await persist(
      actor,
      personIdentityFrom(id, input),
      transaction,
    );
    return created
      ? { person: created, status: "ready" }
      : { status: "forbidden" };
  };
  return {
    createInTransaction,
    ensureInTransaction,
    ensure: async (
      actor: PeopleActor,
      requestId: string,
      rawInput: CreatePersonInput,
    ): Promise<EnsurePersonResult> => {
      return await dependencies.transaction.run(
        (transaction) =>
          ensureInTransaction(actor, requestId, rawInput, transaction),
        { workspaceId: actor.workspaceId },
      );
    },
    create: async (
      actor: PeopleActor,
      rawInput: CreatePersonInput,
    ): Promise<CreatePersonResult> => {
      const input = normalizeCreatePersonInput(rawInput);
      const errors = validateCreatePersonInput(input);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(
        (transaction) => createInTransaction(actor, input, transaction),
        { workspaceId: actor.workspaceId },
      );
    },
    get: (
      actor: PeopleActor,
      personId: string,
    ): Promise<GetPersonResult> =>
      dependencies.transaction.run(async (transaction) => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: false,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" };
        return await dependencies.repository.getIdentity({
          ...actor,
          personId,
          transaction,
        });
      }, { workspaceId: actor.workspaceId }),
  };
}

export type PeopleManagement = Pick<
  ReturnType<typeof createPeopleManagement>,
  "create" | "get"
>;
