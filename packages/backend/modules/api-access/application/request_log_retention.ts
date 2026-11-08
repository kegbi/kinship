/**
 * API access's share of the retention job (SECA-04, BEQ-15, AUD-A2): the
 * request-log rows no throttle or budget reads any more, deleted in bounded
 * batches, with a backlog past the run's cap left to the next run.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import { requestLogRetentionCutoffs } from "../domain/request_log_retention.ts";
import type { RequestLogRetentionRepository } from "../ports/request_log_retention.ts";

export const REQUEST_LOG_RETENTION_BATCH = {
  maximumBatches: 100,
  size: 5_000,
} as const;

export function createRequestLogRetention(dependencies: {
  readonly batch?: { readonly maximumBatches: number; readonly size: number };
  readonly clock: Clock;
  readonly repository: RequestLogRetentionRepository;
}): { purge(): Promise<number> } {
  const batch = dependencies.batch ?? REQUEST_LOG_RETENTION_BATCH;
  return {
    async purge() {
      const cutoffs = requestLogRetentionCutoffs(dependencies.clock.now());
      let total = 0;
      for (let round = 0; round < batch.maximumBatches; round += 1) {
        const deleted = await dependencies.repository.deleteExpired({
          ...cutoffs,
          limit: batch.size,
        });
        total += deleted;
        if (deleted < batch.size) break;
      }
      return total;
    },
  };
}
