/**
 * MCP-D1: editing and deleting notes, activities, calls, and conversations
 * through the deployment's real composition.
 *
 * A browser session (with its Origin) and a personal token with
 * `interactions:write` may change and remove each kind at the revision they
 * last read; neither `interactions:read` nor `interactions:create` admits
 * either route. Every rule the create enforces holds for the edit, an
 * identifier or vocabulary entry from another workspace changes nothing, and
 * every read the records feed — the activity report, communications, Today,
 * the journal, search, the person's timeline and profile, and the directory —
 * still answers after an edit and after a delete. Each write leaves one audit
 * row naming the token it was made with and none of the content.
 */

import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import type { HttpMethod, SignedInFixture } from "../support/api.ts";
import { composeTokenSuite, type MintedToken } from "../support/tokens.ts";
import { holdWorkspaceWrites } from "../support/workspace_write_queue.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

// deno-lint-ignore no-explicit-any
type Json = any;

async function expect(
  response: Response,
  status: number,
  label: string,
): Promise<Json> {
  const text = await response.text();
  assert(
    response.status === status,
    `${label}: expected ${status}, received ${response.status}: ${text}`,
  );
  return text ? JSON.parse(text) : undefined;
}

async function person(
  fixture: SignedInFixture,
  givenName: string,
): Promise<string> {
  const response = await api.request(fixture, "/api/v1/people", "POST", {
    givenName,
    isPartial: false,
  });
  assert(response.status === 201, `${givenName} created`);
  return (await response.json()).person.id as string;
}

async function record(
  fixture: SignedInFixture,
  input: Record<string, unknown>,
): Promise<{ readonly id: string; readonly updatedAt: string }> {
  const body = await expect(
    await api.request(fixture, "/api/v1/interactions", "POST", {
      ...input,
      requestId: crypto.randomUUID(),
    }),
    201,
    `${input.kind} recorded`,
  );
  assert(
    typeof body.record.updatedAt === "string",
    `${input.kind} create returns its revision`,
  );
  return { id: body.record.id, updatedAt: body.record.updatedAt };
}

interface World {
  readonly activityTypeId: string;
  readonly ada: string;
  readonly adaEmail: string;
  readonly channelTypeId: string;
  readonly emotionId: string;
  readonly foreign: SignedInFixture;
  readonly foreignActivityTypeId: string;
  readonly foreignChannelTypeId: string;
  readonly foreignPerson: string;
  readonly grace: string;
  readonly graceEmail: string;
  readonly lin: string;
  readonly otherChannelTypeId: string;
  readonly own: SignedInFixture;
  readonly suffix: string;
}

async function world(label: string): Promise<World> {
  const suffix = crypto.randomUUID();
  const own = await register(`${label}-${suffix}@example.test`, "Editing");
  const foreign = await register(
    `${label}-foreign-${suffix}@example.test`,
    "Foreign editing",
  );
  const ada = await person(own, "Ada");
  const grace = await person(own, "Grace");
  const lin = await person(own, "Lin");
  const foreignPerson = await person(foreign, "Foreign person");
  const ids = {
    activityTypeId: crypto.randomUUID(),
    adaEmail: crypto.randomUUID(),
    channelTypeId: crypto.randomUUID(),
    emotionId: crypto.randomUUID(),
    foreignActivityTypeId: crypto.randomUUID(),
    foreignChannelTypeId: crypto.randomUUID(),
    graceEmail: crypto.randomUUID(),
    otherChannelTypeId: crypto.randomUUID(),
  };
  await sql`insert into crm.emotion_options (id, name)
    values (${ids.emotionId}::uuid, ${`Content ${suffix}`})`;
  await sql`insert into crm.activity_types (id, workspace_id, name) values
    (${ids.activityTypeId}::uuid, ${own.workspaceId}::uuid, 'Shared meal'),
    (${ids.foreignActivityTypeId}::uuid, ${foreign.workspaceId}::uuid, 'Foreign meal')`;
  await sql`insert into crm.contact_method_types (id, workspace_id, name) values
    (${ids.channelTypeId}::uuid, ${own.workspaceId}::uuid, 'Edit email'),
    (${ids.otherChannelTypeId}::uuid, ${own.workspaceId}::uuid, 'Edit phone'),
    (${ids.foreignChannelTypeId}::uuid, ${foreign.workspaceId}::uuid, 'Foreign email')`;
  await sql`insert into crm.person_contact_methods (id, person_id, type_id, value, workspace_id) values
    (${ids.adaEmail}::uuid, ${ada}::uuid, ${ids.channelTypeId}::uuid, 'ada@example.test', ${own.workspaceId}::uuid),
    (${ids.graceEmail}::uuid, ${grace}::uuid, ${ids.channelTypeId}::uuid, 'grace@example.test', ${own.workspaceId}::uuid)`;
  return { ...ids, ada, foreign, foreignPerson, grace, lin, own, suffix };
}

