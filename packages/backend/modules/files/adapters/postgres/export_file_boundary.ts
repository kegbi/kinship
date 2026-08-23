import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  ExportFileBoundary,
  ExportFileBoundaryDependencies,
} from "../../application/export_file_boundary.ts";

interface FileRow {
  readonly byte_size: string | null;
  readonly checksum_sha256: string | null;
  readonly filename: string;
  readonly id: string;
  readonly mime_type: string;
  readonly status: string;
  readonly storage_key: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function verified(
  storage: ExportFileBoundaryDependencies["storage"],
  file: Pick<FileRow, "byte_size" | "checksum_sha256" | "storage_key">,
): Promise<
  | { readonly bytes: Uint8Array; readonly status: "valid" }
  | { readonly status: "corrupt" | "missing" | "unavailable" }
> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await storage.get({ key: file.storage_key });
  } catch {
    return { status: "unavailable" };
  }
  if (!bytes) return { status: "missing" };
  if (
    file.byte_size === null || file.checksum_sha256 === null ||
    BigInt(file.byte_size) !== BigInt(bytes.byteLength) ||
    await sha256(bytes) !== file.checksum_sha256
  ) return { status: "corrupt" };
  return { bytes, status: "valid" };
}

const activeAdmin = (command: {
  readonly memberId: string;
  readonly role: string;
  readonly userId: string;
  readonly workspaceId: string;
}) =>
  sql`
  account.id = ${command.userId}::uuid
  and account.status = 'active' and account.deleted_at is null
  and member.id = ${command.memberId}::uuid and member.user_id = account.id
  and member.workspace_id = ${command.workspaceId}::uuid
  and member.role = ${command.role} and member.role in ('owner', 'admin')
  and member.status = 'active' and member.left_at is null
  and workspace.id = ${command.workspaceId}::uuid
  and workspace.status = 'active' and workspace.deleted_at is null
`;

export class PostgresExportFileBoundary implements ExportFileBoundary {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly dependencies: ExportFileBoundaryDependencies,
  ) {}

  async discard(
    command: Parameters<ExportFileBoundary["discard"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["discard"]>>> {
    const result = await sql<{ readonly storage_key: string }>`
      select stored.storage_key
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      join crm.files stored on stored.workspace_id = workspace.id
        and stored.id = ${command.fileId}::uuid and stored.deleted_at is null
      where ${activeAdmin(command)}
    `.execute(this.database);
    const file = result.rows[0];
    if (!file) return { status: "forbidden" };
    try {
      await this.dependencies.storage.remove({ key: file.storage_key });
      await sql`update crm.files set status = 'quarantined', updated_at = now()
        where id = ${command.fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`
        .execute(this.database);
      return { status: "discarded" };
    } catch {
      return { status: "unavailable" };
    }
  }

  async recover(
    command: Parameters<ExportFileBoundary["recover"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["recover"]>>> {
    const result = await sql<FileRow>`
      select stored.id::text, stored.original_filename as filename,
        stored.mime_type, stored.status, stored.storage_key,
        stored.byte_size::text, stored.checksum_sha256
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      join crm.files stored on stored.workspace_id = workspace.id
        and stored.metadata ->> 'exportId' = ${command.exportId}
        and stored.status in ('available', 'processing')
        and stored.deleted_at is null
      where ${activeAdmin(command)}
      order by stored.created_at desc, stored.id desc
      limit 1
    `.execute(this.database);
    const file = result.rows[0];
    if (!file) return { status: "absent" };
    const checked = await verified(this.dependencies.storage, file);
    if (checked.status === "unavailable") return { status: "unavailable" };
    if (checked.status !== "valid") {
      if (checked.status === "corrupt") {
        await this.dependencies.storage.remove({ key: file.storage_key }).catch(
          () => undefined,
        );
      }
      await sql`update crm.files set status = ${
        checked.status === "corrupt" ? "quarantined" : "missing"
      }, updated_at = now()
        where id = ${file.id}::uuid and workspace_id = ${command.workspaceId}::uuid`
        .execute(this.database);
      return { status: "absent" };
    }
    if (file.status !== "available") {
      await sql`update crm.files set status = 'available', updated_at = now()
        where id = ${file.id}::uuid and workspace_id = ${command.workspaceId}::uuid`
        .execute(this.database);
    }
    return { bytes: checked.bytes, fileId: file.id, status: "stored" };
  }

  async store(
    command: Parameters<ExportFileBoundary["store"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["store"]>>> {
    const fileId = this.dependencies.ids.next();
    const storageKey = this.dependencies.keys.next();
    const inserted = await sql<{ readonly id: string }>`
      insert into crm.files (
        id, workspace_id, uploaded_by_member_id, original_filename,
        storage_provider, storage_bucket, storage_key, byte_size, mime_type,
        checksum_sha256, status, visibility, metadata
      )
      select ${fileId}::uuid, workspace.id, member.id, ${command.filename},
        ${this.dependencies.storage.provider}, ${this.dependencies.storage.bucket},
        ${storageKey}, ${command.bytes.byteLength}, ${command.mimeType},
        ${command.checksumSha256}, 'processing', 'private',
        ${JSON.stringify({ exportId: command.exportId })}::text::jsonb
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where ${activeAdmin(command)}
      returning id::text
    `.execute(this.database);
    if (!inserted.rows[0]) return { status: "forbidden" };
    try {
      await this.dependencies.storage.put({
        bytes: command.bytes,
        key: storageKey,
        mimeType: command.mimeType,
      });
    } catch {
      const checked = await verified(this.dependencies.storage, {
        byte_size: String(command.bytes.byteLength),
        checksum_sha256: command.checksumSha256,
        storage_key: storageKey,
      });
      if (checked.status === "unavailable") {
        return { status: "unavailable" };
      }
      if (checked.status !== "valid") {
        if (checked.status === "corrupt") {
          await this.dependencies.storage.remove({ key: storageKey }).catch(
            () => undefined,
          );
        }
        await sql`update crm.files set status = ${
          checked.status === "corrupt" ? "quarantined" : "missing"
        }, updated_at = now()
          where id = ${fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`
          .execute(this.database).catch(() => undefined);
        return { status: "unavailable" };
      }
    }
    await sql`update crm.files set status = 'available', updated_at = now()
      where id = ${fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`
      .execute(this.database);
    return { fileId, status: "stored" };
  }

  async read(
    command: Parameters<ExportFileBoundary["read"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["read"]>>> {
    const result = await sql<FileRow>`
      select stored.id::text, stored.original_filename as filename,
        stored.mime_type, stored.status, stored.storage_key,
        stored.byte_size::text, stored.checksum_sha256
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      join crm.files stored on stored.workspace_id = workspace.id
        and stored.id = ${command.fileId}::uuid and stored.deleted_at is null
      where ${activeAdmin(command)}
    `.execute(this.database);
    const file = result.rows[0];
    if (!file) return { status: "not-found" };
    if (file.status !== "available") return { status: "missing" };
    const checked = await verified(this.dependencies.storage, file);
    if (checked.status === "unavailable") return { status: "unavailable" };
    if (checked.status !== "valid") {
      await sql`update crm.files set status = ${
        checked.status === "corrupt" ? "quarantined" : "missing"
      }, updated_at = now()
        where id = ${command.fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`
        .execute(this.database);
      return checked.status === "missing"
        ? { status: "missing" }
        : { status: "unavailable" };
    }
    return {
      bytes: checked.bytes,
      filename: file.filename,
      mimeType: file.mime_type,
      status: "ready",
    };
  }
}
