import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  auditFailure,
  auditHistoryReducer,
  type AuditHistoryState,
  eventContext,
  eventDetails,
  filterInput,
  formatAction,
  formatDetail,
  initialAuditHistory,
} from "./audit.ts";

const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  action: "people.person-created",
  actor: { name: "Workspace owner" },
  details: {},
  id: "00000000-0000-4000-8000-000000000901",
  occurredAt: "2026-08-17T12:30:00.000Z",
  redacted: false,
  subject: { id: "00000000-0000-4000-8000-000000000100", type: "person" },
  ...overrides,
} as AuditEvent);

describe("GOVERNANCE-002 audit event wording", () => {
  it("names actions and every detail shape as accessible text", () => {
    expect(formatAction("people.person-updated")).toBe(
      "People person updated",
    );
    expect(formatDetail("from", { isYearApproximate: false, precision: "day" }))
      .toBe("day only");
    expect(formatDetail("from", { isYearApproximate: true, precision: "full" }))
      .toBe("Approximate full date");
    expect(formatDetail("to", null)).toBe("Not set");
    expect(formatDetail("tags", ["a", "b"])).toBe("a, b");
    expect(formatDetail("isPartial", true)).toBe("Yes");
    expect(formatDetail("isPartial", false)).toBe("No");
    expect(formatDetail("status", "archived")).toBe("Archived");
    expect(formatDetail("section", "contact-methods")).toBe("contact-methods");
    expect(formatDetail("count", 3 as never)).toBe("Protected detail");
    expect(formatDetail("from", { precision: "bogus" } as never)).toBe(
      "Protected detail",
    );
    expect(
      formatDetail("from", {
        extra: 1,
        isYearApproximate: true,
        precision: "day",
      } as never),
    ).toBe("Protected detail");
  });

  it("joins an event's context and details", () => {
    expect(eventContext(event({
      person: { id: "p", name: "Ada" },
    } as Partial<AuditEvent>))).toBe("Workspace owner · Ada · person");
    expect(eventContext(event())).toBe("Workspace owner · person");
    expect(eventDetails(event())).toBe("No non-sensitive details stored.");
    expect(eventDetails(event({ details: { status: "cancelled", to: null } })))
      .toBe("Status: Cancelled · To: Not set");
  });
});

describe("GOVERNANCE-002 audit filters", () => {
  it("sends only the filled filters, dates as instants", () => {
    expect(filterInput({})).toEqual({ limit: 20 });
    expect(filterInput({
      action: " people.person-updated ",
      actorMemberId: "member",
      from: "2026-08-01T00:00",
      personId: "person",
      to: "not a date",
    }, "next")).toEqual({
      action: "people.person-updated",
      actorMemberId: "member",
      cursor: "next",
      from: new Date("2026-08-01T00:00").toISOString(),
      limit: 20,
      personId: "person",
    });
  });

  it("maps a refused read's status to its failure", () => {
    expect(auditFailure(403)).toBe("forbidden");
    expect(auditFailure(404)).toBe("not-found");
    expect(auditFailure(409)).toBe("stale");
    expect(auditFailure(503)).toBe("unavailable");
    expect(auditFailure(undefined)).toBe("unavailable");
  });
});

describe("GOVERNANCE-002 audit history reducer", () => {
  const loaded = (
    state: AuditHistoryState,
    items: readonly AuditEvent[],
    extra: { nextCursor?: string; cursor?: string; archived?: boolean } = {},
  ) =>
    auditHistoryReducer(state, {
      cursor: extra.cursor,
      page: {
        items: [...items],
        ...(extra.nextCursor ? { nextCursor: extra.nextCursor } : {}),
        status: extra.archived ? "archived" : "ready",
      } as never,
      preferences: { effectiveTimezone: "UTC", locale: "en" },
      type: "loaded",
    });

  const withPage = loaded(initialAuditHistory, [event()], {
    nextCursor: "older",
  });

  it("starts loading and counts what a first page answers", () => {
    expect(initialAuditHistory.loading).toBe(true);
    expect(withPage).toMatchObject({
      loading: false,
      message: "1 audit event in immutable newest-first order.",
      nextCursor: "older",
      retryable: false,
    });
    expect(loaded(initialAuditHistory, []).message).toBe(
      "No audit events match this scope.",
    );
    expect(loaded(initialAuditHistory, [event(), event()], { archived: true }))
      .toMatchObject({
        message:
          "2 audit events in immutable newest-first order. Archived person history remains readable.",
      });
  });

  it("clears the list for a new search but keeps it for a continuation", () => {
    const search = auditHistoryReducer(withPage, { type: "loading" });
    expect(search).toMatchObject({
      events: [],
      loading: true,
      message: "Loading audit history…",
      nextCursor: undefined,
    });
    const continued = auditHistoryReducer(withPage, {
      cursor: "older",
      type: "loading",
    });
    expect(continued).toMatchObject({
      loading: true,
      message: "Loading older audit events…",
      nextCursor: "older",
    });
    expect(continued.events).toHaveLength(1);
    expect(loaded(continued, [event()], { cursor: "older" }).events)
      .toHaveLength(2);
  });

  it("keeps the person a page named once a later page does not", () => {
    const named = auditHistoryReducer(initialAuditHistory, {
      page: { items: [], person: { id: "p", name: "Ada" }, status: "ready" },
      type: "loaded",
    } as never);
    expect(named.personName).toBe("Ada");
    expect(loaded(named, []).personName).toBe("Ada");
    expect(
      auditHistoryReducer(named, { failure: "forbidden", type: "failed" })
        .personUnknown,
    ).toBe(false);
  });

  it.each(
    [
      [
        "session-lost",
        false,
        "Sign in again to review audit history.",
        true,
        undefined,
      ],
      [
        "session-lost",
        true,
        "Sign in again to review audit history. Existing results are unchanged.",
        true,
        "older",
      ],
      [
        "unavailable",
        false,
        "Audit history could not be loaded. Try again.",
        true,
        undefined,
      ],
      [
        "unavailable",
        true,
        "Older audit events could not be loaded. Existing results are unchanged. Try again.",
        true,
        "older",
      ],
      [
        "forbidden",
        false,
        "You do not have permission to review audit history. Owner or administrator access is required.",
        true,
        undefined,
      ],
      [
        "forbidden",
        true,
        "You no longer have permission to continue this audit history. Existing results are unchanged.",
        false,
        undefined,
      ],
      [
        "not-found",
        false,
        "This audit scope was not found in the active workspace.",
        true,
        undefined,
      ],
      [
        "not-found",
        true,
        "This audit scope is no longer available. Existing results are unchanged. Adjust filters to start a new search.",
        false,
        undefined,
      ],
      [
        "stale",
        false,
        "This audit page is stale. Restart the filtered history.",
        true,
        undefined,
      ],
      [
        "stale",
        true,
        "This audit page is stale. Restart the filtered history. Existing results are unchanged.",
        true,
        undefined,
      ],
    ] as const,
  )(
    "reports a %s failure (continued: %s)",
    (failure, continued, message, retryable, retryCursor) => {
      const next = auditHistoryReducer(withPage, {
        cursor: continued ? "older" : undefined,
        failure,
        type: "failed",
      });
      expect(next).toMatchObject({
        loading: false,
        message,
        personUnknown: true,
        retryable,
        retryCursor,
      });
      const ends = failure === "stale" ||
        (continued && (failure === "forbidden" || failure === "not-found"));
      expect(next.nextCursor).toBe(ends ? undefined : "older");
    },
  );
});
