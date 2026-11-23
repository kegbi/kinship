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
 * `create` given a `requestId` (MCP-D4) is both at once: it takes the same
 * `replayRequest` step `ensure` does, which derives, locks, and looks up the
 * identifier first, so a retry of a creation that already happened returns
 * that person before duplicate detection could warn about them, and only a
 * request that created nothing yet reaches the warning.
 * `duplicateOverride` is therefore not part of what a retry is compared on: a
 * warned request retried with the override creates, and either spelling
 * retried after that returns the person it created. A derived identifier whose
 * person was since deleted answers `idempotency-conflict` rather than writing
 * a second row under the identifier the deleted one still holds.
 *
 * Every rule about the names themselves lives in `domain/person_identity.ts`.
 * What is left here is the order of the steps: normalize, validate,
 * revalidate the actor under lock, write, audit, and read both back before the
 * transaction is allowed to commit.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import { uuid } from "../../../shared-kernel/validation.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import {
  type CreatePersonInput,
  derivePersonId,
  type NewPersonIdentity,
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

/** A member's creation, optionally named by a retry-safe request identifier. */
export interface CreatePersonRequest extends CreatePersonInput {
  readonly requestId?: string;
}

/** What `create` answers; a request identifier adds the conflict. */
export type CreatePersonRequestResult =
  | CreatePersonResult
  | Failure<never, "idempotency-conflict">;

/** What a stored row says about a retried request identifier. */
type RequestReplay =
  | Failure<"forbidden", "idempotency-conflict">
  | { readonly person: PersonIdentity; readonly status: "replayed" };

export type GetPersonResult = PersonIdentityLookup;

export function createPeopleManagement(
  dependencies: PeopleManagementDependencies,
) {
  /** Writes the person, records the event, and reads both back. */
  const persist = async (
    actor: PeopleActor,
    person: NewPersonIdentity,
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
  /**
   * The first half of a creation a request identifier names: derive the
   * identifier, revalidate the actor, lock the identifier, and answer from the
   * row a previous attempt left, if there is one. `fresh` hands the identifier
   * back to the caller, whose own rules decide whether to write it.
   */
  const replayRequest = async (
    actor: PeopleActor,
    requestId: string,
    input: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<
    | RequestReplay
    | { readonly id: string; readonly status: "fresh" }
  > => {
    const id = await derivePersonId(actor.workspaceId, requestId);
    const standing = await dependencies.actors.revalidate({
      ...actor,
      lock: true,
      transaction,
    });
    if (standing === "revoked") return { status: "forbidden" };
    await dependencies.repository.lockRequest({ id, transaction });
    const existing = await dependencies.repository.getRequestedIdentity({
      ...actor,
      personId: id,
      transaction,
    });
    if (existing.status === "ready" || existing.status === "archived") {
      return sameIdentity(existing.person, input)
        ? { person: existing.person, status: "replayed" }
        : { status: "idempotency-conflict" };
    }
    if (existing.status === "not-found") return { id, status: "fresh" };
    return existing.status === "deleted"
      ? { status: "idempotency-conflict" }
      : { status: "forbidden" };
  };
  /** Writes the person a fresh request names, or answers why it could not. */
  const persistRequested = async (
    actor: PeopleActor,
    id: string,
    input: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<PersonIdentity | Failure<"forbidden">> =>
    await persist(actor, personIdentityFrom(id, input), transaction) ??
      { status: "forbidden" };
  /** A member's creation named by a request identifier. */
  const createRequested = async (
    actor: PeopleActor,
    requestId: string,
    input: CreatePersonInput,
    transaction: PeopleTransaction,
  ): Promise<CreatePersonRequestResult> => {
    const replay = await replayRequest(actor, requestId, input, transaction);
    if (replay.status === "replayed") {
      return { person: replay.person, status: "created" };
    }
    if (replay.status !== "fresh") return replay;
    if (!input.duplicateOverride) {
      const duplicates = await dependencies.repository.findPossibleDuplicates({
        ...actor,
        ...input,
        transaction,
      });
      if (duplicates.length > 0) {
        return { duplicates, status: "possible-duplicate" };
      }
    }
    const created = await persistRequested(
      actor,
      replay.id,
      input,
      transaction,
    );
    return "status" in created
      ? created
      : { person: created, status: "created" };
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
    const replay = await replayRequest(actor, requestId, input, transaction);
    if (replay.status === "replayed") {
      return { person: replay.person, status: "ready" };
    }
    if (replay.status !== "fresh") return replay;
    const created = await persistRequested(
      actor,
      replay.id,
      input,
      transaction,
    );
    return "status" in created ? created : { person: created, status: "ready" };
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
      rawInput: CreatePersonRequest,
    ): Promise<CreatePersonRequestResult> => {
      const { requestId: rawRequestId, ...identity } = rawInput;
      const input = normalizeCreatePersonInput(identity);
      const errors = validateCreatePersonInput(input);
      const requestId = rawRequestId === undefined
        ? undefined
        : uuid(rawRequestId);
      if (rawRequestId !== undefined && requestId === undefined) {
        return {
          errors: {
            ...errors,
            requestId: "Use a canonical request identifier.",
          },
          status: "validation-error",
        };
      }
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(
        (transaction) =>
          requestId === undefined
            ? createInTransaction(actor, input, transaction)
            : createRequested(actor, requestId, input, transaction),
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
