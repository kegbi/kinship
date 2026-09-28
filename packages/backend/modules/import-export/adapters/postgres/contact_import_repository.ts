import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ContactSourceSystem,
  ImportedContact,
} from "../../domain/contact_import.ts";
import type {
  ImportReport,
  PreparedImportContact,
} from "../../domain/import_rules.ts";
import type {
  ContactImportMatch,
  ContactImportRepository,
} from "../../ports/contact_import_repository.ts";
import type { ImportActor, ImportTransaction } from "../../ports/context.ts";

/**
 * Where each contact format keeps its rows in `data_import_entities`. A
 * vCard row's source key is its `UID` and its fingerprint is only recorded
 * in the column when it has none; a CSV row's source key is its row number
 * in the file, which identifies nothing across files, so a CSV row is only
 * ever matched by fingerprint.
 */
const SOURCE_TABLES: Readonly<Record<ContactSourceSystem, string>> = {
  csv: "csv_rows",
  vcard: "vcards",
};

type Database = Kysely<ApplicationDatabase>;

/** A dry run's diagnostics, as report rows. */
export async function insertReports(
  database: Database,
  importId: string,
  report: ImportReport,
): Promise<void> {
  for (const diagnostic of report.diagnostics) {
    await sql`
      insert into crm.data_import_reports (
        import_id, severity, message, details
      ) values (
        ${importId}::uuid, ${diagnostic.severity},
        ${diagnostic.message}, ${
      JSON.stringify({ code: diagnostic.code })
    }::text::jsonb
      )
    `.execute(database);
  }
}

/**
 * The person an earlier completed import of the same format into the same
 * workspace made of this row, if one did, and whether that earlier row said
 * something different under the same identity.
 */
async function earlier(
  database: Database,
  actor: ImportActor,
  sourceSystem: ContactSourceSystem,
  row: { readonly fingerprint: string; readonly sourcePrimaryKey?: string },
  excludeImportId?: string,
): Promise<Omit<ContactImportMatch, "row"> | undefined> {
  const key = sourceSystem === "vcard" ? row.sourcePrimaryKey ?? null : null;
  const result = await sql<{
    readonly fingerprint: string | null;
    readonly target_key: string;
  }>`
    select entity.target_key, entity.raw_snapshot->>'fingerprint' as fingerprint
    from crm.data_import_entities entity
    join crm.data_imports prior on prior.id = entity.import_id
    where prior.workspace_id = ${actor.workspaceId}::uuid
      and prior.source_system = ${sourceSystem} and prior.status = 'completed'
      and prior.id <> coalesce(${
    excludeImportId ?? null
  }::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      and entity.source_table = ${SOURCE_TABLES[sourceSystem]}
      and entity.target_table = 'people' and entity.target_key is not null
      and entity.status = 'mapped'
      and case when ${key}::text is null
        then entity.source_fingerprint = ${row.fingerprint}
        else entity.source_primary_key = ${key}::text end
    order by prior.completed_at desc, prior.id
    limit 1
  `.execute(database);
  const found = result.rows[0];
  return found
    ? {
      changed: found.fingerprint !== row.fingerprint,
      targetPersonId: found.target_key,
    }
    : undefined;
}

/** The contact a staging row carries, or nothing when it is not one. */
function storedContact(value: unknown): ImportedContact | undefined {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const contact = (parsed as { readonly contact?: unknown } | null)?.contact;
  return contact !== null && typeof contact === "object" &&
      typeof (contact as { givenName?: unknown }).givenName === "string"
    ? contact as ImportedContact
    : undefined;
}

