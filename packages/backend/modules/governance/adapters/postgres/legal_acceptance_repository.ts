import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type { LegalDocument } from "../../domain/legal_rules.ts";
import type { LegalAcceptanceRepository } from "../../ports/legal_acceptance_repository.ts";

interface DocumentRow {
  readonly content: string;
  readonly document_type: string;
  readonly id: string;
  readonly published_at: string | null;
  readonly version: string;
}

function document(row: DocumentRow): LegalDocument {
  return {
    content: row.content,
    documentType: row.document_type,
    id: row.id,
    ...pickDefined({ publishedAt: row.published_at }),
    version: row.version,
  };
}

const documentColumns = sql`document.id::text, document.document_type,
  document.version, document.content,
  case when document.published_at is null then null else
    ${instantColumn("document.published_at")} end as published_at`;

export class PostgresLegalAcceptanceRepository
  implements LegalAcceptanceRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async requirements(
    command: Parameters<LegalAcceptanceRepository["requirements"]>[0],
  ) {
    const result = await sql<DocumentRow>`
      select ${documentColumns}
      from crm.legal_documents document
      where document.is_active
        and document.published_at is not null
        and document.published_at <= now()
        and not exists (
          select 1 from crm.legal_acceptances acceptance
          where acceptance.legal_document_id = document.id
            and acceptance.user_id = ${command.userId}::uuid
            and acceptance.workspace_id = ${command.workspaceId}::uuid
        )
      order by case document.document_type when 'terms' then 1 when 'privacy' then 2 else 3 end,
        document.document_type, document.version, document.id
    `.execute(databaseFromSession(command.transaction));
    return { documents: result.rows.map(document), status: "ready" as const };
  }

  async publicDocument(documentType: "privacy" | "terms") {
    const result = await sql<DocumentRow>`
      select ${documentColumns}
      from crm.legal_documents document
      where document.document_type = ${documentType}
        and document.is_active
        and document.published_at is not null
        and document.published_at <= now()
      limit 1
    `.execute(this.database);
    return result.rows[0]
      ? { document: document(result.rows[0]), status: "ready" as const }
      : { status: "not-found" as const };
  }

  accept(command: Parameters<LegalAcceptanceRepository["accept"]>[0]) {
    return (async () => {
      const transaction = databaseFromSession(command.transaction);
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${command.userId}:${command.workspaceId}`}, 0))`
        .execute(transaction);
      const selected = await sql<{
        readonly document_type: string;
        readonly version: string;
      }>`
        select document_type, version from crm.legal_documents
        where id = ${command.documentId}::uuid and is_active
          and published_at is not null and published_at <= ${command.now}
        for update
      `.execute(transaction);
      if (!selected.rows[0]) {
        return { status: "superseded-version" as const };
      }
      const existing = await sql<{ readonly accepted_at: string }>`
        select ${instantColumn("accepted_at")} as accepted_at
        from crm.legal_acceptances
        where user_id = ${command.userId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and legal_document_id = ${command.documentId}::uuid
        order by accepted_at, id limit 1
      `.execute(transaction);
      if (existing.rows[0]) {
        return {
          acceptedAt: existing.rows[0].accepted_at,
          documentId: command.documentId,
          status: "already-accepted" as const,
        };
      }
      const inserted = await sql<{ readonly accepted_at: string }>`
        insert into crm.legal_acceptances
          (id, workspace_id, user_id, legal_document_id, ip_address, accepted_at, created_at)
        values (${command.acceptanceId}::uuid, ${command.workspaceId}::uuid,
          ${command.userId}::uuid, ${command.documentId}::uuid,
          ${command.ipAddress ?? null}::inet, ${command.now}, ${command.now})
        returning ${instantColumn("accepted_at")} as accepted_at
      `.execute(transaction);
      await sql`
        insert into crm.audit_events (
          workspace_id, actor_member_id, subject_type, subject_id, action,
          payload, occurred_at, visible_on_dashboard, created_at
        ) values (
          ${command.workspaceId}::uuid, ${command.memberId}::uuid,
          'legal_document', ${command.documentId}::uuid,
          'legal-document-accepted',
          ${
        JSON.stringify({
          acceptanceId: command.acceptanceId,
          documentType: selected.rows[0].document_type,
          version: selected.rows[0].version,
        })
      }::jsonb,
          ${command.now}, false, ${command.now}
        )
      `.execute(transaction);
      return {
        acceptedAt: inserted.rows[0]!.accepted_at,
        documentId: command.documentId,
        status: "accepted" as const,
      };
    })();
  }
}
