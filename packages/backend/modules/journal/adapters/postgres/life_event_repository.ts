import { sql } from "kysely";
import type { DatePrecision } from "../../../../shared-kernel/partial_date.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type { StoredLifeEvent } from "../../domain/life_event_rules.ts";
import type { LifeEventRepository } from "../../ports/life_event_repository.ts";

interface LifeEventRow {
  readonly created_at: string;
  readonly day: number | null;
  readonly happened_at: string | null;
  readonly id: string;
  readonly month: number | null;
  readonly name: string | null;
  readonly note: string | null;
  readonly person_id: string;
  readonly precision: DatePrecision;
  readonly type_id: string | null;
  readonly updated_at: string;
  readonly year: number | null;
}

/**
 * The columns every answer reads. The type is named by its identifier only:
 * the vocabulary is the workspace module's, and the use case names the type
 * through that module's boundary.
 */
const columns = sql`event.id::text, event.person_id::text, event.name,
  event.note, event.year, event.month, event.day, event.precision,
  event.life_event_type_id::text as type_id,
  case when event.happened_at is not null then
    ${instantColumn("event.happened_at")} end as happened_at,
  ${instantColumn("event.created_at")} as created_at,
  ${instantColumn("event.updated_at")} as updated_at`;

function lifeEvent(row: LifeEventRow): StoredLifeEvent {
  return {
    createdAt: row.created_at,
    ...(row.day === null ? {} : { day: row.day }),
    ...pickDefined({ happenedAt: row.happened_at }),
    id: row.id,
    ...(row.month === null ? {} : { month: row.month }),
    ...pickDefined({ name: row.name, note: row.note }),
    personId: row.person_id,
    precision: row.precision,
    ...pickDefined({ typeId: row.type_id }),
    updatedAt: row.updated_at,
    ...(row.year === null ? {} : { year: row.year }),
  };
}

/** A person's life events in PostgreSQL, always scoped to one workspace. */
export class PostgresLifeEventRepository implements LifeEventRepository {
  async create(
    command: Parameters<LifeEventRepository["create"]>[0],
  ): Promise<StoredLifeEvent> {
    const { value } = command;
    const result = await sql<LifeEventRow>`
      with event as (
        insert into crm.life_events (
          id, workspace_id, person_id, life_event_type_id, name, note,
          year, month, day, precision, created_at, updated_at
        ) values (
          ${command.id}::uuid, ${command.workspaceId}::uuid,
          ${command.personId}::uuid, ${value.typeId ?? null}::uuid,
          ${value.name ?? null}, ${value.note ?? null},
          ${value.year ?? null}::smallint, ${value.month ?? null}::smallint,
          ${value.day ?? null}::smallint, ${value.precision},
          ${command.now}, ${command.now}
        ) returning *
      )
      select ${columns} from event
    `.execute(databaseFromSession(command.transaction));
    return lifeEvent(result.rows[0]!);
  }

  async delete(
    command: Parameters<LifeEventRepository["delete"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly id: string }>`
      delete from crm.life_events
      where id = ${command.lifeEventId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and person_id = ${command.personId}::uuid
        and ${instantColumn("updated_at")} = ${command.expectedUpdatedAt}
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows.length === 1;
  }

  async lock(
    command: Parameters<LifeEventRepository["lock"]>[0],
  ): Promise<StoredLifeEvent | undefined> {
    const result = await sql<LifeEventRow>`
      select ${columns} from crm.life_events event
      where event.id = ${command.lifeEventId}::uuid
        and event.workspace_id = ${command.workspaceId}::uuid
        and event.person_id = ${command.personId}::uuid
      for update of event
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? lifeEvent(row) : undefined;
  }

  async update(
    command: Parameters<LifeEventRepository["update"]>[0],
  ): Promise<StoredLifeEvent | undefined> {
    const { value } = command;
    const result = await sql<LifeEventRow>`
      with event as (
        update crm.life_events set
          life_event_type_id = ${value.typeId ?? null}::uuid,
          name = ${value.name ?? null}, note = ${value.note ?? null},
          year = ${value.year ?? null}::smallint,
          month = ${value.month ?? null}::smallint,
          day = ${value.day ?? null}::smallint,
          precision = ${value.precision},
          happened_at = case when ${command.keepHappenedAt}::boolean
            then happened_at end,
          updated_at = greatest(
            ${command.now}::timestamptz,
            updated_at + interval '1 microsecond'
          )
        where id = ${command.lifeEventId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and person_id = ${command.personId}::uuid
          and ${instantColumn("updated_at")} = ${command.expectedUpdatedAt}
        returning *
      )
      select ${columns} from event
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? lifeEvent(row) : undefined;
  }
}
