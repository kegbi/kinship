import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
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
    const authorization = await sql<{ readonly authorized: boolean }>`
      select exists (
        select 1
        from crm.users account
        join crm.workspace_members member on member.user_id = account.id
        join crm.workspaces workspace on workspace.id = member.workspace_id
        where account.id = ${command.userId}::uuid
          and account.status = 'active' and account.deleted_at is null
          and member.id = ${command.memberId}::uuid
          and member.workspace_id = ${command.workspaceId}::uuid
          and member.role = ${command.role}
          and member.role in ('owner', 'admin')
          and member.status = 'active' and member.left_at is null
          and workspace.id = ${command.workspaceId}::uuid
          and workspace.status = 'active' and workspace.deleted_at is null
      ) as authorized
    `.execute(database);
    if (!authorization.rows[0]?.authorized) return { status: "forbidden" };

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
          to_char(stored.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
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
        ...(item.person_id ? { personId: item.person_id } : {}),
        ...(item.person_name ? { personName: item.person_name } : {}),
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
