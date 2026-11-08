/**
 * Marking two people as not duplicates (REL-064, `PEOPLE-008`).
 *
 * The directory's duplicate review offers two people who share a name, an
 * email address, or a phone number. Two different people really can, so a
 * member may dismiss the pair, and the review stops offering it to every
 * member of the workspace. The decision is one `person_duplicate_dismissals`
 * row, stored lower person id first.
 *
 * It takes `people.write`, which every active role holds, so the member's
 * standing is revalidated under lock and nothing more; that revalidation is
 * also what proves `dismissed_by_member_id` is the actor's membership in the
 * pair's workspace, which the database's foreign key alone does not. Both
 * people must exist, undeleted, in that workspace, and are locked so a
 * concurrent merge sees the row or never races it. An archived person may be
 * dismissed: the decision changes nothing about them.
 *
 * Dismissing a dismissed pair succeeds and writes and audits nothing. A new
 * decision is audited as `people.duplicate-dismissed` in the same transaction,
 * naming only the two ids. There is no undo, as a merge has none: the review
 * is a suggestion, and a later edit can still make the pair look alike.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type { PersonDuplicateDismissalAudit } from "../ports/audit.ts";
import type { PeopleActor, PeopleTransactionRunner } from "../ports/context.ts";
import type { PersonDuplicateDismissalRepository } from "../ports/duplicate_dismissal.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface PersonDuplicateDismissalDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: PersonDuplicateDismissalAudit;
  readonly clock: Clock;
  readonly repository: PersonDuplicateDismissalRepository;
  readonly transaction: PeopleTransactionRunner;
}

export type DismissDuplicatePairResult =
  | {
    /** The pair as stored: lower id first. */
    readonly personIds: readonly [string, string];
    readonly status: "dismissed";
  }
  | Failure<"forbidden" | "not-found" | "unavailable", "same-person">;

export function createPersonDuplicateDismissals(
  dependencies: PersonDuplicateDismissalDependencies,
) {
  return {
    dismiss: async (
      actor: PeopleActor,
      personIds: readonly [string, string],
    ): Promise<DismissDuplicatePairResult> => {
      const [first, second] = personIds.map((id) => id.toLowerCase());
      if (first === undefined || second === undefined || first === second) {
        return { status: "same-person" };
      }
      const [personLowId, personHighId] = first < second
        ? [first, second]
        : [second, first];
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          const standing = await dependencies.actors.revalidate({
            ...actor,
            lock: true,
            transaction,
          });
          if (standing !== "active") return { status: "forbidden" as const };
          const pair = {
            personHighId,
            personLowId,
            transaction,
            workspaceId: actor.workspaceId,
          };
          const found = await dependencies.repository.lockPair(pair);
          if (found !== 2) return { status: "not-found" as const };
          const stored = await dependencies.repository.dismiss({
            ...pair,
            memberId: actor.memberId,
          });
          if (stored) {
            await dependencies.audit.record({
              actor,
              occurredAt: dependencies.clock.now(),
              personHighId,
              personLowId,
              transaction,
            });
          }
          return {
            personIds: [personLowId, personHighId] as const,
            status: "dismissed" as const,
          };
        },
        { workspaceId: actor.workspaceId },
      );
    },
  };
}

export type PersonDuplicateDismissals = ReturnType<
  typeof createPersonDuplicateDismissals
>;
