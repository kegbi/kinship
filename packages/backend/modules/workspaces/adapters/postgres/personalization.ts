import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import {
  UNIQUE_CONFLICT,
  writeWithUniqueConflict,
} from "../../../../platform/postgres/transactions.ts";
import type {
  PersonalizationEntry,
  PersonalizationSection,
} from "../../domain/personalization_rules.ts";
import type {
  PersonalizationRepository,
  WorkspacePersonalizationDeleteCommand,
  WorkspacePersonalizationRepository,
} from "../../ports/personalization_repository.ts";

interface Row {
  readonly canDelete: boolean;
  readonly id: string;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly name: string;
  readonly forwardLabel?: string;
  readonly referenceCount: number;
  readonly sortOrder: number;
  readonly reverseLabel?: string;
  readonly updatedAt: string;
}

interface Vocabulary {
  readonly active: string;
  readonly canDelete: string;
  readonly name: string;
  readonly nameColumn: string;
  readonly sort: string;
  readonly table: string;
}

const VOCABULARIES: Partial<Record<PersonalizationSection, Vocabulary>> = {
  "profile-modules": {
    active: "v.is_active",
    canDelete: "v.can_delete",
    name: "coalesce(v.name, v.translation_key, v.key)",
    nameColumn: "name",
    sort: "v.sort_order",
    table: "workspace_profile_modules",
  },
  "gender-options": {
    active: "not v.is_archived",
    canDelete: "not v.is_system",
    name: "v.name",
    nameColumn: "name",
    sort: "v.sort_order",
    table: "gender_options",
  },
  "contact-method-types": {
    active: "not v.is_archived",
    canDelete: "v.can_delete and not v.is_system",
    name: "v.name",
    nameColumn: "name",
    sort: "v.sort_order",
    table: "contact_method_types",
  },
  "contact-labels": {
    active: "true",
    canDelete: "not v.is_system",
    name: "coalesce(v.label, v.translation_key)",
    nameColumn: "label",
    sort: "0",
    table: "contact_labels",
  },
  "activity-types": {
    active: "not v.is_archived",
    canDelete: "not v.is_system",
    name: "coalesce(v.name, v.translation_key)",
    nameColumn: "name",
    sort: "v.sort_order",
    table: "activity_types",
  },
  "life-event-types": {
    active: "not v.is_archived",
    canDelete: "not v.is_system",
    name: "coalesce(v.name, v.seed_key)",
    nameColumn: "name",
    sort: "v.sort_order",
    table: "life_event_types",
  },
  "relationship-types": {
    active: "not v.is_archived",
    canDelete: "v.can_delete and not v.is_system",
    name: "v.forward_label || ' / ' || v.reverse_label",
    nameColumn: "forward_label",
    sort: "v.sort_order",
    table: "relationship_types",
  },
};

function profileModuleKey(name: string): string | undefined {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return key && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) ? key : undefined;
}

const SAVEPOINT = "workspace_personalization_write";

function itemCapabilities(
  section: PersonalizationSection,
  canDelete: boolean,
): PersonalizationEntry["capabilities"] {
  const readOnly = section === "emotion-options" ||
    section === "pet-categories";
  return {
    delete: !readOnly && canDelete,
    disable: !readOnly && section !== "contact-labels",
    editValue: false,
    rename: !readOnly,
    reorder: !readOnly && section !== "contact-labels",
    replace: !readOnly && canDelete,
    setDefault: section === "gender-options",
  };
}

function entry(
  section: PersonalizationSection,
  row: Row,
): PersonalizationEntry {
  const readOnly = section === "emotion-options" ||
    section === "pet-categories";
  return {
    ...row,
    canDelete: row.canDelete && !row.isDefault,
    capabilities: itemCapabilities(section, row.canDelete && !row.isDefault),
    kind: section === "relationship-types" ? "relationship-type" : "named",
    readOnly,
    updatedAt: row.updatedAt.replace(" ", "T").replace(/\+00$/, "Z"),
  };
}

async function authorized(
  command: Parameters<PersonalizationRepository["list"]>[0],
): Promise<boolean> {
  if (command.role === "member") return false;
  const result = await sql<{ readonly allowed: boolean }>`
    select exists(select 1 from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.id = ${command.memberId}::uuid
        and wm.user_id = ${command.userId}::uuid
        and wm.workspace_id = ${command.workspaceId}::uuid
        and wm.role in ('owner', 'admin') and wm.status = 'active'
        and wm.left_at is null and w.status = 'active' and w.deleted_at is null
    ) as allowed
  `.execute(databaseFromSession(command.transaction));
  return result.rows[0]?.allowed === true;
}

