import { assertEquals } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import {
  createAuthenticationRetention,
  drain,
  RETENTION_BATCH,
} from "./authentication_retention.ts";
import type { RetentionBatch } from "../ports/retention.ts";

Deno.test("[AUD-A2] each kind of row is purged before its own window", async () => {
  const calls: string[] = [];
  const record = (kind: string) => (batch: RetentionBatch) => {
    calls.push(`${kind}:${batch.before.toISOString()}:${batch.limit}`);
    return Promise.resolve(kind === "sessions" ? 3 : 0);
  };
  const retention = createAuthenticationRetention({
    clock: fixedClock("2026-11-08T12:00:00.000Z"),
    repository: {
      deleteEndedSessions: record("sessions"),
      deleteResetRequests: record("resets"),
      deleteSpentVerificationTokens: record("tokens"),
    },
  });
  assertEquals(await retention.purge(), {
    endedSessions: 3,
    resetRequests: 0,
    spentVerificationTokens: 0,
  });
  assertEquals(calls, [
    `sessions:2026-10-09T12:00:00.000Z:${RETENTION_BATCH.size}`,
    `resets:2026-11-01T12:00:00.000Z:${RETENTION_BATCH.size}`,
    `tokens:2026-11-01T12:00:00.000Z:${RETENTION_BATCH.size}`,
  ]);
});

Deno.test("[AUD-A2] a backlog is drained in full batches until one comes back short", async () => {
  const sizes = [2, 2, 1, 2];
  let calls = 0;
  const total = await drain(
    () => Promise.resolve(sizes[calls++] ?? 0),
    new Date(0),
    { maximumBatches: 10, size: 2 },
  );
  assertEquals([total, calls], [5, 3]);
});

Deno.test("[AUD-A2] a run stops at its batch cap and leaves the rest to the next", async () => {
  let calls = 0;
  const total = await drain(
    () => {
      calls += 1;
      return Promise.resolve(2);
    },
    new Date(0),
    { maximumBatches: 3, size: 2 },
  );
  assertEquals([total, calls], [6, 3]);
});
