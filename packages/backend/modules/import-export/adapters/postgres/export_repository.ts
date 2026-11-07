import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { PostgresTransactionRunner } from "../../../../platform/postgres/transactions.ts";
import type {
  ExportFormat,
  ExportManifest,
  ExportRowSet,
  ExportSummary,
  StoredExport,
} from "../../domain/export_rules.ts";
import type { ExportActor, ExportTransaction } from "../../ports/context.ts";
import type { ExportRepository } from "../../ports/export_repository.ts";

interface ExportRow {
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly error: string | null;
  readonly expires_at: Date | null;
  readonly file_id: string | null;
  readonly format: ExportFormat;
  readonly id: string;
  readonly manifest: unknown;
  readonly status: ExportSummary["status"];
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rowSet(value: unknown): ExportRowSet {
  const set = record(value);
  return { count: Number(set.count ?? 0), sha256: String(set.sha256 ?? "") };
}

function manifest(value: unknown): ExportManifest {
  const source = record(value);
  const rows = record(source.rows);
  const attachments = record(source.attachments);
  return {
    attachments: {
      count: Number(attachments.count ?? 0),
      items: Array.isArray(attachments.items)
        ? attachments.items as ExportManifest["attachments"]["items"]
        : [],
      sha256: String(attachments.sha256 ?? ""),
    },
    limitations: Array.isArray(source.limitations)
      ? source.limitations.filter((item): item is string =>
        typeof item === "string"
      )
      : [],
    profile: source.profile === "csv" || source.profile === "vcard"
      ? source.profile
      : "monica-json",
    rows: {
      ...(rows.contactMethods
        ? { contactMethods: rowSet(rows.contactMethods) }
        : {}),
      ...(rows.dates ? { dates: rowSet(rows.dates) } : {}),
      people: rowSet(rows.people),
    },
    version: 1,
  };
}

function summary(row: ExportRow): ExportSummary {
  return {
    ...(row.completed_at
      ? { completedAt: row.completed_at.toISOString() }
      : {}),
    createdAt: row.created_at.toISOString(),
    ...pickDefined({ error: row.error }),
    ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    exportId: row.id,
    format: row.format,
    manifest: manifest(row.manifest),
    status: row.status,
  };
}

const selected = sql`
  export.id::text, export.format, export.status, export.file_id::text,
  export.manifest, export.error, export.created_at, export.completed_at,
  export.expires_at
`;
export class PostgresExportTransaction
  extends PostgresTransactionRunner<ExportTransaction> {}

export class PostgresExportRepository implements ExportRepository {
  async startOrResume(
    command: Parameters<ExportRepository["startOrResume"]>[0],
  ): Promise<{ readonly created: boolean; readonly exportId: string }> {
    const database = databaseFromSession(command.transaction);
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${command.actor.workspaceId}:${command.actor.memberId}:workspace-export`}, 0))`
      .execute(database);
    const existing = await sql<{ readonly id: string }>`
      select id::text from crm.data_exports
      where workspace_id = ${command.actor.workspaceId}::uuid
        and requested_by_member_id = ${command.actor.memberId}::uuid
        and status = 'running' and format = ${command.format}
      order by created_at, id limit 1
    `.execute(database);
    if (existing.rows[0]) {
      return { created: false, exportId: existing.rows[0].id };
    }
    const inserted = await sql<
      { readonly id: string }
    >`insert into crm.data_exports (
      id, workspace_id, requested_by_member_id, format, status, manifest,
      started_at, created_at, updated_at
    ) values (
      ${command.exportId}::uuid, ${command.actor.workspaceId}::uuid,
      ${command.actor.memberId}::uuid, ${command.format}, 'running', '{}'::jsonb,
      ${command.startedAt}, ${command.startedAt}, ${command.startedAt}
    ) returning id::text`.execute(database);
    return { created: true, exportId: inserted.rows[0]!.id };
  }

