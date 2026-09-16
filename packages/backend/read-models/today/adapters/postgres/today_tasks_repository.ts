import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type { TaskStatus } from "../../../../modules/planning/public.ts";
import type { TodayTasksRepository } from "../../application/get_today_tasks.ts";

interface TodayTaskRow {
  readonly archived: boolean | null;
  readonly completed_at: string | null;
  readonly completed_by_member_id: string | null;
  readonly created_at: string | null;
  readonly created_by_member_id: string | null;
  readonly description: string | null;
  readonly due_at: string | null;
  readonly id: string | null;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly status: TaskStatus | null;
  readonly title: string | null;
  readonly updated_at: string | null;
}

export class PostgresTodayTasksRepository implements TodayTasksRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async getDueTasks(
    command: Parameters<TodayTasksRepository["getDueTasks"]>[0],
  ): Promise<Awaited<ReturnType<TodayTasksRepository["getDueTasks"]>>> {
    const result = await sql<TodayTaskRow>`
      select task.id::text, task.title, task.description, task.status,
        ${instantColumn("task.due_at")} as due_at,
        ${instantColumn("task.completed_at")} as completed_at,
        task.completed_by_member_id::text, task.created_by_member_id::text,
        ${instantColumn("task.created_at")} as created_at,
        ${instantColumn("task.updated_at")} as updated_at,
        task.person_id::text as person_id,
        person.archived_at is not null as archived,
        case when person.id is not null then
          ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))}
        end as person_name
      from crm.tasks task
      left join crm.people person on person.id = task.person_id
        and person.workspace_id = task.workspace_id
        and person.deleted_at is null
      where task.workspace_id = ${command.workspaceId}::uuid
        and task.status = 'open' and task.deleted_at is null
        and task.due_at is not null and task.due_at <= ${command.dueBefore}
      order by task.due_at, task.id
      limit ${command.limit}
    `.execute(this.database);
    return {
      items: result.rows.flatMap((row) =>
        row.id && row.created_at && row.status && row.title && row.updated_at
          ? [{
            ...pickDefined({
              completedAt: row.completed_at,
              completedByMemberId: row.completed_by_member_id,
            }),
            createdAt: row.created_at,
            ...pickDefined({
              createdByMemberId: row.created_by_member_id,
              description: row.description,
              dueAt: row.due_at,
            }),
            id: row.id,
            ...(row.person_id
              ? {
                person: row.person_name
                  ? {
                    archived: row.archived === true,
                    id: row.person_id,
                    name: row.person_name,
                  }
                  : {
                    archived: true,
                    id: row.person_id,
                    name: "Deleted/Unavailable person",
                    unavailable: true,
                  },
              }
              : {}),
            status: row.status,
            title: row.title,
            updatedAt: row.updated_at,
          }]
          : []
      ),
      status: "ready",
    };
  }
}
