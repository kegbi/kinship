import type { ImportedPersonReference } from "../../../people/public.ts";
import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { FileBusinessImportBoundary } from "../../application/import_business_boundary.ts";
import { assertImportFileRepresentable } from "../../application/import_file_boundary.ts";

export class PostgresFileBusinessImportBoundary
  implements FileBusinessImportBoundary {
  constructor(private readonly people: ImportedPersonReference) {}
  async fileExists(
    c: {
      id: string;
      workspaceId: string;
      transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean> {
    const result =
      await sql`select id from crm.files where id=${c.id}::uuid and workspace_id=${c.workspaceId}::uuid for key share`
        .execute(databaseFromSession(c.transaction));
    return result.rows.length === 1;
  }
  async importRecords(
    command: Parameters<FileBusinessImportBoundary["importRecords"]>[0],
  ): Promise<void> {
    const db = databaseFromSession(command.transaction),
      workspace = command.actor.workspaceId;
    for (const { id, data: d, references: r } of command.records) {
      const created = d.createdAt ?? null,
        updated = d.updatedAt ?? d.createdAt ?? null;
      if (d.kind === "photo") {
        assertImportFileRepresentable({
          byteSize: Number(d.byteSize),
          originalFilename: String(d.filename ?? ""),
        });
        if (d.legacyFile === true) {
          await sql`update crm.files set mime_type=coalesce(mime_type,${
            d.mimeType ?? null
          }),created_at=coalesce(${created}::timestamptz,created_at),updated_at=coalesce(${updated}::timestamptz,updated_at) where id=${id}::uuid and workspace_id=${workspace}::uuid and status='missing'`
            .execute(db);
        }
        await sql`insert into crm.files (id,workspace_id,uploaded_by_member_id,original_filename,storage_provider,byte_size,mime_type,status,visibility,metadata,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${command.actor.memberId}::uuid,${d.filename},'import-manifest',${d.byteSize},${
          d.mimeType ?? null
        },'missing','private',${
          JSON.stringify({ source: "monica", photo: d.source ?? {} })
        }::jsonb,coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
          .execute(db);
      } else if (d.kind === "person_photo") {
        const person = await this.people.existsForImport({
          ...command.actor,
          personIds: [r.personId!],
          transaction: command.transaction,
        });
        if (
          !person ||
          !await this.fileExists({
            workspaceId: workspace,
            id: r.fileId!,
            transaction: command.transaction,
          })
        ) {
          throw new Error("Imported photo reference is outside the workspace.");
        }
        await sql`insert into crm.person_file_links (id,person_id,file_id,kind,created_at,updated_at) values (${id}::uuid,${r.personId}::uuid,${r.fileId}::uuid,'photo',coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else throw new Error("Unsupported file import record.");
    }
  }
}
