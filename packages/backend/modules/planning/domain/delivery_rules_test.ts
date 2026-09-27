import { assertEquals } from "../../../testing/assert.ts";
import {
  type ClaimedReminderOccurrence,
  deliveryAuditAction,
  deliveryChannels,
  deliveryLimits,
  deliveryOutcome,
  digestWindow,
  nextAttemptAt,
  planDeliveryUnits,
  type ProviderDeliveryResult,
  safeCode,
} from "./delivery_rules.ts";

const finalizedAt = new Date("2026-05-04T09:00:00.000Z");

function outcome(input: {
  readonly attemptCount?: number;
  readonly maxAttempts?: number;
  readonly reconciling?: boolean;
  readonly result: ProviderDeliveryResult;
}) {
  return deliveryOutcome({
    attemptCount: input.attemptCount ?? 1,
    finalizedAt,
    maxAttempts: input.maxAttempts ?? 4,
    reconciling: input.reconciling ?? false,
    result: input.result,
    retryBaseMilliseconds: 30_000,
  });
}

Deno.test("[GAP-016] a provider error code is reduced to something safe to store", () => {
  assertEquals(
    safeCode({ code: "rate limited!", status: "transient" }),
    "rate_limited_",
  );
  assertEquals(
    safeCode({ code: "a.b:c-d_e", status: "rejected" }),
    "a.b:c-d_e",
    "the safe alphabet survives untouched",
  );
  assertEquals(
    safeCode({ code: "!!!", status: "ambiguous" }).length,
    3,
    "unsafe characters become placeholders rather than vanishing",
  );
  assertEquals(safeCode({ code: "", status: "transient" }), "provider-error");
  assertEquals(
    safeCode({ code: "x".repeat(200), status: "transient" }).length,
    120,
    "a long code is bounded",
  );
});

Deno.test("[GAP-016] one tick's bounds are clamped rather than refused", () => {
  assertEquals(deliveryLimits({ owner: "worker" }), {
    leaseMilliseconds: 30_000,
    limit: 20,
    maxAttempts: 4,
    owner: "worker",
    retryBaseMilliseconds: 30_000,
  });
  assertEquals(
    deliveryLimits({
      leaseMilliseconds: 1,
      limit: 0,
      maxAttempts: 0,
      owner: "o".repeat(200),
      retryBaseMilliseconds: 1,
    }),
    {
      leaseMilliseconds: 1_000,
      limit: 1,
      maxAttempts: 1,
      owner: "o".repeat(120),
      retryBaseMilliseconds: 1_000,
    },
  );
  assertEquals(
    deliveryLimits({
      leaseMilliseconds: 10_000_000,
      limit: 1_000,
      maxAttempts: 1_000,
      owner: "worker",
      retryBaseMilliseconds: 10_000_000,
    }),
    {
      leaseMilliseconds: 300_000,
      limit: 100,
      maxAttempts: 20,
      owner: "worker",
      retryBaseMilliseconds: 3_600_000,
    },
  );
  assertEquals(deliveryLimits({ limit: 20.9, owner: "worker" }).limit, 20);
});

Deno.test("[GAP-016] a confirmation is a send and carries its receipt", () => {
  assertEquals(
    outcome({ result: { receipt: "r-1", status: "confirmed" } }),
    { providerResultState: "confirmed", receipt: "r-1", status: "sent" },
  );
  assertEquals(deliveryAuditAction("sent"), "delivered");
});

Deno.test("[GAP-016] a rejection fails permanently however many attempts are left", () => {
  assertEquals(
    outcome({ result: { code: "no-such-member", status: "rejected" } }),
    {
      error: "no-such-member",
      providerResultState: "rejected",
      status: "failed",
    },
  );
  assertEquals(deliveryAuditAction("failed"), "failed");
});

Deno.test("[GAP-016] an unresolved attempt retries with bounded exponential backoff", () => {
  assertEquals(
    outcome({ result: { code: "timeout", status: "transient" } }),
    {
      error: "timeout",
      nextAttemptAt: new Date("2026-05-04T09:00:30.000Z"),
      providerResultState: "unattempted",
      status: "retry",
    },
  );
  assertEquals(
    outcome({ result: { code: "timeout", status: "ambiguous" } })
      .providerResultState,
    "ambiguous",
    "an ambiguous attempt may already have had an effect",
  );
  assertEquals(
    outcome({ reconciling: true, result: { code: "t", status: "transient" } })
      .providerResultState,
    "ambiguous",
    "a reconciliation never falls back to an unattempted delivery",
  );
  assertEquals(deliveryAuditAction("retry"), undefined);
  assertEquals(
    nextAttemptAt(finalizedAt, 0, 30_000).toISOString(),
    "2026-05-04T09:00:30.000Z",
  );
  assertEquals(
    nextAttemptAt(finalizedAt, 3, 30_000).toISOString(),
    "2026-05-04T09:02:00.000Z",
  );
  assertEquals(
    nextAttemptAt(finalizedAt, 100, 30_000).toISOString(),
    "2026-05-04T17:32:00.000Z",
    "the backoff exponent is capped",
  );
});

