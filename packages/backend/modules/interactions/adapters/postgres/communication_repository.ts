import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import {
  instantColumn,
  millisecondInstantColumn,
} from "../../../../platform/postgres/timestamps.ts";
import type {
  CallRecord,
  CommunicationMessage,
  ConversationRecord,
  StoredCommunication,
} from "../../domain/communication_rules.ts";
import type { CommunicationRepository } from "../../ports/communication_repository.ts";

interface CallRow {
  readonly called_at: string;
  readonly contact_was_caller: boolean;
  readonly content: string | null;
  readonly created_at: string;
  readonly created_by_member_id: string | null;
  readonly emotion_ids: readonly string[];
  readonly id: string;
  readonly person_id: string;
}

interface ConversationRow {
  readonly channel_type_id: string | null;
  readonly contact_method_id: string | null;
  readonly created_at: string;
  readonly happened_at: string;
  readonly id: string;
  readonly messages: readonly CommunicationMessage[];
  readonly person_id: string;
  readonly title: string | null;
}

export class PostgresCommunicationRepository
  implements CommunicationRepository {
  async lockRequest(
    command: Parameters<CommunicationRepository["lockRequest"]>[0],
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.id}, 0))`
      .execute(databaseFromSession(command.transaction));
  }

  async findRequest(
    command: Parameters<CommunicationRepository["findRequest"]>[0],
  ): Promise<Awaited<ReturnType<CommunicationRepository["findRequest"]>>> {
    const database = databaseFromSession(command.transaction);
    const calls = await sql<CallRow>`
      select call.id::text, call.person_id::text, ${
      millisecondInstantColumn("call.called_at")
    } as called_at,
        call.contact_was_caller, call.content, call.created_by_member_id::text,
        ${instantColumn("call.created_at")} as created_at,
        coalesce((select array_agg(link.emotion_id::text order by link.emotion_id)
          from crm.call_emotions link where link.call_id = call.id), array[]::text[]) as emotion_ids
      from crm.calls call where call.id = ${command.id}::uuid
        and call.workspace_id = ${command.workspaceId}::uuid
    `.execute(database);
    const call = calls.rows[0];
    if (call) return { communication: this.storedCall(call), status: "found" };
    const conversations = await sql<ConversationRow>`
      select thread.id::text, thread.person_id::text, thread.channel_type_id::text,
        thread.contact_method_id::text, ${
      millisecondInstantColumn("thread.happened_at")
    } as happened_at,
        thread.title, ${instantColumn("thread.created_at")} as created_at,
        coalesce((select jsonb_agg(jsonb_build_object('id', message.id::text,
          'content', message.content, 'direction', message.direction,
          'writtenAt', ${
      millisecondInstantColumn("message.written_at")
    }) order by message.written_at, message.id)
          from crm.messages message where message.conversation_id = thread.id), '[]'::jsonb) as messages
      from crm.conversation_threads thread where thread.id = ${command.id}::uuid
        and thread.workspace_id = ${command.workspaceId}::uuid
    `.execute(database);
    const thread = conversations.rows[0];
    return thread
      ? { communication: this.storedConversation(thread), status: "found" }
      : { status: "absent" };
  }

  private storedCall(row: CallRow): StoredCommunication {
    return {
      calledAt: row.called_at,
      contactWasCaller: row.contact_was_caller,
      ...pickDefined({ content: row.content }),
      createdAt: row.created_at,
      ...pickDefined({ createdByMemberId: row.created_by_member_id }),
      emotionIds: row.emotion_ids,
      id: row.id,
      kind: "call",
      personId: row.person_id,
    };
  }

  private storedConversation(row: ConversationRow): StoredCommunication {
    return {
      ...pickDefined({
        channelTypeId: row.channel_type_id,
        contactMethodId: row.contact_method_id,
      }),
      createdAt: row.created_at,
      happenedAt: row.happened_at,
      id: row.id,
      kind: "conversation",
      messages: row.messages,
      personId: row.person_id,
      ...pickDefined({ title: row.title }),
    };
  }

  async createCall(
    command: Parameters<CommunicationRepository["createCall"]>[0],
  ): Promise<CallRecord | undefined> {
    const database = databaseFromSession(command.transaction);
    const inserted = await sql<{ readonly created_at: string }>`
      insert into crm.calls (id, workspace_id, person_id, called_at, contact_was_caller,
        content, created_by_member_id, created_at, updated_at) values (
        ${command.id}::uuid, ${command.workspaceId}::uuid, ${command.person.id}::uuid,
        ${command.calledAt}, ${command.contactWasCaller}, ${
      command.content ?? null
    },
        ${command.memberId}::uuid, ${command.occurredAt}, ${command.occurredAt})
      returning ${instantColumn("created_at")} as created_at
    `.execute(database);
    const row = inserted.rows[0];
    if (!row) return undefined;
    if (command.emotions.length > 0) {
      await sql`
      insert into crm.call_emotions (call_id, emotion_id, created_at) values ${
        sql.join(
          command.emotions.map((emotion) =>
            sql`(${command.id}::uuid, ${emotion.id}::uuid, ${command.occurredAt})`
          ),
        )
      }
    `.execute(database);
    }
    return {
      calledAt: command.calledAt.toISOString(),
      contactWasCaller: command.contactWasCaller,
      ...pickDefined({ content: command.content }),
      createdAt: row.created_at,
      emotions: command.emotions,
      id: command.id,
      kind: "call",
      person: command.person,
    };
  }

  async createConversation(
    command: Parameters<CommunicationRepository["createConversation"]>[0],
  ): Promise<ConversationRecord | undefined> {
    const database = databaseFromSession(command.transaction);
    const inserted = await sql<{ readonly created_at: string }>`
      insert into crm.conversation_threads (id, workspace_id, person_id, channel_type_id,
        contact_method_id, happened_at, title, created_at, updated_at) values (
        ${command.id}::uuid, ${command.workspaceId}::uuid, ${command.person.id}::uuid,
        ${command.channelType.id}::uuid, ${
      command.contactMethod?.id ?? null
    }::uuid,
        ${command.happenedAt}, ${
      command.title ?? null
    }, ${command.occurredAt}, ${command.occurredAt})
      returning ${instantColumn("created_at")} as created_at
    `.execute(database);
    const row = inserted.rows[0];
    if (!row) return undefined;
    if (command.messages.length > 0) {
      await sql`
      insert into crm.messages (id, conversation_id, content, written_at, direction,
        author_member_id, created_at, updated_at) values ${
        sql.join(command.messages.map((message) =>
          sql`(
          ${message.id}::uuid, ${command.id}::uuid, ${message.content}, ${new Date(
            message.writtenAt,
          )},
          ${message.direction}, ${
            message.direction === "outbound" ? command.memberId : null
          }::uuid,
          ${command.occurredAt}, ${command.occurredAt})`
        ))
      }
    `.execute(database);
    }
    return {
      channelType: command.channelType,
      ...pickDefined({ contactMethod: command.contactMethod }),
      createdAt: row.created_at,
      happenedAt: command.happenedAt.toISOString(),
      id: command.id,
      kind: "conversation",
      messages: command.messages,
      person: command.person,
      ...pickDefined({ title: command.title }),
    };
  }

  async listForPerson(
    command: Parameters<CommunicationRepository["listForPerson"]>[0],
  ): Promise<readonly StoredCommunication[]> {
    const database = databaseFromSession(command.transaction);
    const [calls, conversations] = await Promise.all([
      sql<CallRow>`
        select call.id::text, call.person_id::text, ${
        millisecondInstantColumn("call.called_at")
      } as called_at,
          call.contact_was_caller, call.content, call.created_by_member_id::text,
          ${instantColumn("call.created_at")} as created_at,
          coalesce((select array_agg(link.emotion_id::text order by link.emotion_id)
            from crm.call_emotions link where link.call_id = call.id), array[]::text[]) as emotion_ids
        from crm.calls call
        where call.workspace_id = ${command.workspaceId}::uuid
          and call.person_id = ${command.personId}::uuid
        order by call.called_at desc, call.id
        limit 50
      `.execute(database),
      sql<ConversationRow>`
        select thread.id::text, thread.person_id::text,
          thread.channel_type_id::text, thread.contact_method_id::text,
          ${millisecondInstantColumn("thread.happened_at")} as happened_at,
          thread.title, ${instantColumn("thread.created_at")} as created_at,
          coalesce((select jsonb_agg(jsonb_build_object('id', message.id::text,
            'content', message.content, 'direction', message.direction,
            'writtenAt', ${millisecondInstantColumn("message.written_at")})
            order by message.written_at, message.id)
            from crm.messages message where message.conversation_id = thread.id),
            '[]'::jsonb) as messages
        from crm.conversation_threads thread
        where thread.workspace_id = ${command.workspaceId}::uuid
          and thread.person_id = ${command.personId}::uuid
        order by thread.happened_at desc, thread.id
        limit 50
      `.execute(database),
    ]);
    return [
      ...calls.rows.map((row) => this.storedCall(row)),
      ...conversations.rows.map((row) => this.storedConversation(row)),
    ].sort((left, right) => {
      const leftAt = left.kind === "call" ? left.calledAt : left.happenedAt;
      const rightAt = right.kind === "call" ? right.calledAt : right.happenedAt;
      return rightAt.localeCompare(leftAt) || left.id.localeCompare(right.id);
    }).slice(0, 50);
  }

  async assertPostcondition(
    command: Parameters<CommunicationRepository["assertPostcondition"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    const result = command.record.kind === "call"
      ? await sql<{ readonly valid: boolean }>`select count(*) = 1 and
          (select count(*) from crm.call_emotions where call_id = ${command.record.id}::uuid) = ${command.record.emotions.length} as valid
          from crm.calls where id = ${command.record.id}::uuid and workspace_id = ${command.workspaceId}::uuid
            and person_id = ${command.record.person.id}::uuid and created_by_member_id = ${command.memberId}::uuid`
        .execute(database)
      : await sql<{ readonly valid: boolean }>`select count(*) = 1 and
          (select count(*) from crm.messages where conversation_id = ${command.record.id}::uuid) = ${command.record.messages.length} as valid
          from crm.conversation_threads where id = ${command.record.id}::uuid and workspace_id = ${command.workspaceId}::uuid
            and person_id = ${command.record.person.id}::uuid`.execute(
        database,
      );
    if (result.rows[0]?.valid !== true) {
      throw new Error("Communication persistence postcondition failed.");
    }
  }
}
