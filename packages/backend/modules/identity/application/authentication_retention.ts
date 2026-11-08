/**
 * Identity's share of the retention job (SECA-04, BEQ-15, AUD-A2).
 *
 * One run deletes every session that ended more than thirty days ago, and
 * every reset request and spent verification token older than a week, in
 * batches small enough that no statement holds anything for long. A run that
 * meets a larger backlog than `maximumBatches` allows leaves the rest to the
 * next one rather than running for ever.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import { authenticationRetentionCutoffs } from "../domain/identity_rules.ts";
import type {
  AuthenticationRetentionRepository,
  RetentionBatch,
} from "../ports/retention.ts";

/** How many rows one statement deletes, and how many statements a run sends. */
export const RETENTION_BATCH = { maximumBatches: 100, size: 1_000 } as const;

export interface AuthenticationRetentionResult {
  readonly endedSessions: number;
  readonly resetRequests: number;
  readonly spentVerificationTokens: number;
}

export function createAuthenticationRetention(dependencies: {
  readonly clock: Clock;
  readonly repository: AuthenticationRetentionRepository;
}): { purge(): Promise<AuthenticationRetentionResult> } {
  return {
    async purge() {
      const cutoffs = authenticationRetentionCutoffs(dependencies.clock.now());
      const repository = dependencies.repository;
      return {
        endedSessions: await drain(
          (batch) => repository.deleteEndedSessions(batch),
          cutoffs.endedSessionsBefore,
        ),
        resetRequests: await drain(
          (batch) => repository.deleteResetRequests(batch),
          cutoffs.tokensBefore,
        ),
        spentVerificationTokens: await drain(
          (batch) => repository.deleteSpentVerificationTokens(batch),
          cutoffs.tokensBefore,
        ),
      };
    },
  };
}

/** Deletes in batches until one comes back short, or the run's cap. */
export async function drain(
  remove: (batch: RetentionBatch) => Promise<number>,
  before: Date,
  batch: { readonly maximumBatches: number; readonly size: number } =
    RETENTION_BATCH,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < batch.maximumBatches; round += 1) {
    const deleted = await remove({ before, limit: batch.size });
    total += deleted;
    if (deleted < batch.size) break;
  }
  return total;
}
