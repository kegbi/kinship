import { type RawBuilder, sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  InteractionKind,
  StoredRecord,
} from "../../domain/interaction_changes.ts";
import type { InteractionChangeRepository } from "../../ports/interaction_change_repository.ts";
import { PostgresCommunicationRepository } from "./communication_repository.ts";
import { PostgresInteractionRepository } from "./interaction_repository.ts";

/**
 * The table each kind lives in. These are fixed literals of this file, never
 * client text, so they may be spliced into a statement.
 */
const TABLES: Readonly<Record<InteractionKind, string>> = {
  activity: "crm.activities",
  call: "crm.calls",
  conversation: "crm.conversation_threads",
  note: "crm.notes",
};

type Database = ReturnType<typeof databaseFromSession>;

/** `case when supplied then value else current end`, for a partial update. */
function keep(
  supplied: boolean,
  value: RawBuilder<unknown>,
  current: string,
): RawBuilder<unknown> {
  return supplied ? value : sql.raw(current);
}

/**
 * Makes a join table hold exactly `ids` for one record: rows no longer named
 * are removed and new ones added, so a participant or an emotion that stays
 * keeps the row (and the role) it already had.
 */
async function replaceLinks(
  database: Database,
  table:
    | "crm.activity_emotions"
    | "crm.activity_participants"
    | "crm.call_emotions",
  owner: "activity_id" | "call_id",
  member: "emotion_id" | "person_id",
  id: string,
  ids: readonly string[],
  occurredAt: Date,
): Promise<void> {
  const keepIds = ids.length === 0
    ? sql`array[]::uuid[]`
    : sql`array[${sql.join(ids.map((entry) => sql`${entry}::uuid`))}]`;
  await sql`
    delete from ${sql.raw(table)}
    where ${sql.raw(owner)} = ${id}::uuid
      and not (${sql.raw(member)} = any(${keepIds}))
  `.execute(database);
  if (ids.length === 0) return;
  await sql`
    insert into ${sql.raw(table)} (${sql.raw(owner)}, ${
    sql.raw(member)
  }, created_at)
    values ${
    sql.join(ids.map((entry) =>
      sql`(${id}::uuid, ${entry}::uuid, ${occurredAt})`
    ))
  }
    on conflict do nothing
  `.execute(database);
}

/** The revision a write leaves: now, and always later than the last one. */
function nextRevision(occurredAt: Date, alias: string): RawBuilder<unknown> {
  return sql`greatest(${occurredAt}::timestamptz, ${
    sql.raw(alias)
  }.updated_at + interval '1 microsecond')`;
}