async function recordAll(w: World) {
  const note = await record(w.own, {
    body: `Edit note ${w.suffix}`,
    kind: "note",
    personId: w.ada,
  });
  const activity = await record(w.own, {
    happenedAt: "2026-10-01T18:00:00.000Z",
    kind: "activity",
    participantIds: [w.ada, w.grace],
    summary: `Edit dinner ${w.suffix}`,
  });
  const call = await record(w.own, {
    calledAt: "2026-10-01T19:00:00.000Z",
    contactWasCaller: false,
    content: `Edit call ${w.suffix}`,
    kind: "call",
    personId: w.ada,
  });
  const conversation = await record(w.own, {
    channelTypeId: w.channelTypeId,
    contactMethodId: w.adaEmail,
    happenedAt: "2026-10-01T20:00:00.000Z",
    kind: "conversation",
    messages: [{
      content: `Edit message ${w.suffix}`,
      direction: "inbound",
      writtenAt: "2026-10-01T20:00:00.000Z",
    }],
    personId: w.ada,
    title: `Edit conversation ${w.suffix}`,
  });
  return { activity, call, conversation, note };
}

/** Every read the four kinds feed, answering 200, as their text. */
async function dependentReads(w: World, personIds: readonly string[]) {
  const texts: string[] = [];
  const paths = [
    "/api/v1/today/favorite-notes",
    "/api/v1/today/recent-activity",
    "/api/v1/journal",
    `/api/v1/search?q=${encodeURIComponent(w.suffix)}`,
    "/api/v1/people",
    ...personIds.flatMap((id) => [
      `/api/v1/people/${id}/activity-report`,
      `/api/v1/people/${id}/communications`,
      `/api/v1/people/${id}/timeline`,
      `/api/v1/people/${id}`,
    ]),
  ];
  for (const path of paths) {
    const response = await api.request(w.own, path);
    const text = await response.text();
    assert(response.status === 200, `${path}: ${response.status} ${text}`);
    texts.push(text);
  }
  return texts.join("\n");
}

async function audits(workspaceId: string, subjectId: string) {
  return await sql<{
    readonly payload: Record<string, unknown>;
    readonly text: string;
  }[]>`
    select payload, payload::text as text from crm.audit_events
    where workspace_id = ${workspaceId}::uuid
      and action = 'interactions.interaction-changed'
      and subject_id = ${subjectId}::uuid
    order by occurred_at, id
  `;
}

const KINDS = ["note", "activity", "call", "conversation"] as const;

function bearer(
  token: MintedToken,
  path: string,
  method: HttpMethod,
  body: unknown,
) {
  return tokens.bearer(token.secret, path, { body, method });
}

