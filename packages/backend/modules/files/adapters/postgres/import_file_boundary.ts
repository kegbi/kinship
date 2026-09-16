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
      values (
        ${command.fileId}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid, ${command.originalFilename},
        'import-manifest', ${command.byteSize}, 'missing', 'private',
        ${
      JSON.stringify({ importId: command.importId, source: "monica" })
    }::text::jsonb
      )
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported file context is invalid.");
  }
}
