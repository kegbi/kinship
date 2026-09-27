import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { PostgresTransactionRunner } from "../../../../platform/postgres/transactions.ts";
import type {
  ImportReport,
  ImportSummary,
  PreparedImportCommit,
} from "../../domain/import_rules.ts";
import type { ImportActor, ImportTransaction } from "../../ports/context.ts";
import type {
  ImportRepository,
  StageImportCommand,
} from "../../ports/import_repository.ts";

export class PostgresImportTransaction
  extends PostgresTransactionRunner<ImportTransaction> {}

interface ImportRow {
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly id: string;
  readonly stats: unknown;
  readonly status: "completed" | "dry_run" | "failed";
}

function report(value: unknown): ImportReport {
  const stats = jsonRecord(value) as { readonly report?: ImportReport };
  return stats.report ?? {
    counts: {
      contacts: 0,
      legacyCredentialsDiscarded: 0,
      missingFiles: 0,
      orphans: 0,
      unsupported: 0,
    },
    diagnostics: [],
  };
}
function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === "object" &&
          !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function summary(row: ImportRow): ImportSummary {
  return {
    ...(row.completed_at
      ? { completedAt: row.completed_at.toISOString() }
      : {}),
    createdAt: row.created_at.toISOString(),
    importId: row.id,
    report: report(row.stats),
    sourceProfile: "json_export",
    status: row.status,
  };
}

export class PostgresImportRepository implements ImportRepository {
  async stage(command: StageImportCommand): Promise<{
    readonly importId: string;
    readonly report: ImportReport;
    readonly status: "dry_run";
  }> {
    const database = databaseFromSession(command.transaction);
    await sql`
      insert into crm.data_imports (
        id, workspace_id, requested_by_member_id, source_system,
        source_profile, status, started_at, stats, created_at, updated_at
      ) values (
        ${command.importId}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid, 'monica', 'json_export', 'dry_run',
        now(), ${
      JSON.stringify({
        fingerprint: command.fingerprint,
        report: command.report,
      })
    }::text::jsonb,
        now(), now()
      )
    `.execute(database);
    for (const contact of command.contacts) {
      await sql`
        insert into crm.data_import_entities (
          import_id, source_table, source_primary_key, source_uuid,
          target_table, target_key, status, warnings, raw_snapshot
        ) values (
          ${command.importId}::uuid, 'contacts', ${contact.sourcePrimaryKey},
          ${contact.sourceUuid ?? null}::uuid, 'people',
          ${contact.targetPersonId}, 'mapped', '[]'::jsonb,
          jsonb_strip_nulls(jsonb_build_object(
            'first_name', ${contact.givenName}::text,
            'middle_name', ${contact.middleName ?? null}::text,
            'last_name', ${contact.familyName ?? null}::text,
            'nickname', ${contact.nickname ?? null}::text,
            'description', ${contact.description ?? null}::text,
            'food_preferences', ${contact.foodPreferences ?? null}::text,
            'is_partial', ${contact.isPartial}::boolean,
            'is_starred', ${contact.isStarred}::boolean,
            'is_dead', ${contact.isDeceased}::boolean,
            'is_active', ${!contact.archived}::boolean,
            'deleted_at', ${contact.deletedAt ?? null}::text,
            'default_avatar_color',
            ${contact.avatarPresentation?.backgroundColor ?? null}::text,
            'avatar_source', ${
        contact.avatarPresentation?.source ?? null
      }::text,
            'avatar_external_url',
            ${contact.avatarPresentation?.externalUrl ?? null}::text
          ))
        )
      `.execute(database);
      if (contact.avatar) {
        await sql`
          insert into crm.data_import_entities (
            import_id, source_table, source_primary_key, target_table,
            target_key, status, warnings, raw_snapshot
          ) values (
            ${command.importId}::uuid, 'photos',
            ${`contact:${contact.sourcePrimaryKey}:avatar`}, 'files',
            ${contact.avatar.fileId}, 'warning',
            ${JSON.stringify(["attachment-bytes-not-imported"])}::text::jsonb,
            jsonb_build_object(
              'byteSize', ${contact.avatar.byteSize}::integer,
              'originalFilename', ${contact.avatar.originalFilename}::text,
              'present', ${contact.avatar.present}::boolean,
              'personId', ${contact.targetPersonId}::text,
              'personSourcePrimaryKey', ${contact.sourcePrimaryKey}::text
            )
          )
        `.execute(database);
      }
    }
    for (const diagnostic of command.report.diagnostics) {
      await sql`
        insert into crm.data_import_reports (
          import_id, severity, message, details
        ) values (
          ${command.importId}::uuid, ${diagnostic.severity},
          ${diagnostic.message}, ${
        JSON.stringify({ code: diagnostic.code })
      }::text::jsonb
        )
      `.execute(database);
    }
    return {
      importId: command.importId,
      report: command.report,
      status: "dry_run",
    };
  }

