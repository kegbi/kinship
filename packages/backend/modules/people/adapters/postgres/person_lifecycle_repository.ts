import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  PersonLifecycleRecord,
  PersonLifecycleRepository,
} from "../../public.ts";

interface PersonRow {
  readonly archived_at: Date | null;
  readonly deleted_at: Date | null;
  readonly description: string | null;
  readonly family_name: string | null;
  readonly gender_option_id: string | null;
  readonly given_name: string;
  readonly id: string;
  readonly is_deceased: boolean;
  readonly is_partial: boolean;
  readonly middle_name: string | null;
  readonly nickname: string | null;
  readonly updated_at: string;
}

/** The columns every lifecycle statement reads the person back with. */
const PERSON_COLUMNS = sql`id::text, given_name, middle_name, family_name,
  nickname, description, gender_option_id::text, is_deceased, is_partial,
  archived_at, deleted_at, ${instantColumn("updated_at")} as updated_at`;

function record(row: PersonRow): PersonLifecycleRecord {
  return {
    ...pickDefined({
      description: row.description,
      familyName: row.family_name,
      genderOptionId: row.gender_option_id,
    }),
    givenName: row.given_name,
    id: row.id,
    isDeceased: row.is_deceased,
    isPartial: row.is_partial,
    lifecycle: row.deleted_at
      ? "deleted"
      : row.archived_at
      ? "archived"
      : "active",
    ...pickDefined({ middleName: row.middle_name, nickname: row.nickname }),
    updatedAt: row.updated_at,
  };
}

export class PostgresPersonLifecycleRepository
  implements PersonLifecycleRepository {
  async lock(
    command: Parameters<PersonLifecycleRepository["lock"]>[0],
  ): Promise<Awaited<ReturnType<PersonLifecycleRepository["lock"]>>> {
    const database = databaseFromSession(command.transaction);
    const result = await sql<PersonRow>`
      select ${PERSON_COLUMNS}
      from crm.people
      where id = ${command.personId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      for update
    `.execute(database);
    const row = result.rows[0];
    return row
      ? { person: record(row), status: "ready" }
      : { status: "not-found" };
  }

  async mutate(
    command: Parameters<PersonLifecycleRepository["mutate"]>[0],
  ): Promise<PersonLifecycleRecord | undefined> {
    const database = databaseFromSession(command.transaction);
    let result;
    if (command.action === "edit" && command.input) {
      const { description, genderOptionId, isDeceased } = command.input;
      result = await sql<PersonRow>`
        update crm.people set
          given_name = ${command.input.givenName},
          middle_name = ${command.input.middleName ?? null},
          family_name = ${command.input.familyName ?? null},
          nickname = ${command.input.nickname ?? null},
          description = ${
        description === undefined ? sql`description` : description || null
      },
          gender_option_id = ${
        genderOptionId === undefined
          ? sql`gender_option_id`
          : sql`${genderOptionId || null}::uuid`
      },
          is_deceased = ${isDeceased ?? sql`is_deceased`},
          is_partial = ${command.input.isPartial},
          updated_at = greatest(
            ${command.occurredAt}::timestamptz,
            updated_at + interval '1 microsecond'
          )
        where id = ${command.personId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and deleted_at is null and archived_at is null
        returning ${PERSON_COLUMNS}
      `.execute(database);
    } else if (command.action === "archive") {
      result = await sql<PersonRow>`
        update crm.people set archived_at = greatest(
            ${command.occurredAt}::timestamptz,
            updated_at + interval '1 microsecond'
          ),
          updated_at = greatest(
            ${command.occurredAt}::timestamptz,
            updated_at + interval '1 microsecond'
          )
        where id = ${command.personId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and deleted_at is null and archived_at is null
        returning ${PERSON_COLUMNS}
      `.execute(database);
    } else if (command.action === "restore") {
      result = await sql<PersonRow>`
        update crm.people set archived_at = null,
          updated_at = greatest(
            ${command.occurredAt}::timestamptz,
            updated_at + interval '1 microsecond'
          )
        where id = ${command.personId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and deleted_at is null and archived_at is not null
        returning ${PERSON_COLUMNS}
      `.execute(database);
    } else if (command.action === "delete") {
      result = await sql<PersonRow>`
        update crm.people set deleted_at = greatest(
            ${command.occurredAt}::timestamptz,
            updated_at + interval '1 microsecond'
          ),
          updated_at = greatest(
            ${command.occurredAt}::timestamptz,
            updated_at + interval '1 microsecond'
          )
        where id = ${command.personId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and deleted_at is null
        returning ${PERSON_COLUMNS}
      `.execute(database);
    } else {
      return undefined;
    }
    const row = result.rows[0];
    return row ? record(row) : undefined;
  }

  async assertPostcondition(
    command: Parameters<PersonLifecycleRepository["assertPostcondition"]>[0],
  ): Promise<void> {
    const expectedArchived = command.action === "delete"
      ? command.before.lifecycle === "archived"
      : command.person.lifecycle === "archived";
    const expectedDeleted = command.person.lifecycle === "deleted";
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid
      from crm.people
      where id = ${command.person.id}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and given_name = ${command.person.givenName}
        and middle_name is not distinct from ${
      command.person.middleName ?? null
    }
        and family_name is not distinct from ${
      command.person.familyName ?? null
    }
        and nickname is not distinct from ${command.person.nickname ?? null}
        and description is not distinct from ${
      command.person.description ?? null
    }
        and gender_option_id is not distinct from ${
      command.person.genderOptionId ?? null
    }::uuid
        and is_deceased = ${command.person.isDeceased}
        and is_partial = ${command.person.isPartial}
        and (archived_at is not null) = ${expectedArchived}
        and (deleted_at is not null) = ${expectedDeleted}
        and ${instantColumn("updated_at")} = ${command.person.updatedAt}
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error(`Person ${command.action} postcondition failed.`);
    }
  }
}
