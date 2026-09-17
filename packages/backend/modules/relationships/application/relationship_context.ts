/**
 * What reading or writing a relationship needs before it may proceed.
 *
 * Every path starts by revalidating the actor inside the caller's transaction,
 * and every write then asks the same three questions in the same order: does
 * the workspace have its default vocabulary, may this actor use the type the
 * edge points at, and may both people be written to. Those steps, and the
 * audit-with-postcondition that closes a write, were written out four times
 * inside one 830-line file; they are written once here.
 *
 * The lock flag is the whole difference between the halves. A write locks the
 * actor's rows, the type, and both people for the rest of the transaction; a
 * read keeps the lock-free concurrency the listings always had.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import type {
  RelationshipRecord,
  RelationshipTypeOption,
} from "../domain/relationship_rules.ts";
import type { RelationshipAudit } from "../ports/audit.ts";
import type {
  RelationshipActor,
  RelationshipTransaction,
  RelationshipTransactionRunner,
} from "../ports/context.ts";
import type { RelationshipRepository } from "../ports/relationship_repository.ts";
import type {
  RelationshipPersonBoundary,
  TransactionalPeopleCreation,
} from "../../people/public.ts";
import type {
  ActorRevalidation,
  RelationshipWorkspaceBoundary,
} from "../../workspaces/public.ts";

export interface RelationshipDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: RelationshipAudit;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly people: RelationshipPersonBoundary;
  readonly peopleCreation: TransactionalPeopleCreation;
  readonly repository: RelationshipRepository;
  readonly transaction: RelationshipTransactionRunner;
  readonly workspace: RelationshipWorkspaceBoundary;
}

/** Every way a relationship write can fail. */
export type MutationFailure =
  | Failure<"archived-write-rejected" | "forbidden" | "not-found", "stale">
  | ValidationFailure;

/** The context a write proceeds in, with the type it is allowed to use. */
export type MutationContext =
  | MutationFailure
  | {
    readonly status: "ready";
    readonly type?: RelationshipTypeOption;
  };

/**
 * The actor's standing, asked first inside the caller's transaction. Write
 * paths lock the actor's rows; read paths keep their lock-free concurrency.
 */
export async function active(
  dependencies: Pick<RelationshipDependencies, "actors">,
  actor: RelationshipActor,
  transaction: RelationshipTransaction,
  lock: boolean,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock,
    transaction,
  }) === "active";
}

/**
 * Whether a write may proceed, and against which relationship type.
 *
 * A workspace that hides the section and one that refuses the actor are both
 * reported as forbidden, so a caller cannot tell a hidden feature from a
 * missing permission. The type is returned only when one was asked for, which
 * is why an unlink — which names no type — is answered with `ready` alone.
 */
export async function inspectMutation(
  dependencies: Pick<RelationshipDependencies, "people" | "workspace">,
  actor: RelationshipActor,
  transaction: RelationshipTransaction,
  personIds: readonly string[],
  relationshipTypeId?: string,
): Promise<MutationContext> {
  const defaults = await dependencies.workspace
    .ensureDefaultRelationshipTypes({ ...actor, transaction });
  if (defaults.status !== "ready") return { status: "forbidden" };
  const workspace = await dependencies.workspace.inspect({
    ...actor,
    lock: true,
    ...(relationshipTypeId ? { relationshipTypeId } : {}),
    transaction,
  });
  if (workspace.status === "forbidden" || workspace.status === "hidden") {
    return { status: "forbidden" };
  }
  if (workspace.status === "not-found") return { status: "not-found" };
  const people = await dependencies.people.inspect({
    ...actor,
    lock: true,
    personIds,
    transaction,
  });
  if (people.status === "not-found") return { status: "not-found" };
  if (people.status === "archived") {
    return { status: "archived-write-rejected" };
  }
  const type = workspace.status === "ready" ? workspace.type : undefined;
  return { status: "ready", ...(type ? { type } : {}) };
}

/**
 * Records the audit event a write owes and proves both rows are there.
 *
 * The repository and the recorder each read their own write back inside the
 * transaction, so a write that silently did nothing cannot commit as an
 * audited success.
 */
export async function auditRelationship(
  dependencies: Pick<RelationshipDependencies, "audit" | "repository">,
  action: "create" | "delete" | "update",
  actor: RelationshipActor,
  transaction: RelationshipTransaction,
  occurredAt: Date,
  before: RelationshipRecord | undefined,
  after: RelationshipRecord | undefined,
): Promise<void> {
  const command = {
    action,
    actor,
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
    occurredAt,
    transaction,
  };
  const auditId = await dependencies.audit.record(command);
  await dependencies.repository.assertPostcondition({
    action,
    ...actor,
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
    transaction,
  });
  await dependencies.audit.assertPostcondition({ ...command, auditId });
}
