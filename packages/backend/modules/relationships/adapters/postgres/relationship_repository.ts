import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type { RelationshipRecord } from "../../domain/relationship_rules.ts";
import type { RelationshipRepository } from "../../ports/relationship_repository.ts";

interface RelationshipRow {
  readonly created_at: string;
  readonly from_person_id: string;
  readonly id: string;
  readonly relationship_type_id: string;
  readonly status: "active" | "ended";
  readonly to_person_id: string;
  readonly updated_at: string;
}

function record(
  row: RelationshipRow,
  labels: { readonly forwardLabel?: string; readonly reverseLabel?: string } =
    {},
): RelationshipRecord {
  return {
    createdAt: row.created_at,
    forwardLabel: labels.forwardLabel ?? "",
    fromPersonId: row.from_person_id,
    id: row.id,
    relationshipTypeId: row.relationship_type_id,
    relationshipTypeArchived: false,
    reverseLabel: labels.reverseLabel ?? "",
    status: row.status,
    toPersonId: row.to_person_id,
    updatedAt: row.updated_at,
  };
}

const projection = sql`
  edge.id::text, edge.from_person_id::text, edge.to_person_id::text,
  edge.relationship_type_id::text, edge.status,
  ${instantColumn("edge.created_at")} as created_at,
  ${instantColumn("edge.updated_at")} as updated_at
`;

export class PostgresRelationshipRepository implements RelationshipRepository {
  async list(
    command: Parameters<RelationshipRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipRepository["list"]>>> {
    const database = databaseFromSession(command.transaction);
    if (command.after) {
      const anchor = await sql<{ readonly created_at: string }>`
        select ${instantColumn("created_at")} as created_at
        from crm.relationships
        where id = ${command.after.id}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and ${command.personId}::uuid in (from_person_id, to_person_id)
      `.execute(database);
      if (anchor.rows[0]?.created_at !== command.after.createdAt) {
        return { status: "stale-cursor" };
      }
    }
    const result = await sql<RelationshipRow>`
      select ${projection}
      from crm.relationships edge
      where edge.workspace_id = ${command.workspaceId}::uuid
        and ${command.personId}::uuid in (edge.from_person_id, edge.to_person_id)
        ${
      command.after
        ? sql`and (edge.created_at, edge.id) > (${command.after.createdAt}::timestamptz, ${command.after.id}::uuid)`
        : sql``
    }
      order by edge.created_at, edge.id
      limit ${command.limit}
    `.execute(database);
    return { records: result.rows.map((row) => record(row)), status: "ready" };
  }

  async get(
    command: Parameters<RelationshipRepository["get"]>[0],
  ): Promise<RelationshipRecord | undefined> {
    const result = await sql<RelationshipRow>`
      select ${projection}
      from crm.relationships edge
      where edge.id = ${command.relationshipId}::uuid
        and edge.workspace_id = ${command.workspaceId}::uuid
        and ${command.personId}::uuid in (edge.from_person_id, edge.to_person_id)
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? record(result.rows[0]) : undefined;
  }

  async lockRelationship(
    command: Parameters<RelationshipRepository["lockRelationship"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipRepository["lockRelationship"]>>> {
    const result = await sql<RelationshipRow>`
      select ${projection}
      from crm.relationships edge
      where edge.id = ${command.relationshipId}::uuid
        and edge.workspace_id = ${command.workspaceId}::uuid
        and ${command.personId}::uuid in (edge.from_person_id, edge.to_person_id)
      for update of edge
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { relationship: record(result.rows[0]), status: "ready" }
      : { status: "not-found" };
  }

  async findExact(
    command: Parameters<RelationshipRepository["findExact"]>[0],
  ): Promise<RelationshipRecord | undefined> {
    const result = await sql<RelationshipRow>`
      select ${projection}
      from crm.relationships edge
      where edge.workspace_id = ${command.workspaceId}::uuid
        and edge.from_person_id = ${command.sourcePersonId}::uuid
        and edge.to_person_id = ${command.targetPersonId}::uuid
        and edge.relationship_type_id = ${command.relationshipTypeId}::uuid
      limit 1
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? record(result.rows[0]) : undefined;
  }

  async create(
    command: Parameters<RelationshipRepository["create"]>[0],
  ): Promise<RelationshipRecord | undefined> {
    const result = await sql<RelationshipRow>`
      insert into crm.relationships (
        id, workspace_id, from_person_id, to_person_id,
        relationship_type_id, status, created_at, updated_at
      ) values (
        ${command.id}::uuid, ${command.workspaceId}::uuid,
        ${command.sourcePersonId}::uuid, ${command.targetPersonId}::uuid,
        ${command.type.id}::uuid, 'active', ${command.occurredAt}, ${command.occurredAt}
      ) on conflict (from_person_id, to_person_id, relationship_type_id) do nothing
      returning id::text, from_person_id::text, to_person_id::text,
        relationship_type_id::text, status,
        ${instantColumn("created_at")} as created_at,
        ${instantColumn("updated_at")} as updated_at
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? record(result.rows[0], command.type) : undefined;
  }

  async update(
    command: Parameters<RelationshipRepository["update"]>[0],
  ): Promise<RelationshipRecord | undefined> {
    const result = await sql<RelationshipRow>`
      update crm.relationships edge set
        relationship_type_id = ${command.type.id}::uuid,
        updated_at = greatest(${command.occurredAt}::timestamptz,
          edge.updated_at + interval '1 microsecond')
      where edge.id = ${command.relationshipId}::uuid
        and edge.workspace_id = ${command.workspaceId}::uuid
        and not exists (
          select 1 from crm.relationships duplicate
          where duplicate.from_person_id = edge.from_person_id
            and duplicate.to_person_id = edge.to_person_id
            and duplicate.relationship_type_id = ${command.type.id}::uuid
            and duplicate.id <> edge.id
        )
      returning edge.id::text, edge.from_person_id::text,
        edge.to_person_id::text, edge.relationship_type_id::text, edge.status,
        ${instantColumn("edge.created_at")} as created_at,
        ${instantColumn("edge.updated_at")} as updated_at
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? record(result.rows[0], command.type) : undefined;
  }

  async delete(
    command: Parameters<RelationshipRepository["delete"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly id: string }>`
      delete from crm.relationships
      where id = ${command.relationshipId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows.length === 1;
  }

  async assertPostcondition(
    command: Parameters<RelationshipRepository["assertPostcondition"]>[0],
  ): Promise<void> {
    const edge = command.after ?? command.before;
    if (!edge) throw new Error("Relationship postcondition has no edge.");
    const result = await sql<{ readonly valid: boolean }>`
      select case when ${command.action} = 'delete' then not exists (
        select 1 from crm.relationships where id = ${edge.id}::uuid
      ) else exists (
        select 1 from crm.relationships
        where id = ${edge.id}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and from_person_id = ${edge.fromPersonId}::uuid
          and to_person_id = ${edge.toPersonId}::uuid
          and relationship_type_id = ${edge.relationshipTypeId}::uuid
          and status = ${edge.status}
      ) end as valid
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error(`Relationship ${command.action} postcondition failed.`);
    }
  }
}
