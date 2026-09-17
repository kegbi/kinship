/**
 * What reading or writing a profile fact needs before it may proceed.
 *
 * Both halves of the section — the listing and the three writes — start the
 * same way: revalidate the actor, then read the person the facts hang off and
 * the workspace configuration for the section. Those two steps were written
 * twice inside one 995-line file; they are written once here, and the two
 * use-case files that follow are left with their own work.
 *
 * The lock flag is the whole difference between the halves. A write locks the
 * actor's rows and the person for the rest of the transaction; a read keeps
 * the lock-free concurrency the listing always had.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type { ProfileFactAudit } from "../ports/audit.ts";
import type {
  PeopleActor,
  PeopleTransaction,
  PeopleTransactionRunner,
} from "../ports/context.ts";
import type {
  ProfileFactContextLock,
  ProfileFactInspectionCommand,
  ProfileFactOrganizationBoundary,
  ProfileFactRepository,
  ProfileFactWorkspaceBoundary,
  ProfileFactWorkspaceInspection,
} from "../ports/profile_fact_repository.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface ProfileFactDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: ProfileFactAudit;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly organizations: ProfileFactOrganizationBoundary;
  readonly repository: ProfileFactRepository;
  readonly transaction: PeopleTransactionRunner;
  readonly workspace: ProfileFactWorkspaceBoundary;
}

/**
 * The vocabulary this section is validated against.
 *
 * The workspace answers first, because it also decides whether the section is
 * visible at all. Only the work section has a second vocabulary, and only when
 * options are actually wanted, so the organization boundary is asked exactly
 * then and never otherwise.
 */
export async function inspectConfiguration(
  dependencies: Pick<ProfileFactDependencies, "organizations" | "workspace">,
  command: ProfileFactInspectionCommand,
): Promise<ProfileFactWorkspaceInspection> {
  const workspace = await dependencies.workspace.inspect(command);
  if (
    workspace.status !== "ready" || command.section !== "work" ||
    (command.includeOptions !== true && command.value === undefined &&
      !command.selectedOptionIds?.length)
  ) return workspace;
  return dependencies.organizations.inspect(command);
}

/**
 * Revalidates the actor before the person context is read.
 *
 * Write paths lock the actor's rows for the rest of the transaction; the read
 * path keeps the lock-free concurrency it always had.
 */
export async function profileFactContext(
  dependencies: Pick<ProfileFactDependencies, "actors" | "repository">,
  actor: PeopleActor,
  personId: string,
  transaction: PeopleTransaction,
  lock: boolean,
): Promise<ProfileFactContextLock> {
  const standing = await dependencies.actors.revalidate({
    ...actor,
    lock,
    transaction,
  });
  if (standing === "revoked") return { status: "forbidden" };
  const command = { ...actor, personId, transaction };
  return lock
    ? await dependencies.repository.lockContext(command)
    : await dependencies.repository.inspectContext(command);
}