export class PostgresContactImportRepository
  implements ContactImportRepository {
  async history(
    command: Parameters<ContactImportRepository["history"]>[0],
  ): ReturnType<ContactImportRepository["history"]> {
    const database = databaseFromSession(command.transaction);
    const matches: ContactImportMatch[] = [];
    const file = await sql<{ readonly seen: boolean }>`
      select exists (
        select 1 from crm.data_imports prior
        where prior.workspace_id = ${command.actor.workspaceId}::uuid
          and prior.source_system = ${command.sourceSystem}
          and prior.status = 'completed'
          and prior.stats->>'fingerprint' = ${command.fingerprint}
      ) as seen
    `.execute(database);
    for (const row of command.rows) {
      if (row.status !== "mapped") continue;
      const match = await earlier(
        database,
        command.actor,
        command.sourceSystem,
        row,
      );
      if (match) matches.push({ ...match, row: row.row });
    }
    return { fileImportedBefore: file.rows[0]?.seen === true, matches };
  }

  async stageContacts(
    command: Parameters<ContactImportRepository["stageContacts"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    await sql`
      insert into crm.data_imports (
        id, workspace_id, requested_by_member_id, source_system,
        source_profile, status, started_at, stats, created_at, updated_at
      ) values (
        ${command.importId}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid, ${command.sourceSystem}, 'vcf',
        'dry_run', now(), ${
      JSON.stringify({
        fingerprint: command.fingerprint,
        report: command.report,
      })
    }::text::jsonb, now(), now()
      )
    `.execute(database);
    for (const row of command.rows) {
      const mapped = row.status === "mapped";
      await sql`
        insert into crm.data_import_entities (
          import_id, source_table, source_primary_key, source_fingerprint,
          target_table, target_key, status, warnings, raw_snapshot
        ) values (
          ${command.importId}::uuid, ${SOURCE_TABLES[command.sourceSystem]},
          ${mapped ? row.sourcePrimaryKey ?? null : null},
          ${mapped && !row.sourcePrimaryKey ? row.fingerprint : null},
          ${mapped ? "people" : null}, ${mapped ? row.targetPersonId : null},
          ${row.status},
          ${JSON.stringify(mapped ? [] : [row.reason])}::text::jsonb,
          ${
        JSON.stringify(
          mapped
            ? {
              contact: row.contact,
              fingerprint: row.fingerprint,
              row: row.row,
            }
            : { row: row.row },
        )
      }::text::jsonb
        )
      `.execute(database);
    }
    await insertReports(database, command.importId, command.report);
  }

  async stagePendingCsv(
    command: Parameters<ContactImportRepository["stagePendingCsv"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    await sql`
      insert into crm.data_imports (
        id, workspace_id, requested_by_member_id, source_system,
        source_profile, status, started_at, stats, created_at, updated_at
      ) values (
        ${command.importId}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid, 'csv', 'csv', 'pending', now(), ${
      JSON.stringify({
        fingerprint: command.fingerprint,
        preview: command.preview,
      })
    }::text::jsonb, now(), now()
      )
    `.execute(database);
    for (const [index, cells] of command.rows.entries()) {
      await sql`
        insert into crm.data_import_entities (
          import_id, source_table, source_primary_key, status, raw_snapshot
        ) values (
          ${command.importId}::uuid, 'csv_rows', ${String(index + 1)},
          'mapped', ${JSON.stringify({ cells, row: index + 1 })}::text::jsonb
        )
      `.execute(database);
    }
  }

  async lockPendingCsv(
    actor: ImportActor,
    importId: string,
    transaction: ImportTransaction,
  ): ReturnType<ContactImportRepository["lockPendingCsv"]> {
    const database = databaseFromSession(transaction);
    const run = await sql<{
      readonly fingerprint: string | null;
      readonly headers: unknown;
    }>`
      select stats #> '{preview,headers}' as headers,
        stats->>'fingerprint' as fingerprint
      from crm.data_imports
      where id = ${importId}::uuid and workspace_id = ${actor.workspaceId}::uuid
        and source_system = 'csv' and status = 'pending'
      for update
    `.execute(database);
    const headers = run.rows[0]?.headers;
    const parsedHeaders = typeof headers === "string"
      ? JSON.parse(headers) as unknown
      : headers;
    if (!Array.isArray(parsedHeaders)) return undefined;
    const rows = await sql<{ readonly cells: unknown }>`
      select raw_snapshot->'cells' as cells
      from crm.data_import_entities
      where import_id = ${importId}::uuid and source_table = 'csv_rows'
      order by (raw_snapshot->>'row')::integer
    `.execute(database);
    return {
      fingerprint: run.rows[0]?.fingerprint ?? "",
      headers: parsedHeaders.map(String),
      rows: rows.rows.map((row) => {
        const cells = typeof row.cells === "string"
          ? JSON.parse(row.cells) as unknown
          : row.cells;
        return Array.isArray(cells) ? cells.map(String) : [];
      }),
    };
  }

  async mapCsv(
    command: Parameters<ContactImportRepository["mapCsv"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    for (const row of command.rows) {
      const mapped = row.status === "mapped";
      const updated = await sql<{ readonly id: string }>`
        update crm.data_import_entities set
          source_fingerprint = ${mapped ? row.fingerprint : null},
          target_table = ${mapped ? "people" : null},
          target_key = ${mapped ? row.targetPersonId : null},
          status = ${row.status},
          warnings = ${JSON.stringify(mapped ? [] : [row.reason])}::text::jsonb,
          raw_snapshot = ${
        // The raw cells, ignored and unmapped columns included, are replaced
        // by what the mapping kept: v8 keeps a redacted snapshot only.
        JSON.stringify(
          mapped
            ? {
              contact: row.contact,
              fingerprint: row.fingerprint,
              row: row.row,
            }
            : { row: row.row },
        )}::text::jsonb
        where import_id = ${command.importId}::uuid
          and source_table = 'csv_rows'
          and source_primary_key = ${String(row.row)}
        returning id::text
      `.execute(database);
      if (!updated.rows[0]) throw new Error("CSV staging row is missing.");
    }
    const run = await sql<{ readonly id: string }>`
      update crm.data_imports set status = 'dry_run', updated_at = now(),
        stats = (stats - 'preview') || ${
      JSON.stringify({ mapping: command.mapping, report: command.report })
    }::text::jsonb
      where id = ${command.importId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and status = 'pending'
      returning id::text
    `.execute(database);
    if (!run.rows[0]) throw new Error("CSV mapping context is invalid.");
    await insertReports(database, command.importId, command.report);
  }
}

/**
 * A vCard or CSV run's staged contacts, in file order, each with the person
 * an earlier import already made of it.
 */
export async function preparedContacts(
  database: Database,
  actor: ImportActor,
  importId: string,
  sourceSystem: ContactSourceSystem,
): Promise<PreparedImportContact[]> {
  const rows = await sql<{
    readonly id: string;
    readonly raw_snapshot: unknown;
    readonly source_primary_key: string | null;
    readonly target_key: string;
  }>`
    select id::text, source_primary_key, target_key, raw_snapshot
    from crm.data_import_entities
    where import_id = ${importId}::uuid
      and source_table = ${SOURCE_TABLES[sourceSystem]}
      and target_table = 'people' and status = 'mapped'
    order by (raw_snapshot->>'row')::integer, id
  `.execute(database);
  const prepared: PreparedImportContact[] = [];
  for (const row of rows.rows) {
    const contact = storedContact(row.raw_snapshot);
    if (!contact) throw new Error("Staged contact is unreadable.");
    const snapshot = (typeof row.raw_snapshot === "string"
      ? JSON.parse(row.raw_snapshot)
      : row.raw_snapshot) as { readonly fingerprint: string };
    const sourceKey = sourceSystem === "vcard"
      ? row.source_primary_key ?? undefined
      : undefined;
    const previous = await earlier(database, actor, sourceSystem, {
      fingerprint: snapshot.fingerprint,
      ...(sourceKey ? { sourcePrimaryKey: sourceKey } : {}),
    }, importId);
    prepared.push({
      archived: false,
      contact,
      entityId: row.id,
      ...(contact.familyName ? { familyName: contact.familyName } : {}),
      givenName: contact.givenName,
      isDeceased: contact.dates.some((date) =>
        date.kind === "deceased"
      ),
      isPartial: false,
      isStarred: false,
      ...(contact.middleName ? { middleName: contact.middleName } : {}),
      ...(contact.nickname ? { nickname: contact.nickname } : {}),
      ...(previous ? { previousTargetPersonId: previous.targetPersonId } : {}),
      sourcePrimaryKey: `entity:${row.id}`,
      targetPersonId: row.target_key,
    });
  }
  return prepared;
}
