import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  FileMetadataRepository,
  PersonFileKind,
  PersonFileStatus,
  StoredPersonFile,
} from "../../application/person_files.ts";

interface FileRow {
  readonly byte_size: string;
  readonly checksum_sha256: string | null;
  readonly created_at: string;
  readonly file_id: string;
  readonly filename: string;
  readonly kind: PersonFileKind;
  readonly mime_type: string;
  readonly person_id: string;
  readonly status: PersonFileStatus;
  readonly storage_key: string;
  readonly title: string;
}

function file(row: FileRow): StoredPersonFile {
  return {
    byteSize: Number(row.byte_size),
    ...pickDefined({ checksumSha256: row.checksum_sha256 }),
    createdAt: row.created_at,
    fileId: row.file_id,
    filename: row.filename,
    kind: row.kind,
    mimeType: row.mime_type,
    personId: row.person_id,
    status: row.status,
    storageKey: row.storage_key,
    title: row.title,
  };
}

const selectedColumns = sql`
  stored.id::text as file_id, link.person_id::text,
  stored.original_filename as filename, link.kind, link.title,
  stored.byte_size::text, stored.mime_type, stored.checksum_sha256,
  stored.status, stored.storage_key,
  ${instantColumn("stored.created_at")} as created_at
`;

/**
 * The subject of every file operation: a person this workspace still owns.
 * The actor's own standing is `ActorRevalidation`'s question, asked by
 * `createPersonFileManagement` before any of these run, so this repository
 * scopes by workspace and aggregate ownership alone.
 */
const ownedPerson = (command: {
  readonly personId: string;
  readonly workspaceId: string;
}) =>
  sql`
  person.id = ${command.personId}::uuid
  and person.workspace_id = ${command.workspaceId}::uuid
`;

export class PostgresFileMetadataRepository implements FileMetadataRepository {
  async authorizeUpload(
    command: Parameters<FileMetadataRepository["authorizeUpload"]>[0],
  ): Promise<Awaited<ReturnType<FileMetadataRepository["authorizeUpload"]>>> {
    const result = await sql<{ readonly person_id: string }>`
      select person.id::text as person_id
      from crm.people person
      where ${ownedPerson(command)}
        and person.archived_at is null and person.deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? { status: "authorized" } : { status: "not-found" };
  }

  async reserveUpload(
    command: Parameters<FileMetadataRepository["reserveUpload"]>[0],
  ): Promise<Awaited<ReturnType<FileMetadataRepository["reserveUpload"]>>> {
    const result = await sql<FileRow>`
      with authorized as (
        select person.id
        from crm.people person
        where ${ownedPerson(command)}
          and person.archived_at is null and person.deleted_at is null
      ), stored as (
        insert into crm.files (
          id, workspace_id, uploaded_by_member_id, original_filename,
          storage_provider, storage_bucket, storage_key, byte_size, mime_type,
          checksum_sha256, status, visibility, created_at, updated_at
        )
        select ${command.fileId}::uuid, ${command.workspaceId}::uuid,
          ${command.memberId}::uuid, ${command.filename},
          ${command.storageProvider}, ${command.storageBucket},
          ${command.storageKey}, ${command.byteSize}, ${command.mimeType},
          ${command.checksumSha256}, 'processing', 'private',
          ${command.occurredAt}, ${command.occurredAt}
        from authorized
        returning *
      ), link as (
        insert into crm.person_file_links (
          person_id, file_id, kind, title, created_at, updated_at
        )
        select authorized.id, stored.id, ${command.kind}, ${command.title},
          ${command.occurredAt}, ${command.occurredAt}
        from authorized cross join stored
        returning *
      )
      select ${selectedColumns}
      from stored cross join link
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? { file: file(row), status: "reserved" }
      : { status: "not-found" };
  }

