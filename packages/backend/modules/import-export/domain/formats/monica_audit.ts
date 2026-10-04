/** Monica history is imported as inert governance events, never live delivery. */
import { credentialName } from "../contact_import.ts";
import {
  booleanValue,
  sourceId,
  validOptionalBoolean,
} from "./monica_source.ts";

type Row = Record<string, unknown>;
interface AuditEntity {
  readonly owner: "governance";
  readonly sourceTable: string;
  readonly sourcePrimaryKey: string;
  readonly targetTable: "audit_events";
  readonly data: Readonly<Record<string, unknown>>;
  readonly references: Readonly<
    Record<string, { readonly table: string; readonly key: string }>
  >;
}
export interface MonicaAudit {
  readonly entities: readonly AuditEntity[];
  readonly handledTables: readonly string[];
}

export function monicaAudit(
  tables: Readonly<Record<string, unknown>>,
): MonicaAudit | string {
  const entities: AuditEntity[] = [];
  const handledTables = ["audit_logs", "reminders_sent"];
  const rows = (table: string): Row[] =>
    Array.isArray(tables[table]) ? tables[table] as Row[] : [];
  for (const table of handledTables) {
    if (
      tables[table] !== undefined &&
      (!Array.isArray(tables[table]) ||
        rows(table).some((row) =>
          !row || typeof row !== "object" || Array.isArray(row)
        ))
    ) {
      return "Every historical Monica table must contain objects.";
    }
    for (const row of rows(table)) {
      const key = sourceId(row.id);
      if (!key) return "A historical Monica event has no source identity.";
      const sent = table === "reminders_sent";
      const references: Record<string, { table: string; key: string }> = {};
      const contactId = sourceId(sent ? row.contact_id : row.about_contact_id);
      const reminderId = sent ? sourceId(row.reminder_id) : undefined;
      for (
        const [name, sourceTable, id] of [["personId", "contacts", contactId], [
          "reminderId",
          "reminders",
          reminderId,
        ]] as const
      ) {
        if (
          id &&
          rows(sourceTable).filter((candidate) =>
              sourceId(candidate.id) === id &&
              sourceId(candidate.account_id) === sourceId(row.account_id)
            ).length === 1
        ) {
          references[name] = { table: sourceTable, key: id };
        }
      }
      try {
        if (!sent && !validOptionalBoolean(row.should_appear_on_dashboard)) {
          throw new Error("A historical Monica dashboard flag is invalid.");
        }
        const objects = typeof row.objects === "string" && row.objects.trim()
          ? JSON.parse(row.objects)
          : row.objects ?? {};
        const payload = {
          ...(sent
            ? {
              title: row.title ?? null,
              description: row.description ?? null,
              html_sent_content: row.html_sent_content ?? null,
              lead_time_days: row.scheduled_number_days_before ?? null,
              source_updated_at: row.updated_at ?? null,
            }
            : { objects }),
          source: {
            system: "monica",
            table,
            id: key,
            accountId: sourceId(row.account_id) ?? null,
            authorId: sourceId(row.author_id) ?? null,
            contactId: contactId ?? null,
            reminderId: reminderId ?? null,
            updatedAt: row.updated_at ?? null,
          },
        };
        const data = auditData({
          action: sent ? "reminder.sent" : row.action,
          actorNameSnapshot: sent ? null : row.author_name ?? null,
          occurredAt: sent ? row.sent_date : row.audited_at,
          createdAt: row.created_at ?? (sent ? row.sent_date : row.audited_at),
          visibleOnDashboard: sent
            ? false
            : booleanValue(row.should_appear_on_dashboard),
          payload,
        });
        entities.push({
          owner: "governance",
          sourceTable: table,
          sourcePrimaryKey: key,
          targetTable: "audit_events",
          data: { ...data },
          references,
        });
      } catch {
        return "A historical Monica event contains invalid data; no audit rows were discarded.";
      }
    }
  }
  return { entities, handledTables };
}

function auditData(data: Record<string, unknown>): Record<string, unknown> {
  if (
    typeof data.action !== "string" || !data.action.trim() ||
    data.action.length > 500 ||
    (data.actorNameSnapshot !== null &&
      (typeof data.actorNameSnapshot !== "string" ||
        data.actorNameSnapshot.length > 10_000))
  ) throw new Error("Invalid historical audit event.");
  const instant = (value: unknown): string => {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?)?$/
        .test(value)
    ) throw new Error("Invalid historical date.");
    const day = new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(
      0,
      10,
    );
    if (day !== value.slice(0, 10)) throw new Error("Invalid historical date.");
    const normalized = value.length === 10
      ? `${value}T00:00:00Z`
      : /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ? value.replace(" ", "T")
      : `${value.replace(" ", "T")}Z`;
    return new Date(normalized).toISOString();
  };
  const clean = (value: unknown, depth = 0): unknown => {
    if (depth > 12) throw new Error("Audit nesting limit exceeded.");
    if (Array.isArray(value)) {
      return value.map((item) => clean(item, depth + 1));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).filter(([key]) => !credentialName(key)).map((
          [key, item],
        ) => [key, clean(item, depth + 1)]),
      );
    }
    if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return value;
      }
      return clean(parsed, depth + 1);
    }
    return value;
  };
  if (JSON.stringify(data.payload).length > 100_000) {
    throw new Error("Audit payload limit exceeded.");
  }
  return {
    ...data,
    occurredAt: instant(data.occurredAt),
    createdAt: instant(data.createdAt),
    payload: clean(data.payload),
  };
}
