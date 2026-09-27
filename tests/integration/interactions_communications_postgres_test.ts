/**
 * Calls and conversations (split from `interactions_postgres_test.ts`,
 * GAP-035).
 *
 * Its final test closes the app and pools it loaded from
 * `interactions.test-helper.ts`.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import {
  configured,
  createPerson,
  deepEqual,
  directCommunications,
  directConnection,
  register,
  request,
  sql,
} from "./interactions.test-helper.ts";

Deno.test("INTERACTION-002 PostgreSQL atomically persists tenant-safe calls and conversations", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `communication-${suffix}@example.test`,
    "Communication",
  );
  const foreign = await register(
    `communication-foreign-${suffix}@example.test`,
    "Foreign communication",
  );
  const personId = await createPerson(primary, "Ada communication");
  const foreignPersonId = await createPerson(foreign, "Foreign communication");
  const emotionId = crypto.randomUUID();
  const inactiveEmotionId = crypto.randomUUID();
  const channelTypeId = crypto.randomUUID();
  const foreignChannelTypeId = crypto.randomUUID();
  const contactMethodId = crypto.randomUUID();
  const foreignContactMethodId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`insert into crm.emotion_options (id, name) values (${emotionId}::uuid, 'Grateful')`;
    await transaction`insert into crm.emotion_options (id, name, is_active) values (${inactiveEmotionId}::uuid, 'Retired', false)`;
    await transaction`insert into crm.contact_method_types (id, workspace_id, name)
      values (${channelTypeId}::uuid, ${primary.workspaceId}::uuid, 'Email')`;
    await transaction`insert into crm.contact_method_types (id, workspace_id, name)
      values (${foreignChannelTypeId}::uuid, ${foreign.workspaceId}::uuid, 'Foreign email')`;
    await transaction`insert into crm.person_contact_methods (id, person_id, type_id, value)
      values (${contactMethodId}::uuid, ${personId}::uuid, ${channelTypeId}::uuid, 'ada@example.test')`;
    await transaction`insert into crm.person_contact_methods (id, person_id, type_id, value)
      values (${foreignContactMethodId}::uuid, ${foreignPersonId}::uuid, ${foreignChannelTypeId}::uuid, 'foreign@example.test')`;
  });
  const actor = {
    memberId: primary.memberId,
    role: primary.role,
    userId: primary.userId,
    workspaceId: primary.workspaceId,
  };
  const call = await directCommunications.recordCommunication(actor, {
    calledAt: "2026-08-16T18:15:00.000Z",
    contactWasCaller: true,
    content: "Planned a visit.",
    emotionIds: [emotionId],
    kind: "call",
    personId,
    requestId: crypto.randomUUID(),
  });
  const conversation = await directCommunications.recordCommunication(actor, {
    channelTypeId,
    contactMethodId,
    happenedAt: "2026-08-16T19:15:00.000Z",
    kind: "conversation",
    messages: [
      {
        content: "Arrived?",
        direction: "outbound",
        writtenAt: "2026-08-16T19:15:00.000Z",
      },
      {
        content: "Yes",
        direction: "inbound",
        writtenAt: "2026-08-16T19:16:00.000Z",
      },
    ],
    personId,
    requestId: crypto.randomUUID(),
    title: "Arrival",
  });
  assert(
    call.status === "created" && conversation.status === "created",
    "communications were not created",
  );
  const listed = await directCommunications.listCommunications(actor, personId);
  assert(
    listed.status === "ready" && listed.items.length === 2,
    "person communication projection is incomplete",
  );
  const httpListed = await request(
    primary,
    `/api/v1/people/${personId}/communications`,
  );
  const httpListedBody = await httpListed.json() as {
    readonly items?: readonly unknown[];
  };
  const profile = await request(primary, `/api/v1/people/${personId}`);
  const profileBody = await profile.json() as {
    readonly person?: { readonly lastContactAt?: string };
  };
  assert(
    httpListed.status === 200 && httpListedBody.items?.length === 2,
    "versioned communication API did not use the configured public facade",
  );
  assert(
    profile.status === 200 &&
      profileBody.person?.lastContactAt === "2026-08-16T19:16:00.000Z",
    `last-contact projection did not include the latest message: ${
      JSON.stringify(profileBody)
    }`,
  );
  const malformedThreadId = crypto.randomUUID();
  const noContentCallId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`insert into crm.conversation_threads (
      id, workspace_id, person_id, channel_type_id, contact_method_id,
      happened_at, title
    ) values (
      ${malformedThreadId}::uuid, ${primary.workspaceId}::uuid,
      ${personId}::uuid, ${channelTypeId}::uuid,
      ${foreignContactMethodId}::uuid,
      '2026-08-16T17:15:00.000Z'::timestamptz,
      'Malformed persisted contact method'
    )`;
    await transaction`insert into crm.calls (
      id, workspace_id, person_id, called_at, contact_was_caller,
      content, created_by_member_id
    ) values (
      ${noContentCallId}::uuid, ${primary.workspaceId}::uuid,
      ${personId}::uuid, '2026-08-16T16:15:00.000Z'::timestamptz,
      false, null, ${primary.memberId}::uuid
    )`;
  });
  const historical = await request(
    primary,
    `/api/v1/people/${personId}/communications`,
  );
  const historicalBody = await historical.json() as {
    readonly items?: readonly Record<string, unknown>[];
  };
  const malformedThread = historicalBody.items?.find((item) =>
    item.id === malformedThreadId
  );
  const noContentCall = historicalBody.items?.find((item) =>
    item.id === noContentCallId
  );
  assert(
    historical.status === 200 && malformedThread && noContentCall,
    "persisted communication regressions were not projected",
  );
  assert(
    !("contactMethod" in malformedThread) &&
      !JSON.stringify(malformedThread).includes("foreign@example.test"),
    `malformed cross-person contact method leaked: ${
      JSON.stringify(malformedThread)
    }`,
  );
  assert(
    !("content" in noContentCall),
    `nullable call content was not omitted: ${JSON.stringify(noContentCall)}`,
  );
  const before = await sql<
    [{ readonly calls: number; readonly conversations: number }]
  >`select
    (select count(*)::int from crm.calls where workspace_id = ${primary.workspaceId}::uuid) calls,
    (select count(*)::int from crm.conversation_threads where workspace_id = ${primary.workspaceId}::uuid) conversations`;
  const crossPerson = await directCommunications.recordCommunication(actor, {
    calledAt: "2026-08-16T20:00:00.000Z",
    contactWasCaller: false,
    kind: "call",
    personId: foreignPersonId,
    requestId: crypto.randomUUID(),
  });
  const invalidMethod = await directCommunications.recordCommunication(actor, {
    channelTypeId,
    contactMethodId: crypto.randomUUID(),
    happenedAt: "2026-08-16T20:00:00.000Z",
    kind: "conversation",
    personId,
    requestId: crypto.randomUUID(),
  });
  const crossMethod = await directCommunications.recordCommunication(actor, {
    channelTypeId,
    contactMethodId: foreignContactMethodId,
    happenedAt: "2026-08-16T20:00:00.000Z",
    kind: "conversation",
    personId,
    requestId: crypto.randomUUID(),
  });
  const crossChannel = await directCommunications.recordCommunication(actor, {
    channelTypeId: foreignChannelTypeId,
    happenedAt: "2026-08-16T20:00:00.000Z",
    kind: "conversation",
    personId,
    requestId: crypto.randomUUID(),
  });
  const inactiveEmotion = await directCommunications.recordCommunication(
    actor,
    {
      calledAt: "2026-08-16T20:00:00.000Z",
      contactWasCaller: false,
      emotionIds: [inactiveEmotionId],
      kind: "call",
      personId,
      requestId: crypto.randomUUID(),
    },
  );
  const crossMember = await directCommunications.recordCommunication({
    ...actor,
    memberId: foreign.memberId,
  }, {
    calledAt: "2026-08-16T20:00:00.000Z",
    contactWasCaller: false,
    kind: "call",
    personId,
    requestId: crypto.randomUUID(),
  });
  const after = await sql<
    [{
      readonly audits: number;
      readonly calls: number;
      readonly conversations: number;
      readonly messages: number;
    }]
  >`select
    (select count(*)::int from crm.calls where workspace_id = ${primary.workspaceId}::uuid) calls,
    (select count(*)::int from crm.conversation_threads where workspace_id = ${primary.workspaceId}::uuid) conversations,
    (select count(*)::int from crm.messages message join crm.conversation_threads thread on thread.id = message.conversation_id where thread.workspace_id = ${primary.workspaceId}::uuid) messages,
    (select count(*)::int from crm.audit_events where workspace_id = ${primary.workspaceId}::uuid and action = 'interactions.communication-created') audits`;
  assert(
    crossPerson.status === "not-found" &&
      invalidMethod.status === "not-found" &&
      crossMethod.status === "not-found" &&
      crossChannel.status === "not-found" &&
      inactiveEmotion.status === "not-found" &&
      crossMember.status === "forbidden",
    "cross-workspace communication context was accepted",
  );
  assert(
    after[0]?.calls === before[0].calls &&
      after[0].conversations === before[0].conversations &&
      after[0].messages === 2 && after[0].audits === 2,
    `communication atomicity proof failed: ${JSON.stringify(after[0])}`,
  );
});

Deno.test("INTERACTION-002 PostgreSQL canonical replay retains historical communication references", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `communication-replay-${suffix}@example.test`,
    "Communication replay",
  );
  const personId = await createPerson(fixture, "Replay person");
  const channelTypeId = crypto.randomUUID();
  await sql`insert into crm.contact_method_types (id, workspace_id, name)
    values (${channelTypeId}::uuid, ${fixture.workspaceId}::uuid, 'Archived chat')`;
  const actor = {
    memberId: fixture.memberId,
    role: fixture.role,
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
  };
  const messageId = async (namespace: string, requestId: string) => {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          `kinship.interactions.${namespace}.v1\u0000${fixture.workspaceId.toLowerCase()}\u0000${requestId.toLowerCase()}`,
        ),
      ),
    );
    digest[6] = (digest[6]! & 0x0f) | 0x80;
    digest[8] = (digest[8]! & 0x3f) | 0x80;
    return [...digest.slice(0, 16)].map((value) =>
      value.toString(16).padStart(2, "0")
    ).join("");
  };
  let requestId: string;
  do {
    requestId = crypto.randomUUID();
  } while (
    await messageId("message-0", requestId) <
      await messageId("message-1", requestId)
  );
  const input = {
    channelTypeId,
    happenedAt: "2026-08-16T18:00:00.000Z",
    kind: "conversation" as const,
    messages: [
      {
        content: "Later",
        direction: "outbound" as const,
        writtenAt: "2026-08-16T19:00:00.000Z",
      },
      {
        content: "Equal B",
        direction: "inbound" as const,
        writtenAt: "2026-08-16T18:30:00.000Z",
      },
      {
        content: "Equal A",
        direction: "outbound" as const,
        writtenAt: "2026-08-16T18:30:00.000Z",
      },
    ],
    personId,
    requestId,
    title: "Replay",
  };
  const created = await directCommunications.recordCommunication(actor, input);
  const replayed = await directCommunications.recordCommunication(actor, input);
  await sql`update crm.contact_method_types set is_archived = true
    where id = ${channelTypeId}::uuid`;
  const replayedAfterArchive = await directCommunications.recordCommunication(
    actor,
    input,
  );
  const historicalId = crypto.randomUUID();
  await sql`insert into crm.conversation_threads
    (id, workspace_id, person_id, channel_type_id, happened_at, title)
    values (${historicalId}::uuid, ${fixture.workspaceId}::uuid,
      ${personId}::uuid, null, '2026-08-15T18:00:00.000Z', null)`;
  const listed = await directCommunications.listCommunications(actor, personId);
  const historical = listed.status === "ready"
    ? listed.items.find((record) => record.id === historicalId)
    : undefined;
  const proof = await sql<
    [{
      readonly audits: number;
      readonly conversations: number;
      readonly messages: number;
    }]
  >`select
    (select count(*)::int from crm.conversation_threads where id = ${
    created.status === "created" ? created.record.id : crypto.randomUUID()
  }::uuid) conversations,
    (select count(*)::int from crm.messages where conversation_id = ${
    created.status === "created" ? created.record.id : crypto.randomUUID()
  }::uuid) messages,
    (select count(*)::int from crm.audit_events where subject_id = ${
    created.status === "created" ? created.record.id : crypto.randomUUID()
  }::uuid and action = 'interactions.communication-created') audits`;
  assert(
    created.status === "created" && replayed.status === "created" &&
      replayedAfterArchive.status === "created",
    `exact communication retry was not stable: ${
      JSON.stringify({
        created: created.status,
        replayed: replayed.status,
        replayedAfterArchive: replayedAfterArchive.status,
      })
    }`,
  );
  assert(
    created.status === "created" && created.record.kind === "conversation" &&
      created.record.messages.map((message) => message.content).join(",") ===
        "Equal B,Equal A,Later",
    `created messages were not chronologically canonical: ${
      JSON.stringify(created)
    }`,
  );
  assert(
    created.status === "created" && replayed.status === "created" &&
      replayedAfterArchive.status === "created" &&
      deepEqual(replayed.record, created.record) &&
      deepEqual(replayedAfterArchive.record, created.record),
    `communication replay response differed from create: ${
      JSON.stringify({ created, replayed, replayedAfterArchive })
    }`,
  );
  assert(
    proof[0]?.conversations === 1 && proof[0].messages === 3 &&
      proof[0].audits === 1,
    `communication retry duplicated persistence: ${JSON.stringify(proof[0])}`,
  );
  assert(
    historical?.kind === "conversation" && !("channelType" in historical),
    `unknown-channel history disappeared: ${JSON.stringify(listed)}`,
  );
});

Deno.test("INTERACTION-002 PostgreSQL replay totally orders identical messages", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `communication-identical-${suffix}@example.test`,
    "Identical communication",
  );
  const personId = await createPerson(fixture, "Identical person");
  const channelTypeId = crypto.randomUUID();
  await sql`insert into crm.contact_method_types (id, workspace_id, name)
    values (${channelTypeId}::uuid, ${fixture.workspaceId}::uuid, 'Chat')`;
  const messageId = async (namespace: string, requestId: string) => {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          `kinship.interactions.${namespace}.v1\u0000${fixture.workspaceId.toLowerCase()}\u0000${requestId.toLowerCase()}`,
        ),
      ),
    );
    digest[6] = (digest[6]! & 0x0f) | 0x80;
    digest[8] = (digest[8]! & 0x3f) | 0x80;
    return [...digest.slice(0, 16)].map((value) =>
      value.toString(16).padStart(2, "0")
    ).join("");
  };
  let requestId: string;
  do {
    requestId = crypto.randomUUID();
  } while (
    await messageId("message-0", requestId) <
      await messageId("message-1", requestId)
  );
  const actor = {
    memberId: fixture.memberId,
    role: fixture.role,
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
  };
  const input = {
    channelTypeId,
    happenedAt: "2026-08-16T18:00:00.000Z",
    kind: "conversation" as const,
    messages: [
      {
        content: "Identical",
        direction: "outbound" as const,
        writtenAt: "2026-08-16T18:30:00.000Z",
      },
      {
        content: "Identical",
        direction: "outbound" as const,
        writtenAt: "2026-08-16T18:30:00.000Z",
      },
    ],
    personId,
    requestId,
  };
  const created = await directCommunications.recordCommunication(actor, input);
  const replayed = await directCommunications.recordCommunication(actor, input);
  const listed = await directCommunications.listCommunications(actor, personId);
  const listedRecord = listed.status === "ready"
    ? listed.items.find((record) =>
      created.status === "created" && record.id === created.record.id
    )
    : undefined;
  const proof = await sql<
    [{
      readonly audits: number;
      readonly conversations: number;
      readonly messages: number;
    }]
  >`select
    (select count(*)::int from crm.conversation_threads where id = ${
    created.status === "created" ? created.record.id : crypto.randomUUID()
  }::uuid) conversations,
    (select count(*)::int from crm.messages where conversation_id = ${
    created.status === "created" ? created.record.id : crypto.randomUUID()
  }::uuid) messages,
    (select count(*)::int from crm.audit_events where subject_id = ${
    created.status === "created" ? created.record.id : crypto.randomUUID()
  }::uuid and action = 'interactions.communication-created') audits`;
  assert(
    created.status === "created" && replayed.status === "created" &&
      deepEqual(replayed.record, created.record) &&
      deepEqual(listedRecord, created.record),
    `identical-message responses differed: ${
      JSON.stringify({ created, replayed, listedRecord })
    }`,
  );
  assert(
    proof[0]?.conversations === 1 && proof[0].messages === 2 &&
      proof[0].audits === 1,
    `identical-message retry duplicated effects: ${JSON.stringify(proof[0])}`,
  );
});

Deno.test({
  name: "INTERACTION-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await configured.close();
    await directConnection.destroy();
  },
});
