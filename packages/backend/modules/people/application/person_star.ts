/**
 * Starring a person, and taking the star away (GAP-053, `PEOPLE-010`).
 *
 * The star is `people.is_starred`: one flag the whole workspace shares, not a
 * per-member favourite. Setting it takes `people.write`, which every active
 * role holds, so the member's standing is revalidated and nothing more.
 *
 * An archived person is read-only for their star exactly as for their avatar
 * and tags: both directions are refused until they are restored, and the
 * star they had when archived is kept. Setting the state a person already has
 * writes and audits nothing, so a repeated request is harmless. A change is
 * audited as `people.person-starred` or `people.person-unstarred` in the same
 * transaction, and does not move the person's revision.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type { PersonStarAudit } from "../ports/audit.ts";
import type { PeopleActor, PeopleTransactionRunner } from "../ports/context.ts";
import type { PersonStarRepository } from "../ports/star.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface PersonStarDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: PersonStarAudit;
  readonly clock: Clock;
  readonly repository: PersonStarRepository;
  readonly transaction: PeopleTransactionRunner;
}

export type SetPersonStarResult =
  | { readonly isStarred: boolean; readonly status: "ready" }
  | Failure<
    "archived-write-rejected" | "forbidden" | "not-found" | "unavailable"
  >;

export function createPersonStarManagement(
  dependencies: PersonStarDependencies,
) {
  return {
    set: (
      actor: PeopleActor,
      personId: string,
      starred: boolean,
    ): Promise<SetPersonStarResult> =>
      runOrUnavailable(dependencies.transaction, async (transaction) => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing !== "active") return { status: "forbidden" as const };
        const locked = await dependencies.repository.lock({
          ...actor,
          personId,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        if (locked.archived) {
          return { status: "archived-write-rejected" as const };
        }
        if (locked.starred !== starred) {
          await dependencies.repository.save({
            ...actor,
            personId,
            starred,
            transaction,
          });
          await dependencies.audit.record({
            action: starred ? "starred" : "unstarred",
            actor,
            occurredAt: dependencies.clock.now(),
            personId,
            transaction,
          });
        }
        return { isStarred: starred, status: "ready" as const };
      }),
  };
}

export type PersonStarManagement = ReturnType<
  typeof createPersonStarManagement
>;