Deno.test("[MCP-D1] PostgreSQL edits each kind by cookie and token at its revision, under every create rule", async () => {
  const w = await world("edit");
  const records = await recordAll(w);
  const writer = await tokens.mint(w.own, ["interactions:write"]);
  const reader = await tokens.mint(w.own, ["interactions:read"]);
  const capture = await tokens.mint(w.own, ["interactions:create"]);
  const foreignWriter = await tokens.mint(w.foreign, ["interactions:write"]);
  const cadence = await expect(
    await api.request(w.own, "/api/v1/stay-in-touch-cadences", "POST", {
      intervalCount: 1,
      intervalUnit: "week",
      personId: w.lin,
      requestId: crypto.randomUUID(),
    }),
    201,
    "cadence for Lin",
  );
  assert(cadence.cadence?.id, "cadence created");
  await expect(
    await api.request(w.own, "/api/v1/journal/activities", "POST", {
      activityId: records.activity.id,
    }),
    201,
    "activity journaled",
  );

  // The reads an agent finds records with expose each record's revision.
  const report = await expect(
    await bearer(
      reader,
      `/api/v1/people/${w.ada}/activity-report`,
      "GET",
      undefined,
    ),
    200,
    "report",
  );
  for (const entry of [records.note, records.activity]) {
    assertEquals(
      report.items.find((item: Json) => item.id === entry.id)?.updatedAt,
      entry.updatedAt,
      "the activity report names the revision",
    );
  }
  const history = await expect(
    await bearer(
      reader,
      `/api/v1/people/${w.ada}/communications`,
      "GET",
      undefined,
    ),
    200,
    "communications",
  );
  for (const entry of [records.call, records.conversation]) {
    assertEquals(
      history.items.find((item: Json) => item.id === entry.id)?.updatedAt,
      entry.updatedAt,
      "communications name the revision",
    );
  }

  // Neither a read nor a capture grant admits an edit or a delete.
  for (const kind of KINDS) {
    const path = `/api/v1/interactions/${kind}/${records[kind].id}`;
    for (const token of [reader, capture]) {
      await expect(
        await bearer(token, path, "PATCH", {
          expectedUpdatedAt: records[kind].updatedAt,
          ...(kind === "note"
            ? { body: "Denied" }
            : { contactWasCaller: true }),
        }),
        401,
        `${token.record.scopes.join()} edit ${kind}`,
      );
      await expect(
        await bearer(token, path, "DELETE", {
          expectedUpdatedAt: records[kind].updatedAt,
        }),
        401,
        `${token.record.scopes.join()} delete ${kind}`,
      );
    }
    // Another workspace's writer finds nothing and changes nothing.
    const foreign = await bearer(foreignWriter, path, "PATCH", {
      expectedUpdatedAt: records[kind].updatedAt,
      ...(kind === "note"
        ? { body: "Foreign" }
        : kind === "activity"
        ? { summary: "Foreign" }
        : kind === "call"
        ? { content: "Foreign" }
        : { title: "Foreign" }),
    });
    await expect(foreign, 404, `foreign writer edits ${kind}`);
    await expect(
      await bearer(foreignWriter, path, "DELETE", {
        expectedUpdatedAt: records[kind].updatedAt,
      }),
      404,
      `foreign writer deletes ${kind}`,
    );
  }

  // A note: body and favourite by token, favourite off by cookie.
  const notePath = `/api/v1/interactions/note/${records.note.id}`;
  const favorited = await expect(
    await bearer(writer, notePath, "PATCH", {
      body: `Edited note ${w.suffix}`,
      expectedUpdatedAt: records.note.updatedAt,
      isFavorited: true,
    }),
    200,
    "note edited by token",
  );
  assert(
    favorited.record.body === `Edited note ${w.suffix}` &&
      favorited.record.isFavorited === true &&
      favorited.record.updatedAt > records.note.updatedAt,
    `note edit answered the new revision: ${JSON.stringify(favorited)}`,
  );
  const stale = await expect(
    await bearer(writer, notePath, "PATCH", {
      body: "Stale",
      expectedUpdatedAt: records.note.updatedAt,
    }),
    409,
    "a stale note revision",
  );
  assertEquals(stale.code, "interaction_stale");
  const favorites = await dependentReads(w, [w.ada]);
  assert(
    favorites.includes(`Edited note ${w.suffix}`) &&
      !favorites.includes(`Edit note ${w.suffix}`),
    "every read shows the edited note",
  );
  assertEquals(
    (await expect(
      await api.request(w.own, "/api/v1/today/favorite-notes"),
      200,
      "favorites",
    )).items.find((item: Json) => item.id === records.note.id)?.updatedAt,
    favorited.record.updatedAt,
    "the favourite reaches Today with the revision an edit names",
  );
  const unfavorited = await expect(
    await api.request(w.own, notePath, "PATCH", {
      expectedUpdatedAt: favorited.record.updatedAt,
      isFavorited: false,
    }),
    200,
    "note unfavourited by cookie",
  );
  assert(
    !(await expect(
      await api.request(w.own, "/api/v1/today/favorite-notes"),
      200,
      "favorites",
    )).items.some((item: Json) => item.id === records.note.id),
    "the note left Today's favourites",
  );
  const [favoritedAt] = await sql<{ readonly favorited_at: Date | null }[]>`
    select favorited_at from crm.notes where id = ${records.note.id}::uuid`;
  assert(favoritedAt?.favorited_at === null, "favorited_at cleared");

  // An activity: every create rule, then a move to other people and later.
  const activityPath = `/api/v1/interactions/activity/${records.activity.id}`;
  for (
    const [label, change] of [
      ["foreign participant", { participantIds: [w.foreignPerson] }],
      ["foreign activity type", { activityTypeId: w.foreignActivityTypeId }],
      ["unknown emotion", { emotionIds: [crypto.randomUUID()] }],
    ] as const
  ) {
    const refused = await expect(
      await bearer(writer, activityPath, "PATCH", {
        expectedUpdatedAt: records.activity.updatedAt,
        ...change,
      }),
      404,
      label,
    );
    assertEquals(refused.code, "interaction_not_found", label);
  }
  await sql`update crm.people set archived_at = now() where id = ${w.grace}::uuid`;
  await expect(
    await bearer(writer, activityPath, "PATCH", {
      expectedUpdatedAt: records.activity.updatedAt,
      summary: "Archived",
    }),
    409,
    "an archived participant makes the activity read-only",
  );
  await expect(
    await bearer(writer, activityPath, "DELETE", {
      expectedUpdatedAt: records.activity.updatedAt,
    }),
    409,
    "and undeletable",
  );
  await sql`update crm.people set archived_at = null where id = ${w.grace}::uuid`;
  // Planning only hears of contact later than what it holds, and a new
  // cadence holds its own creation, so the activity moves past now.
  const later = new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000);
  const moved = await expect(
    await bearer(writer, activityPath, "PATCH", {
      activityTypeId: w.activityTypeId,
      description: "Long talk",
      emotionIds: [w.emotionId],
      expectedUpdatedAt: records.activity.updatedAt,
      happenedAt: later.toISOString(),
      participantIds: [w.grace, w.lin],
      summary: `Edited lunch ${w.suffix}`,
    }),
    200,
    "activity edited by token",
  );
  assert(
    moved.record.activityType === "Shared meal" &&
      moved.record.description === "Long talk" &&
      moved.record.emotions.length === 1 &&
      moved.record.participants.map((entry: Json) => entry.id).sort().join() ===
        [w.grace, w.lin].sort().join(),
    `activity edit answered the stored record: ${JSON.stringify(moved)}`,
  );
  const [contacted] = await sql<{ readonly last: string | null }[]>`
    select to_char(last_contacted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as last
    from crm.stay_in_touch_cadences where person_id = ${w.lin}::uuid`;
  assertEquals(
    contacted?.last,
    later.toISOString().slice(0, 19),
    "adding Lin to a later activity advanced Lin's cadence",
  );
  const afterActivity = await dependentReads(w, [w.ada, w.grace, w.lin]);
  assert(
    afterActivity.includes(`Edited lunch ${w.suffix}`) &&
      !afterActivity.includes(`Edit dinner ${w.suffix}`),
    "every read shows the edited activity",
  );
  const adaReport = await expect(
    await api.request(w.own, `/api/v1/people/${w.ada}/activity-report`),
    200,
    "Ada's report",
  );
  assert(
    !adaReport.items.some((item: Json) => item.id === records.activity.id),
    "Ada left the activity, so her report no longer lists it",
  );
  const cleared = await expect(
    await api.request(w.own, activityPath, "PATCH", {
      activityTypeId: null,
      description: null,
      emotionIds: [],
      expectedUpdatedAt: moved.record.updatedAt,
    }),
    200,
    "activity cleared by cookie",
  );
  assert(
    cleared.record.activityType === undefined &&
      cleared.record.description === undefined &&
      cleared.record.emotions.length === 0,
    "explicit null and an empty list clear the activity's optional fields",
  );

  // A call, by cookie.
  const callPath = `/api/v1/interactions/call/${records.call.id}`;
  const call = await expect(
    await api.request(w.own, callPath, "PATCH", {
      calledAt: "2026-10-02T09:00:00.000Z",
      contactWasCaller: true,
      content: null,
      emotionIds: [w.emotionId],
      expectedUpdatedAt: records.call.updatedAt,
    }),
    200,
    "call edited by cookie",
  );
  assert(
    call.record.content === undefined && call.record.contactWasCaller &&
      call.record.calledAt === "2026-10-02T09:00:00.000Z" &&
      call.record.emotions.length === 1,
    `call edit answered the stored record: ${JSON.stringify(call)}`,
  );

  // A conversation: its contact method stays on its person and channel.
  const conversationPath =
    `/api/v1/interactions/conversation/${records.conversation.id}`;
  for (
    const [label, change] of [
      ["channel without its contact method", {
        channelTypeId: w.otherChannelTypeId,
      }],
      ["another person's contact method", { contactMethodId: w.graceEmail }],
      ["foreign channel", {
        channelTypeId: w.foreignChannelTypeId,
        contactMethodId: null,
      }],
    ] as const
  ) {
    await expect(
      await bearer(writer, conversationPath, "PATCH", {
        expectedUpdatedAt: records.conversation.updatedAt,
        ...change,
      }),
      404,
      label,
    );
  }
  const conversation = await expect(
    await bearer(writer, conversationPath, "PATCH", {
      channelTypeId: w.otherChannelTypeId,
      contactMethodId: null,
      expectedUpdatedAt: records.conversation.updatedAt,
      messages: [
        {
          content: `Edited reply ${w.suffix}`,
          direction: "outbound",
          writtenAt: "2026-10-01T21:00:00.000Z",
        },
        {
          content: `Edited message ${w.suffix}`,
          direction: "inbound",
          writtenAt: "2026-10-01T20:30:00.000Z",
        },
      ],
      title: null,
    }),
    200,
    "conversation edited by token",
  );
  assert(
    conversation.record.channelType?.id === w.otherChannelTypeId &&
      conversation.record.contactMethod === undefined &&
      conversation.record.title === undefined &&
      conversation.record.messages.map((entry: Json) => entry.content)
          .join() === `Edited message ${w.suffix},Edited reply ${w.suffix}`,
    `conversation edit answered the stored record: ${
      JSON.stringify(conversation)
    }`,
  );
  const afterAll = await dependentReads(w, [w.ada, w.grace, w.lin]);
  assert(
    afterAll.includes(`Edited reply ${w.suffix}`) &&
      !afterAll.includes(`Edit message ${w.suffix}`) &&
      !afterAll.includes(`Edit call ${w.suffix}`),
    "every read shows the edited call and conversation",
  );

  // One audit row per edit, naming the token and never the content.
  for (
    const [id, expected] of [
      [records.note.id, [writer.record.id, undefined]],
      [records.activity.id, [writer.record.id, undefined]],
      [records.call.id, [undefined]],
      [records.conversation.id, [writer.record.id]],
    ] as const
  ) {
    const rows = await audits(w.own.workspaceId, id);
    assertEquals(
      rows.map((row) => row.payload.apiTokenId),
      expected,
      `audit rows for ${id}`,
    );
    assert(
      rows.every((row) =>
        row.payload.action === "update" && !row.text.includes(w.suffix) &&
        !row.text.includes("Long talk")
      ),
      `audit payloads carry no content: ${rows.map((row) => row.text)}`,
    );
  }
  assertEquals(
    (await audits(w.own.workspaceId, records.activity.id))[0]?.payload.fields,
    [
      "activityTypeId",
      "description",
      "emotionIds",
      "happenedAt",
      "participantIds",
      "summary",
    ],
  );
  assertEquals(unfavorited.status, "saved");
});