  async prepareCommit(
    actor: ImportActor,
    importId: string,
    transaction: ImportTransaction,
  ): Promise<PreparedImportCommit> {
    const database = databaseFromSession(transaction);
    const locked = await sql<{
      readonly stats: unknown;
      readonly status: string;
    }>`
      select status, stats
      from crm.data_imports
      where id = ${importId}::uuid and workspace_id = ${actor.workspaceId}::uuid
      for update
    `.execute(database);
    const run = locked.rows[0];
    if (!run) return { status: "not-found" };
    if (run.status === "completed") {
      const stats = jsonRecord(run.stats) as {
        readonly peopleCreated?: number;
        readonly peopleReused?: number;
      };
      return {
        importId,
        peopleCreated: stats.peopleCreated ?? 0,
        peopleReused: stats.peopleReused ?? 0,
        status: "completed",
      };
    }
    if (run.status !== "dry_run") return { status: "not-found" };

    const contacts = await sql<{
      readonly deleted_at: Date | null;
      readonly description: string | null;
      readonly family_name: string | null;
      readonly food_preferences: string | null;
      readonly given_name: string;
      readonly is_active: boolean;
      readonly is_dead: boolean;
      readonly is_partial: boolean;
      readonly is_starred: boolean;
      readonly middle_name: string | null;
      readonly nickname: string | null;
      readonly avatar_color: string | null;
      readonly avatar_external_url: string | null;
      readonly avatar_source: "default" | "external" | "gravatar" | null;
      readonly source_primary_key: string;
      readonly source_uuid: string | null;
      readonly target_key: string;
    }>`
      select source_primary_key, source_uuid::text, target_key,
        raw_snapshot->>'first_name' as given_name,
        raw_snapshot->>'middle_name' as middle_name,
        raw_snapshot->>'last_name' as family_name,
        raw_snapshot->>'nickname' as nickname,
        raw_snapshot->>'description' as description,
        raw_snapshot->>'food_preferences' as food_preferences,
        coalesce(raw_snapshot->>'is_partial' in ('true', '1'), false) as is_partial,
        coalesce(raw_snapshot->>'is_starred' in ('true', '1'), false) as is_starred,
        coalesce(raw_snapshot->>'is_dead' in ('true', '1'), false) as is_dead,
        coalesce(raw_snapshot->>'is_active' not in ('false', '0'), true) as is_active,
        (raw_snapshot->>'deleted_at')::timestamptz as deleted_at,
        raw_snapshot->>'default_avatar_color' as avatar_color,
        raw_snapshot->>'avatar_source' as avatar_source,
        raw_snapshot->>'avatar_external_url' as avatar_external_url
      from crm.data_import_entities
      where import_id = ${importId}::uuid and source_table = 'contacts'
      order by created_at, id
    `.execute(database);
    const preparedContacts: Extract<
      PreparedImportCommit,
      { status: "ready" }
    >["contacts"][number][] = [];
    for (const contact of contacts.rows) {
      const previous = await sql<{ readonly target_key: string }>`
        select entity.target_key
        from crm.data_import_entities entity
        join crm.data_imports prior on prior.id = entity.import_id
        where prior.workspace_id = ${actor.workspaceId}::uuid
          and prior.source_system = 'monica' and prior.status = 'completed'
          and prior.stats->>'fingerprint' = (
            select current.stats->>'fingerprint'
            from crm.data_imports current
            where current.id = ${importId}::uuid
          )
          and prior.id <> ${importId}::uuid
          and entity.source_table = 'contacts'
          and entity.source_primary_key = ${contact.source_primary_key}
        order by prior.completed_at desc, prior.id
        limit 1
      `.execute(database);
      const avatarPresentation = pickDefined({
        backgroundColor: contact.avatar_color,
        externalUrl: contact.avatar_external_url,
        source: contact.avatar_source,
      });
      preparedContacts.push({
        archived: !contact.is_active,
        ...(Object.keys(avatarPresentation).length > 0
          ? { avatarPresentation }
          : {}),
        ...(contact.deleted_at
          ? { deletedAt: contact.deleted_at.toISOString() }
          : {}),
        ...pickDefined({
          description: contact.description,
          familyName: contact.family_name,
          foodPreferences: contact.food_preferences,
        }),
        givenName: contact.given_name,
        isDeceased: contact.is_dead,
        isPartial: contact.is_partial,
        isStarred: contact.is_starred,
        ...pickDefined({
          middleName: contact.middle_name,
          nickname: contact.nickname,
        }),
        ...(previous.rows[0]?.target_key
          ? { previousTargetPersonId: previous.rows[0].target_key }
          : {}),
        sourcePrimaryKey: contact.source_primary_key,
        targetPersonId: contact.target_key,
      });
    }

    const avatars = await sql<{
      readonly byte_size: number;
      readonly original_filename: string;
      readonly person_source_primary_key: string;
      readonly target_key: string;
    }>`
      select target_key,
        (raw_snapshot->>'byteSize')::integer as byte_size,
        raw_snapshot->>'originalFilename' as original_filename,
        raw_snapshot->>'personSourcePrimaryKey' as person_source_primary_key
      from crm.data_import_entities
      where import_id = ${importId}::uuid and source_table = 'photos'
      order by created_at, id
    `.execute(database);
    const preparedAvatars = avatars.rows.map((avatar) => ({
      byteSize: avatar.byte_size,
      fileId: avatar.target_key,
      originalFilename: avatar.original_filename,
      personSourcePrimaryKey: avatar.person_source_primary_key,
    }));
    return {
      avatars: preparedAvatars,
      contacts: preparedContacts,
      importId,
      status: "ready",
    };
  }

