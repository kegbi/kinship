import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  ExportContactMethod,
  ExportDate,
  ExportPerson,
  PeopleExportBoundary,
} from "../../application/export_people_boundary.ts";

interface ExportPersonRow {
  readonly archived: boolean;
  readonly contact_methods: unknown;
  readonly dates: unknown;
  readonly deleted_at: string | null;
  readonly description: string | null;
  readonly family_name: string | null;
  readonly food_preferences: string | null;
  readonly given_name: string;
  readonly id: string;
  readonly is_deceased: boolean;
  readonly is_partial: boolean;
  readonly is_starred: boolean;
  readonly middle_name: string | null;
  readonly nickname: string | null;
}

function methods(value: unknown): readonly ExportContactMethod[] {
  const parsed = typeof value === "string"
    ? (() => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return [];
      }
    })()
    : value;
  return Array.isArray(parsed)
    ? parsed.flatMap((item) => {
      if (item === null || typeof item !== "object") return [];
      const method = item as Record<string, unknown>;
      return typeof method.value === "string" &&
          typeof method.label === "string"
        ? [{
          kind: method.kind === "email" || method.kind === "phone"
            ? method.kind
            : "other" as const,
          label: method.label,
          value: method.value,
        }]
        : [];
    })
    : [];
}

const PRECISIONS = new Set([
  "day",
  "full",
  "month",
  "month_day",
  "unknown",
  "year",
  "year_month",
]);

function dates(value: unknown): readonly ExportDate[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.flatMap((item) => {
      const date = item as Record<string, unknown>;
      if (
        typeof date?.kind !== "string" ||
        typeof date.precision !== "string" || !PRECISIONS.has(date.precision)
      ) return [];
      const part = (key: "day" | "month" | "year") =>
        typeof date[key] === "number" ? { [key]: date[key] as number } : {};
      return [{
        ...part("day"),
        kind: date.kind,
        ...(typeof date.label === "string" ? { label: date.label } : {}),
        ...part("month"),
        precision: date.precision as ExportDate["precision"],
        ...part("year"),
      }];
    })
    : [];
}

function person(row: ExportPersonRow): ExportPerson {
  return {
    ...(row.archived ? { archived: true } : {}),
    contactMethods: methods(row.contact_methods),
    dates: dates(row.dates),
    ...pickDefined({
      deletedAt: row.deleted_at,
      description: row.description,
      familyName: row.family_name,
      foodPreferences: row.food_preferences,
    }),
    givenName: row.given_name,
    id: row.id,
    isDeceased: row.is_deceased,
    isPartial: row.is_partial,
    isStarred: row.is_starred,
    ...pickDefined({ middleName: row.middle_name, nickname: row.nickname }),
  };
}

/**
 * The caller revalidates the actor before it reaches this boundary (see the
 * `ActorRevalidation` port), so the queries below scope by workspace alone.
 */
const children = (workspaceId: string) =>
  sql`
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'kind', type.kind, 'label', type.name, 'value', method.value
    ) order by method.sort_order, method.id) as items
    from crm.person_contact_methods method
    join crm.contact_method_types type on type.id = method.type_id
      and type.workspace_id = ${workspaceId}::uuid
    where method.person_id = person.id
  ) methods on true
  left join lateral (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'kind', date.kind, 'label', date.label, 'year', date.year,
      'month', date.month, 'day', date.day, 'precision', date.precision
    )) order by date.kind, date.created_at, date.id) as items
    from crm.person_dates date
    where date.person_id = person.id
  ) dates on true
`;

const selected = sql`
  person.id::text, person.given_name, person.middle_name, person.family_name,
  person.nickname, person.description, person.food_preferences,
  person.is_partial, person.is_starred, person.is_deceased,
  person.archived_at is not null as archived,
  case when person.deleted_at is null then null else
    ${instantColumn("person.deleted_at")}
  end as deleted_at,
  coalesce(methods.items, '[]'::jsonb) as contact_methods,
  coalesce(dates.items, '[]'::jsonb) as dates
`;

export class PostgresPeopleExportBoundary implements PeopleExportBoundary {
  async getPerson(
    command: Parameters<PeopleExportBoundary["getPerson"]>[0],
  ): Promise<ExportPerson | undefined> {
    const result = await sql<ExportPersonRow>`
      select ${selected}
      from crm.people person
      ${children(command.actor.workspaceId)}
      where person.workspace_id = ${command.actor.workspaceId}::uuid
        and person.id = ${command.personId}::uuid
        and person.deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? person(result.rows[0]) : undefined;
  }

  async listWorkspace(
    command: Parameters<PeopleExportBoundary["listWorkspace"]>[0],
  ): Promise<readonly ExportPerson[]> {
    if (command.actor.role === "member") return [];
    const result = await sql<ExportPersonRow>`
      select ${selected}
      from crm.people person
      ${children(command.actor.workspaceId)}
      where person.workspace_id = ${command.actor.workspaceId}::uuid
        and person.deleted_at is null
      order by person.id
      limit 501
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map(person);
  }
}