  async complete(
    command: Parameters<ExportRepository["complete"]>[0],
  ): Promise<ExportSummary> {
    const result = await sql<ExportRow>`
      update crm.data_exports export set status = 'completed',
        file_id = ${command.fileId}::uuid,
        manifest = ${JSON.stringify(command.manifest)}::text::jsonb,
        completed_at = ${command.completedAt}, expires_at = ${command.expiresAt},
        updated_at = ${command.completedAt}
      where export.id = ${command.exportId}::uuid
        and export.workspace_id = ${command.actor.workspaceId}::uuid
        and export.requested_by_member_id = ${command.actor.memberId}::uuid
        and export.status = 'running'
      returning ${selected}
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) {
      throw new Error("Export completion context is invalid.");
    }
    return summary(result.rows[0]);
  }

  async fail(command: Parameters<ExportRepository["fail"]>[0]): Promise<void> {
    await sql`update crm.data_exports set status = 'failed', error = ${command.error},
      updated_at = ${command.failedAt}
      where id = ${command.exportId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and requested_by_member_id = ${command.actor.memberId}::uuid
        and status = 'running'`
      .execute(databaseFromSession(command.transaction));
  }

  async list(
    actor: ExportActor,
    transaction: ExportTransaction,
  ): Promise<readonly ExportSummary[]> {
    const result = await sql<ExportRow>`
      select ${selected} from crm.data_exports export
      where export.workspace_id = ${actor.workspaceId}::uuid
      order by export.created_at desc, export.id desc limit 50
    `.execute(databaseFromSession(transaction));
    return result.rows.map(summary);
  }

  async consumeDownload(
    command: Parameters<ExportRepository["consumeDownload"]>[0],
  ): ReturnType<ExportRepository["consumeDownload"]> {
    const database = databaseFromSession(command.transaction);
    const result = await sql<{ readonly file_id: string }>`
      update crm.data_exports export
      set manifest = export.manifest #- '{download}', updated_at = ${command.now}
      where export.id = ${command.exportId}::uuid
        and export.workspace_id = ${command.actor.workspaceId}::uuid
        and export.status = 'completed' and export.file_id is not null
        and export.expires_at > ${command.now}
        and export.manifest #>> '{download,digest}' = ${command.digest}
        and (export.manifest #>> '{download,expiresAt}')::timestamptz > ${command.now}
        and export.manifest #>> '{download,memberId}' = ${command.actor.memberId}
      returning export.file_id::text
    `.execute(database);
    if (result.rows[0]) {
      return { fileId: result.rows[0].file_id, status: "consumed" };
    }
    // A live link issued to another member is refused without being spent
    // (SECT-10): it stays the issuing member's to redeem.
    const existing = await sql<{ readonly elsewhere: boolean }>`
      select coalesce(
        manifest #>> '{download,digest}' = ${command.digest}
          and (manifest #>> '{download,expiresAt}')::timestamptz > ${command.now}
          and (manifest #>> '{download,memberId}')
            is distinct from ${command.actor.memberId},
        false
      ) as elsewhere
      from crm.data_exports
      where id = ${command.exportId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and status = 'completed'
    `.execute(database);
    const row = existing.rows[0];
    if (!row) return { status: "not-found" };
    return row.elsewhere ? { status: "forbidden" } : { status: "expired" };
  }

  async lock(
    actor: ExportActor,
    exportId: string,
    transaction: ExportTransaction,
  ): Promise<StoredExport | undefined> {
    const result = await sql<ExportRow>`
      select ${selected} from crm.data_exports export
      where export.workspace_id = ${actor.workspaceId}::uuid
        and export.id = ${exportId}::uuid
      for update of export
    `.execute(databaseFromSession(transaction));
    const row = result.rows[0];
    if (!row) return undefined;
    const internal = record(row.manifest);
    const download = record(internal.download);
    return {
      ...summary(row),
      ...(typeof download.digest === "string"
        ? { downloadDigest: download.digest }
        : {}),
      ...(typeof download.expiresAt === "string"
        ? { downloadExpiresAt: download.expiresAt }
        : {}),
      ...pickDefined({ fileId: row.file_id }),
    };
  }

  async issueDownload(
    command: Parameters<ExportRepository["issueDownload"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly id: string }>`
      update crm.data_exports set manifest = jsonb_set(
        manifest, '{download}', ${
      JSON.stringify({
        digest: command.digest,
        expiresAt: command.expiresAt.toISOString(),
        // The member the link is bound to (SECT-10). The schema keeps the
        // link's state in the manifest, so the binding sits beside its digest.
        memberId: command.actor.memberId,
      })
    }::text::jsonb, true
      ), updated_at = now()
      where id = ${command.exportId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and status = 'completed' and expires_at > now()
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] !== undefined;
  }
}
