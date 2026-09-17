import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type { StoredTask, TaskStatus } from "../../domain/task_rules.ts";
import type { TaskRepository } from "../../ports/task_repository.ts";

interface TaskRow {
  readonly completed_at: string | null;
  readonly completed_by_member_id: string | null;
  readonly created_at: string;
  readonly created_by_member_id: string | null;
  readonly description: string | null;
  readonly due_at: string | null;
  readonly id: string;
  readonly person_id: string | null;
  readonly status: TaskStatus;
  readonly title: string;
  readonly updated_at: string;
}

function task(row: TaskRow): StoredTask {
  return {
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
    ...pickDefined({ personId: row.person_id }),
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

const columns = sql`
  task.id::text, task.person_id::text, task.title, task.description,
  task.status, ${instantColumn("task.due_at")} as due_at,
  ${instantColumn("task.completed_at")} as completed_at,
  task.completed_by_member_id::text, task.created_by_member_id::text,
  ${instantColumn("task.created_at")} as created_at,
  ${instantColumn("task.updated_at")} as updated_at
`;

function dueTimestamp(value: string | null | undefined) {
  if (value === null || value === undefined) return sql`null::timestamptz`;
  const microsecondRemainder = Number(
    /\.(\d{6})Z$/.exec(value)?.[1]?.slice(3) ?? "0",
  );
  return sql`${new Date(value)}::timestamptz +
    ${microsecondRemainder} * interval '1 microsecond'`;
}

export class PostgresTaskRepository implements TaskRepository {
  async lockRequest(
    command: Parameters<TaskRepository["lockRequest"]>[0],
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.id}, 0))`
      .execute(databaseFromSession(command.transaction));
  }

  async find(
    command: Parameters<TaskRepository["find"]>[0],
  ): Promise<Awaited<ReturnType<TaskRepository["find"]>>> {
    const result = await sql<TaskRow>`
      select ${columns}
      from crm.tasks task
      where task.id = ${command.id}::uuid
        and task.workspace_id = ${command.workspaceId}::uuid
        and task.deleted_at is null
      ${command.lock ? sql`for update` : sql``}
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? { status: "found", task: task(row) } : { status: "not-found" };
  }

  async list(
    command: Parameters<TaskRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<TaskRepository["list"]>>> {
    const database = databaseFromSession(command.transaction);
    if (command.after) {
      const anchor = await sql<{ readonly valid: boolean }>`
        select exists (select 1 from crm.tasks task
          where task.id = ${command.after.id}::uuid
            and task.workspace_id = ${command.workspaceId}::uuid
            and task.deleted_at is null
            and task.status = ${command.after.status}
            and task.due_at is not distinct from ${
        command.after.dueAt ?? null
      }::timestamptz
            and task.updated_at = ${command.after.updatedAt}::timestamptz
            and (${command.personId ?? null}::uuid is null
              or task.person_id = ${command.personId ?? null}::uuid)
            and (${command.status ?? null}::text is null
              or task.status = ${command.status ?? null})
            and (${command.dueBefore ?? null}::timestamptz is null
              or task.due_at <= ${command.dueBefore ?? null}::timestamptz)
        ) as valid
      `.execute(database);
      if (!anchor.rows[0]?.valid) return { status: "stale-cursor" };
    }
    const anchorRank = command.after
      ? command.after.status === "open"
        ? 0
        : command.after.status === "completed"
        ? 1
        : 2
      : undefined;
    const result = await sql<TaskRow>`
      select ${columns}
      from crm.tasks task
      where task.workspace_id = ${command.workspaceId}::uuid
        and task.deleted_at is null
        ${
      command.personId
        ? sql`and task.person_id = ${command.personId}::uuid`
        : sql``
    }
        ${command.status ? sql`and task.status = ${command.status}` : sql``}
        ${
      command.dueBefore ? sql`and task.due_at <= ${command.dueBefore}` : sql``
    }
        ${
      command.after
        ? sql`and (
          case task.status when 'open' then 0 when 'completed' then 1 else 2 end > ${anchorRank}
          or (case task.status when 'open' then 0 when 'completed' then 1 else 2 end = ${anchorRank}
            and (
              (${command.after.dueAt ?? null}::timestamptz is not null and
                (task.due_at > ${
          command.after.dueAt ?? null
        }::timestamptz or task.due_at is null))
              or (task.due_at is not distinct from ${
          command.after.dueAt ?? null
        }::timestamptz
                and (task.updated_at < ${command.after.updatedAt}::timestamptz
                  or (task.updated_at = ${command.after.updatedAt}::timestamptz
                    and task.id > ${command.after.id}::uuid)))
            )
          )
        )`
        : sql``
    }
      order by case task.status when 'open' then 0 when 'completed' then 1 else 2 end,
        task.due_at asc nulls last, task.updated_at desc, task.id
      limit ${command.limit + 1}
    `.execute(database);
    const visible = result.rows.slice(0, command.limit);
    const final = visible.at(-1);
    return {
      items: visible.map(task),
      ...(result.rows.length > command.limit && final
        ? {
          next: {
            ...pickDefined({ dueAt: final.due_at }),
            id: final.id,
            status: final.status,
            updatedAt: final.updated_at,
          },
        }
        : {}),
      status: "ready",
    };
  }

  async create(
    command: Parameters<TaskRepository["create"]>[0],
  ): Promise<StoredTask | undefined> {
    const dueAt = dueTimestamp(command.dueAt);
    const result = await sql<TaskRow>`
      insert into crm.tasks as task (
        id, workspace_id, person_id, title, description, status, due_at,
        created_by_member_id, created_at, updated_at
      ) values (
        ${command.id}::uuid, ${command.workspaceId}::uuid,
        ${command.personId ?? null}::uuid, ${command.title},
        ${command.description ?? null}, 'open', ${dueAt},
        ${command.memberId}::uuid, ${command.occurredAt}, ${command.occurredAt}
      ) returning ${columns}
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? task(row) : undefined;
  }

  async save(
    command: Parameters<TaskRepository["save"]>[0],
  ): Promise<StoredTask | undefined> {
    const hasTitle = command.title !== undefined;
    const hasDescription = command.description !== undefined;
    const hasDueAt = command.dueAt !== undefined;
    const hasPersonId = command.personId !== undefined;
    const hasStatus = command.status !== undefined;
    const hasCompletedAt = command.completedAt !== undefined;
    const dueAt = dueTimestamp(command.dueAt);
    const result = await sql<TaskRow>`
      update crm.tasks task set
        title = case when ${hasTitle} then ${
      command.title ?? ""
    } else task.title end,
        description = case when ${hasDescription} then ${
      command.description ?? null
    } else task.description end,
        due_at = case when ${hasDueAt} then ${dueAt} else task.due_at end,
        person_id = case when ${hasPersonId} then ${
      command.personId ?? null
    }::uuid else task.person_id end,
        status = case when ${hasStatus} then ${
      command.status ?? "open"
    } else task.status end,
        completed_at = case when ${hasCompletedAt} then ${
      command.completedAt ?? null
    } else task.completed_at end,
        completed_by_member_id = case when ${hasCompletedAt}
          then case when ${command.completedAt ?? null}::timestamptz is null
            then null else ${command.memberId}::uuid end
          else task.completed_by_member_id end,
        updated_at = greatest(
          ${command.occurredAt}::timestamptz,
          task.updated_at + interval '1 microsecond'
        )
      where task.id = ${command.id}::uuid
        and task.workspace_id = ${command.workspaceId}::uuid
        and task.deleted_at is null
        ${
      command.expectedUpdatedAt
        ? sql`and ${
          instantColumn("task.updated_at")
        } = ${command.expectedUpdatedAt}`
        : sql``
    }
      returning ${columns}
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? task(row) : undefined;
  }

  async assertPostcondition(
    command: Parameters<TaskRepository["assertPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid
      from crm.tasks task
      where task.id = ${command.task.id}::uuid
        and task.workspace_id = ${command.workspaceId}::uuid
        and task.status = ${command.task.status}
        and task.title = ${command.task.title}
        and task.deleted_at is null
        and (task.status <> 'completed' or
          (task.completed_at is not null and task.completed_by_member_id is not null))
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Task persistence postcondition failed.");
    }
  }
}