export class PostgresWorkspacePersonalization
  implements WorkspacePersonalizationRepository {
  authorize(
    command: Parameters<PersonalizationRepository["list"]>[0],
  ): Promise<boolean> {
    return authorized(command);
  }

  async list(
    command: Parameters<PersonalizationRepository["list"]>[0],
  ): ReturnType<PersonalizationRepository["list"]> {
    if (!await authorized(command)) return { status: "forbidden" };
    const vocabulary = VOCABULARIES[command.section];
    if (!vocabulary) {
      if (command.section === "tags") return { status: "unavailable" };
      if (command.section === "reminder-rules") {
        return { status: "unavailable" };
      }
      const globalTable = command.section === "emotion-options"
        ? "emotion_options"
        : "pet_categories";
      const result = await sql<Row>`
        select v.id::text, v.name, v.sort_order::int as "sortOrder",
          v.is_active as "isActive", false as "canDelete",
          false as "isDefault", 0::int as "referenceCount",
          v.updated_at::text as "updatedAt"
        from ${sql.table(`crm.${globalTable}`)} as v
        order by v.sort_order, lower(v.name), v.id
      `.execute(databaseFromSession(command.transaction));
      return {
        capabilities: { create: false, editValue: false },
        entries: result.rows.map((row) => entry(command.section, row)),
        readOnly: true,
        status: "ready",
      };
    }
    const defaultExpression = command.section === "gender-options"
      ? `exists(select 1 from crm.workspace_settings ws where ws.workspace_id = v.workspace_id and ws.default_gender_option_id = v.id)`
      : "false";
    const orderExpression = command.section === "contact-labels"
      ? `lower(${vocabulary.name}), v.id`
      : `${vocabulary.sort}, lower(${vocabulary.name}), v.id`;
    const result = await sql<Row>`
      select v.id::text, ${sql.raw(vocabulary.name)}::text as name,
        ${sql.raw(vocabulary.sort)}::int as "sortOrder",
        ${sql.raw(vocabulary.active)}::boolean as "isActive",
        ${sql.raw(vocabulary.canDelete)}::boolean as "canDelete",
        ${sql.raw(defaultExpression)}::boolean as "isDefault",
        0::int as "referenceCount", v.updated_at::text as "updatedAt",
        ${
      command.section === "relationship-types"
        ? sql.raw("v.forward_label")
        : sql.raw("null")
    }::text as "forwardLabel",
        ${
      command.section === "relationship-types"
        ? sql.raw("v.reverse_label")
        : sql.raw("null")
    }::text as "reverseLabel"
      from ${sql.table(`crm.${vocabulary.table}`)} as v
      where v.workspace_id = ${command.workspaceId}::uuid
      order by ${sql.raw(orderExpression)}
    `.execute(databaseFromSession(command.transaction));
    return {
      capabilities: { create: true, editValue: false },
      entries: result.rows.map((row) => entry(command.section, row)),
      readOnly: false,
      status: "ready",
    };
  }

  async inspect(
    command: Parameters<PersonalizationRepository["inspect"]>[0],
  ): ReturnType<PersonalizationRepository["inspect"]> {
    const listed = await this.list(command);
    if (listed.status !== "ready") return listed;
    const found = listed.entries.find((candidate) =>
      candidate.id === command.id
    );
    return found ? { entry: found, status: "ready" } : { status: "not-found" };
  }

  async prepareDelete(
    command: WorkspacePersonalizationDeleteCommand,
  ): ReturnType<WorkspacePersonalizationRepository["prepareDelete"]> {
    if (!await authorized(command)) return { status: "forbidden" };
    const vocabulary = VOCABULARIES[command.section];
    if (!vocabulary) return { status: "invalid" };
    if (command.replacementId === command.id) return { status: "not-found" };
    const database = databaseFromSession(command.transaction);
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.workspaceId}, 23))`
      .execute(database);
    const locked = await sql<{ readonly id: string }>`
      select id::text from ${sql.table(`crm.${vocabulary.table}`)}
      where workspace_id = ${command.workspaceId}::uuid
        and id in (${command.id}::uuid, ${
      command.replacementId ?? command.id
    }::uuid)
      order by id for update
    `.execute(database);
    const expectedRows = command.replacementId ? 2 : 1;
    if (locked.rows.length !== expectedRows) return { status: "not-found" };
    const existing = await this.inspect(command);
    if (existing.status !== "ready") return existing;
    if (existing.entry.updatedAt !== command.expectedUpdatedAt) {
      return { status: "stale" };
    }
    if (!existing.entry.canDelete) return { status: "required-default" };
    return existing;
  }

  async deletePrepared(
    command: WorkspacePersonalizationDeleteCommand,
  ): ReturnType<WorkspacePersonalizationRepository["deletePrepared"]> {
    const vocabulary = VOCABULARIES[command.section];
    if (!vocabulary) {
      throw new Error("Prepared personalization vocabulary is unavailable");
    }
    const deleted = await sql<{ readonly id: string }>`
      delete from ${sql.table(`crm.${vocabulary.table}`)}
      where id = ${command.id}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (deleted.rows.length !== 1) {
      throw new Error("Prepared personalization option was not deleted");
    }
    return { id: command.id, status: "deleted" };
  }

  async mutate(
    command: Parameters<PersonalizationRepository["mutate"]>[0],
  ): ReturnType<PersonalizationRepository["mutate"]> {
    if (!await authorized(command)) return { status: "forbidden" };
    const vocabulary = VOCABULARIES[command.section];
    if (!vocabulary) return { status: "invalid" };
    const database = databaseFromSession(command.transaction);
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.workspaceId}, 23))`
      .execute(database);
    if (command.action === "create") {
      const moduleKey = command.section === "profile-modules"
        ? profileModuleKey(command.name ?? "")
        : undefined;
      if (command.section === "profile-modules" && !moduleKey) {
        return { status: "invalid" };
      }
      if (moduleKey) {
        const duplicateKey = await sql<{ readonly duplicate: boolean }>`
          select exists(select 1 from crm.workspace_profile_modules
            where workspace_id = ${command.workspaceId}::uuid
              and key = ${moduleKey}) as duplicate
        `.execute(database);
        if (duplicateKey.rows[0]?.duplicate) return { status: "conflict" };
      }
      const duplicate = await sql<{ readonly duplicate: boolean }>`
        select exists(select 1 from ${sql.table(`crm.${vocabulary.table}`)} v
          where v.workspace_id = ${command.workspaceId}::uuid
            and lower(${sql.raw(vocabulary.name)}) = lower(${
        command.name ?? ""
      })
        ) as duplicate
      `.execute(database);
      if (
        duplicate.rows[0]?.duplicate && command.section !== "relationship-types"
      ) {
        return { status: "conflict" };
      }
      if (command.section === "relationship-types") {
        const pairDuplicate = await sql<{ readonly duplicate: boolean }>`
          select exists(select 1 from crm.relationship_types
            where workspace_id = ${command.workspaceId}::uuid
              and lower(forward_label) = lower(${command.forwardLabel!})
              and lower(reverse_label) = lower(${command
          .reverseLabel!})) as duplicate
        `.execute(database);
        if (pairDuplicate.rows[0]?.duplicate) return { status: "conflict" };
      }
      const insertedResult = await writeWithUniqueConflict(
        database,
        SAVEPOINT,
        async (): Promise<{ readonly id: string } | undefined> => {
          if (command.section === "profile-modules") {
            return (await sql<{ readonly id: string }>`
              insert into crm.workspace_profile_modules
                (workspace_id, key, name, is_active, can_delete, sort_order)
              values (${command.workspaceId}::uuid, ${moduleKey!}, ${command
              .name!}, true, true, ${command.sortOrder}) returning id::text
            `.execute(database)).rows[0];
          }
          if (command.section === "contact-labels") {
            return (await sql<{ readonly id: string }>`
              insert into crm.contact_labels (workspace_id, label)
              values (${command.workspaceId}::uuid, ${command
              .name!}) returning id::text
            `.execute(database)).rows[0];
          }
          if (command.section === "relationship-types") {
            return (await sql<{ readonly id: string }>`
              insert into crm.relationship_types
                (workspace_id, forward_label, reverse_label, can_delete, sort_order)
              values (${command.workspaceId}::uuid, ${command
              .forwardLabel!}, ${command.reverseLabel!}, true,
                ${command.sortOrder}) returning id::text
            `.execute(database)).rows[0];
          }
          return (await sql<{ readonly id: string }>`
            insert into ${sql.table(`crm.${vocabulary.table}`)}
              (workspace_id, ${sql.ref(vocabulary.nameColumn)}, sort_order)
            values (${command.workspaceId}::uuid, ${command
            .name!}, ${command.sortOrder}) returning id::text
          `.execute(database)).rows[0];
        },
      );
      if (insertedResult === UNIQUE_CONFLICT) return { status: "conflict" };
      const inserted = insertedResult;
      if (!inserted) return { status: "unavailable" };
      const inspected = await this.inspect({ ...command, id: inserted.id });
      return inspected.status === "ready"
        ? { entry: inspected.entry, status: "saved" }
        : inspected;
    }
    const locked = await sql<{ readonly id: string }>`
      select id::text from ${sql.table(`crm.${vocabulary.table}`)}
      where id = ${command.id}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      for update
    `.execute(database);
    if (locked.rows.length !== 1) return { status: "not-found" };
    const existing = await this.inspect(command);
    if (existing.status !== "ready") return existing;
    if (existing.entry.updatedAt !== command.expectedUpdatedAt) {
      return { status: "stale" };
    }
    if (command.action === "delete") {
      if (!existing.entry.canDelete) return { status: "required-default" };
      await sql`
        delete from ${sql.table(`crm.${vocabulary.table}`)}
        where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid
      `.execute(database);
      return { id: command.id, status: "deleted" };
    }
    const name = command.name ?? existing.entry.name;
    const sortOrder = command.sortOrder ?? existing.entry.sortOrder;
    const isActive = command.isActive ?? existing.entry.isActive;
    if (
      command.name !== undefined && command.section !== "relationship-types"
    ) {
      const duplicate = await sql<{ readonly duplicate: boolean }>`
        select exists(select 1 from ${sql.table(`crm.${vocabulary.table}`)} v
          where v.workspace_id = ${command.workspaceId}::uuid
            and v.id <> ${command.id}::uuid
            and lower(${sql.raw(vocabulary.name)}) = lower(${name})
        ) as duplicate
      `.execute(database);
      if (duplicate.rows[0]?.duplicate) return { status: "conflict" };
    }
    if (
      command.section === "contact-labels" &&
      (!isActive || sortOrder !== 0)
    ) return { status: "invalid" };
    const updatedResult = await writeWithUniqueConflict(
      database,
      SAVEPOINT,
      async () => {
        if (command.section === "profile-modules") {
          await sql`update crm.workspace_profile_modules set name = ${name},
        sort_order = ${sortOrder}, is_active = ${isActive}, updated_at = now()
        where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid`
            .execute(database);
        } else if (command.section === "contact-labels") {
          await sql`update crm.contact_labels set label = ${name}, updated_at = now()
        where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid`
            .execute(database);
        } else if (command.section === "relationship-types") {
          const forwardLabel = command.forwardLabel ??
            existing.entry.forwardLabel!;
          const reverseLabel = command.reverseLabel ??
            existing.entry.reverseLabel!;
          const pairDuplicate = await sql<{ readonly duplicate: boolean }>`
        select exists(select 1 from crm.relationship_types
          where workspace_id = ${command.workspaceId}::uuid and id <> ${command.id}::uuid
            and lower(forward_label) = lower(${forwardLabel})
            and lower(reverse_label) = lower(${reverseLabel})) as duplicate
      `.execute(database);
          if (pairDuplicate.rows[0]?.duplicate) return "conflict" as const;
          await sql`update crm.relationship_types set forward_label = ${forwardLabel},
        reverse_label = ${reverseLabel}, sort_order = ${sortOrder},
        is_archived = ${!isActive}, updated_at = now()
        where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid`
            .execute(database);
        } else {
          const activeColumn = command.section === "gender-options" ||
              command.section === "contact-method-types" ||
              command.section === "activity-types" ||
              command.section === "life-event-types"
            ? "is_archived"
            : undefined;
          await sql`update ${sql.table(`crm.${vocabulary.table}`)} set
        ${sql.ref(vocabulary.nameColumn)} = ${name}, sort_order = ${sortOrder},
        ${activeColumn ? sql.ref(activeColumn) : sql.ref("updated_at")} = ${
            activeColumn ? !isActive : new Date()
          }, updated_at = now()
        where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid`
            .execute(database);
        }
        if (command.section === "gender-options" && command.isDefault) {
          await sql`update crm.workspace_settings set default_gender_option_id = ${command.id}::uuid,
        updated_at = now() where workspace_id = ${command.workspaceId}::uuid`
            .execute(database);
        }
        return "updated" as const;
      },
    );
    if (
      updatedResult === UNIQUE_CONFLICT || updatedResult === "conflict"
    ) return { status: "conflict" };
    const updated = await this.inspect(command);
    return updated.status === "ready"
      ? { entry: updated.entry, status: "saved" }
      : updated;
  }
}