export class PostgresInteractionChangeRepository
  implements InteractionChangeRepository {
  constructor(
    private readonly interactions = new PostgresInteractionRepository(),
    private readonly communications = new PostgresCommunicationRepository(),
  ) {}

  async find(
    command: Parameters<InteractionChangeRepository["find"]>[0],
  ): Promise<StoredRecord | undefined> {
    const locked = await sql<{ readonly id: string }>`
      select id::text from ${sql.raw(TABLES[command.kind])}
      where id = ${command.id}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      for update
    `.execute(databaseFromSession(command.transaction));
    if (locked.rows.length === 0) return undefined;
    switch (command.kind) {
      case "activity":
        return await this.interactions.findActivity(command);
      case "note":
        return await this.interactions.findNote(command);
      case "call":
        return await this.communications.findCall(command);
      case "conversation":
        return await this.communications.findConversation(command);
    }
  }

  async save(
    command: Parameters<InteractionChangeRepository["save"]>[0],
  ): Promise<boolean> {
    const database = databaseFromSession(command.transaction);
    const { change } = command;
    const scope = sql`
      where record.id = ${command.id}::uuid
        and record.workspace_id = ${command.workspaceId}::uuid
        and record.updated_at = ${command.expectedUpdatedAt}::timestamptz
      returning record.id::text
    `;
    const revision = nextRevision(command.occurredAt, "record");
    let updated: { readonly rows: readonly unknown[] };
    switch (change.kind) {
      case "note":
        updated = await sql`
          update crm.notes record set
            body = ${
          keep(
            change.body !== undefined,
            sql`${change.body ?? ""}::text`,
            "record.body",
          )
        },
            is_favorited = ${
          keep(
            change.isFavorited !== undefined,
            sql`${change.isFavorited === true}::boolean`,
            "record.is_favorited",
          )
        },
            favorited_at = ${
          keep(
            change.isFavorited !== undefined,
            change.isFavorited === true
              ? sql`case when record.is_favorited then record.favorited_at
                  else ${command.occurredAt}::timestamptz end`
              : sql`null::timestamptz`,
            "record.favorited_at",
          )
        },
            updated_at = ${revision}
          ${scope}
        `.execute(database);
        return updated.rows.length === 1;
      case "activity":
        updated = await sql`
          update crm.activities record set
            activity_type_id = ${
          keep(
            change.activityTypeId !== undefined,
            sql`${change.activityTypeId ?? null}::uuid`,
            "record.activity_type_id",
          )
        },
            summary = ${
          keep(
            change.summary !== undefined,
            sql`${change.summary ?? ""}::text`,
            "record.summary",
          )
        },
            description = ${
          keep(
            change.description !== undefined,
            sql`${change.description ?? null}::text`,
            "record.description",
          )
        },
            happened_at = ${
          keep(
            change.happenedAt !== undefined,
            sql`${change.happenedAt ?? null}::timestamptz`,
            "record.happened_at",
          )
        },
            updated_at = ${revision}
          ${scope}
        `.execute(database);
        if (updated.rows.length !== 1) return false;
        if (change.participantIds) {
          await replaceLinks(
            database,
            "crm.activity_participants",
            "activity_id",
            "person_id",
            command.id,
            change.participantIds,
            command.occurredAt,
          );
        }
        if (change.emotionIds) {
          await replaceLinks(
            database,
            "crm.activity_emotions",
            "activity_id",
            "emotion_id",
            command.id,
            change.emotionIds,
            command.occurredAt,
          );
        }
        return true;
      case "call":
        updated = await sql`
          update crm.calls record set
            called_at = ${
          keep(
            change.calledAt !== undefined,
            sql`${change.calledAt ?? null}::timestamptz`,
            "record.called_at",
          )
        },
            contact_was_caller = ${
          keep(
            change.contactWasCaller !== undefined,
            sql`${change.contactWasCaller === true}::boolean`,
            "record.contact_was_caller",
          )
        },
            content = ${
          keep(
            change.content !== undefined,
            sql`${change.content ?? null}::text`,
            "record.content",
          )
        },
            updated_at = ${revision}
          ${scope}
        `.execute(database);
        if (updated.rows.length !== 1) return false;
        if (change.emotionIds) {
          await replaceLinks(
            database,
            "crm.call_emotions",
            "call_id",
            "emotion_id",
            command.id,
            change.emotionIds,
            command.occurredAt,
          );
        }
        return true;
      case "conversation":
        updated = await sql`
          update crm.conversation_threads record set
            channel_type_id = ${
          keep(
            change.channelTypeId !== undefined,
            sql`${change.channelTypeId ?? null}::uuid`,
            "record.channel_type_id",
          )
        },
            contact_method_id = ${
          keep(
            change.contactMethodId !== undefined,
            sql`${change.contactMethodId ?? null}::uuid`,
            "record.contact_method_id",
          )
        },
            happened_at = ${
          keep(
            change.happenedAt !== undefined,
            sql`${change.happenedAt ?? null}::timestamptz`,
            "record.happened_at",
          )
        },
            title = ${
          keep(
            change.title !== undefined,
            sql`${change.title ?? null}::text`,
            "record.title",
          )
        },
            updated_at = ${revision}
          ${scope}
        `.execute(database);
        if (updated.rows.length !== 1) return false;
        if (change.messages) {
          await sql`
            delete from crm.messages where conversation_id = ${command.id}::uuid
          `.execute(database);
          if (change.messages.length > 0) {
            await sql`
              insert into crm.messages (conversation_id, content, written_at,
                direction, author_member_id, created_at, updated_at)
              values ${
              sql.join(change.messages.map((message) =>
                sql`(${command.id}::uuid, ${message.content},
                  ${new Date(message.writtenAt)}, ${message.direction}, ${
                  message.direction === "outbound" ? command.memberId : null
                }::uuid, ${command.occurredAt}, ${command.occurredAt})`
              ))
            }
            `.execute(database);
          }
        }
        return true;
    }
  }

  async remove(
    command: Parameters<InteractionChangeRepository["remove"]>[0],
  ): Promise<boolean> {
    // The schema declares what goes with the record: participants, emotions,
    // messages, and an activity's journal item cascade; nothing else points
    // at these rows.
    const removed = await sql<{ readonly id: string }>`
      delete from ${sql.raw(TABLES[command.kind])}
      where id = ${command.id}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and updated_at = ${command.expectedUpdatedAt}::timestamptz
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return removed.rows.length === 1;
  }
}
