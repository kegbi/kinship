/**
 * Clearing a reminder the member was never told about (REL-088).
 *
 * An occurrence whose delivery `failed` or needs `manual_attention` stays in
 * the member's Today attention queue, because nothing else ends it: the
 * worker never claims either state again. Acknowledging it moves it to the
 * schema's existing `skipped` state, which the attention queue, Today's
 * reminder panel, and the calendar feed already leave out, and which a
 * regenerated window never revives.
 *
 * It is acknowledged rather than retried. A failed delivery was refused or
 * ran out of attempts, and a `manual_attention` one may already have reached
 * the member: resending it is exactly what the delivery lifecycle promises
 * never to do.
 *
 * Only the member it was generated for may acknowledge it, whatever their
 * role, because it is their own delivery rather than the person's record; an
 * archived person's undelivered reminder may be cleared too, since the queue
 * still lists it. A replay answers `acknowledged` again without a second
 * audit event.
 */

import type { PlanningActor } from "../ports/context.ts";
import {
  actorIsActive,
  type ReminderManagementDependencies,
} from "./reminder_context.ts";

export type AcknowledgeOccurrenceResult =
  | { readonly occurrenceId: string; readonly status: "acknowledged" }
  | { readonly status: "forbidden" | "not-found" | "stale" };

export function createReminderOccurrences(
  dependencies: Pick<
    ReminderManagementDependencies,
    "actors" | "audit" | "clock" | "repository" | "transaction"
  >,
) {
  return {
    acknowledge: async (
      actor: PlanningActor,
      occurrenceId: string,
    ): Promise<AcknowledgeOccurrenceResult> => {
      const id = occurrenceId.toLowerCase();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const occurredAt = dependencies.clock.now();
        const outcome = await dependencies.repository.acknowledgeUndelivered({
          ...actor,
          id,
          now: occurredAt,
          transaction,
        });
        if (!outcome) return { status: "not-found" };
        if (outcome === "stale") return { status: "stale" };
        if (outcome === "acknowledged") {
          await dependencies.audit.record({
            action: "acknowledged",
            actor,
            occurredAt,
            subjectId: id,
            transaction,
          });
        }
        return { occurrenceId: id, status: "acknowledged" };
      });
    },
  };
}
