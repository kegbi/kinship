import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import {
  assertImportFileRepresentable,
  type FileImportBoundary,
} from "../../application/import_file_boundary.ts";

export class PostgresFileImportBoundary implements FileImportBoundary {
  async representMissing(
    command: Parameters<FileImportBoundary["representMissing"]>[0],
  ): Promise<void> {
    assertImportFileRepresentable(command);
    const result = await sql<{ readonly id: string }>`
      insert into crm.files (
        id, workspace_id, uploaded_by_member_id, original_filename,
        storage_provider, byte_size, status, visibility, metadata
      )
      select ${command.fileId}::uuid, workspace.id,
        ${command.actor.memberId}::uuid, ${command.originalFilename},
        'import-manifest', ${command.byteSize}, 'missing', 'private',
        ${
      JSON.stringify({ importId: command.importId, source: "monica" })
    }::text::jsonb
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.actor.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.actor.memberId}::uuid
        and member.user_id = account.id
        and member.workspace_id = ${command.actor.workspaceId}::uuid
        and member.role = ${command.actor.role}
        and member.role in ('owner', 'admin')
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.actor.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported file context is invalid.");
  }
}
