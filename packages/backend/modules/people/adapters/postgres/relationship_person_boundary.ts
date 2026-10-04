import { sql } from "kysely";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { UNNAMED_PERSON } from "../../domain/person_name.ts";
import type {
  InteractionPersonBoundary,
  RelationshipPersonBoundary,
} from "../../public.ts";

export class PostgresRelationshipPersonBoundary
  implements InteractionPersonBoundary {
  async existsForImport(
    c: {
      readonly workspaceId: string;
      readonly personIds: readonly string[];
      readonly transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean> {
    const ids = [...new Set(c.personIds)];
    if (!ids.length) return false;
    const result =
      await sql`select id from crm.people where workspace_id=${c.workspaceId}::uuid and id=any(${ids}::uuid[]) order by id for key share`
        .execute(databaseFromSession(c.transaction));
    return result.rows.length === ids.length;
  }
  async describeContactMethods(
    command: Parameters<
      InteractionPersonBoundary["describeContactMethods"]
    >[0],
  ): Promise<
    Awaited<ReturnType<InteractionPersonBoundary["describeContactMethods"]>>
  > {
    const ids = [...new Set(command.contactMethodIds)].slice(0, 50);
    if (ids.length === 0) return [];
    const result = await sql<{
      readonly id: string;
      readonly type_id: string;
      readonly value: string;
    }>`
      select method.id::text, method.type_id::text, method.value
      from crm.person_contact_methods method
      join crm.people person on person.id = method.person_id
      where method.id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
        and method.person_id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
      order by method.id
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      id: row.id,
      typeId: row.type_id,
      value: row.value,
    }));
  }

  async inspectContactMethod(
    command: Parameters<InteractionPersonBoundary["inspectContactMethod"]>[0],
  ): Promise<
    Awaited<ReturnType<InteractionPersonBoundary["inspectContactMethod"]>>
  > {
    const result = await sql<{
      readonly id: string;
      readonly type_id: string;
      readonly value: string;
    }>`
      select method.id::text, method.type_id::text, method.value
      from crm.person_contact_methods method
      join crm.people person on person.id = method.person_id
      where method.id = ${command.contactMethodId}::uuid
        and method.person_id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
      for key share of method, person
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? {
        contactMethod: { id: row.id, typeId: row.type_id, value: row.value },
        status: "ready",
      }
      : { status: "not-found" };
  }
  async inspect(
    command: Parameters<RelationshipPersonBoundary["inspect"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipPersonBoundary["inspect"]>>> {
    const ids = [...new Set(command.personIds)].sort();
    if (ids.length === 0) return { status: "not-found" };
    const result = await sql<
      { readonly archived_at: Date | null; readonly id: string }
    >`
      select id::text, archived_at
      from crm.people
      where workspace_id = ${command.workspaceId}::uuid
        and id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
        and deleted_at is null
      order by id
      ${command.lock ? sql`for update` : sql``}
    `.execute(databaseFromSession(command.transaction));
    if (result.rows.length !== ids.length) return { status: "not-found" };
    return result.rows.some((row) => row.archived_at !== null)
      ? { status: "archived" }
      : { status: "ready" };
  }

  async summarize(
    command: Parameters<RelationshipPersonBoundary["summarize"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipPersonBoundary["summarize"]>>> {
    const ids = [...new Set(command.personIds)].slice(0, 50);
    if (ids.length === 0) return [];
    const result = await sql<{
      readonly archived_at: Date | null;
      readonly id: string;
      readonly name: string;
    }>`
      select id::text, archived_at,
        ${sql.raw(personDisplayNameSql(UNNAMED_PERSON))} as name
      from crm.people
      where workspace_id = ${command.workspaceId}::uuid
        and id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
        and deleted_at is null
      order by id
      limit 50
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      archived: row.archived_at !== null,
      id: row.id,
      name: row.name,
    }));
  }
}
