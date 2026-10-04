import type { ActorRevalidation } from "../../workspaces/public.ts";
import type { LegalActor } from "../ports/context.ts";

/** Historical events never borrow the importing member's identity. */
export interface HistoricalAuditImport {
  importRecords(command: {
    readonly actor: LegalActor;
    readonly records: readonly {
      readonly id: string;
      readonly data: Readonly<Record<string, unknown>>;
      readonly references: Readonly<Record<string, string>>;
    }[];
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}

export interface HistoricalAuditData {
  readonly action: string;
  readonly actorNameSnapshot: string | null;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly visibleOnDashboard: boolean;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** SQL exports omit a zone; Monica's stored timestamps are UTC. */
export function historicalAuditInstant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?)?$/
      .test(value)
  ) {
    throw new Error("A historical audit timestamp is invalid.");
  }
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)
  ) {
    throw new Error("A historical audit timestamp is invalid.");
  }
  const zoned = value.length === 10
    ? `${value}T00:00:00Z`
    : /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value.replace(" ", "T")
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(zoned);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("A historical audit timestamp is invalid.");
  }
  return date.toISOString();
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    throw new Error("Historical audit payload nesting is too deep.");
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) =>
        !/(password|passwd|secret|token|credential|apikey|authorization|cookie|recoverycode|privatekey)/i
          .test(key.replace(/[^a-z0-9]/gi, ""))
      ).map(([key, item]) => [key, redact(item, depth + 1)]),
    );
  }
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
    return redact(parsed, depth + 1);
  }
  return value;
}

/** Re-run at the owner boundary: staged rows are not trusted input. */
export function historicalAuditData(
  data: Readonly<Record<string, unknown>>,
): HistoricalAuditData {
  if (
    typeof data.action !== "string" || !data.action.trim() ||
    data.action.length > 500 || typeof data.visibleOnDashboard !== "boolean" ||
    !data.payload || typeof data.payload !== "object" ||
    Array.isArray(data.payload) ||
    (data.actorNameSnapshot !== null && data.actorNameSnapshot !== undefined &&
      (typeof data.actorNameSnapshot !== "string" ||
        data.actorNameSnapshot.length > 10_000))
  ) {
    throw new Error("A historical audit event is invalid.");
  }
  if (JSON.stringify(data.payload).length > 100_000) {
    throw new Error("A historical audit payload exceeds the supported limit.");
  }
  return {
    action: data.action,
    actorNameSnapshot: typeof data.actorNameSnapshot === "string"
      ? data.actorNameSnapshot
      : null,
    occurredAt: historicalAuditInstant(data.occurredAt),
    createdAt: historicalAuditInstant(data.createdAt),
    visibleOnDashboard: data.visibleOnDashboard,
    payload: redact(data.payload) as Record<string, unknown>,
  };
}

export interface HistoricalAuditRecorder {
  recordImported(command: {
    readonly id: string;
    readonly workspaceId: string;
    readonly personId?: string;
    readonly reminderId?: string;
    readonly data: HistoricalAuditData;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}

export interface HistoricalAuditReferences {
  personExists(
    command: {
      readonly actor: LegalActor;
      readonly personId: string;
      readonly transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean>;
  reminderExists(
    command: {
      readonly actor: LegalActor;
      readonly reminderId: string;
      readonly transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean>;
}

export function createHistoricalAuditImport(dependencies: {
  readonly actors: ActorRevalidation;
  readonly recorder: HistoricalAuditRecorder;
  readonly references: HistoricalAuditReferences;
}): HistoricalAuditImport {
  return {
    async importRecords(command) {
      if (
        command.actor.role === "member" ||
        await dependencies.actors.revalidate({
            ...command.actor,
            lock: true,
            transaction: command.transaction,
          }) !== "active"
      ) throw new Error("Historical audit import is forbidden.");
      for (const record of command.records) {
        const data = historicalAuditData(record.data);
        const { personId, reminderId } = record.references;
        if (
          personId &&
          !await dependencies.references.personExists({
            actor: command.actor,
            personId,
            transaction: command.transaction,
          })
        ) throw new Error("Historical audit person is outside the workspace.");
        if (
          reminderId &&
          !await dependencies.references.reminderExists({
            actor: command.actor,
            reminderId,
            transaction: command.transaction,
          })
        ) {
          throw new Error(
            "Historical audit reminder is outside the workspace.",
          );
        }
        await dependencies.recorder.recordImported({
          id: record.id,
          workspaceId: command.actor.workspaceId,
          ...(personId ? { personId } : {}),
          ...(reminderId ? { reminderId } : {}),
          data,
          transaction: command.transaction,
        });
      }
    },
  };
}
