import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  TagPersonalizationCommand,
  TagPersonalizationEntry,
  TagPersonalizationFacade,
} from "../../application/tag_personalization.ts";

interface TagRow {
  readonly id: string;
  readonly name: string;
  readonly referenceCount: number;
  readonly updatedAt: string;
}

function entry(row: TagRow): TagPersonalizationEntry {
  return {
    capabilities: {
      delete: true,
      disable: false,
      editValue: false,
      rename: true,
      reorder: false,
      replace: true,
      setDefault: false,
    },
    canDelete: true,
    id: row.id,
    isActive: true,
    isDefault: false,
    kind: "named",
    name: row.name,
    readOnly: false,
    referenceCount: row.referenceCount,
    sortOrder: 0,
    updatedAt: row.updatedAt.replace(" ", "T").replace(/\+00$/, "Z"),
  };
}

const UNIQUE_CONFLICT = Symbol("people-tag-personalization-unique-conflict");

async function writeWithUniqueConflict<T>(
  database: ReturnType<typeof databaseFromSession>,
  write: () => Promise<T>,
): Promise<T | typeof UNIQUE_CONFLICT> {
  await sql`savepoint people_tag_personalization_write`.execute(database);
  try {
    const result = await write();
    await sql`release savepoint people_tag_personalization_write`.execute(
      database,
    );
    return result;
  } catch (error) {
    await sql`rollback to savepoint people_tag_personalization_write`.execute(
      database,
    );
    await sql`release savepoint people_tag_personalization_write`.execute(
      database,
    );
    if (
      typeof error === "object" && error !== null && "code" in error &&
      error.code === "23505"
    ) return UNIQUE_CONFLICT;
    throw error;
  }
}

async function find(
  command: TagPersonalizationCommand & { readonly id: string },
): Promise<TagRow | undefined> {
  const result = await sql<TagRow>`
    select t.id::text, t.name, count(pt.person_id)::int as "referenceCount",
      t.updated_at::text as "updatedAt"
    from crm.tags t left join crm.person_tags pt on pt.tag_id = t.id
    where t.id = ${command.id}::uuid and t.workspace_id = ${command.workspaceId}::uuid
    group by t.id
  `.execute(databaseFromSession(command.transaction));
  return result.rows[0];
}

export class PostgresTagPersonalization implements TagPersonalizationFacade {
  async list(
    command: TagPersonalizationCommand,
  ): Promise<unknown> {
    if (command.section !== "tags") return { status: "unavailable" };
    const result = await sql<TagRow>`
      select t.id::text, t.name, count(pt.person_id)::int as "referenceCount",
        t.updated_at::text as "updatedAt"
      from crm.tags t left join crm.person_tags pt on pt.tag_id = t.id
      where t.workspace_id = ${command.workspaceId}::uuid group by t.id
      order by lower(t.name), t.id
    `.execute(databaseFromSession(command.transaction));
    return {
      capabilities: { create: true, editValue: false },
      entries: result.rows.map(entry),
      readOnly: false,
      status: "ready",
    };
  }

  async inspect(
    command: TagPersonalizationCommand,
  ): Promise<unknown> {
    if (command.section !== "tags") return { status: "unavailable" };
    if (!command.id) return { status: "not-found" };
    const row = await find({ ...command, id: command.id });
    return row
      ? { entry: entry(row), status: "ready" }
      : { status: "not-found" };
  }

  async mutate(
    command: TagPersonalizationCommand,
  ): Promise<unknown> {
    if (command.section !== "tags") return { status: "invalid" };
    const database = databaseFromSession(command.transaction);
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.workspaceId}, 29))`
      .execute(database);
    if (command.action === "create" && command.name !== undefined) {
      const slug = command.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const duplicate = await sql<{ readonly duplicate: boolean }>`
        select exists(select 1 from crm.tags where workspace_id = ${command.workspaceId}::uuid
          and (lower(name) = lower(${command.name}) or slug = ${slug})) as duplicate
      `.execute(database);
      if (duplicate.rows[0]?.duplicate) return { status: "conflict" };
      const created = await writeWithUniqueConflict(
        database,
        () =>
          sql<TagRow>`
            insert into crm.tags (workspace_id, name, slug)
            values (${command.workspaceId}::uuid, ${command.name}, ${slug})
            returning id::text, name, 0::int as "referenceCount", updated_at::text as "updatedAt"
          `.execute(database),
      );
      if (created === UNIQUE_CONFLICT) return { status: "conflict" };
      const row = created.rows[0];
      return row
        ? { entry: entry(row), status: "saved" }
        : { status: "unavailable" };
    }
    if (!command.id || !command.expectedUpdatedAt) return { status: "invalid" };
    if (command.replacementId === command.id) return { status: "not-found" };
    const lockedIds = command.replacementId
      ? [command.id, command.replacementId].sort()
      : [command.id];
    const locked = await sql<{ readonly id: string }>`
      select id::text from crm.tags
      where workspace_id = ${command.workspaceId}::uuid
        and id = any(${lockedIds}::uuid[])
      order by id for update
    `.execute(database);
    if (locked.rows.length !== lockedIds.length) return { status: "not-found" };
    const row = await find({ ...command, id: command.id });
    if (!row) return { status: "not-found" };
    if (entry(row).updatedAt !== command.expectedUpdatedAt) {
      return { status: "stale" };
    }
    if (command.action === "update") {
      if (
        command.isActive === false || command.isDefault ||
        (command.sortOrder ?? 0) !== 0
      ) {
        return { status: "invalid" };
      }
      const name = command.name ?? row.name;
      const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const conflict = await sql<{ readonly duplicate: boolean }>`
        select exists(select 1 from crm.tags where workspace_id = ${command.workspaceId}::uuid
          and id <> ${command.id}::uuid and (lower(name) = lower(${name}) or slug = ${slug}))
          as duplicate
      `.execute(database);
      if (conflict.rows[0]?.duplicate) return { status: "conflict" };
      const updated = await writeWithUniqueConflict(
        database,
        () =>
          sql<TagRow>`
            update crm.tags set name = ${name}, slug = ${slug}, updated_at = now()
            where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid
            returning id::text, name,
              (select count(*)::int from crm.person_tags where tag_id = crm.tags.id)
                as "referenceCount", updated_at::text as "updatedAt"
          `.execute(database),
      );
      if (updated === UNIQUE_CONFLICT) return { status: "conflict" };
      const value = updated.rows[0];
      return value
        ? { entry: entry(value), status: "saved" }
        : { status: "not-found" };
    }
    if (row.referenceCount > 0 && !command.replacementId) {
      return {
        referenceCount: row.referenceCount,
        status: "replacement-required",
      };
    }
    if (command.replacementId) {
      await sql`insert into crm.person_tags (person_id, tag_id)
        select person_id, ${command.replacementId}::uuid from crm.person_tags
        where tag_id = ${command.id}::uuid on conflict do nothing`.execute(
        database,
      );
      await sql`delete from crm.person_tags where tag_id = ${command.id}::uuid`
        .execute(database);
    }
    await sql`delete from crm.tags where id = ${command.id}::uuid
      and workspace_id = ${command.workspaceId}::uuid`.execute(database);
    return { id: command.id, status: "deleted" };
  }
}
