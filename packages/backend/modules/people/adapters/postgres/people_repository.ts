import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  PeopleRepository,
  PeopleTransaction,
  PersonIdentity,
  PersonIdentityLookup,
  PossibleDuplicate,
} from "../../application/create_person.ts";

interface DuplicateRow {
  readonly family_name: string | null;
  readonly given_name: string;
  readonly id: string;
  readonly nickname: string | null;
}

function displayName(row: DuplicateRow): string {
  const formal = [row.given_name, row.family_name].filter(Boolean).join(" ");
  return formal || row.nickname || "Unnamed person";
}

export class PostgresPeopleTransaction {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<T>(
    work: (transaction: PeopleTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction().execute((transaction) =>
      work({ opaque: transaction })
    );
  }
}

export class PostgresPeopleRepository implements PeopleRepository {
  async lockRequest(
    command: Parameters<PeopleRepository["lockRequest"]>[0],
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.id},0))`
      .execute(databaseFromSession(command.transaction));
  }
  async findPossibleDuplicates(
    command: Parameters<PeopleRepository["findPossibleDuplicates"]>[0],
  ): Promise<readonly PossibleDuplicate[]> {
    const result = await sql<DuplicateRow>`
      select id::text, given_name, family_name, nickname
      from crm.people
      where workspace_id = ${command.workspaceId}::uuid
        and archived_at is null
        and deleted_at is null
        and lower(btrim(given_name)) = lower(btrim(${command.givenName}))
        and lower(btrim(coalesce(family_name, ''))) =
          lower(btrim(${command.familyName ?? ""}))
        and lower(btrim(coalesce(nickname, ''))) =
          lower(btrim(${command.nickname ?? ""}))
      order by created_at asc, id asc
      limit 5
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      displayName: displayName(row),
      id: row.id,
    }));
  }

  async getIdentity(
    command: Parameters<PeopleRepository["getIdentity"]>[0],
  ): Promise<PersonIdentityLookup> {
    const result = await sql<{
      readonly archived_at: Date | null;
      readonly family_name: string | null;
      readonly given_name: string;
      readonly id: string;
      readonly is_partial: boolean;
      readonly middle_name: string | null;
      readonly nickname: string | null;
    }>`
      select person.id::text, person.given_name, person.middle_name,
        person.family_name, person.nickname, person.is_partial,
        person.archived_at
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    if (!row) return { status: "not-found" };
    return {
      person: {
        ...(row.family_name ? { familyName: row.family_name } : {}),
        givenName: row.given_name,
        id: row.id,
        isPartial: row.is_partial,
        ...(row.middle_name ? { middleName: row.middle_name } : {}),
        ...(row.nickname ? { nickname: row.nickname } : {}),
      },
      status: row.archived_at ? "archived" : "ready",
    };
  }

  async create(
    command: Parameters<PeopleRepository["create"]>[0],
  ): Promise<PersonIdentity | undefined> {
    const result = await sql<{
      readonly family_name: string | null;
      readonly given_name: string;
      readonly id: string;
      readonly is_partial: boolean;
      readonly middle_name: string | null;
      readonly nickname: string | null;
    }>`
      insert into crm.people (
        id, workspace_id, created_by_member_id, given_name, middle_name,
        family_name, nickname, is_partial, created_at, updated_at
      )
      values (
        ${command.id}::uuid, ${command.workspaceId}::uuid,
        ${command.memberId}::uuid, ${command.givenName},
        ${command.middleName ?? null}, ${command.familyName ?? null},
        ${command.nickname ?? null}, ${command.isPartial}, now(), now()
      )
      returning id::text, given_name, middle_name, family_name, nickname,
        is_partial
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? {
        ...(row.family_name ? { familyName: row.family_name } : {}),
        givenName: row.given_name,
        id: row.id,
        isPartial: row.is_partial,
        ...(row.middle_name ? { middleName: row.middle_name } : {}),
        ...(row.nickname ? { nickname: row.nickname } : {}),
      }
      : undefined;
  }

  async assertCreatedPostcondition(
    command: Parameters<PeopleRepository["assertCreatedPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid
      from crm.people
      where id = ${command.id}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and created_by_member_id = ${command.memberId}::uuid
        and given_name = ${command.givenName}
        and middle_name is not distinct from ${command.middleName ?? null}
        and family_name is not distinct from ${command.familyName ?? null}
        and nickname is not distinct from ${command.nickname ?? null}
        and is_partial = ${command.isPartial}
        and archived_at is null and deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Created person postcondition failed.");
    }
  }
}