  async finalizeUpload(
    command: Parameters<FileMetadataRepository["finalizeUpload"]>[0],
  ): Promise<Awaited<ReturnType<FileMetadataRepository["finalizeUpload"]>>> {
    const result = await sql<FileRow>`
      with authorized as (
        select person.id
        from crm.people person
        where ${ownedPerson(command)}
          and person.archived_at is null and person.deleted_at is null
      ), updated as (
        update crm.files stored set status = ${command.status},
          updated_at = ${command.occurredAt}
        from authorized
        where stored.id = ${command.fileId}::uuid
          and stored.workspace_id = ${command.workspaceId}::uuid
          and stored.status = 'processing'
        returning stored.*
      )
      select ${selectedColumns}
      from updated stored
      join crm.person_file_links link on link.file_id = stored.id
        and link.person_id = ${command.personId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? { file: file(row), status: "created" }
      : { status: "not-found" };
  }

  async find(
    command: Parameters<FileMetadataRepository["find"]>[0],
  ): Promise<Awaited<ReturnType<FileMetadataRepository["find"]>>> {
    const result = await sql<FileRow>`
      select ${selectedColumns}
      from crm.people person
      join crm.person_file_links link on link.person_id = person.id
      join crm.files stored on stored.id = link.file_id
        and stored.workspace_id = person.workspace_id
      where ${ownedPerson(command)} and person.deleted_at is null
        and stored.id = ${command.fileId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? { file: file(row), status: "found" } : { status: "not-found" };
  }

  async list(
    command: Parameters<FileMetadataRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<FileMetadataRepository["list"]>>> {
    const database = databaseFromSession(command.transaction);
    const authorized = await sql<{ readonly person_id: string }>`
      select person.id::text as person_id
      from crm.people person
      where ${ownedPerson(command)} and person.deleted_at is null
    `.execute(database);
    if (!authorized.rows[0]) return { status: "not-found" };
    const result = await sql<FileRow>`
      select ${selectedColumns}
      from crm.person_file_links link
      join crm.files stored on stored.id = link.file_id
        and stored.workspace_id = ${command.workspaceId}::uuid
      where link.person_id = ${command.personId}::uuid
        and stored.deleted_at is null and stored.status <> 'deleted'
      order by case link.kind when 'photo' then 0 else 1 end,
        link.sort_order, stored.created_at desc, stored.id
    `.execute(database);
    return { files: result.rows.map(file), status: "ready" };
  }

  async markMissing(
    command: Parameters<FileMetadataRepository["markMissing"]>[0],
  ): Promise<void> {
    await sql`
      update crm.files stored set status = 'missing', updated_at = ${command.occurredAt}
      where stored.id = ${command.fileId}::uuid
        and stored.workspace_id = ${command.workspaceId}::uuid
        and stored.status in ('available', 'processing')
    `.execute(databaseFromSession(command.transaction));
  }

  async recordRead(
    command: Parameters<FileMetadataRepository["recordRead"]>[0],
  ): Promise<void> {
    await sql`
      update crm.person_file_links link
      set download_count = download_count + 1, updated_at = now()
      where link.person_id = ${command.personId}::uuid
        and link.file_id = ${command.fileId}::uuid
        and exists (
          select 1 from crm.files stored
          where stored.id = link.file_id
            and stored.workspace_id = ${command.workspaceId}::uuid
            and stored.status = 'available' and stored.deleted_at is null
        )
    `.execute(databaseFromSession(command.transaction));
  }

  async reserveRemoval(
    command: Parameters<FileMetadataRepository["reserveRemoval"]>[0],
  ): Promise<Awaited<ReturnType<FileMetadataRepository["reserveRemoval"]>>> {
    const database = databaseFromSession(command.transaction);
    const result = await sql<FileRow>`
      select ${selectedColumns}
      from crm.people person
      join crm.person_file_links link on link.person_id = person.id
      join crm.files stored on stored.id = link.file_id
        and stored.workspace_id = person.workspace_id
        and stored.deleted_at is null
      where ${ownedPerson(command)}
        and person.archived_at is null and person.deleted_at is null
        and stored.id = ${command.fileId}::uuid
      for update of stored
    `.execute(database);
    const row = result.rows[0];
    if (!row) return { status: "not-found" };
    if (row.status === "processing") return { status: "processing" };
    await sql`
      update crm.files stored set status = 'processing', updated_at = ${command.occurredAt}
      where stored.id = ${command.fileId}::uuid
        and stored.workspace_id = ${command.workspaceId}::uuid
    `.execute(database);
    return { file: file(row), status: "reserved" };
  }

  async finalizeRemoval(
    command: Parameters<FileMetadataRepository["finalizeRemoval"]>[0],
  ): Promise<Awaited<ReturnType<FileMetadataRepository["finalizeRemoval"]>>> {
    const database = databaseFromSession(command.transaction);
    const result = await sql<FileRow>`
      select ${selectedColumns}
      from crm.people person
      join crm.person_file_links link on link.person_id = person.id
      join crm.files stored on stored.id = link.file_id
        and stored.workspace_id = person.workspace_id
        and stored.deleted_at is null
      where ${ownedPerson(command)}
        and person.archived_at is null and person.deleted_at is null
        and stored.id = ${command.fileId}::uuid and stored.status = 'processing'
      for update of stored
    `.execute(database);
    const row = result.rows[0];
    if (!row) return { status: "not-found" };
    await sql`
      delete from crm.person_file_links link
      where link.person_id = ${command.personId}::uuid
        and link.file_id = ${command.fileId}::uuid
    `.execute(database);
    await sql`
      update crm.files stored set status = 'deleted', deleted_at = ${command.occurredAt},
        updated_at = ${command.occurredAt}, storage_key = null
      where stored.id = ${command.fileId}::uuid
        and stored.workspace_id = ${command.workspaceId}::uuid
    `.execute(database);
    return { file: file(row), status: "removed" };
  }
}
