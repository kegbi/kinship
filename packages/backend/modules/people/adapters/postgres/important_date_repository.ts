import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  ImportantDateRecord,
  ImportantDateRepository,
  ImportantDateValue,
} from "../../public.ts";

interface ImportantDateRow {
  readonly created_at: string;
  readonly day: number | null;
  readonly id: string;
  readonly is_age_based: boolean;
  readonly is_year_approximate: boolean;
  readonly kind: ImportantDateRecord["kind"];
  readonly label: string | null;
  readonly month: number | null;
  readonly notes: string | null;
  readonly person_id: string;
  readonly precision: ImportantDateRecord["precision"];
  readonly updated_at: string;
  readonly year: number | null;
}

function record(row: ImportantDateRow): ImportantDateRecord {
  return {
    ...(row.day === null ? {} : { day: row.day }),
    createdAt: row.created_at,
    id: row.id,
    isAgeBased: row.is_age_based,
    isYearApproximate: row.is_year_approximate,
    kind: row.kind,
    ...pickDefined({ label: row.label }),
    ...(row.month === null ? {} : { month: row.month }),
    ...pickDefined({ notes: row.notes }),
    personId: row.person_id,
    precision: row.precision,
    scheduling: row.month !== null && row.day !== null
      ? "annual-reminder"
      : "not-schedulable",
    updatedAt: row.updated_at,
    ...(row.year === null ? {} : { year: row.year }),
  };
}

const projection = sql`
  id::text, person_id::text, kind, label, year::int, month::int, day::int,
  precision, is_year_approximate, is_age_based, notes,
  ${instantColumn("created_at")} as created_at,
  ${instantColumn("updated_at")} as updated_at
`;

function valueParameters(value: ImportantDateValue) {
  return {
    day: value.day ?? null,
    isAgeBased: value.isAgeBased,
    isYearApproximate: value.isYearApproximate,
    kind: value.kind,
    label: value.label ?? null,
    month: value.month ?? null,
    notes: value.notes ?? null,
    precision: value.precision,
    year: value.year ?? null,
  };
}

export class PostgresImportantDateRepository
  implements ImportantDateRepository {
  async lockContext(
    command: Parameters<ImportantDateRepository["lockContext"]>[0],
  ): Promise<Awaited<ReturnType<ImportantDateRepository["lockContext"]>>> {
    const database = databaseFromSession(command.transaction);
    const person = await sql<{
      readonly archived_at: Date | null;
      readonly id: string;
    }>`
      select id::text, archived_at
      from crm.people
      where id = ${command.personId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and deleted_at is null
      for update
    `.execute(database);
    const row = person.rows[0];
    if (!row) return { status: "not-found" };
    return { status: row.archived_at ? "archived" : "ready" };
  }

  async lockDate(
    command: Parameters<ImportantDateRepository["lockDate"]>[0],
  ): Promise<Awaited<ReturnType<ImportantDateRepository["lockDate"]>>> {
    const result = await sql<ImportantDateRow>`
      select ${projection}
      from crm.person_dates
      where id = ${command.dateId}::uuid
        and person_id = ${command.personId}::uuid
      for update
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? { date: record(row), status: "ready" }
      : { status: "not-found" };
  }

  async list(
    command: Parameters<ImportantDateRepository["list"]>[0],
  ): Promise<readonly ImportantDateRecord[]> {
    const result = await sql<ImportantDateRow>`
      select ${projection}
      from crm.person_dates
      where person_id = ${command.personId}::uuid
      order by year nulls last, month nulls last, day nulls last,
        case kind
          when 'birthday' then 0
          when 'first_met' then 1
          when 'deceased' then 2
          else 3
        end,
        lower(coalesce(label, '')), id
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map(record);
  }

  async create(
    command: Parameters<ImportantDateRepository["create"]>[0],
  ): Promise<ImportantDateRecord | undefined> {
    const value = valueParameters(command.value);
    const result = await sql<ImportantDateRow>`
      insert into crm.person_dates (
        id, person_id, kind, label, year, month, day, precision,
        is_year_approximate, is_age_based, notes, created_at, updated_at
      ) values (
        ${command.id}::uuid, ${command.personId}::uuid, ${value.kind},
        ${value.label}, ${value.year}, ${value.month}, ${value.day},
        ${value.precision}, ${value.isYearApproximate}, ${value.isAgeBased},
        ${value.notes}, ${command.occurredAt}::timestamptz,
        ${command.occurredAt}::timestamptz
      )
      on conflict do nothing
      returning ${projection}
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? record(row) : undefined;
  }

  async update(
    command: Parameters<ImportantDateRepository["update"]>[0],
  ): Promise<ImportantDateRecord | undefined> {
    const value = valueParameters(command.value);
    const result = await sql<ImportantDateRow>`
      update crm.person_dates set
        kind = ${value.kind}, label = ${value.label}, year = ${value.year},
        month = ${value.month}, day = ${value.day},
        precision = ${value.precision},
        is_year_approximate = ${value.isYearApproximate},
        is_age_based = ${value.isAgeBased}, notes = ${value.notes},
        updated_at = greatest(
          ${command.occurredAt}::timestamptz,
          updated_at + interval '1 microsecond'
        )
      where id = ${command.dateId}::uuid
        and person_id = ${command.personId}::uuid
        and (
          ${value.kind} not in ('birthday', 'deceased', 'first_met')
          or not exists (
            select 1 from crm.person_dates singleton
            where singleton.person_id = ${command.personId}::uuid
              and singleton.kind = ${value.kind}
              and singleton.id <> ${command.dateId}::uuid
          )
        )
      returning ${projection}
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? record(row) : undefined;
  }

  async delete(
    command: Parameters<ImportantDateRepository["delete"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly id: string }>`
      delete from crm.person_dates
      where id = ${command.dateId}::uuid
        and person_id = ${command.personId}::uuid
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows.length === 1;
  }

  async assertPostcondition(
    command: Parameters<ImportantDateRepository["assertPostcondition"]>[0],
  ): Promise<void> {
    const id = command.after?.id ?? command.before?.id;
    if (!id) throw new Error("Important date postcondition has no target.");
    const result = await sql<{ readonly valid: boolean }>`
      select case
        when ${command.action} = 'delete' then not exists (
          select 1 from crm.person_dates
          where id = ${id}::uuid and person_id = ${command.personId}::uuid
        )
        else exists (
          select 1 from crm.person_dates
          where id = ${id}::uuid and person_id = ${command.personId}::uuid
            and kind = ${command.after?.kind ?? ""}
            and label is not distinct from ${command.after?.label ?? null}
            and year is not distinct from ${command.after?.year ?? null}
            and month is not distinct from ${command.after?.month ?? null}
            and day is not distinct from ${command.after?.day ?? null}
            and precision = ${command.after?.precision ?? "unknown"}
            and is_year_approximate = ${
      command.after?.isYearApproximate ?? false
    }
            and is_age_based = ${command.after?.isAgeBased ?? false}
            and notes is not distinct from ${command.after?.notes ?? null}
            and ${instantColumn("updated_at")} = ${
      command.after?.updatedAt ?? ""
    }
        )
      end as valid
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error(`Important date ${command.action} postcondition failed.`);
    }
  }
}
