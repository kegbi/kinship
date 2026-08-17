import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  InteractionWorkspaceBoundary,
  WorkspaceInteractionOption,
} from "../../application/interaction_workspace_boundary.ts";

interface OptionRow {
  readonly id: string;
  readonly name: string;
}

interface CursorOptionRow extends OptionRow {
  readonly sort_order: number;
}

interface OptionCursor {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeCursor(
  cursor: OptionCursor,
  workspaceId: string,
  kind: "activity-type" | "emotion",
  search: string,
): string {
  return btoa(JSON.stringify({
    ...cursor,
    kind,
    search,
    version: 1,
    workspaceId,
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(
  value: string,
  workspaceId: string,
  kind: "activity-type" | "emotion",
  search: string,
): OptionCursor | undefined {
  try {
    const parsed = JSON.parse(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    ) as Record<string, unknown>;
    if (
      parsed.version !== 1 || parsed.workspaceId !== workspaceId ||
      parsed.kind !== kind || parsed.search !== search ||
      typeof parsed.id !== "string" || !UUID_PATTERN.test(parsed.id) ||
      typeof parsed.name !== "string" ||
      !Number.isSafeInteger(parsed.sortOrder)
    ) return undefined;
    return {
      id: parsed.id,
      name: parsed.name,
      sortOrder: parsed.sortOrder as number,
    };
  } catch {
    return undefined;
  }
}

function option(row: OptionRow): WorkspaceInteractionOption {
  return { id: row.id, name: row.name };
}

export class PostgresInteractionWorkspaceBoundary
  implements InteractionWorkspaceBoundary {
  async authorize(
    command: Parameters<InteractionWorkspaceBoundary["authorize"]>[0],
  ): Promise<Awaited<ReturnType<InteractionWorkspaceBoundary["authorize"]>>> {
    const database = databaseFromSession(command.transaction);
    const authorized = await sql<{ readonly authorized: boolean }>`
      select true as authorized
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.role in ('owner', 'admin', 'member')
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
      for update of account, member, workspace
    `.execute(database);
    return { status: authorized.rows[0]?.authorized ? "ready" : "forbidden" };
  }

  async describe(
    command: Parameters<InteractionWorkspaceBoundary["describe"]>[0],
  ): Promise<Awaited<ReturnType<InteractionWorkspaceBoundary["describe"]>>> {
    const database = databaseFromSession(command.transaction);
    const activityType = command.activityTypeId
      ? (await sql<OptionRow>`
        select id::text,
          coalesce(nullif(name, ''), nullif(translation_key, ''), 'Activity') as name
        from crm.activity_types
        where id = ${command.activityTypeId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
      `.execute(database)).rows[0]
      : undefined;
    const ids = [...new Set(command.emotionIds)].sort();
    const emotions = ids.length === 0 ? [] : (await sql<OptionRow>`
      select id::text, name from crm.emotion_options
      where id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
      order by id
    `.execute(database)).rows.map(option);
    return {
      ...(activityType ? { activityType: option(activityType) } : {}),
      emotions,
    };
  }

  async inspect(
    command: Parameters<InteractionWorkspaceBoundary["inspect"]>[0],
  ): Promise<Awaited<ReturnType<InteractionWorkspaceBoundary["inspect"]>>> {
    const database = databaseFromSession(command.transaction);
    const context = await sql<{ readonly hidden: boolean }>`
      select exists (
        select 1 from crm.workspace_profile_modules module
        where module.workspace_id = workspace.id
          and module.key = ${
      command.kind === "activity" ? "activities" : "notes"
    }
          and module.is_active = false
      ) as hidden
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.role in ('owner', 'admin', 'member')
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
      ${command.lock ? sql`for update of account, member, workspace` : sql``}
    `.execute(database);
    const resolved = context.rows[0];
    if (!resolved) return { status: "forbidden" };
    if (resolved.hidden) return { status: "hidden" };

    let activityType: WorkspaceInteractionOption | undefined;
    if (command.activityTypeId) {
      const result = await sql<OptionRow>`
        select id::text,
          coalesce(nullif(name, ''), nullif(translation_key, ''), 'Activity') as name
        from crm.activity_types
        where id = ${command.activityTypeId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and is_archived = false
        ${command.lock ? sql`for key share` : sql``}
      `.execute(database);
      const row = result.rows[0];
      if (!row) return { status: "not-found" };
      activityType = option(row);
    }

    const ids = [...new Set(command.emotionIds)].sort();
    const emotions = ids.length === 0 ? [] : (await sql<OptionRow>`
        select id::text, name from crm.emotion_options
        where id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
          and is_active = true
        order by id
        ${command.lock ? sql`for key share` : sql``}
      `.execute(database)).rows.map(option);
    if (emotions.length !== ids.length) return { status: "not-found" };
    return {
      ...(activityType ? { activityType } : {}),
      emotions,
      status: "ready",
    };
  }

  async options(
    command: Parameters<InteractionWorkspaceBoundary["options"]>[0],
  ): Promise<Awaited<ReturnType<InteractionWorkspaceBoundary["options"]>>> {
    const database = databaseFromSession(command.transaction);
    const context = await sql<{
      readonly activities_hidden: boolean;
      readonly notes_hidden: boolean;
    }>`
      select exists (
        select 1 from crm.workspace_profile_modules module
        where module.workspace_id = workspace.id and module.key = 'activities'
          and module.is_active = false
      ) as activities_hidden,
      exists (
        select 1 from crm.workspace_profile_modules module
        where module.workspace_id = workspace.id and module.key = 'notes'
          and module.is_active = false
      ) as notes_hidden
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.role in ('owner', 'admin', 'member')
        and member.status = 'active' and member.left_at is null
        and workspace.status = 'active' and workspace.deleted_at is null
    `.execute(database);
    const visibility = context.rows[0];
    if (!visibility) return { status: "forbidden" };
    const activityTypeSearch = command.activityTypeSearch?.trim() ?? "";
    const emotionSearch = command.emotionSearch?.trim() ?? "";
    const activityAfter = command.activityTypeCursor
      ? decodeCursor(
        command.activityTypeCursor,
        command.workspaceId,
        "activity-type",
        activityTypeSearch,
      )
      : undefined;
    const emotionAfter = command.emotionCursor
      ? decodeCursor(
        command.emotionCursor,
        command.workspaceId,
        "emotion",
        emotionSearch,
      )
      : undefined;
    if (
      (command.activityTypeCursor && !activityAfter) ||
      (command.emotionCursor && !emotionAfter)
    ) return { status: "stale-cursor" };

    if (activityAfter) {
      const anchor = await sql<CursorOptionRow>`
        select id::text, sort_order,
          coalesce(nullif(name, ''), nullif(translation_key, ''), 'Activity') as name
        from crm.activity_types
        where id = ${activityAfter.id}::uuid
          and workspace_id = ${command.workspaceId}::uuid and is_archived = false
          and (${activityTypeSearch} = '' or coalesce(name, translation_key, '') ilike ${`%${activityTypeSearch}%`})
      `.execute(database);
      const row = anchor.rows[0];
      if (
        !row || row.sort_order !== activityAfter.sortOrder ||
        row.name !== activityAfter.name
      ) {
        return { status: "stale-cursor" };
      }
    }
    if (emotionAfter) {
      const anchor = await sql<CursorOptionRow>`
        select id::text, name, sort_order from crm.emotion_options
        where id = ${emotionAfter.id}::uuid and is_active = true
          and (${emotionSearch} = '' or name ilike ${`%${emotionSearch}%`})
      `.execute(database);
      const row = anchor.rows[0];
      if (
        !row || row.sort_order !== emotionAfter.sortOrder ||
        row.name !== emotionAfter.name
      ) {
        return { status: "stale-cursor" };
      }
    }
    const [types, emotions] = await Promise.all([
      visibility.activities_hidden
        ? Promise.resolve({ rows: [] as CursorOptionRow[] })
        : sql<CursorOptionRow>`
        select id::text,
          coalesce(nullif(name, ''), nullif(translation_key, ''), 'Activity') as name,
          sort_order
        from crm.activity_types
        where workspace_id = ${command.workspaceId}::uuid and is_archived = false
          and (${activityTypeSearch} = '' or coalesce(name, translation_key, '') ilike ${`%${activityTypeSearch}%`})
          ${
          activityAfter
            ? sql`and (sort_order, lower(coalesce(nullif(name, ''), nullif(translation_key, ''), 'Activity')), id) > (${activityAfter.sortOrder}, lower(${activityAfter.name}), ${activityAfter.id}::uuid)`
            : sql``
        }
        order by sort_order, lower(coalesce(name, translation_key, '')), id
        limit ${command.limit + 1}
      `.execute(database),
      visibility.activities_hidden
        ? Promise.resolve({ rows: [] as CursorOptionRow[] })
        : sql<CursorOptionRow>`
        select id::text, name, sort_order from crm.emotion_options
        where is_active = true
          and (${emotionSearch} = '' or name ilike ${`%${emotionSearch}%`})
          ${
          emotionAfter
            ? sql`and (sort_order, lower(name), id) > (${emotionAfter.sortOrder}, lower(${emotionAfter.name}), ${emotionAfter.id}::uuid)`
            : sql``
        }
        order by sort_order, lower(name), id
        limit ${command.limit + 1}
      `.execute(database),
    ]);
    const visibleTypes = types.rows.slice(0, command.limit);
    const visibleEmotions = emotions.rows.slice(0, command.limit);
    const lastType = visibleTypes.at(-1);
    const lastEmotion = visibleEmotions.at(-1);
    return {
      activityTypes: visibleTypes.map(option),
      ...(types.rows.length > command.limit && lastType
        ? {
          activityTypesNextCursor: encodeCursor(
            {
              id: lastType.id,
              name: lastType.name,
              sortOrder: lastType.sort_order,
            },
            command.workspaceId,
            "activity-type",
            activityTypeSearch,
          ),
        }
        : {}),
      availability: {
        activity: !visibility.activities_hidden,
        note: !visibility.notes_hidden,
      },
      emotions: visibleEmotions.map(option),
      ...(emotions.rows.length > command.limit && lastEmotion
        ? {
          emotionsNextCursor: encodeCursor(
            {
              id: lastEmotion.id,
              name: lastEmotion.name,
              sortOrder: lastEmotion.sort_order,
            },
            command.workspaceId,
            "emotion",
            emotionSearch,
          ),
        }
        : {}),
      status: "ready",
    };
  }
}