Deno.test("[MCP-D1] PostgreSQL deletes each kind at its revision and every dependent read still answers", async () => {
  const w = await world("delete");
  const records = await recordAll(w);
  const writer = await tokens.mint(w.own, ["interactions:write"]);
  await expect(
    await api.request(w.own, "/api/v1/journal/activities", "POST", {
      activityId: records.activity.id,
    }),
    201,
    "activity journaled",
  );
  await expect(
    await api.request(
      w.own,
      `/api/v1/interactions/note/${records.note.id}`,
      "PATCH",
      {
        expectedUpdatedAt: records.note.updatedAt,
        isFavorited: true,
      },
    ),
    200,
    "note favourited",
  );
  const [favorite] = await sql<{ readonly updated_at: string }[]>`
    select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
    from crm.notes where id = ${records.note.id}::uuid`;
  const revisions: Record<(typeof KINDS)[number], string> = {
    activity: records.activity.updatedAt,
    call: records.call.updatedAt,
    conversation: records.conversation.updatedAt,
    note: favorite!.updated_at,
  };
  const before = await dependentReads(w, [w.ada, w.grace]);
  assert(
    [
      `Edit note ${w.suffix}`,
      `Edit dinner ${w.suffix}`,
      `Edit call ${w.suffix}`,
      `Edit message ${w.suffix}`,
    ].every((text) => before.includes(text)),
    "every read lists the four records before the deletes",
  );

  for (const [index, kind] of KINDS.entries()) {
    const path = `/api/v1/interactions/${kind}/${records[kind].id}`;
    const viaToken = index % 2 === 0;
    const send = (body: unknown) =>
      viaToken
        ? bearer(writer, path, "DELETE", body)
        : api.request(w.own, path, "DELETE", body);
    const stale = await expect(
      await send({ expectedUpdatedAt: "2026-01-01T00:00:00.000000Z" }),
      409,
      `stale ${kind} delete`,
    );
    assertEquals(stale.code, "interaction_stale");
    assertEquals(
      await expect(
        await send({ expectedUpdatedAt: revisions[kind] }),
        200,
        `${kind} delete`,
      ),
      { id: records[kind].id, kind, status: "deleted" },
    );
    await expect(
      await send({ expectedUpdatedAt: revisions[kind] }),
      404,
      `${kind} deleted twice`,
    );
    const rows = await audits(w.own.workspaceId, records[kind].id);
    const deletion = rows.at(-1);
    assert(
      deletion?.payload.action === "delete" && deletion.payload.kind === kind &&
        deletion.payload.apiTokenId ===
          (viaToken ? writer.record.id : undefined) &&
        !deletion.text.includes(w.suffix),
      `${kind} delete audited without content: ${deletion?.text}`,
    );
  }

  const [left] = await sql<{
    readonly journal: number;
    readonly links: number;
    readonly messages: number;
  }[]>`
    select
      (select count(*)::int from crm.journal_items
        where activity_id = ${records.activity.id}::uuid) as journal,
      (select count(*)::int from crm.activity_participants
        where activity_id = ${records.activity.id}::uuid) as links,
      (select count(*)::int from crm.messages
        where conversation_id = ${records.conversation.id}::uuid) as messages`;
  assertEquals(
    left,
    { journal: 0, links: 0, messages: 0 },
    "the schema's cascades removed what belonged to the records",
  );
  const after = await dependentReads(w, [w.ada, w.grace]);
  assert(
    ![
      `Edit note ${w.suffix}`,
      `Edit dinner ${w.suffix}`,
      `Edit call ${w.suffix}`,
      `Edit message ${w.suffix}`,
    ].some((text) => after.includes(text)),
    "no read lists a deleted record",
  );
});

