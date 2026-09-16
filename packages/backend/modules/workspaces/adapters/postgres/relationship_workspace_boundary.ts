import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  RelationshipWorkspaceBoundary,
  WorkspaceRelationshipType,
} from "../../public.ts";
import { DEFAULT_RELATIONSHIP_TYPE_VOCABULARY } from "../../application/register_first_workspace.ts";

function option(row: {
  readonly forward_label: string;
  readonly id: string;
  readonly is_archived: boolean;
  readonly reverse_label: string;
}): WorkspaceRelationshipType {
  return {
    archived: row.is_archived,
    forwardLabel: row.forward_label,
    id: row.id,
    reverseLabel: row.reverse_label,
  };
}

export class PostgresRelationshipWorkspaceBoundary
  implements RelationshipWorkspaceBoundary {
  async ensureDefaultRelationshipTypes(
    command: Parameters<
      RelationshipWorkspaceBoundary["ensureDefaultRelationshipTypes"]
    >[0],
  ): Promise<
    Awaited<
      ReturnType<
        RelationshipWorkspaceBoundary["ensureDefaultRelationshipTypes"]
      >
    >
  > {
    const inspected = await this.inspect({ ...command, lock: false });
    if (inspected.status !== "ready") {
      return {
        status: inspected.status === "hidden" ? "hidden" : "forbidden",
      };
    }
    const database = databaseFromSession(command.transaction);
    const vocabulary = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY;
    await sql`
      select pg_advisory_xact_lock(
        hashtextextended(${command.workspaceId}, ${vocabulary.version})
      )
    `.execute(database);
    const expected = vocabulary.types.map((type) =>
      sql`(${type.forwardLabel}::text, ${type.reverseLabel}::text,
        ${type.sortOrder}::integer)`
    );
    await sql`
      with expected (forward_label, reverse_label, sort_order) as (
        values ${sql.join(expected)}
      )
      insert into crm.relationship_types (
        workspace_id, forward_label, reverse_label, is_system, can_delete,
        is_archived, sort_order
      )
      select ${command.workspaceId}::uuid, expected.forward_label,
        expected.reverse_label, true, false, false, expected.sort_order
      from expected
      where not exists (
        select 1 from crm.relationship_types actual
        where actual.workspace_id = ${command.workspaceId}::uuid
          and actual.is_system = true
          and actual.forward_label = expected.forward_label
          and actual.reverse_label = expected.reverse_label
      )
    `.execute(database);
    const postcondition = await sql<{ readonly valid: boolean }>`
      with expected (forward_label, reverse_label, sort_order) as (
        values ${sql.join(expected)}
      ), checked as (
        select expected.forward_label, expected.reverse_label,
          expected.sort_order, count(actual.id)::integer as matches,
          coalesce(bool_and(
            actual.is_system and not actual.can_delete
            and actual.group_id is null
            and actual.sort_order = expected.sort_order
          ), false) as exact
        from expected
        left join crm.relationship_types actual
          on actual.workspace_id = ${command.workspaceId}::uuid
          and actual.is_system = true
          and actual.forward_label = expected.forward_label
          and actual.reverse_label = expected.reverse_label
        group by expected.forward_label, expected.reverse_label,
          expected.sort_order
      )
      select count(*) = ${vocabulary.types.length}
        and bool_and(matches = 1 and exact) as valid
      from checked
    `.execute(database);
    if (postcondition.rows[0]?.valid !== true) {
      throw new Error("Default relationship-type postconditions failed.");
    }
    return { status: "ready" };
  }

  async inspect(
    command: Parameters<RelationshipWorkspaceBoundary["inspect"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipWorkspaceBoundary["inspect"]>>> {
    const database = databaseFromSession(command.transaction);
    const context = await sql<{ readonly hidden: boolean }>`
      select exists (
        select 1 from crm.workspace_profile_modules module
        where module.workspace_id = ${command.workspaceId}::uuid
          and module.key = 'relationships' and module.is_active = false
      ) as hidden
    `.execute(database);
    if (context.rows[0]?.hidden) return { status: "hidden" };
    if (!command.relationshipTypeId) return { status: "ready" };
    const selected = await sql<{
      readonly forward_label: string;
      readonly id: string;
      readonly is_archived: boolean;
      readonly reverse_label: string;
    }>`
      select id::text, forward_label, reverse_label, is_archived
      from crm.relationship_types
      where id = ${command.relationshipTypeId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and is_archived = false
      ${command.lock ? sql`for update` : sql``}
    `.execute(database);
    return selected.rows[0]
      ? { status: "ready", type: option(selected.rows[0]) }
      : { status: "not-found" };
  }

  async listTypes(
    command: Parameters<RelationshipWorkspaceBoundary["listTypes"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipWorkspaceBoundary["listTypes"]>>> {
    const inspected = await this.inspect({ ...command, lock: false });
    if (inspected.status !== "ready") {
      return {
        status: inspected.status === "hidden" ? "hidden" : "forbidden",
      };
    }
    const search = command.search?.trim() ?? "";
    const database = databaseFromSession(command.transaction);
    if (command.after) {
      const anchor = await sql<{
        readonly forward_label: string;
        readonly id: string;
        readonly sort_order: number;
      }>`
        select id::text, forward_label, sort_order
        from crm.relationship_types
        where workspace_id = ${command.workspaceId}::uuid
          and id = ${command.after.id}::uuid
          and is_archived = false
          and (${search} = '' or forward_label ilike ${`%${search}%`}
            or reverse_label ilike ${`%${search}%`})
      `.execute(database);
      const row = anchor.rows[0];
      if (
        !row || row.sort_order !== command.after.sortOrder ||
        row.forward_label.toLocaleLowerCase() !==
          command.after.forwardLabel.toLocaleLowerCase()
      ) return { status: "stale-cursor" };
    }
    const result = await sql<{
      readonly forward_label: string;
      readonly id: string;
      readonly is_archived: boolean;
      readonly reverse_label: string;
      readonly sort_order: number;
    }>`
      select id::text, forward_label, reverse_label, is_archived, sort_order
      from crm.relationship_types
      where workspace_id = ${command.workspaceId}::uuid
        and is_archived = false
        and (${search} = '' or forward_label ilike ${`%${search}%`}
          or reverse_label ilike ${`%${search}%`})
        ${
      command.after
        ? sql`and (sort_order, lower(forward_label), id) >
          (${command.after.sortOrder}, lower(${command.after.forwardLabel}), ${command.after.id}::uuid)`
        : sql``
    }
      order by sort_order, lower(forward_label), id
      limit ${command.limit}
    `.execute(database);
    return {
      records: result.rows.map((row) => ({
        ...option(row),
        cursor: {
          forwardLabel: row.forward_label,
          id: row.id,
          sortOrder: row.sort_order,
        },
      })),
      status: "ready",
    };
  }

  async hydrateTypes(
    command: Parameters<RelationshipWorkspaceBoundary["hydrateTypes"]>[0],
  ): Promise<
    Awaited<ReturnType<RelationshipWorkspaceBoundary["hydrateTypes"]>>
  > {
    const inspected = await this.inspect({ ...command, lock: false });
    if (inspected.status !== "ready") {
      return {
        status: inspected.status === "hidden" ? "hidden" : "forbidden",
      };
    }
    const ids = [...new Set(command.relationshipTypeIds)].slice(0, 51);
    if (ids.length === 0) return { records: [], status: "ready" };
    const result = await sql<{
      readonly forward_label: string;
      readonly id: string;
      readonly is_archived: boolean;
      readonly reverse_label: string;
    }>`
      select id::text, forward_label, reverse_label, is_archived
      from crm.relationship_types
      where workspace_id = ${command.workspaceId}::uuid
        and id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
      order by id
      limit 51
    `.execute(databaseFromSession(command.transaction));
    return { records: result.rows.map(option), status: "ready" };
  }
}