  async retargetContact(
    importId: string,
    sourcePrimaryKey: string,
    targetPersonId: string,
    transaction: ImportTransaction,
  ): Promise<void> {
    const result = await sql<{ readonly id: string }>`
      update crm.data_import_entities set target_key = ${targetPersonId}
      where import_id = ${importId}::uuid and source_table = 'contacts'
        and source_primary_key = ${sourcePrimaryKey}
      returning id::text
    `.execute(databaseFromSession(transaction));
    if (!result.rows[0]) throw new Error("Import identity retarget failed.");
  }

  async complete(
    actor: ImportActor,
    importId: string,
    counts: { readonly peopleCreated: number; readonly peopleReused: number },
    transaction: ImportTransaction,
  ): Promise<void> {
    const database = databaseFromSession(transaction);
    const locked = await sql<{ readonly stats: unknown }>`
      select stats from crm.data_imports
      where id = ${importId}::uuid and workspace_id = ${actor.workspaceId}::uuid
        and status = 'dry_run'
      for update
    `.execute(database);
    const run = locked.rows[0];
    if (!run) throw new Error("Import completion context is invalid.");
    const nextStats = {
      ...jsonRecord(run.stats),
      ...counts,
    };
    const completed = await sql<{ readonly id: string }>`
      update crm.data_imports
      set status = 'completed', completed_at = now(), updated_at = now(),
        stats = ${JSON.stringify(nextStats)}::text::jsonb
      where id = ${importId}::uuid and workspace_id = ${actor.workspaceId}::uuid
      returning id::text
    `.execute(database);
    if (!completed.rows[0]) throw new Error("Import completion failed.");
  }

  async get(
    actor: ImportActor,
    importId: string,
  ): Promise<ImportSummary | undefined> {
    const result = await sql<ImportRow>`
      select id::text, status, stats, created_at, completed_at
      from crm.data_imports
      where id = ${importId}::uuid and workspace_id = ${actor.workspaceId}::uuid
    `.execute(this.database);
    return result.rows[0] ? summary(result.rows[0]) : undefined;
  }

  async list(actor: ImportActor): Promise<readonly ImportSummary[]> {
    const result = await sql<ImportRow>`
      select run.id::text, run.status, run.stats, run.created_at, run.completed_at
      from crm.data_imports run
      where run.workspace_id = ${actor.workspaceId}::uuid
      order by run.created_at desc, run.id desc
      limit 50
    `.execute(this.database);
    return result.rows.map(summary);
  }

  constructor(private readonly database: Kysely<ApplicationDatabase>) {}
}
