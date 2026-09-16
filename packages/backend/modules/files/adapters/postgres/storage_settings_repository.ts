import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  StorageFileLookupItem,
  StorageSettingsRepository,
} from "../../application/storage_settings.ts";

interface UsageRow {
  readonly available: string;
  readonly missing: string;
  readonly processing: string;
  readonly quarantined: string;
  readonly total_bytes: string;
  readonly total_files: string;
}

interface LookupRow {
  readonly byte_size: string;
  readonly created_at: string;
  readonly file_id: string;
  readonly filename: string;
  readonly kind: StorageFileLookupItem["kind"];
  readonly mime_type: string;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly status: StorageFileLookupItem["status"];
  readonly title: string;
}

export class PostgresStorageSettingsRepository
  implements StorageSettingsRepository {
  async read(
    command: Parameters<StorageSettingsRepository["read"]>[0],
  ): Promise<Awaited<ReturnType<StorageSettingsRepository["read"]>>> {
    const database = databaseFromSession(command.transaction);
    const usage = await sql<UsageRow>`
      select
        count(*) filter (where status = 'available')::text as available,
        count(*) filter (where status = 'missing')::text as missing,
        count(*) filter (where status = 'processing')::text as processing,
        count(*) filter (where status = 'quarantined')::text as quarantined,
        coalesce(sum(byte_size), 0)::text as total_bytes,
        count(*)::text as total_files
      from crm.files
      where workspace_id = ${command.workspaceId}::uuid
        and deleted_at is null and status <> 'deleted'
    `.execute(database);
    const row = usage.rows[0]!;
    let files: readonly StorageFileLookupItem[] = [];
    if (command.query) {
      const lookup = await sql<LookupRow>`
        select stored.id::text as file_id,
          coalesce(stored.original_filename, 'Unnamed file') as filename,
          coalesce(link.kind, 'unlinked') as kind,
          coalesce(link.title, stored.original_filename, 'Unnamed file') as title,
          coalesce(stored.byte_size, 0)::text as byte_size,
          coalesce(stored.mime_type, 'application/octet-stream') as mime_type,
          stored.status,
          person.id::text as person_id,
          nullif(trim(concat_ws(' ', person.given_name, person.family_name)), '') as person_name,
          ${instantColumn("stored.created_at")} as created_at
        from crm.files stored
        left join lateral (
          select candidate.person_id, candidate.kind, candidate.title
          from crm.person_file_links candidate
          where candidate.file_id = stored.id
            and exists (
              select 1 from crm.people linked_person
              where linked_person.id = candidate.person_id
                and linked_person.workspace_id = stored.workspace_id
            )
          order by candidate.created_at, candidate.id
          limit 1
        ) link on true
        left join crm.people person on person.id = link.person_id
          and person.workspace_id = stored.workspace_id
        where stored.workspace_id = ${command.workspaceId}::uuid
          and stored.deleted_at is null and stored.status <> 'deleted'
          and (
            stored.id::text = ${command.query}
            or stored.original_filename ilike ${`%${command.query}%`}
            or link.title ilike ${`%${command.query}%`}
            or person.given_name ilike ${`%${command.query}%`}
            or person.family_name ilike ${`%${command.query}%`}
          )
        order by stored.created_at desc, stored.id desc
        limit 20
      `.execute(database);
      files = lookup.rows.map((item) => ({
        byteSize: Number(item.byte_size),
        createdAt: item.created_at,
        fileId: item.file_id,
        filename: item.filename,
        kind: item.kind,
        mimeType: item.mime_type,
        ...pickDefined({
          personId: item.person_id,
          personName: item.person_name,
        }),
        status: item.status,
        title: item.title,
      }));
    }
    return {
      files,
      status: "ready",
      usage: {
        available: Number(row.available),
        missing: Number(row.missing),
        processing: Number(row.processing),
        quarantined: Number(row.quarantined),
        totalBytes: Number(row.total_bytes),
        totalFiles: Number(row.total_files),
      },
    };
  }
}
