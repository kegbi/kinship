import { assertEquals } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import {
  REQUEST_LOG_RETENTION,
  requestLogRetentionCutoffs,
} from "../domain/request_log_retention.ts";
import type { RequestLogRetentionBatch } from "../ports/request_log_retention.ts";
import { createRequestLogRetention } from "./request_log_retention.ts";

Deno.test("[AUD-A2] throttle rows live an hour and mail-budget rows two days", () => {
  assertEquals(REQUEST_LOG_RETENTION, {
    mailBudgetMilliseconds: 172_800_000,
    requestMilliseconds: 3_600_000,
  });
  const cutoffs = requestLogRetentionCutoffs(
    new Date("2026-11-08T12:00:00.000Z"),
  );
  assertEquals(
    [
      cutoffs.mailBudgetBefore.toISOString(),
      cutoffs.requestsBefore.toISOString(),
    ],
    ["2026-11-06T12:00:00.000Z", "2026-11-08T11:00:00.000Z"],
  );
});

Deno.test("[AUD-A2] the request log is drained in batches up to the run's cap", async () => {
  for (
    const [sizes, expected] of [
      [[3, 3, 1], [7, 3]],
      [[3, 3, 3, 3, 3], [9, 3]],
      [[0], [0, 1]],
    ] as const
  ) {
    const batches: RequestLogRetentionBatch[] = [];
    const retention = createRequestLogRetention({
      batch: { maximumBatches: 3, size: 3 },
      clock: fixedClock("2026-11-08T12:00:00.000Z"),
      repository: {
        deleteExpired(batch) {
          batches.push(batch);
          return Promise.resolve(sizes[batches.length - 1] ?? 0);
        },
      },
    });
    assertEquals([await retention.purge(), batches.length], [...expected]);
    assertEquals(
      batches[0]?.requestsBefore.toISOString(),
      "2026-11-08T11:00:00.000Z",
    );
    assertEquals(batches[0]?.limit, 3);
  }
});
