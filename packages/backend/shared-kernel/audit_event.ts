/**
 * The audit contract every module writes through.
 *
 * `governance` owns `audit_events` and the one writer that inserts into it,
 * but every other module owns the *meaning* of its own events: it turns a
 * use-case command into an `AuditEvent` with a pure `describe…Event` function
 * that lives beside that use case. No module may depend on `governance`, so
 * the shape they agree on cannot live there — ten modules restated it by hand
 * until it moved here.
 *
 * This module declares no writer and imports nothing, so the kernel stays a
 * leaf and the concrete recorder is still built at a composition root. Its one
 * function, `auditPayload`, is the pure rule every writer stores a payload by.
 */

export interface AuditTransaction {
  readonly opaque: unknown;
}

/** One audit-history row, as its owning module describes it. */
export interface AuditEvent {
  readonly action: string;
  readonly actorMemberId?: string | undefined;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly personId?: string | undefined;
  /**
   * The request or job run that caused the event (GAP-039). It is operational
   * correlation, not product history: the writer stores it as
   * `payload.requestId`, and the audit-history read model never shows it.
   */
  readonly requestId?: string | undefined;
  /**
   * The personal API token the request authenticated with (MCP-A1). The
   * writer stores it as `payload.apiTokenId`; an event written for a session
   * cookie, or by a job, has none.
   */
  readonly apiTokenId?: string | undefined;
  readonly subjectId?: string | undefined;
  readonly subjectType: string;
  readonly visibleOnDashboard: boolean;
  readonly workspaceId?: string | undefined;
}

/**
 * The `payload` column an event is stored with: the module's own payload and,
 * when the event is correlated, its `requestId`, which a module payload cannot
 * overwrite. `audit_events.payload` is `jsonb`, so correlation needs no column.
 *
 * `apiTokenId` is stricter (MCP-A1): it is the event's own token or nothing,
 * so a module payload can neither overwrite the credential that made a change
 * nor name one for a change no token made.
 */
export function auditPayload(
  event: AuditEvent,
): Readonly<Record<string, unknown>> {
  const payload = "apiTokenId" in event.payload
    ? Object.fromEntries(
      Object.entries(event.payload).filter(([key]) => key !== "apiTokenId"),
    )
    : event.payload;
  if (!event.requestId && !event.apiTokenId) return payload;
  return {
    ...payload,
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.apiTokenId ? { apiTokenId: event.apiTokenId } : {}),
  };
}

/**
 * Where `created_at` comes from. Most events stamp the row with the instant
 * the use case observed (`occurredAt`, the default); the few written with
 * `now()` say so, because a postcondition cannot re-read a `now()`.
 */
export type AuditEventCreatedAt = "now" | "occurredAt";

export interface AuditEventWrite {
  readonly createdAt?: AuditEventCreatedAt;
  readonly event: AuditEvent;
  /** The message thrown when the insert stores nothing. */
  readonly missing?: string;
  readonly transaction: AuditTransaction;
}

export interface ConditionalAuditEventWrite {
  readonly createdAt?: AuditEventCreatedAt;
  readonly event: AuditEvent;
  readonly transaction: AuditTransaction;
  /** Store the row only when this holds. The statement runs either way. */
  readonly when: boolean;
}

export interface AuditEventAssertion {
  /**
   * The id the write returned. A `string` matches that row, `null` matches
   * none while keeping the statement identical, and leaving it out drops the
   * predicate for a write whose caller never kept an id.
   */
  readonly auditId?: string | null;
  readonly createdAt?: AuditEventCreatedAt;
  readonly event: AuditEvent;
  /** The message thrown when the row count is not `matches`. */
  readonly failure?: string;
  /** Rows the caller expects. One unless the write was conditional. */
  readonly matches?: 0 | 1;
  readonly transaction: AuditTransaction;
}

export interface AuditEventRecorder {
  /** Writes one event inside the caller's transaction and returns its id. */
  record(command: AuditEventWrite): Promise<string>;
  /**
   * Writes one event only when the caller's condition holds. Both outcomes
   * execute the same statement, so an anonymous authentication attempt cannot
   * be told from a known one by the SQL the transaction ran.
   */
  recordWhen(command: ConditionalAuditEventWrite): Promise<string | undefined>;
  /** Re-reads the written row inside the same transaction. */
  assertRecorded(command: AuditEventAssertion): Promise<void>;
}
