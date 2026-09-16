import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ExportContactMethod,
  ExportPerson,
  PeopleExportBoundary,
} from "../../application/export_people_boundary.ts";

interface ExportPersonRow {
  readonly archived: boolean;
  readonly contact_methods: unknown;
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

function person(row: ExportPersonRow): ExportPerson {
  return {
    ...(row.archived ? { archived: true } : {}),
    contactMethods: methods(row.contact_methods),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.family_name ? { familyName: row.family_name } : {}),
    ...(row.food_preferences ? { foodPreferences: row.food_preferences } : {}),
    givenName: row.given_name,
    id: row.id,
    isDeceased: row.is_deceased,
    isPartial: row.is_partial,
    isStarred: row.is_starred,
    ...(row.middle_name ? { middleName: row.middle_name } : {}),
    ...(row.nickname ? { nickname: row.nickname } : {}),
  };
}

/**
 * The caller revalidates the actor before it reaches this boundary (see the
 * `ActorRevalidation` port), so the queries below scope by workspace alone.
 */
const contactMethods = (workspaceId: string) =>
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
`;

const selected = sql`
  person.id::text, person.given_name, person.middle_name, person.family_name,
  person.nickname, person.description, person.food_preferences,
  person.is_partial, person.is_starred, person.is_deceased,
  person.archived_at is not null as archived,
  case when person.deleted_at is null then null else
    to_char(person.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  end as deleted_at,
  coalesce(methods.items, '[]'::jsonb) as contact_methods
`;

export class PostgresPeopleExportBoundary implements PeopleExportBoundary {
  async getPerson(
    command: Parameters<PeopleExportBoundary["getPerson"]>[0],
  ): Promise<ExportPerson | undefined> {
    const result = await sql<ExportPersonRow>`
      select ${selected}
      from crm.people person
      ${contactMethods(command.actor.workspaceId)}
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
      ${contactMethods(command.actor.workspaceId)}
      where person.workspace_id = ${command.actor.workspaceId}::uuid
        and person.deleted_at is null
      order by person.id
      limit 501
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map(person);
  }
}
