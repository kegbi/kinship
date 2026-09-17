/**
 * Creating a relationship, creating the person on the other end of one,
 * changing the type an edge points at, and unlinking it.
 *
 * Creation is idempotent in the way the graph allows: the repository answers
 * with nothing when the edge already exists, so the existing edge is read back
 * and reported as `existing` rather than as a conflict. A change and an unlink
 * are optimistic instead — the caller says which revision it composed against,
 * and a row that moved since is refused as stale.
 *
 * `createRelatedPerson` is the one path that spans two modules. The person and
 * the edge are written in one transaction, so a relationship that cannot be
 * created takes the person with it; the abort below is how a failure that is
 * not an exception still rolls the transaction back, and it is unwrapped into
 * the ordinary failure result the caller expects.
 */

import {
  decorate,
  type RelationshipMutation,
  success,
  validateEndpoints,
  validateRevision,
} from "../domain/relationship_rules.ts";
import type {
  RelationshipActor,
  RelationshipTransaction,
} from "../ports/context.ts";
import {
  active,
  auditRelationship,
  inspectMutation,
  type MutationFailure,
  type RelationshipDependencies,
} from "./relationship_context.ts";
import type {
  CreatePersonInput,
  CreatePersonResult,
  PersonIdentity,
} from "../../people/public.ts";

type RelatedPersonFailure =
  | Exclude<CreatePersonResult, { readonly status: "created" }>
  | MutationFailure;

export type RelatedPersonRelationshipResult =
  | RelatedPersonFailure
  | (RelationshipMutation & {
    readonly person: PersonIdentity;
    readonly status: "created";
  });

class RelatedPersonAbort extends Error {
  constructor(readonly result: RelatedPersonFailure) {
    super("Atomic related-person creation aborted.");
  }
}

export interface CreateRelationshipInput {
  readonly relationshipTypeId: string;
  readonly targetPersonId: string;
}

export interface UpdateRelationshipInput {
  readonly expectedUpdatedAt: string;
  readonly relationshipTypeId: string;
}

export function createRelationshipWrites(
  dependencies: RelationshipDependencies,
) {
  const createInTransaction = async (
    actor: RelationshipActor,
    sourcePersonId: string,
    input: CreateRelationshipInput,
    transaction: RelationshipTransaction,
  ): Promise<
    | MutationFailure
    | (RelationshipMutation & { readonly status: "created" | "existing" })
  > => {
    const errors = validateEndpoints(sourcePersonId, input.targetPersonId);
    if (Object.keys(errors).length > 0) {
      return { errors, status: "validation-error" };
    }
    if (!await active(dependencies, actor, transaction, true)) {
      return { status: "forbidden" };
    }
    const context = await inspectMutation(dependencies, actor, transaction, [
      sourcePersonId,
      input.targetPersonId,
    ], input.relationshipTypeId);
    if (context.status !== "ready") return context;
    if (!context.type) return { status: "not-found" };
    const occurredAt = dependencies.clock.now();
    const record = await dependencies.repository.create({
      ...actor,
      id: dependencies.ids.create(),
      occurredAt,
      sourcePersonId,
      targetPersonId: input.targetPersonId,
      transaction,
      type: context.type,
    });
    if (!record) {
      const existing = await dependencies.repository.findExact({
        ...actor,
        relationshipTypeId: input.relationshipTypeId,
        sourcePersonId,
        targetPersonId: input.targetPersonId,
        transaction,
      });
      return existing
        ? success(decorate(existing, context.type), "existing")
        : { status: "stale" };
    }
    await auditRelationship(
      dependencies,
      "create",
      actor,
      transaction,
      occurredAt,
      undefined,
      record,
    );
    return success(record, "created");
  };
  return {
    create: async (
      actor: RelationshipActor,
      sourcePersonId: string,
      input: CreateRelationshipInput,
    ): Promise<
      | MutationFailure
      | (RelationshipMutation & { readonly status: "created" | "existing" })
    > =>
      await dependencies.transaction.run((transaction) =>
        createInTransaction(actor, sourcePersonId, input, transaction)
      ),
    createRelatedPerson: async (
      actor: RelationshipActor,
      sourcePersonId: string,
      input: {
        readonly person: CreatePersonInput;
        readonly relationshipTypeId: string;
      },
    ): Promise<RelatedPersonRelationshipResult> => {
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const defaults = await dependencies.workspace
            .ensureDefaultRelationshipTypes({ ...actor, transaction });
          if (defaults.status !== "ready") return { status: "forbidden" };
          const person = await dependencies.peopleCreation.createInTransaction(
            actor,
            input.person,
            transaction,
          );
          if (person.status !== "created") return person;
          const relationship = await createInTransaction(
            actor,
            sourcePersonId,
            {
              relationshipTypeId: input.relationshipTypeId,
              targetPersonId: person.person.id,
            },
            transaction,
          );
          if (!("relationship" in relationship)) {
            throw new RelatedPersonAbort(relationship);
          }
          return {
            ...relationship,
            person: person.person,
            status: "created" as const,
          };
        });
      } catch (error) {
        if (error instanceof RelatedPersonAbort) return error.result;
        throw error;
      }
    },
    update: async (
      actor: RelationshipActor,
      personId: string,
      relationshipId: string,
      input: UpdateRelationshipInput,
    ): Promise<
      MutationFailure | (RelationshipMutation & { readonly status: "updated" })
    > => {
      const errors = validateRevision(input.expectedUpdatedAt, "save");
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const observed = await dependencies.repository.get({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (!observed) return { status: "not-found" };
        const context = await inspectMutation(
          dependencies,
          actor,
          transaction,
          [
            observed.fromPersonId,
            observed.toPersonId,
          ],
          input.relationshipTypeId,
        );
        if (context.status !== "ready") return context;
        if (!context.type) return { status: "not-found" };
        const locked = await dependencies.repository.lockRelationship({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        if (locked.relationship.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const occurredAt = dependencies.clock.now();
        const record = await dependencies.repository.update({
          ...actor,
          occurredAt,
          relationshipId,
          transaction,
          type: context.type,
        });
        if (!record) return { status: "stale" };
        await auditRelationship(
          dependencies,
          "update",
          actor,
          transaction,
          occurredAt,
          locked.relationship,
          record,
        );
        return success(record, "updated");
      });
    },
    delete: async (
      actor: RelationshipActor,
      personId: string,
      relationshipId: string,
      input: { readonly expectedUpdatedAt: string },
    ) => {
      const errors = validateRevision(input.expectedUpdatedAt, "unlink");
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" as const };
      }
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const observed = await dependencies.repository.get({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (!observed) return { status: "not-found" as const };
        const context = await inspectMutation(
          dependencies,
          actor,
          transaction,
          [
            observed.fromPersonId,
            observed.toPersonId,
          ],
        );
        if (context.status !== "ready") return context;
        const locked = await dependencies.repository.lockRelationship({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        if (locked.relationship.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" as const };
        }
        const occurredAt = dependencies.clock.now();
        if (
          !(await dependencies.repository.delete({
            ...actor,
            relationshipId,
            transaction,
          }))
        ) return { status: "stale" as const };
        await auditRelationship(
          dependencies,
          "delete",
          actor,
          transaction,
          occurredAt,
          locked.relationship,
          undefined,
        );
        return {
          affectedPersonIds: [
            locked.relationship.fromPersonId,
            locked.relationship.toPersonId,
          ] as const,
          relationshipId,
          status: "deleted" as const,
        };
      });
    },
  };
}