/** Soft-deletes a person the way the product does, with its confirmation. */
async function softDelete(fixture: SignedInFixture, personId: string) {
  const impact = await expect(
    await api.request(fixture, `/api/v1/people/${personId}/deletion-impact`),
    200,
    "deletion impact",
  );
  await expect(
    await api.request(fixture, `/api/v1/people/${personId}`, "DELETE", {
      confirmation: impact.impact.confirmation,
      expectedUpdatedAt: impact.impact.person.updatedAt,
    }),
    200,
    "person deleted",
  );
}

async function reportIds(fixture: SignedInFixture, personId: string) {
  const report = await expect(
    await api.request(fixture, `/api/v1/people/${personId}/activity-report`),
    200,
    "activity report",
  );
  return report.items.map((item: Json) => item.id) as string[];
}

Deno.test("[MCP-D1] PostgreSQL an activity whose participant was deleted is edited and deleted for the people who remain", async () => {
  const w = await world("removed");
  const writer = await tokens.mint(w.own, ["interactions:write"]);
  const kept = await record(w.own, {
    happenedAt: "2026-10-01T18:00:00.000Z",
    kind: "activity",
    participantIds: [w.ada, w.grace],
    summary: `Removed dinner ${w.suffix}`,
  });
  const dropped = await record(w.own, {
    happenedAt: "2026-10-02T18:00:00.000Z",
    kind: "activity",
    participantIds: [w.ada, w.grace],
    summary: `Removed lunch ${w.suffix}`,
  });
  await softDelete(w.own, w.grace);

  const path = `/api/v1/interactions/activity/${kept.id}`;
  const edited = await expect(
    await bearer(writer, path, "PATCH", {
      expectedUpdatedAt: kept.updatedAt,
      summary: `Removed supper ${w.suffix}`,
    }),
    200,
    "summary-only edit of an activity with a deleted participant",
  );
  assertEquals(
    edited.record.participants.map((entry: Json) => entry.id),
    [w.ada],
  );
  const report = await expect(
    await api.request(w.own, `/api/v1/people/${w.ada}/activity-report`),
    200,
    "Ada's report",
  );
  const read = report.items.find((item: Json) => item.id === kept.id);
  assert(
    read?.summary === `Removed supper ${w.suffix}` &&
      read.updatedAt === edited.record.updatedAt &&
      read.participants.map((entry: Json) => entry.id).join() === w.ada,
    `the report reads the edit back for Ada: ${JSON.stringify(read)}`,
  );
  assertEquals(
    (await expect(
      await api.request(w.own, "/api/v1/today/recent-activity"),
      200,
      "recent activity",
    )).items.find((item: Json) => item.id === kept.id)?.updatedAt,
    edited.record.updatedAt,
    "Today's recent activity names the revision an edit needs",
  );
  const [rows] = await sql<{ readonly links: number }[]>`
    select count(*)::int as links from crm.activity_participants
    where activity_id = ${kept.id}::uuid`;
  assertEquals(rows?.links, 2, "the deleted person's row is left alone");
  const [audit] = await audits(w.own.workspaceId, kept.id);
  assertEquals(audit?.payload.participantIds, [w.ada]);
  await expect(
    await bearer(writer, path, "PATCH", {
      expectedUpdatedAt: edited.record.updatedAt,
      participantIds: [w.ada, w.grace],
    }),
    404,
    "a deleted person the change names is refused",
  );

  assertEquals(
    await expect(
      await bearer(
        writer,
        `/api/v1/interactions/activity/${dropped.id}`,
        "DELETE",
        {
          expectedUpdatedAt: dropped.updatedAt,
        },
      ),
      200,
      "delete of an activity with a deleted participant",
    ),
    { id: dropped.id, kind: "activity", status: "deleted" },
  );
  assert(
    !(await reportIds(w.own, w.ada)).includes(dropped.id),
    "the deleted activity left Ada's report",
  );
  const [removal] = await audits(w.own.workspaceId, dropped.id);
  assertEquals(removal?.payload.participantIds, [w.ada]);
});

