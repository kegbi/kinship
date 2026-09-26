import { assertEquals } from "../testing/assert.ts";
import { type AuditEvent, auditPayload } from "./audit_event.ts";

const EVENT: AuditEvent = {
  action: "people.person-created",
  actorMemberId: "00000000-0000-4000-8000-000000000002",
  occurredAt: new Date("2026-09-26T10:00:00.000Z"),
  payload: { isPartial: false },
  subjectType: "person",
  visibleOnDashboard: true,
  workspaceId: "00000000-0000-4000-8000-000000000003",
};

Deno.test("[GAP-039] a correlated event stores its request identifier in the payload", () => {
  assertEquals(
    auditPayload({ ...EVENT, requestId: "3f2a9c0d8e7b6a5f" }),
    { isPartial: false, requestId: "3f2a9c0d8e7b6a5f" },
    "the module's payload, then the correlation",
  );
});

Deno.test("[GAP-039] an uncorrelated event stores its payload unchanged", () => {
  assertEquals(
    auditPayload(EVENT),
    { isPartial: false },
    "no identifier is no member",
  );
  assertEquals(
    auditPayload({ ...EVENT, requestId: undefined }),
    { isPartial: false },
    "an absent identifier is no member either",
  );
});

Deno.test("[GAP-039] the correlation cannot be overwritten by a module payload", () => {
  assertEquals(
    auditPayload({
      ...EVENT,
      payload: { requestId: "spoofed" },
      requestId: "3f2a9c0d8e7b6a5f",
    }),
    { requestId: "3f2a9c0d8e7b6a5f" },
    "the event's own correlation wins",
  );
});
