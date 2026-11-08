/**
 * Letting go of registrations nobody verified (SECA-04, AUD-A2).
 *
 * Identity names the pending registrations older than a week, locked for this
 * transaction, and this module decides which may go. A registration somebody
 * is still waiting on stays: one a pending, unexpired invitation is addressed
 * to, since the invitee may still verify it, and one with a membership in
 * anybody else's workspace, which a pending registration should never have
 * and this job will not be the one to break. The rest lose the workspaces they
 * were provisioned with before provisioning waited for verification, and
 * identity discards them with their tokens.
 *
 * Batches are walked in id order, each in its own transaction, so a
 * registration that stays is passed over rather than read again, and a run
 * meeting a backlog larger than its cap leaves the rest to the next one.
 *
 * The cursor lives only for one run: each run starts again from the lowest id,
 * so the registrations that stay are read again every hour. That costs a
 * bounded read per run, and keeps no state that a restart or a second worker
 * would have to agree on. It does mean that more held registrations than one
 * run's cap (`maximumBatches × size`) would stop the job reaching the ones
 * after them; held ones are rare — an invitee who has not verified yet — so a
 * run is far from that.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  authenticationRetentionCutoffs,
  type PendingRegistrationRetentionFacade,
} from "../../identity/public.ts";
import type { RegistrationTransactionRunner } from "../ports/context.ts";
import type { PendingRegistrationRetentionRepository } from "../ports/registration_retention.ts";

/** How many registrations one batch considers, and how many batches a run. */
export const REGISTRATION_RETENTION_BATCH = {
  maximumBatches: 50,
  size: 200,
} as const;

export function createStaleRegistrationPurge(dependencies: {
  readonly batch?: { readonly maximumBatches: number; readonly size: number };
  readonly clock: Clock;
  readonly identity: PendingRegistrationRetentionFacade;
  readonly repository: PendingRegistrationRetentionRepository;
  readonly transaction: RegistrationTransactionRunner;
}): { purge(): Promise<number> } {
  const batch = dependencies.batch ?? REGISTRATION_RETENTION_BATCH;
  return {
    async purge() {
      const now = dependencies.clock.now();
      const createdBefore =
        authenticationRetentionCutoffs(now).pendingRegistrationsBefore;
      let afterUserId: string | undefined;
      let discarded = 0;
      for (let round = 0; round < batch.maximumBatches; round += 1) {
        const page = await dependencies.transaction.run(async (transaction) => {
          const stale = await dependencies.identity.listStalePendingUsers({
            ...(afterUserId === undefined ? {} : { afterUserId }),
            createdBefore,
            limit: batch.size,
            transaction,
          });
          const held = await dependencies.repository.heldPendingRegistrations(
            { now, transaction, users: stale },
          );
          const userIds = stale.map((user) => user.userId)
            .filter((userId) => !held.has(userId));
          if (userIds.length > 0) {
            await dependencies.repository.deletePendingWorkspaces({
              transaction,
              userIds,
            });
          }
          const count = await dependencies.identity.discardPendingUsers({
            transaction,
            userIds,
          });
          return { count, last: stale.at(-1)?.userId, size: stale.length };
        });
        discarded += page.count;
        afterUserId = page.last;
        if (page.size < batch.size) break;
      }
      return discarded;
    },
  };
}