Deno.test("[MCP-D1] PostgreSQL a contact method on another channel is refused and a shared activity's delete reaches every participant", async () => {
  const w = await world("channel");
  const adaPhone = crypto.randomUUID();
  await sql`insert into crm.person_contact_methods (id, person_id, type_id, value, workspace_id) values
    (${adaPhone}::uuid, ${w.ada}::uuid, ${w.otherChannelTypeId}::uuid, '+15550100', ${w.own.workspaceId}::uuid)`;
  const records = await recordAll(w);
  await expect(
    await api.request(
      w.own,
      `/api/v1/interactions/conversation/${records.conversation.id}`,
      "PATCH",
      {
        contactMethodId: adaPhone,
        expectedUpdatedAt: records.conversation.updatedAt,
      },
    ),
    404,
    "Ada's contact method on another channel",
  );
  const create = {
    happenedAt: "2026-10-03T18:00:00.000Z",
    kind: "activity",
    participantIds: [w.ada, w.grace, w.lin],
    requestId: crypto.randomUUID(),
    summary: `Shared walk ${w.suffix}`,
  };
  const shared = (await expect(
    await api.request(w.own, "/api/v1/interactions", "POST", create),
    201,
    "shared activity recorded",
  )).record;
  for (const id of [w.ada, w.grace, w.lin]) {
    assert((await reportIds(w.own, id)).includes(shared.id), "listed before");
  }
  await expect(
    await api.request(
      w.own,
      `/api/v1/interactions/activity/${shared.id}`,
      "DELETE",
      { expectedUpdatedAt: shared.updatedAt },
    ),
    200,
    "shared activity deleted",
  );
  for (const id of [w.ada, w.grace, w.lin]) {
    assert(
      !(await reportIds(w.own, id)).includes(shared.id),
      `the shared activity left ${id}'s report`,
    );
  }
  const replayed = await expect(
    await api.request(w.own, "/api/v1/interactions", "POST", create),
    409,
    "re-sending the original create after the delete",
  );
  assertEquals(
    replayed.code,
    "interaction_request_deleted",
    "the delete's tombstone refuses the same requestId (MCP-E3)",
  );
  const [kept] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.activities
    where id = ${shared.id}::uuid`;
  assertEquals(kept?.count, 0, "the activity is not recorded again");
});

/** The table each kind lives in, for the row counts below. */
const TABLES = {
  activity: "crm.activities",
  call: "crm.calls",
  conversation: "crm.conversation_threads",
  note: "crm.notes",
} as const;

async function rows(kind: keyof typeof TABLES, id: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from ${sql(TABLES[kind])}
    where id = ${id}::uuid`;
  return row?.count ?? -1;
}

/** One create of each kind, with its own fixed requestId. */
function keyedCreates(w: World) {
  return {
    activity: {
      happenedAt: "2026-10-02T18:00:00.000Z",
      kind: "activity",
      participantIds: [w.ada],
      requestId: crypto.randomUUID(),
      summary: `Keyed walk ${w.suffix}`,
    },
    call: {
      calledAt: "2026-10-02T19:00:00.000Z",
      contactWasCaller: true,
      kind: "call",
      personId: w.ada,
      requestId: crypto.randomUUID(),
    },
    conversation: {
      channelTypeId: w.channelTypeId,
      happenedAt: "2026-10-02T20:00:00.000Z",
      kind: "conversation",
      messages: [{
        content: `Keyed message ${w.suffix}`,
        direction: "outbound",
        writtenAt: "2026-10-02T20:00:00.000Z",
      }],
      personId: w.ada,
      requestId: crypto.randomUUID(),
    },
    note: {
      body: `Keyed note ${w.suffix}`,
      kind: "note",
      personId: w.ada,
      requestId: crypto.randomUUID(),
    },
  } as const;
}

Deno.test("[MCP-E3] PostgreSQL every interaction kind's create replayed after its delete is refused by the tombstone", async () => {
  const w = await world("tombstone");
  const writer = await tokens.mint(w.own, ["interactions:create"]);
  for (const [kind, create] of Object.entries(keyedCreates(w))) {
    const typed = kind as keyof typeof TABLES;
    const created = (await expect(
      await tokens.bearer(writer.secret, "/api/v1/interactions", {
        body: create,
        method: "POST",
      }),
      201,
      `${kind} recorded`,
    )).record;
    const replay = await expect(
      await api.request(w.own, "/api/v1/interactions", "POST", create),
      201,
      `${kind} replayed before its delete`,
    );
    assertEquals(replay.record.id, created.id, `${kind} replay returns it`);
    await expect(
      await api.request(
        w.own,
        `/api/v1/interactions/${kind}/${created.id}`,
        "DELETE",
        { expectedUpdatedAt: created.updatedAt },
      ),
      200,
      `${kind} deleted`,
    );
    const [tombstone] = await sql<{ record_type: string }[]>`
      select record_type from crm.request_tombstones
      where workspace_id = ${w.own.workspaceId}::uuid
        and record_id = ${created.id}::uuid`;
    assertEquals(tombstone?.record_type, kind, `${kind} left its tombstone`);
    for (
      const response of [
        await api.request(w.own, "/api/v1/interactions", "POST", create),
        await tokens.bearer(writer.secret, "/api/v1/interactions", {
          body: create,
          method: "POST",
        }),
      ]
    ) {
      const refused = await expect(response, 409, `${kind} replay refused`);
      assertEquals(refused.code, "interaction_request_deleted", kind);
    }
    assertEquals(
      await rows(typed, created.id),
      0,
      `${kind} not recorded again`,
    );
  }
  // The tombstones are the workspace's: another workspace's key names its own
  // record, and its replay is untouched.
  const foreignNote = {
    body: "Foreign keyed note",
    kind: "note",
    personId: w.foreignPerson,
    requestId: keyedCreates(w).note.requestId,
  };
  await expect(
    await api.request(w.foreign, "/api/v1/interactions", "POST", foreignNote),
    201,
    "another workspace records under its own derived id",
  );
});

/**
 * A note's delete and its create's replay, queued on the workspace row in both
 * orders (MCP-E3): the replay that runs first returns the note, which the
 * delete then removes; the replay that runs second is refused. Neither order
 * records the note again.
 */
Deno.test("[MCP-E3] PostgreSQL an interaction delete racing its create's replay never records it again", async () => {
  const w = await world("tombstone-race");
  for (const first of ["delete", "replay"] as const) {
    const create = { ...keyedCreates(w).note, body: `Raced note ${first}` };
    const created = (await expect(
      await api.request(w.own, "/api/v1/interactions", "POST", create),
      201,
      "note recorded",
    )).record;
    const remove = () =>
      api.request(w.own, `/api/v1/interactions/note/${created.id}`, "DELETE", {
        expectedUpdatedAt: created.updatedAt,
      });
    const replay = () =>
      api.request(w.own, "/api/v1/interactions", "POST", create);
    const queue = await holdWorkspaceWrites(sql, w.own.workspaceId);
    let deleted: Promise<Response>;
    let replayed: Promise<Response>;
    try {
      if (first === "delete") {
        deleted = remove();
        await queue.queued(1);
        replayed = replay();
        await queue.queued(2);
      } else {
        replayed = replay();
        await queue.queued(1);
        deleted = remove();
        await queue.queued(2);
      }
    } finally {
      await queue.release();
    }
    await expect(await deleted!, 200, `${first} first: the delete`);
    const answer = await replayed!;
    if (first === "delete") {
      const refused = await expect(answer, 409, "the later replay");
      assertEquals(refused.code, "interaction_request_deleted");
    } else {
      const returned = await expect(answer, 201, "the earlier replay");
      assertEquals(returned.record.id, created.id, "it returned the note");
    }
    assertEquals(await rows("note", created.id), 0, `${first} first: gone`);
  }
});

Deno.test({
  name: "close MCP-D1 PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => suite.close(),
});
