/**
 * Keeping a person's remembered dates.
 *
 * Every write here follows the same order, and the order is the point: the
 * value is normalized and validated before a transaction is opened at all, the
 * actor is revalidated under lock, the person context is locked, the date row
 * is locked and checked against the revision the caller expected, and only
 * then is anything written. Afterwards the reminders the date implies are
 * regenerated, the event is recorded, and both the row and the event are read
 * back before the transaction may commit.
 *
 * Deleting is the one asymmetry: the reminders are regenerated before the row
 * disappears, because the publisher needs to see what it is retiring.
 *
 * What a date may say lives in `domain/important_dates/rules.ts`.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import { isInstant } from "../../../shared-kernel/validation.ts";
import {
  type ImportantDateAction,
  type ImportantDateRecord,
  type ImportantDateValue,
  normalizeImportantDate,
  validateImportantDate,
} from "../domain/important_dates/rules.ts";
import type { ImportantDateAudit } from "../ports/audit.ts";
import type {
  PeopleActor,
  PeopleTransaction,
  PeopleTransactionRunner,
} from "../ports/context.ts";
import type {
  ImportantDateContextLock,
  ImportantDatePublisher,
  ImportantDateRepository,
} from "../ports/important_date_repository.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface ImportantDateDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: ImportantDateAudit;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly publisher: ImportantDatePublisher;
  readonly repository: ImportantDateRepository;
  readonly transaction: PeopleTransactionRunner;
}

export interface ImportantDateUpdateInput extends ImportantDateValue {
  readonly expectedUpdatedAt: string;
}

export interface ImportantDateDeleteInput {
  readonly expectedUpdatedAt: string;
}

export type ImportantDateFailure = Failure<
  "archived-write-rejected" | "conflict" | "forbidden" | "not-found",
  "stale"
>;

export type ImportantDateMutationResult =
  | ImportantDateFailure
  | ValidationFailure
  | { readonly date: ImportantDateRecord; readonly status: "created" }
  | { readonly date: ImportantDateRecord; readonly status: "updated" }
  | { readonly dateId: string; readonly status: "deleted" };
type ImportantDateMutationFailure = ImportantDateFailure | ValidationFailure;
export type ImportantDateCreateResult = ImportantDateMutationFailure | {
  readonly date: ImportantDateRecord;
  readonly status: "created";
};
export type ImportantDateUpdateResult = ImportantDateMutationFailure | {
  readonly date: ImportantDateRecord;
  readonly status: "updated";
};
export type ImportantDateDeleteResult = ImportantDateMutationFailure | {
  readonly dateId: string;
  readonly status: "deleted";
};

export type ImportantDateListResult =
  | Failure<"forbidden" | "not-found">
  | {
    readonly dates: readonly ImportantDateRecord[];
    readonly status: "archived" | "ready";
  };

function contextFailure(context: ImportantDateContextLock) {
  if (context.status === "archived") {
    return { status: "archived-write-rejected" as const };
  }
  return context.status === "forbidden"
    ? { status: "forbidden" as const }
    : { status: "not-found" as const };
}

export function createImportantDateManagement(
  dependencies: ImportantDateDependencies,
) {
  const persist = async (
    actor: PeopleActor,
    personId: string,
    action: ImportantDateAction,
    transaction: PeopleTransaction,
    occurredAt: Date,
    before: ImportantDateRecord | undefined,
    after: ImportantDateRecord | undefined,
    publish = true,
  ) => {
    if (publish) {
      await dependencies.publisher.regenerate({
        ...actor,
        ...(after ? { after } : {}),
        ...(before ? { before } : {}),
        occurredAt,
        transaction,
      });
    }
    const auditCommand = {
      action,
      actor,
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      occurredAt,
      transaction,
    };
    const auditId = await dependencies.audit.record(auditCommand);
    await dependencies.repository.assertPostcondition({
      action,
      ...actor,
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      occurredAt,
      personId,
      transaction,
    });
    await dependencies.audit.assertPostcondition({ ...auditCommand, auditId });
  };

  /**
   * Revalidates the actor under lock before the person context is read, so a
   * revocation committed mid-request cannot reach a write.
   */
  const lockContext = async (
    actor: PeopleActor,
    personId: string,
    transaction: PeopleTransaction,
  ): Promise<ImportantDateContextLock> => {
    const standing = await dependencies.actors.revalidate({
      ...actor,
      lock: true,
      transaction,
    });
    if (standing === "revoked") return { status: "forbidden" };
    return await dependencies.repository.lockContext({
      ...actor,
      personId,
      transaction,
    });
  };

  return {
    list: (
      actor: PeopleActor,
      personId: string,
    ): Promise<ImportantDateListResult> =>
      dependencies.transaction.run(async (transaction) => {
        const context = await lockContext(actor, personId, transaction);
        if (context.status === "forbidden" || context.status === "not-found") {
          return { status: context.status };
        }
        return {
          dates: await dependencies.repository.list({
            ...actor,
            personId,
            transaction,
          }),
          status: context.status,
        };
      }, { workspaceId: actor.workspaceId }),
    create: async (
      actor: PeopleActor,
      personId: string,
      rawValue: ImportantDateValue,
    ): Promise<ImportantDateCreateResult> => {
      const value = normalizeImportantDate(rawValue);
      const errors = validateImportantDate(value);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const context = await lockContext(actor, personId, transaction);
        if (context.status !== "ready") return contextFailure(context);
        const occurredAt = dependencies.clock.now();
        const date = await dependencies.repository.create({
          ...actor,
          id: dependencies.ids.create(),
          occurredAt,
          personId,
          transaction,
          value,
        });
        if (!date) return { status: "conflict" };
        await persist(
          actor,
          personId,
          "create",
          transaction,
          occurredAt,
          undefined,
          date,
        );
        return { date, status: "created" };
      }, { workspaceId: actor.workspaceId });
    },
    update: async (
      actor: PeopleActor,
      personId: string,
      dateId: string,
      rawInput: ImportantDateUpdateInput,
    ): Promise<ImportantDateUpdateResult> => {
      const { expectedUpdatedAt, ...rawValue } = rawInput;
      const value = normalizeImportantDate(rawValue);
      const errors = validateImportantDate(value);
      if (!isInstant(expectedUpdatedAt)) {
        return {
          errors: { expectedUpdatedAt: "Refresh this date before saving." },
          status: "validation-error",
        };
      }
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const context = await lockContext(actor, personId, transaction);
        if (context.status !== "ready") return contextFailure(context);
        const locked = await dependencies.repository.lockDate({
          ...actor,
          dateId,
          personId,
          transaction,
        });
        if (locked.status === "not-found") return locked;
        if (locked.date.updatedAt !== expectedUpdatedAt) {
          return { status: "stale" };
        }
        const occurredAt = dependencies.clock.now();
        const date = await dependencies.repository.update({
          ...actor,
          dateId,
          expectedUpdatedAt,
          occurredAt,
          personId,
          transaction,
          value,
        });
        if (!date) return { status: "conflict" };
        await persist(
          actor,
          personId,
          "update",
          transaction,
          occurredAt,
          locked.date,
          date,
        );
        return { date, status: "updated" };
      }, { workspaceId: actor.workspaceId });
    },
    delete: async (
      actor: PeopleActor,
      personId: string,
      dateId: string,
      input: ImportantDateDeleteInput,
    ): Promise<ImportantDateDeleteResult> => {
      if (!isInstant(input.expectedUpdatedAt)) {
        return {
          errors: { expectedUpdatedAt: "Refresh this date before deleting." },
          status: "validation-error",
        };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const context = await lockContext(actor, personId, transaction);
        if (context.status !== "ready") return contextFailure(context);
        const locked = await dependencies.repository.lockDate({
          ...actor,
          dateId,
          personId,
          transaction,
        });
        if (locked.status === "not-found") return locked;
        if (locked.date.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const occurredAt = dependencies.clock.now();
        await dependencies.publisher.regenerate({
          ...actor,
          before: locked.date,
          occurredAt,
          transaction,
        });
        const deleted = await dependencies.repository.delete({
          ...actor,
          dateId,
          expectedUpdatedAt: input.expectedUpdatedAt,
          occurredAt,
          personId,
          transaction,
        });
        if (!deleted) return { status: "stale" };
        await persist(
          actor,
          personId,
          "delete",
          transaction,
          occurredAt,
          locked.date,
          undefined,
          false,
        );
        return { dateId, status: "deleted" };
      }, { workspaceId: actor.workspaceId });
    },
  };
}

export type ImportantDateManagement = ReturnType<
  typeof createImportantDateManagement
>;
