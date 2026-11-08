import { type Kysely, sql } from "kysely";
import type { Failure } from "../../../../shared-kernel/result.ts";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { writeWithinWorkspace } from "../../../../platform/postgres/transactions.ts";
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
  | Failure<"unavailable", "corrupt" | "missing">
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

/**
 * `createExportManagement` refuses a member role and revalidates the actor
 * before any of this runs, so these queries scope by workspace alone.
 */
export class PostgresExportFileBoundary implements ExportFileBoundary {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly dependencies: ExportFileBoundaryDependencies,
  ) {}

  /**
   * Runs one statement in its own short transaction in the export's
   * workspace (ADR 0008), so no transaction stays open across the object
   * store calls between them.
   */
  #scoped<Row>(
    workspaceId: string,
    query: { execute(database: Kysely<ApplicationDatabase>): Promise<Row> },
  ): Promise<Row> {
    return writeWithinWorkspace(
      this.database,
      workspaceId,
      (database) => query.execute(database),
    );
  }

  async discard(
    command: Parameters<ExportFileBoundary["discard"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["discard"]>>> {
    const result = await this.#scoped(
      command.workspaceId,
      sql<{ readonly storage_key: string }>`
      select stored.storage_key
      from crm.files stored
      where stored.workspace_id = ${command.workspaceId}::uuid
        and stored.id = ${command.fileId}::uuid and stored.deleted_at is null
    `,
    );
    const file = result.rows[0];
    if (!file) return { status: "forbidden" };
    try {
      await this.dependencies.storage.remove({ key: file.storage_key });
      await this.#scoped(
        command.workspaceId,
        sql`update crm.files set status = 'quarantined', updated_at = now()
        where id = ${command.fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`,
      );
      return { status: "discarded" };
    } catch {
      return { status: "unavailable" };
    }
  }

  async recover(
    command: Parameters<ExportFileBoundary["recover"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["recover"]>>> {
    const result = await this.#scoped(
      command.workspaceId,
      sql<FileRow>`
      select stored.id::text, stored.original_filename as filename,
        stored.mime_type, stored.status, stored.storage_key,
        stored.byte_size::text, stored.checksum_sha256
      from crm.files stored
      where stored.workspace_id = ${command.workspaceId}::uuid
        and stored.metadata ->> 'exportId' = ${command.exportId}
        and stored.status in ('available', 'processing')
        and stored.deleted_at is null
      order by stored.created_at desc, stored.id desc
      limit 1
    `,
    );
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
      await this.#scoped(
        command.workspaceId,
        sql`update crm.files set status = ${
          checked.status === "corrupt" ? "quarantined" : "missing"
        }, updated_at = now()
        where id = ${file.id}::uuid and workspace_id = ${command.workspaceId}::uuid`,
      );
      return { status: "absent" };
    }
    if (file.status !== "available") {
      await this.#scoped(
        command.workspaceId,
        sql`update crm.files set status = 'available', updated_at = now()
        where id = ${file.id}::uuid and workspace_id = ${command.workspaceId}::uuid`,
      );
    }
    return { bytes: checked.bytes, fileId: file.id, status: "stored" };
  }

  async store(
    command: Parameters<ExportFileBoundary["store"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["store"]>>> {
    const fileId = this.dependencies.ids.next();
    const storageKey = this.dependencies.keys.next();
    const inserted = await this.#scoped(
      command.workspaceId,
      sql<{ readonly id: string }>`
      insert into crm.files (
        id, workspace_id, uploaded_by_member_id, original_filename,
        storage_provider, storage_bucket, storage_key, byte_size, mime_type,
        checksum_sha256, status, visibility, metadata
      )
      values (
        ${fileId}::uuid, ${command.workspaceId}::uuid,
        ${command.memberId}::uuid, ${command.filename},
        ${this.dependencies.storage.provider}, ${this.dependencies.storage.bucket},
        ${storageKey}, ${command.bytes.byteLength}, ${command.mimeType},
        ${command.checksumSha256}, 'processing', 'private',
        ${JSON.stringify({ exportId: command.exportId })}::text::jsonb
      )
      returning id::text
    `,
    );
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
        await this.#scoped(
          command.workspaceId,
          sql`update crm.files set status = ${
            checked.status === "corrupt" ? "quarantined" : "missing"
          }, updated_at = now()
          where id = ${fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`,
        ).catch(() => undefined);
        return { status: "unavailable" };
      }
    }
    await this.#scoped(
      command.workspaceId,
      sql`update crm.files set status = 'available', updated_at = now()
      where id = ${fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`,
    );
    return { fileId, status: "stored" };
  }

  async read(
    command: Parameters<ExportFileBoundary["read"]>[0],
  ): Promise<Awaited<ReturnType<ExportFileBoundary["read"]>>> {
    const result = await this.#scoped(
      command.workspaceId,
      sql<FileRow>`
      select stored.id::text, stored.original_filename as filename,
        stored.mime_type, stored.status, stored.storage_key,
        stored.byte_size::text, stored.checksum_sha256
      from crm.files stored
      where stored.workspace_id = ${command.workspaceId}::uuid
        and stored.id = ${command.fileId}::uuid and stored.deleted_at is null
    `,
    );
    const file = result.rows[0];
    if (!file) return { status: "not-found" };
    if (file.status !== "available") return { status: "missing" };
    const checked = await verified(this.dependencies.storage, file);
    if (checked.status === "unavailable") return { status: "unavailable" };
    if (checked.status !== "valid") {
      await this.#scoped(
        command.workspaceId,
        sql`update crm.files set status = ${
          checked.status === "corrupt" ? "quarantined" : "missing"
        }, updated_at = now()
        where id = ${command.fileId}::uuid and workspace_id = ${command.workspaceId}::uuid`,
      );
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