Deno.test("[GAP-016] an exhausted attempt stops, and how it stops says what is known", () => {
  assertEquals(
    outcome({
      attemptCount: 4,
      result: { code: "timeout", status: "ambiguous" },
    }),
    {
      error: "timeout",
      providerResultState: "ambiguous",
      status: "manual_attention",
    },
    "an exhausted ambiguous attempt becomes a human's problem",
  );
  assertEquals(
    outcome({
      attemptCount: 4,
      reconciling: true,
      result: { code: "timeout", status: "transient" },
    }),
    {
      error: "timeout",
      providerResultState: "ambiguous",
      status: "manual_attention",
    },
    "an exhausted reconciliation may still have had an effect",
  );
  assertEquals(
    outcome({
      attemptCount: 4,
      result: { code: "timeout", status: "transient" },
    }),
    {
      error: "timeout",
      providerResultState: "rejected",
      status: "failed",
    },
    "an exhausted delivery that never landed simply failed",
  );
  assertEquals(deliveryAuditAction("manual_attention"), "failed");
});

Deno.test("[PLANNING-003] the delivery preference selects the channels new occurrences use", () => {
  assertEquals(
    deliveryChannels({ hasVerifiedEmail: true, preference: "in_app" }),
    ["in_app"],
    "in-app delivery is today's behaviour",
  );
  assertEquals(
    deliveryChannels({ hasVerifiedEmail: true, preference: "email" }),
    ["email"],
    "email delivery generates email occurrences only",
  );
  assertEquals(
    deliveryChannels({ hasVerifiedEmail: true, preference: "both" }),
    ["in_app", "email"],
    "both generates one occurrence of each",
  );
  for (const preference of ["in_app", "email", "both"] as const) {
    assertEquals(
      deliveryChannels({ hasVerifiedEmail: false, preference }),
      ["in_app"],
      `an unverified member keeps in-app reminders under ${preference}`,
    );
  }
});

Deno.test("[PLANNING-003] a digest is due at the latest local digest time", () => {
  assertEquals(
    digestWindow({
      digestTime: "08:00",
      now: new Date("2026-10-20T09:30:00Z"),
    }),
    {
      cutoff: new Date("2026-10-20T08:00:00Z"),
      localDate: "2026-10-20",
    },
    "a member without a time zone reads the digest time in UTC",
  );
  assertEquals(
    digestWindow({
      digestTime: "08:00",
      now: new Date("2026-10-20T07:59:59Z"),
    }),
    {
      cutoff: new Date("2026-10-19T08:00:00Z"),
      localDate: "2026-10-19",
    },
    "before today's digest time, yesterday's digest is the latest",
  );
  assertEquals(
    digestWindow({
      digestTime: "07:30",
      now: new Date("2026-10-20T06:00:00Z"),
      timezone: "Europe/Belgrade",
    }),
    {
      cutoff: new Date("2026-10-20T05:30:00Z"),
      localDate: "2026-10-20",
    },
    "the digest time is local to the member's time zone",
  );
  assertEquals(
    digestWindow({
      digestTime: "09:00",
      now: new Date("2026-10-20T20:00:00Z"),
      timezone: "Pacific/Kiritimati",
    }).localDate,
    "2026-10-21",
    "the local digest date can be ahead of UTC",
  );
  assertEquals(
    digestWindow({
      digestTime: "02:30",
      now: new Date("2026-03-29T03:00:00Z"),
      timezone: "Europe/Belgrade",
    }).cutoff,
    new Date("2026-03-29T01:30:00Z"),
    "a digest time skipped by a clock change moves to the next valid instant",
  );
  assertEquals(
    digestWindow({
      digestTime: "08:00",
      now: new Date("2026-10-20T09:30:00Z"),
      timezone: "Not/AZone",
    }).cutoff,
    new Date("2026-10-20T08:00:00Z"),
    "a zone the runtime cannot resolve reads the digest time in UTC",
  );
});

function claim(
  overrides: Partial<ClaimedReminderOccurrence> & { readonly id: string },
): ClaimedReminderOccurrence {
  return {
    attemptCount: 1,
    body: "body",
    channel: "email",
    claimToken: `token-${overrides.id}`,
    memberId: "member-a",
    providerIdempotencyKey: `key-${overrides.id}`,
    providerResultState: "unattempted",
    title: "title",
    workspaceId: "workspace",
    ...overrides,
  };
}

Deno.test("[PLANNING-003] a member's fresh digest claims become one delivery unit", () => {
  const inApp = claim({ channel: "in_app", id: "in-app" });
  const immediate = claim({ id: "immediate", memberId: "member-c" });
  const first = claim({ digestDate: "2026-10-20", id: "first" });
  const reconciling = claim({
    digestDate: "2026-10-20",
    id: "reconciling",
    providerResultState: "ambiguous",
  });
  const other = claim({
    digestDate: "2026-10-20",
    id: "other",
    memberId: "member-b",
  });
  const second = claim({ digestDate: "2026-10-20", id: "second" });
  assertEquals(
    planDeliveryUnits([inApp, immediate, first, reconciling, other, second]),
    [
      { kind: "single", occurrence: inApp },
      { kind: "single", occurrence: immediate },
      {
        kind: "digest",
        localDate: "2026-10-20",
        memberId: "member-a",
        occurrences: [first, second],
      },
      { kind: "single", occurrence: reconciling },
      {
        kind: "digest",
        localDate: "2026-10-20",
        memberId: "member-b",
        occurrences: [other],
      },
    ],
    "fresh digest claims group per member; everything else is delivered alone",
  );
});
