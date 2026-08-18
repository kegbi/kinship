import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
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
        to_char(task.due_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as due_at,
        to_char(task.completed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as completed_at,
        task.completed_by_member_id::text, task.created_by_member_id::text,
        to_char(task.created_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
        to_char(task.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
        task.person_id::text as person_id,
        person.archived_at is not null as archived,
        case when person.id is not null then
          coalesce(nullif(trim(concat_ws(' ', nullif(person.given_name, ''),
            person.family_name)), ''), nullif(person.nickname, ''), 'Unnamed person')
        end as person_name
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      left join crm.tasks task on task.workspace_id = workspace.id
        and task.status = 'open' and task.deleted_at is null
        and task.due_at is not null and task.due_at <= ${command.dueBefore}
      left join crm.people person on person.id = task.person_id
        and person.workspace_id = workspace.id and person.deleted_at is null
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
      order by task.due_at, task.id
      limit ${command.limit}
    `.execute(this.database);
    if (result.rows.length === 0) return { status: "forbidden" };
    return {
      items: result.rows.flatMap((row) =>
        row.id && row.created_at && row.status && row.title && row.updated_at
          ? [{
            ...(row.completed_at ? { completedAt: row.completed_at } : {}),
            ...(row.completed_by_member_id
              ? { completedByMemberId: row.completed_by_member_id }
              : {}),
            createdAt: row.created_at,
            ...(row.created_by_member_id
              ? { createdByMemberId: row.created_by_member_id }
              : {}),
            ...(row.description ? { description: row.description } : {}),
            ...(row.due_at ? { dueAt: row.due_at } : {}),
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
