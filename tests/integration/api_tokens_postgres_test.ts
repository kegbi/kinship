import type postgres from "postgres";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createApiTokenManagement,
} from "../../packages/backend/modules/api-access/public.ts";
import { apiTokenAuditFrom } from "../../packages/backend/modules/api-access/public.ts";
import {
  PostgresApiTokenRepository,
  PostgresApiTokenTransaction,
} from "../../packages/backend/modules/api-access/adapters/postgres/api_token_repository.ts";
import {
  WebCryptoApiTokenSecrets,
} from "../../packages/backend/modules/api-access/adapters/crypto/api_token_secrets.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  PostgresInvitationIdentity,
} from "../../packages/backend/modules/identity/adapters/postgres/invitation_identity.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  addMembership,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import {
  type HttpMethod,
  PASSWORD,
  type SignedInFixture,
} from "../support/api.ts";
import { composeTokenSuite } from "../support/tokens.ts";
import type { Task } from "../../packages/contracts/generated/auth-client.ts";

const suite = composeTokenSuite();
const { api, databaseUrl, register, sql, tokens: personalTokens } = suite;
const configured = { app: suite.app, close: suite.close };

function management(
  fixture: SignedInFixture,
  path = "/api/v1/settings/api-tokens",
  method: "DELETE" | "GET" | "POST" = "GET",
  body?: unknown,
) {
  return api.request(fixture, path, method, body);
}

Deno.test("interaction capture token preserves four kinds, retries, bounded vocabulary and authority boundaries", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`capture-${suffix}@example.test`, "Capture API");
  const foreign = await register(
    `capture-foreign-${suffix}@example.test`,
    "Foreign capture",
  );
  const person = async (fixture: SignedInFixture, givenName: string) => {
    const response = await api.request(fixture, "/api/v1/people", "POST", {
      givenName,
      isPartial: false,
    });
    assert(response.status === 201, "person created through application");
    return (await response.json()).person.id as string;
  };
  const personId = await person(own, "Ada");
  const otherPersonId = await person(own, "Grace");
  const foreignPersonId = await person(foreign, "Foreign person");
  const mint = (fixture: SignedInFixture, scopes: string[]) =>
    personalTokens.mint(fixture, scopes, { name: "Capture connector" });
  const capture = await mint(own, ["interactions:create"]);
  const foreignCapture = await mint(foreign, ["interactions:create"]);
  assert(
    capture.record.scopes.join() === "interactions:create",
    "no implicit grants issued",
  );
  const send = (
    secret: string,
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    personalTokens.bearer(secret, path, {
      body,
      headers: extra,
      method: method as HttpMethod,
    });
  const expect = async (response: Response, status: number, label: string) => {
    assert(
      response.status === status,
      `${label}: expected ${status}, received ${response.status}: ${
        response.status === status ? "" : await response.text()
      }`,
    );
    return await response.json();
  };
  const activityTypeId = crypto.randomUUID();
  const foreignTypeId = crypto.randomUUID();
  const channelTypeId = crypto.randomUUID();
  const secondChannelId = crypto.randomUUID();
  const foreignChannelId = crypto.randomUUID();
  const contactMethodId = crypto.randomUUID();
  const otherContactId = crypto.randomUUID();
  const foreignContactId = crypto.randomUUID();
  const emotionId = crypto.randomUUID();
  const inactiveEmotionId = crypto.randomUUID();
  const inactiveTypeId = crypto.randomUUID();
  const inactiveChannelId = crypto.randomUUID();
  const search = `Capture ${suffix}`;
  await sql`insert into crm.activity_types (id, workspace_id, name) values
    (${activityTypeId}, ${own.workspaceId}, ${search + " A"}),
    (${foreignTypeId}, ${foreign.workspaceId}, 'Foreign secret activity')`;
  await sql`insert into crm.activity_types (workspace_id, name) values (${own.workspaceId}, ${
    search + " B"
  })`;
  await sql`insert into crm.activity_types (id, workspace_id, name, is_archived) values (${inactiveTypeId}, ${own.workspaceId}, ${
    search + " retired"
  }, true)`;
  await sql`insert into crm.contact_method_types (id, workspace_id, name) values
    (${channelTypeId}, ${own.workspaceId}, 'Connector email'),
    (${secondChannelId}, ${own.workspaceId}, 'Connector chat'),
    (${foreignChannelId}, ${foreign.workspaceId}, 'Foreign secret channel')`;
  await sql`insert into crm.contact_method_types (id, workspace_id, name, is_archived) values (${inactiveChannelId}, ${own.workspaceId}, 'Retired channel', true)`;
  await sql`insert into crm.person_contact_methods (id, person_id, type_id, value, workspace_id) values
    (${contactMethodId}, ${personId}, ${channelTypeId}, 'ada@example.test', (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid)),
    (${otherContactId}, ${otherPersonId}, ${channelTypeId}, 'grace@example.test', (select scope.workspace_id from crm.people scope where scope.id = ${otherPersonId}::uuid)),
    (${foreignContactId}, ${foreignPersonId}, ${foreignChannelId}, 'foreign-secret@example.test', (select scope.workspace_id from crm.people scope where scope.id = ${foreignPersonId}::uuid))`;
  await sql`insert into crm.emotion_options (id, name) values (${emotionId}, ${
    search + " joy"
  })`;
  await sql`insert into crm.emotion_options (name) values (${
    search + " calm"
  })`;
  await sql`insert into crm.emotion_options (id, name, is_active) values (${inactiveEmotionId}, ${
    search + " retired"
  }, false)`;
  const inputs = [
    {
      kind: "note",
      personId,
      body: "API reference note",
      isFavorited: true,
      requestId: crypto.randomUUID(),
    },
    {
      kind: "activity",
      participantIds: [personId, otherPersonId],
      summary: "API dinner",
      description: "Together",
      activityTypeId,
      emotionIds: [emotionId],
      happenedAt: "2026-10-24T18:00:00.000Z",
      requestId: crypto.randomUUID(),
    },
    {
      kind: "call",
      personId,
      content: "API call",
      contactWasCaller: false,
      calledAt: "2026-10-24T19:00:00.000Z",
      emotionIds: [emotionId],
      requestId: crypto.randomUUID(),
    },
    {
      kind: "conversation",
      personId,
      channelTypeId,
      contactMethodId,
      happenedAt: "2026-10-24T20:00:00.000Z",
      title: "API conversation",
      messages: [{
        content: "Hello",
        direction: "outbound",
        writtenAt: "2026-10-24T20:00:00.000Z",
      }],
      requestId: crypto.randomUUID(),
    },
  ];
  const recordIds: string[] = [];
  for (const input of inputs) {
    const created = await expect(
      await send(capture.secret, "/api/v1/interactions", "POST", input),
      201,
      `${input.kind}: token only, no Cookie or Origin`,
    );
    assert(
      created.record.kind === input.kind,
      "owning facade returns requested kind",
    );
    recordIds.push(created.record.id);
    if (input.kind === "activity") {
      assert(
        created.record.participants.length === 2 &&
          created.record.emotions[0].id === emotionId,
        "participants and vocabulary retained",
      );
    }
    if (input.kind === "conversation") {
      assert(
        created.record.contactMethod.id === contactMethodId &&
          created.record.messages[0].content === "Hello",
        "contact method and messages retained",
      );
    }
    const replay = await expect(
      await send(capture.secret, "/api/v1/interactions", "POST", input),
      201,
      "same body requestId replays",
    );
    assert(
      replay.record.id === created.record.id,
      "retry returns original record",
    );
    const field = input.kind === "note"
      ? "body"
      : input.kind === "activity"
      ? "summary"
      : input.kind === "call"
      ? "content"
      : "title";
    const conflict = await expect(
      await send(capture.secret, "/api/v1/interactions", "POST", {
        ...input,
        [field]: "Changed payload",
      }),
      409,
      "changed payload conflicts",
    );
    assert(
      conflict.code === "interaction_request_conflict",
      "original conflict code retained",
    );
  }
  const [audits] = await sql<
    { count: number; actors: number }[]
  >`select count(*)::int as count,
    count(*) filter (where actor_member_id = ${own.memberId}::uuid)::int as actors
    from crm.audit_events where workspace_id = ${own.workspaceId}::uuid
      and subject_id = any(${recordIds}::uuid[])`;
  assert(
    audits?.count === 4 && audits.actors === 4,
    "exactly one owning audit per create, attributed to token member",
  );

  const query = `activityTypeSearch=${
    encodeURIComponent(search)
  }&emotionSearch=${encodeURIComponent(search)}&limit=1`;
  const first = await expect(
    await send(capture.secret, `/api/v1/interaction-options?${query}`),
    200,
    "filtered capture vocabulary",
  );
  assert(
    first.activityTypes.length === 1 && first.emotions.length === 1 &&
      first.activityTypesNextCursor && first.emotionsNextCursor,
    "both option lists have bounded continuation",
  );
  const cursors = `activityTypeCursor=${
    encodeURIComponent(first.activityTypesNextCursor)
  }&emotionCursor=${encodeURIComponent(first.emotionsNextCursor)}`;
  const second = await expect(
    await send(
      capture.secret,
      `/api/v1/interaction-options?${query}&${cursors}`,
    ),
    200,
    "option continuation",
  );
  assert(
    second.activityTypes.length === 1 && second.emotions.length === 1 &&
      !second.activityTypesNextCursor && !second.emotionsNextCursor &&
      first.activityTypes[0].id !== second.activityTypes[0].id &&
      first.emotions[0].id !== second.emotions[0].id,
    "continuation returns exactly the remaining active matches",
  );
  assert(
    Object.keys(first).sort().join() ===
      "activityTypes,activityTypesNextCursor,availability,emotions,emotionsNextCursor,status",
    "options contain no historic content or people",
  );
  for (
    const changedQuery of [
      query.replace("activityTypeSearch=", "activityTypeSearch=changed"),
      query.replace("emotionSearch=", "emotionSearch=changed"),
    ]
  ) {
    await expect(
      await send(
        capture.secret,
        `/api/v1/interaction-options?${changedQuery}&${cursors}`,
      ),
      409,
      "option cursor bound to search",
    );
  }
  await expect(
    await send(
      foreignCapture.secret,
      `/api/v1/interaction-options?${query}&${cursors}`,
    ),
    409,
    "option cursors bound to workspace",
  );
  for (
    const query of [
      "limit=21",
      "emotionCursor=tampered",
      "activityTypeCursor=tampered",
    ]
  ) {
    await expect(
      await send(capture.secret, `/api/v1/interaction-options?${query}`),
      query === "limit=21" ? 400 : 409,
      "bounded and opaque queries",
    );
  }
  const communication = await expect(
    await send(capture.secret, "/api/v1/communication-options"),
    200,
    "current communication vocabulary",
  );
  assert(
    communication.channelTypes.some((option: { id: string }) =>
      option.id === channelTypeId
    ) && !communication.channelTypes.some((option: { id: string }) =>
      [foreignChannelId, inactiveChannelId].some((id) =>
        id === option.id
      )
    ),
    "channels are active and workspace-scoped",
  );
  assert(
    !communication.emotions.some((option: { id: string }) =>
      option.id === inactiveEmotionId
    ),
    "inactive emotions omitted",
  );
  assert(
    Object.keys(communication).sort().join() ===
      "availability,channelTypes,emotions,status",
    "communication options contain only existing vocabulary and availability",
  );

  const routes = [["POST", "/api/v1/interactions", inputs[0]], [
    "GET",
    "/api/v1/interaction-options",
    undefined,
  ], ["GET", "/api/v1/communication-options", undefined]] as const;
  const expired = await mint(own, ["interactions:create"]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second' where id = ${expired.record.id}::uuid`;
  const revoked = await mint(own, ["interactions:create"]);
  assert(
    (await management(
      own,
      `/api/v1/settings/api-tokens/${revoked.record.id}`,
      "DELETE",
    )).status === 200,
    "revoked through owning use case",
  );
  const oldTokens = [];
  for (
    const scope of [
      "people:read",
      "people:profile:read",
      "relationships:read",
      "tasks:read",
      "tasks:create",
      "tasks:write",
    ]
  ) oldTokens.push(await mint(own, [scope]));
  for (const [method, path, body] of routes) {
    for (const token of [expired, revoked, ...oldTokens]) {
      await expect(
        await send(token.secret, path, method, body, {
          cookie: own.cookie,
          origin: "http://localhost",
        }),
        401,
        "old grant or unusable token never borrows cookie",
      );
    }
    for (const authorization of ["", "Basic invalid", "Bearer malformed"]) {
      await expect(
        await send("unused", path, method, body, {
          authorization,
          cookie: own.cookie,
          origin: "http://localhost",
        }),
        401,
        "malformed Authorization never borrows cookie",
      );
    }
    await expect(
      await send(capture.secret, path, method, body, {
        "X-Workspace-Id": foreign.workspaceId,
        cookie: own.cookie,
      }),
      401,
      "foreign requested workspace refused",
    );
  }
  for (const origin of [undefined, "http://foreign.test"]) {
    await expect(
      await configured.app.request("http://localhost/api/v1/interactions", {
        method: "POST",
        body: JSON.stringify(inputs[0]),
        headers: {
          cookie: own.cookie,
          "content-type": "application/json",
          ...(origin ? { origin } : {}),
        },
      }),
      403,
      "cookie writes retain exact Origin",
    );
  }
  assert(
    (await api.request(own, "/api/v1/interactions", "POST", inputs[0]))
      .status === 201,
    "same-origin cookie replay still works",
  );

  for (
    const path of [
      "/api/v1/people",
      `/api/v1/people/${personId}/identity`,
      `/api/v1/people/${personId}`,
      `/api/v1/people/${personId}/relationships`,
      `/api/v1/people/${personId}/activity-report`,
      `/api/v1/people/${personId}/communications`,
      `/api/v1/people/${personId}/timeline`,
      "/api/v1/today/favorite-notes",
      "/api/v1/today/recent-activity",
      "/api/v1/today/attention",
      "/api/v1/journal",
      "/api/v1/tasks",
      "/api/v1/settings/api-tokens",
    ]
  ) {
    await expect(
      await send(capture.secret, path),
      401,
      "capture cannot read historic content or other domains",
    );
  }
  for (
    const [path, body] of [
      ["/api/v1/tasks", { title: "Denied", requestId: crypto.randomUUID() }],
      ["/api/v1/people", { givenName: "Denied", isPartial: false }],
      ["/api/v1/reminders", {}],
      ["/api/v1/journal/posts", {}],
    ] as const
  ) {
    const denied = await send(capture.secret, path, "POST", body);
    assert(
      denied.status === 401 || denied.status === 403,
      "unrelated writes denied",
    );
    await denied.body?.cancel();
  }
  for (
    const [index, changes] of [
      [0, { personId: foreignPersonId }],
      [1, { participantIds: [personId, foreignPersonId] }],
      [1, { activityTypeId: foreignTypeId }],
      [1, { activityTypeId: inactiveTypeId }],
      [1, { emotionIds: [inactiveEmotionId] }],
      [2, { personId: foreignPersonId }],
      [2, { emotionIds: [inactiveEmotionId] }],
      [3, { personId: foreignPersonId }],
      [3, { channelTypeId: foreignChannelId }],
      [3, { channelTypeId: inactiveChannelId }],
      [3, { contactMethodId: foreignContactId }],
      [3, { contactMethodId: otherContactId }],
      [3, { channelTypeId: secondChannelId }],
    ] as const
  ) {
    await expect(
      await send(capture.secret, "/api/v1/interactions", "POST", {
        ...inputs[index],
        ...changes,
        requestId: crypto.randomUUID(),
      }),
      404,
      "foreign, inactive, wrong-parent or incompatible reference refused",
    );
  }
  for (
    const body of [
      { ...inputs[0], happenedAt: "2026-10-24T18:00:00Z" },
      { ...inputs[0], body: "x".repeat(10001) },
      { ...inputs[1], happenedAt: "yesterday" },
      { ...inputs[2], contactWasCaller: "false" },
      {
        ...inputs[3],
        messages: [{
          content: "Hello",
          direction: "sideways",
          writtenAt: "2026-10-24T20:00:00Z",
        }],
      },
    ]
  ) {
    await expect(
      await send(capture.secret, "/api/v1/interactions", "POST", {
        ...body,
        requestId: crypto.randomUUID(),
      }),
      400,
      "strict JSON, date and field limits preserved",
    );
  }

  for (
    const [index, key] of [[0, "notes"], [1, "activities"], [2, "calls"], [
      3,
      "conversations",
    ]] as const
  ) {
    await sql`insert into crm.workspace_profile_modules (workspace_id, key, name, is_active) values (${own.workspaceId}, ${key}, ${key}, false) on conflict (workspace_id, key) do update set is_active = false`;
    await expect(
      await send(capture.secret, "/api/v1/interactions", "POST", {
        ...inputs[index],
        requestId: crypto.randomUUID(),
      }),
      403,
      "hidden capture section refused",
    );
  }
  const hiddenInteractions = await expect(
    await send(capture.secret, "/api/v1/interaction-options"),
    200,
    "hidden sections availability",
  );
  const hiddenCommunications = await expect(
    await send(capture.secret, "/api/v1/communication-options"),
    200,
    "hidden communication availability",
  );
  assert(
    !hiddenInteractions.availability.note &&
      !hiddenInteractions.availability.activity &&
      !hiddenCommunications.availability.call &&
      !hiddenCommunications.availability.conversation,
    "current availability retained",
  );
  await sql`update crm.workspace_profile_modules set is_active = true where workspace_id = ${own.workspaceId}::uuid`;
  const profile = await (await api.request(own, `/api/v1/people/${personId}`))
    .json();
  assert(
    (await api.request(own, `/api/v1/people/${personId}/archive`, "POST", {
      expectedUpdatedAt: profile.person.updatedAt,
    })).status === 200,
    "person archived through use case",
  );
  for (const input of inputs) {
    await expect(
      await send(capture.secret, "/api/v1/interactions", "POST", {
        ...input,
        requestId: crypto.randomUUID(),
      }),
      409,
      "archived person remains read-only",
    );
  }
  await revokeMembership(sql, own.memberId);
  for (const [method, path, body] of routes) {
    await expect(
      await send(capture.secret, path, method, body),
      401,
      "membership revalidated on every capture route",
    );
  }
});

Deno.test("task automation tokens keep independent grants, retry safety, revisions, filters and tenant boundaries", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`task-api-${suffix}@example.test`, "Task API");
  const foreign = await register(
    `task-api-foreign-${suffix}@example.test`,
    "Foreign tasks",
  );
  const person = async (fixture: SignedInFixture) => {
    const response = await api.request(fixture, "/api/v1/people", "POST", {
      givenName: "Ada",
      isPartial: false,
    });
    assert(response.status === 201, "person created through application");
    return (await response.json()).person.id as string;
  };
  const personId = await person(own);
  const foreignPersonId = await person(foreign);
  const mint = (scopes: string[]) =>
    personalTokens.mint(own, scopes, { name: "Task connector" });
  const reader = await mint(["tasks:read"]);
  const creator = await mint(["tasks:create"]);
  const writer = await mint(["tasks:write"]);
  const full = await mint(["tasks:read", "tasks:create", "tasks:write"]);
  const send = (
    secret: string,
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    personalTokens.bearer(secret, path, {
      body,
      headers: extra,
      method: method as HttpMethod,
    });
  const expect = async (response: Response, status: number, label: string) => {
    assert(
      response.status === status,
      `${label}: expected ${status}, received ${response.status}`,
    );
    return await response.json();
  };
  const input = {
    requestId: crypto.randomUUID(),
    title: "Call Ada",
    description: "Discuss plans",
    personId,
    dueAt: "2026-10-26T10:00:00.000Z",
  };
  const created = await expect(
    await send(creator.secret, "/api/v1/tasks", "POST", input),
    201,
    "create-only token without cookies or Origin",
  );
  const task = created.task as Task;
  const root = `/api/v1/tasks/${task.id}`;
  const replay = await expect(
    await send(creator.secret, "/api/v1/tasks", "POST", input),
    201,
    "retry same requestId",
  );
  assert(replay.task.id === task.id, "retry returns original task");
  const conflict = await expect(
    await send(creator.secret, "/api/v1/tasks", "POST", {
      ...input,
      title: "Different",
    }),
    409,
    "changed payload conflicts",
  );
  assert(
    conflict.code === "task_request_conflict",
    "stable idempotency conflict code",
  );
  const routes = [
    ["GET", "/api/v1/tasks", undefined, reader],
    ["GET", root, undefined, reader],
    ["POST", "/api/v1/tasks", input, creator],
    [
      "PATCH",
      root,
      { expectedUpdatedAt: task.updatedAt, title: "Call Ada" },
      writer,
    ],
    ["PUT", `${root}/completion`, { completed: false }, writer],
  ] as const;
  for (const [method, path, body, allowed] of routes) {
    for (
      const token of [reader, creator, writer].filter((token) =>
        token !== allowed
      )
    ) {
      await expect(
        await send(token.secret, path, method, body, { cookie: own.cookie }),
        401,
        "wrong grant never borrows valid cookies",
      );
    }
    for (const authorization of ["", "Basic malformed", "Bearer malformed"]) {
      await expect(
        await send("ignored", path, method, body, {
          authorization,
          cookie: own.cookie,
        }),
        401,
        "malformed Authorization exclusively selects token path",
      );
    }
    await expect(
      await send(full.secret, path, method, body, {
        "X-Workspace-Id": foreign.workspaceId,
      }),
      401,
      "foreign requested workspace refused",
    );
    if (method !== "GET") {
      for (const origin of [undefined, "http://foreign.test"]) {
        const response = await configured.app.request(
          `http://localhost${path}`,
          {
            method,
            headers: {
              cookie: own.cookie,
              "content-type": "application/json",
              ...(origin ? { origin } : {}),
            },
            body: JSON.stringify(body),
          },
        );
        await expect(
          response,
          403,
          "cookie writes retain exact-Origin CSRF protection",
        );
      }
    }
  }
  const detail = await expect(
    await send(reader.secret, root),
    200,
    "read task detail",
  );
  assert(
    detail.task.id === task.id && detail.task.person.id === personId,
    "public get hydrates linked person",
  );
  const changed = await expect(
    await send(writer.secret, root, "PATCH", {
      expectedUpdatedAt: task.updatedAt,
      title: "Edited task",
      description: null,
      dueAt: null,
      personId: null,
    }),
    200,
    "write-only token edits and clears nullable fields",
  );
  assert(
    changed.task.description === undefined &&
      changed.task.dueAt === undefined && changed.task.person === undefined,
    "explicit nulls clear fields",
  );
  await expect(
    await send(writer.secret, root, "PATCH", {
      expectedUpdatedAt: task.updatedAt,
      title: "Stale edit",
    }),
    409,
    "stale optimistic edit refused",
  );
  const complete = await expect(
    await send(writer.secret, `${root}/completion`, "PUT", { completed: true }),
    200,
    "complete",
  );
  assert(complete.task.status === "completed", "task completed");
  const again = await expect(
    await send(writer.secret, `${root}/completion`, "PUT", { completed: true }),
    200,
    "retry completion",
  );
  assert(again.status === "unchanged", "completion is idempotent");
  const reopened = await expect(
    await send(writer.secret, `${root}/completion`, "PUT", {
      completed: false,
    }),
    200,
    "reopen",
  );
  assert(reopened.task.status === "open", "task reopened");

  const foreignCreated = await api.request(foreign, "/api/v1/tasks", "POST", {
    requestId: crypto.randomUUID(),
    title: "Foreign secret task",
    personId: foreignPersonId,
  });
  assert(foreignCreated.status === 201, "foreign task created");
  const foreignTask = (await foreignCreated.json()).task as Task;
  for (
    const [method, path, body] of [
      ["GET", `/api/v1/tasks/${foreignTask.id}`, undefined],
      ["PATCH", `/api/v1/tasks/${foreignTask.id}`, {
        expectedUpdatedAt: foreignTask.updatedAt,
        title: "Denied",
      }],
      ["PUT", `/api/v1/tasks/${foreignTask.id}/completion`, {
        completed: true,
      }],
      ["POST", "/api/v1/tasks", {
        ...input,
        requestId: crypto.randomUUID(),
        personId: foreignPersonId,
      }],
      ["PATCH", root, {
        expectedUpdatedAt: reopened.task.updatedAt,
        personId: foreignPersonId,
      }],
    ] as const
  ) {
    await expect(
      await send(full.secret, path, method, body),
      404,
      "foreign task or linked person refused",
    );
  }
  const dueBefore = "2026-10-28T12:00:00.000Z";
  const dueIds: string[] = [];
  for (const dueAt of [input.dueAt, dueBefore, "2026-11-01T00:00:00.000Z"]) {
    const due = await expect(
      await send(creator.secret, "/api/v1/tasks", "POST", {
        ...input,
        requestId: crypto.randomUUID(),
        dueAt,
      }),
      201,
      "dated task created",
    );
    if (dueAt !== "2026-11-01T00:00:00.000Z") dueIds.push(due.task.id);
  }
  const query = `personId=${personId}&status=open&dueBefore=${
    encodeURIComponent(dueBefore)
  }&limit=1`;
  const first = await expect(
    await send(reader.secret, `/api/v1/tasks?${query}`),
    200,
    "filtered first page",
  );
  assert(
    first.items.length === 1 && first.nextCursor,
    "filtered page has continuation",
  );
  const second = await expect(
    await send(
      reader.secret,
      `/api/v1/tasks?${query}&cursor=${encodeURIComponent(first.nextCursor)}`,
    ),
    200,
    "filtered continuation",
  );
  assert(
    second.items.length === 1 && !second.nextCursor &&
      new Set([first.items[0].id, second.items[0].id]).size === 2 &&
      [first.items[0].id, second.items[0].id].every((id) =>
        dueIds.includes(id)
      ),
    "inclusive due filter and continuation return exactly the two matching tasks",
  );
  for (
    const changedQuery of [
      query.replace(
        encodeURIComponent(dueBefore),
        encodeURIComponent("2026-11-02T00:00:00.000Z"),
      ),
      query.replace(personId, foreignPersonId),
      query.replace("status=open", "status=completed"),
    ]
  ) {
    await expect(
      await send(
        reader.secret,
        `/api/v1/tasks?${changedQuery}&cursor=${
          encodeURIComponent(first.nextCursor)
        }`,
      ),
      409,
      "cursor is bound to each filter",
    );
  }
  await expect(
    await send(reader.secret, "/api/v1/tasks?dueBefore=tomorrow"),
    400,
    "invalid dueBefore rejected",
  );
  const list = await expect(
    await send(reader.secret, "/api/v1/tasks"),
    200,
    "workspace list",
  );
  assert(
    !JSON.stringify(list).includes("Foreign secret task"),
    "foreign tasks never listed",
  );
  const profile = await (await api.request(own, `/api/v1/people/${personId}`))
    .json();
  assert(
    (await api.request(own, `/api/v1/people/${personId}/archive`, "POST", {
      expectedUpdatedAt: profile.person.updatedAt,
    })).status === 200,
    "linked person archived through owning use case",
  );
  const archivedRoot = `/api/v1/tasks/${dueIds[0]}`;
  const archived = await expect(
    await send(reader.secret, archivedRoot),
    200,
    "archived linked person remains readable",
  );
  assert(archived.task.person.archived, "archived projection retained");
  await expect(
    await send(creator.secret, "/api/v1/tasks", "POST", {
      ...input,
      requestId: crypto.randomUUID(),
    }),
    409,
    "cannot create linked task for archived person",
  );
  await expect(
    await send(writer.secret, archivedRoot, "PATCH", {
      expectedUpdatedAt: archived.task.updatedAt,
      personId: null,
    }),
    409,
    "cannot detach archived link to bypass rule",
  );
  await expect(
    await send(writer.secret, `${archivedRoot}/completion`, "PUT", {
      completed: true,
    }),
    409,
    "cannot complete archived linked task",
  );

  const expired = await mint(["tasks:read", "tasks:create", "tasks:write"]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second' where id = ${expired.record.id}::uuid`;
  const revoked = await mint(["tasks:read", "tasks:create", "tasks:write"]);
  assert(
    (await management(
      own,
      `/api/v1/settings/api-tokens/${revoked.record.id}`,
      "DELETE",
    )).status === 200,
    "token revoked through owning API",
  );
  for (const token of [expired, revoked]) {
    for (const [method, path, body] of routes) {
      await expect(
        await send(token.secret, path, method, body, { cookie: own.cookie }),
        401,
        "expired or revoked bearer never borrows cookie",
      );
    }
  }
  for (
    const path of [
      "/api/v1/settings/api-tokens",
    ]
  ) {
    await expect(
      await send(full.secret, path),
      401,
      "unrelated routes stay session-only",
    );
  }
  // Session clients retain the original route behavior.
  assert(
    (await api.request(own, root)).status === 200,
    "cookie task detail supported",
  );
  assert(
    (await api.request(own, `${root}/completion`, "PUT", { completed: false }))
      .status === 200,
    "same-origin cookie write still works",
  );
  await revokeMembership(sql, own.memberId);
  for (const [method, path, body] of routes) {
    await expect(
      await send(full.secret, path, method, body),
      401,
      "token revalidates current membership",
    );
  }
});

Deno.test("scoped person tokens preserve projections, parent boundaries, lookups, cursors, and current membership", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(
    `profile-api-${suffix}@example.test`,
    "Profile API",
  );
  const foreign = await register(
    `profile-foreign-${suffix}@example.test`,
    "Foreign API",
  );
  const person = async (fixture: SignedInFixture, givenName: string) => {
    const response = await api.request(fixture, "/api/v1/people", "POST", {
      givenName,
      isPartial: false,
    });
    assert(response.status === 201, "person fixture created");
    return (await response.json()).person.id as string;
  };
  const sourceId = await person(own, "Ada");
  const targetId = await person(own, "Byron");
  const foreignId = await person(foreign, "Foreign secret name");
  const typeId = crypto.randomUUID();
  const foreignTypeId = crypto.randomUUID();
  const relationshipTypeId = crypto.randomUUID();
  const foreignRelationshipTypeId = crypto.randomUUID();
  await sql`insert into crm.contact_method_types (id, workspace_id, name, kind)
    values (${typeId}, ${own.workspaceId}, 'Connector email', 'email'),
      (${foreignTypeId}, ${foreign.workspaceId}, 'Foreign secret type', 'email')`;
  // Stable whole-second revisions match the owning profile-fact paging fixture.
  await sql`insert into crm.person_contact_methods (person_id, type_id, value, updated_at, workspace_id)
    select ${sourceId}::uuid, ${typeId}::uuid, 'contact-' || n || '@example.test',
      '2026-01-01T00:00:00Z'::timestamptz + n * interval '1 second',
        (select scope.workspace_id from crm.people scope where scope.id = ${sourceId}::uuid)
    from generate_series(1, 51) n`;
  await sql`insert into crm.person_contact_methods (person_id, type_id, value, workspace_id)
    values (${targetId}, ${typeId}, 'other-parent@example.test', (select scope.workspace_id from crm.people scope where scope.id = ${targetId}::uuid)),
      (${foreignId}, ${foreignTypeId}, 'foreign-secret@example.test', (select scope.workspace_id from crm.people scope where scope.id = ${foreignId}::uuid))`;
  await sql`insert into crm.person_dates (person_id, kind, precision, month, day, workspace_id)
    values (${sourceId}, 'birthday', 'month_day', 12, 10, (select scope.workspace_id from crm.people scope where scope.id = ${sourceId}::uuid)), (${foreignId}, 'birthday', 'month_day', 1, 1, (select scope.workspace_id from crm.people scope where scope.id = ${foreignId}::uuid))`;
  await sql`insert into crm.relationship_types (id, workspace_id, forward_label, reverse_label)
    values (${relationshipTypeId}, ${own.workspaceId}, 'Connector parent', 'Connector child'),
      (${foreignRelationshipTypeId}, ${foreign.workspaceId}, 'Foreign secret relation', 'Foreign secret inverse')`;
  await sql`insert into crm.relationships (workspace_id, from_person_id, to_person_id, relationship_type_id)
    values (${own.workspaceId}, ${sourceId}, ${targetId}, ${relationshipTypeId})`;
  const mint = (scopes: readonly string[]) => personalTokens.mint(own, scopes);
  const directory = await mint(["people:read"]);
  const profile = await mint(["people:profile:read"]);
  const relationships = await mint(["relationships:read"]);
  const combined = await mint(["people:profile:read", "relationships:read"]);
  assert(combined.record.scopes.length === 2, "both explicit grants persisted");
  assert(
    (await management(own, undefined, "POST", {
      name: "Duplicate",
      scopes: ["people:profile:read", "people:profile:read"],
    })).status === 400,
    "duplicates refused at HTTP boundary",
  );

  const read = (
    path: string,
    secret: string,
    extra: Record<string, string> = {},
  ) => personalTokens.bearer(secret, path, { headers: extra });
  const root = `/api/v1/people/${sourceId}`;
  const profilePaths = [
    `${root}/identity`,
    `${root}/facts/contact-methods?includeOptions=true`,
    `${root}/dates`,
  ];
  const relationshipPaths = [
    `${root}/relationships`,
    `/api/v1/relationship-types?selected=${foreignRelationshipTypeId}`,
  ];
  const paths = [...profilePaths, ...relationshipPaths];
  for (const path of paths) {
    const correct = profilePaths.includes(path) ? profile : relationships;
    const wrong = profilePaths.includes(path) ? relationships : profile;
    const accepted = await read(path, correct.secret);
    assert(accepted.status === 200, `token-only ${path}: ${accepted.status}`);
    const body = await accepted.text();
    assert(
      !body.includes("Foreign secret") && !body.includes("foreign-secret") &&
        !body.includes("other-parent@"),
      "no unrelated tenant or parent data",
    );
    for (const secret of [directory.secret, wrong.secret, "malformed"]) {
      assert(
        (await read(path, secret, { cookie: own.cookie })).status === 401,
        "wrong or invalid bearer never falls back to valid cookie",
      );
    }
    assert(
      (await read(path, combined.secret, {
        "X-Workspace-Id": foreign.workspaceId,
      })).status === 401,
      "foreign requested workspace refused",
    );
  }
  for (
    const suffix of [
      "identity",
      "facts/contact-methods?includeOptions=true",
      "dates",
      "relationships",
    ]
  ) {
    assert(
      (await read(`/api/v1/people/${foreignId}/${suffix}`, combined.secret))
        .status === 404,
      "foreign parent refused even when its child rows exist",
    );
  }
  assert(
    (await read("/api/v1/people", directory.secret)).status === 200,
    "old directory grant preserved",
  );
  assert(
    (await read("/api/v1/people", profile.secret)).status === 401,
    "profile does not imply directory grant",
  );
  for (
    const path of [
      root,
      `${root}?include=summary`,
      `${root}/timeline`,
    ]
  ) {
    assert(
      (await read(path, combined.secret)).status === 401,
      "aggregates and unrelated content remain cookie-only",
    );
  }
  const facts = await (await read(profilePaths[1]!, profile.secret)).json();
  assert(
    facts.records.length === 50 && facts.nextCursor &&
      facts.options.some((option: { id: string }) => option.id === typeId),
    "facts and member-readable options remain bounded",
  );
  const cursor = encodeURIComponent(facts.nextCursor);
  const next = await (await read(
    `${root}/facts/contact-methods?cursor=${cursor}`,
    profile.secret,
  )).json();
  assert(
    next.records.length === 1 && !next.nextCursor,
    "fact cursor continues without gaps",
  );
  assert(
    (await read(
      `/api/v1/people/${targetId}/facts/contact-methods?cursor=${cursor}`,
      profile.secret,
    )).status === 409,
    "fact cursor cannot change parent",
  );
  assert(
    (await read(`${root}/relationships?cursor=forged`, relationships.secret))
      .status === 409,
    "relationship cursor semantics preserved",
  );
  assert(
    (await read(
      "/api/v1/relationship-types?cursor=forged",
      relationships.secret,
    )).status === 409,
    "lookup cursor semantics preserved",
  );
  const dates = await (await read(`${root}/dates`, profile.secret)).json();
  assert(
    dates.dates[0]?.precision === "month_day" &&
      !Object.hasOwn(dates.dates[0], "year"),
    "unknown year remains absent",
  );
  const edges =
    await (await read(`${root}/relationships`, relationships.secret)).json();
  assert(
    edges.relationships[0]?.display.personId === targetId &&
      edges.relationships[0]?.display.label === "Connector parent",
    "directional edge is scoped to its parent",
  );

  await sql`update crm.people set archived_at = now() where id = ${sourceId}::uuid`;
  for (const path of profilePaths) {
    const response = await read(path, profile.secret);
    assert(
      response.status === 200 && (await response.json()).status === "archived",
      "archived person remains readable",
    );
  }
  assert(
    (await read(`${root}/relationships`, relationships.secret)).status === 200,
    "archived relationships remain readable",
  );
  await sql`insert into crm.workspace_profile_modules (workspace_id, key, is_active)
    values (${own.workspaceId}, 'contact-methods', false), (${own.workspaceId}, 'relationships', false)`;
  for (const path of [profilePaths[1]!, ...relationshipPaths]) {
    const response = await read(path, combined.secret);
    const body = await response.json();
    assert(
      response.status === 200 && body.status === "hidden" &&
        (body.records ?? body.relationships ?? body.options).length === 0,
      "hidden sections and lookups conceal saved data",
    );
  }
  await sql`update crm.api_tokens set expires_at = now() - interval '1 minute' where id = ${combined.record.id}::uuid`;
  for (const path of paths) {
    assert(
      (await read(path, combined.secret, { cookie: own.cookie })).status ===
        401,
      "expired bearer refused",
    );
  }
  await sql`update crm.api_tokens set expires_at = null where id = ${combined.record.id}::uuid`;
  assert(
    (await management(
      own,
      `/api/v1/settings/api-tokens/${combined.record.id}`,
      "DELETE",
    )).status === 200,
    "token revoked through public use case",
  );
  for (const path of paths) {
    assert(
      (await read(path, combined.secret, { cookie: own.cookie })).status ===
        401,
      "revoked bearer refused",
    );
  }
  await revokeMembership(sql, own.memberId);
  assert(
    (await read(profilePaths[0]!, profile.secret)).status === 401 &&
      (await read(relationshipPaths[0]!, relationships.secret)).status === 401,
    "current membership rechecked for both grants",
  );
});

Deno.test("[API-001] PostgreSQL API tokens are hashed, scoped, tenant-bound, expiring, and revocable", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`api-${suffix}@example.test`, "API primary");
  const foreign = await register(
    `api-foreign-${suffix}@example.test`,
    "API foreign",
  );
  const person = await configured.app.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers: {
        "content-type": "application/json",
        cookie: primary.cookie,
        origin: "http://localhost",
        "X-Workspace-Id": primary.workspaceId,
      },
      method: "POST",
    },
  );
  assert(person.status === 201, "programmatic fixture person created");

  assert(
    (await management(primary, undefined, "POST", {
      expiresAt: "2026-09-24T10:00:00.000Z",
      name: "Invalid",
      scopes: ["not a scope"],
    })).status === 400,
    "unknown scope rejected",
  );
  const created = await management(primary, undefined, "POST", {
    expiresAt: "2027-09-24T10:00:00.000Z",
    name: "Desktop read",
    scopes: ["people:read"],
  });
  const createdBody = await created.json() as {
    record: { id: string };
    secret: string;
  };
  assert(
    created.status === 201 &&
      createdBody.secret?.startsWith(`kin_pat_${createdBody.record?.id}.`),
    `secret returned exactly at creation (${created.status}: ${
      JSON.stringify(createdBody)
    })`,
  );
  const stored = await sql<
    { token_hash: string }[]
  >`select token_hash from crm.api_tokens where id = ${createdBody.record.id}::uuid`;
  assert(
    stored[0]?.token_hash &&
      !createdBody.secret.includes(stored[0].token_hash) &&
      stored[0].token_hash !== createdBody.secret,
    "only verifier stored",
  );
  const listed = await management(primary);
  assert(
    listed.status === 200 &&
      !(await listed.text()).includes(createdBody.secret),
    "metadata list does not reveal secret",
  );

  const bearer = (workspaceId?: string) =>
    configured.app.request("http://localhost/api/v1/people", {
      headers: {
        authorization: `Bearer ${createdBody.secret}`,
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      },
    });
  const accepted = await bearer(primary.workspaceId);
  assert(
    accepted.status === 200 && (await accepted.text()).includes("Ada"),
    "scoped bearer reads its people directory",
  );
  assert(
    (await bearer(foreign.workspaceId)).status === 401,
    "bearer cannot select another workspace",
  );
  assert(
    (await configured.app.request("http://localhost/api/v1/people", {
      headers: { authorization: "Bearer malformed" },
    })).status === 401,
    "invalid bearer rejected",
  );

  await sql`update crm.api_tokens set expires_at = now() - interval '1 minute' where id = ${createdBody.record.id}::uuid`;
  assert(
    (await bearer(primary.workspaceId)).status === 401,
    "expired bearer rejected",
  );
  await sql`update crm.api_tokens set expires_at = now() + interval '1 day' where id = ${createdBody.record.id}::uuid`;
  assert(
    (await management(
      foreign,
      `/api/v1/settings/api-tokens/${createdBody.record.id}`,
      "DELETE",
    )).status === 404,
    "foreign workspace cannot revoke token",
  );
  assert(
    (await management(
      primary,
      `/api/v1/settings/api-tokens/${createdBody.record.id}`,
      "DELETE",
    )).status === 200,
    "owner revokes token",
  );
  assert(
    (await bearer(primary.workspaceId)).status === 401,
    "revoked bearer rejected",
  );

  const audit = await sql<
    { action: string }[]
  >`select action from crm.audit_events where subject_id = ${createdBody.record.id}::uuid order by occurred_at`;
  assert(
    audit.map((row) => row.action).join(",") ===
      "api-token-created,api-token-revoked",
    "create and revoke audited",
  );
});

// --- GAP-009 -------------------------------------------------------------

Deno.test({
  name: "[API-001] GAP-009 a revoked member cannot mint or list API tokens",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-revocation-${crypto.randomUUID()}`,
      );
      const actors = new PostgresActorRevalidation();
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        issuers: new PostgresInvitationIdentity(),
        repository: new PostgresApiTokenRepository(),
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: new PostgresApiTokenTransaction(connection.db),
      });

      const allowed = await tokens.create(actor, {
        name: "Allowed token",
        scopes: ["people:read"],
      });
      assert(allowed.status === "created", "an active member mints a token");

      await revokeMembership(sql, actor.memberId);

      const refusedCreate = await tokens.create(actor, {
        name: "Refused token",
        scopes: ["people:read"],
      });
      const refusedList = await tokens.list(actor);
      const refusedRevoke = await tokens.revoke(
        actor,
        allowed.status === "created" ? allowed.record.id : crypto.randomUUID(),
      );
      const authenticated = await tokens.authenticate(
        allowed.status === "created" ? allowed.secret : "kin_pat_invalid",
        "people:read",
      );
      assert(
        refusedCreate.status === "forbidden" &&
          refusedList.status === "forbidden" &&
          refusedRevoke.status === "forbidden" &&
          authenticated.status === "invalid",
        "a revoked member still reached API tokens",
      );
    } finally {
      await connection.destroy();
    }
  },
});
// --- REL-067 -------------------------------------------------------------

Deno.test({
  name:
    "[API-001] REL-067 a token's use is written at most once per 15 minutes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-use-${crypto.randomUUID()}`,
      );
      const start = new Date(Math.floor(Date.now() / 1_000) * 1_000);
      let now = start;
      const actors = new PostgresActorRevalidation();
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => now },
        ids: { next: () => crypto.randomUUID() },
        issuers: new PostgresInvitationIdentity(),
        repository: new PostgresApiTokenRepository(),
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: new PostgresApiTokenTransaction(connection.db),
      });
      const created = await tokens.create(actor, {
        name: "Polling token",
        scopes: ["people:read"],
      });
      assert(created.status === "created", "token minted");
      const use = async (minutes: number) => {
        now = new Date(start.getTime() + minutes * 60_000);
        const accepted = await tokens.authenticate(
          created.secret,
          "people:read",
        );
        const [row] = await sql<
          { last_used_at: Date | null; updated_at: Date }[]
        >`select last_used_at, updated_at from crm.api_tokens where id = ${created.record.id}::uuid`;
        return {
          lastUsedAt: row?.last_used_at?.getTime(),
          status: accepted.status,
          updatedAt: row?.updated_at.getTime(),
        };
      };
      const minute = (value: number) => start.getTime() + value * 60_000;

      const first = await use(0);
      assert(
        first.status === "authenticated" && first.lastUsedAt === minute(0) &&
          first.updatedAt === minute(0),
        `first use is recorded: ${JSON.stringify(first)}`,
      );
      const soon = await use(14);
      assert(
        soon.status === "authenticated" && soon.lastUsedAt === minute(0) &&
          soon.updatedAt === minute(0),
        `a use within 15 minutes is accepted but not written: ${
          JSON.stringify(soon)
        }`,
      );
      const later = await use(16);
      assert(
        later.status === "authenticated" && later.lastUsedAt === minute(16) &&
          later.updatedAt === minute(16),
        `a use after 15 minutes is recorded: ${JSON.stringify(later)}`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

// --- REL-073 -------------------------------------------------------------

/** Whether `statement`, run on another connection, waits on a row lock. */
function blockedBy(
  statement: (transaction: postgres.TransactionSql) => Promise<unknown>,
) {
  return sql.begin(async (transaction) => {
    await transaction`set local lock_timeout = '250ms'`;
    try {
      await transaction.savepoint(statement);
      return false;
    } catch (error) {
      if (error instanceof sql.PostgresError && error.code === "55P03") {
        return true;
      }
      throw error;
    }
  });
}

Deno.test({
  name:
    "[API-001] REL-073 authentication locks the token against writers but not key-share readers",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-lock-${crypto.randomUUID()}`,
      );
      const actors = new PostgresActorRevalidation();
      const repository = new PostgresApiTokenRepository();
      const transactions = new PostgresApiTokenTransaction(connection.db);
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        issuers: new PostgresInvitationIdentity(),
        repository,
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: transactions,
      });
      const created = await tokens.create(actor, {
        name: "Locked token",
        scopes: ["people:read"],
      });
      assert(created.status === "created", "token minted");
      const id = created.record.id;
      const probes = await transactions.run(async (transaction) => {
        const found = await repository.findForAuthentication({
          id,
          transaction,
        });
        assert(found.status === "found", "token found");
        return {
          // A foreign key check takes this lock; FOR UPDATE would block it.
          keyShare: await blockedBy((t) =>
            t`select 1 from crm.api_tokens where id = ${id}::uuid for key share`
          ),
          revocation: await blockedBy((t) =>
            t`update crm.api_tokens set revoked_at = now() where id = ${id}::uuid`
          ),
        };
      });
      assert(
        !probes.keyShare && probes.revocation,
        `only the revocation waits on the authentication: ${
          JSON.stringify(probes)
        }`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[API-001] REL-073 a last use recorded in the future does not pause the record",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-skew-${crypto.randomUUID()}`,
      );
      const start = new Date(Math.floor(Date.now() / 1_000) * 1_000);
      let now = start;
      const actors = new PostgresActorRevalidation();
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => now },
        ids: { next: () => crypto.randomUUID() },
        issuers: new PostgresInvitationIdentity(),
        repository: new PostgresApiTokenRepository(),
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: new PostgresApiTokenTransaction(connection.db),
      });
      const created = await tokens.create(actor, {
        name: "Skewed token",
        scopes: ["people:read"],
      });
      assert(created.status === "created", "token minted");
      // A host whose clock runs an hour ahead records a use first.
      now = new Date(start.getTime() + 60 * 60_000);
      await tokens.authenticate(created.secret, "people:read");
      now = start;
      const accepted = await tokens.authenticate(
        created.secret,
        "people:read",
      );
      const [row] = await sql<
        { last_used_at: Date | null }[]
      >`select last_used_at from crm.api_tokens where id = ${created.record.id}::uuid`;
      assert(
        accepted.status === "authenticated" &&
          row?.last_used_at?.getTime() === start.getTime(),
        `a correct clock replaces a future last use: ${
          JSON.stringify({
            lastUsedAt: row?.last_used_at,
            status: accepted.status,
          })
        }`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test("[AUD-K1] PostgreSQL holds a token to the legal documents a cookie owes, and answers hostile input without an outage", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(
    `legal-token-${suffix}@example.test`,
    "Legal token",
  );
  const minted = await management(owner, undefined, "POST", {
    name: "Directory",
    scopes: ["people:read"],
  });
  assert(minted.status === 201, `token minted: ${minted.status}`);
  const { secret } = await minted.json() as { readonly secret: string };
  const bearer = () =>
    configured.app.request("http://localhost/api/v1/people", {
      headers: { authorization: `Bearer ${secret}` },
    });
  const code = async (response: Response) =>
    (await response.json() as { readonly code?: string }).code;

  assert((await bearer()).status === 200, "a token reads with nothing owed");

  const malformed = await configured.app.request(
    "http://localhost/api/v1/people",
    { headers: { cookie: owner.cookie, "X-Workspace-Id": "not-a-uuid" } },
  );
  assert(
    malformed.status === 400 &&
      await code(malformed) === "workspace_header_invalid",
    `a malformed workspace header is a 400, not an outage: ${malformed.status}`,
  );
  const nul = await api.request(owner, "/api/v1/people", "POST", {
    givenName: "a\u0000b",
    isPartial: false,
  });
  assert(nul.status === 400, `a NUL character is a 400: ${nul.status}`);
  const plain = await configured.app.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers: {
        "content-type": "text/plain",
        cookie: owner.cookie,
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  assert(plain.status === 415, `a text/plain body is a 415: ${plain.status}`);

  const documentId = crypto.randomUUID();
  await sql`insert into crm.legal_documents
    (id, document_type, version, content, published_at, is_active)
    values (${documentId}::uuid, 'terms', ${`aud-k1-${suffix}`},
      'Terms published after the token', now() - interval '1 minute', true)`;
  try {
    const refused = await bearer();
    assert(
      refused.status === 403 &&
        await code(refused) === "legal_acceptance_required",
      `a token passed an outstanding document: ${refused.status}`,
    );
    const cookie = await api.request(owner, "/api/v1/people");
    assert(cookie.status === 403, "the cookie owes the same document");
  } finally {
    await sql`delete from crm.legal_documents where id = ${documentId}::uuid`;
  }
  assert((await bearer()).status === 200, "withdrawn terms admit the token");
});

// --- AUD-M4 --------------------------------------------------------------

interface ListedToken {
  readonly id: string;
  readonly issuer: { readonly email: string; readonly name: string };
  readonly revokedAt?: string;
}

/** Joins an existing identity to a workspace and signs it in there. */
async function joinWorkspace(
  identity: SignedInFixture,
  workspaceId: string,
  role: "admin" | "member" | "owner",
): Promise<SignedInFixture> {
  const memberId = await addMembership(sql, identity.userId, workspaceId, role);
  return { ...identity, memberId, role, workspaceId };
}

function tokenBearer(secret: string, workspaceId: string) {
  return personalTokens.bearer(secret, "/api/v1/people", {
    headers: { "X-Workspace-Id": workspaceId },
  });
}

function mintToken(fixture: SignedInFixture, name: string) {
  return personalTokens.mint(fixture, ["people:read"], { name });
}

Deno.test("[API-001] AUD-M4 an owner lists and revokes a demoted admin's token", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`oversight-${suffix}@example.test`, "Oversight");
  const adminEmail = `oversight-admin-${suffix}@example.test`;
  const admin = await joinWorkspace(
    await register(adminEmail, "Admin home"),
    owner.workspaceId,
    "admin",
  );
  const adminToken = await mintToken(admin, "Admin automation");
  const ownerToken = await mintToken(owner, "Owner automation");

  const demoted = await api.request(
    owner,
    `/api/v1/settings/members/${admin.memberId}`,
    "PATCH",
    { role: "member", status: "active" },
  );
  assert(demoted.status === 200, `the owner demotes A: ${demoted.status}`);
  assert(
    (await tokenBearer(adminToken.secret, owner.workspaceId)).status === 200,
    "demotion applies at use time; A's token reads as a member",
  );

  const listed = await management(owner);
  const body = await listed.json() as { readonly records: ListedToken[] };
  const adminRecord = body.records?.find((record) =>
    record.id === adminToken.record.id
  );
  assert(
    listed.status === 200 && adminRecord?.issuer?.email === adminEmail &&
      adminRecord.issuer.name === "API Tester" &&
      body.records.some((record) => record.id === ownerToken.record.id),
    `the owner's list shows A's token with its issuer: ${JSON.stringify(body)}`,
  );
  assert(
    (await management(admin)).status === 403,
    "a member still cannot list the workspace's tokens",
  );
  assert(
    (await management(
      admin,
      `/api/v1/settings/api-tokens/${ownerToken.record.id}`,
      "DELETE",
    )).status === 403,
    "a member cannot revoke the owner's token",
  );

  const revoked = await management(
    owner,
    `/api/v1/settings/api-tokens/${adminToken.record.id}`,
    "DELETE",
  );
  assert(revoked.status === 200, `the owner revokes A's token`);
  assert(
    (await tokenBearer(adminToken.secret, owner.workspaceId)).status === 401,
    "A's revoked token no longer authenticates",
  );
  assert(
    (await tokenBearer(ownerToken.secret, owner.workspaceId)).status === 200,
    "the owner's own token is untouched",
  );
  const audit = await sql<{ action: string; actor_member_id: string }[]>`
    select action, actor_member_id::text from crm.audit_events
    where subject_id = ${adminToken.record.id}::uuid order by occurred_at
  `;
  assert(
    audit.map((row) => row.action).join() ===
        "api-token-created,api-token-revoked" &&
      audit[1]?.actor_member_id === owner.memberId,
    `the revocation is audited against the owner: ${JSON.stringify(audit)}`,
  );
});

Deno.test("[API-001] AUD-M4 an admin revokes another admin's token, and a foreign owner cannot", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`peer-${suffix}@example.test`, "Peers");
  const firstEmail = `peer-first-${suffix}@example.test`;
  const secondEmail = `peer-second-${suffix}@example.test`;
  const first = await joinWorkspace(
    await register(firstEmail, "First home"),
    owner.workspaceId,
    "admin",
  );
  const second = await joinWorkspace(
    await register(secondEmail, "Second home"),
    owner.workspaceId,
    "admin",
  );
  const foreign = await register(`peer-foreign-${suffix}@example.test`, "Far");
  const token = await mintToken(first, "First admin token");
  const listed = await management(second);
  const records = (await listed.json() as { records: ListedToken[] }).records;
  assert(
    records.some((record) => record.id === token.record.id),
    "a second admin sees the first admin's token",
  );
  assert(
    !(await (await management(foreign)).text()).includes(token.record.id),
    "a foreign owner's list never shows it",
  );
  assert(
    (await management(
      foreign,
      `/api/v1/settings/api-tokens/${token.record.id}`,
      "DELETE",
    )).status === 404,
    "a foreign owner cannot revoke it",
  );
  assert(
    (await management(
      second,
      `/api/v1/settings/api-tokens/${token.record.id}`,
      "DELETE",
    )).status === 200,
    "the second admin revokes it",
  );
});

Deno.test("[API-001] AUD-M4 suspending or leaving revokes the member's tokens in that workspace only", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`removal-${suffix}@example.test`, "Removal");
  const suspendedEmail = `removal-suspended-${suffix}@example.test`;
  const leaverEmail = `removal-leaver-${suffix}@example.test`;
  const suspendedHome = await register(suspendedEmail, "Suspended home");
  const suspended = await joinWorkspace(
    suspendedHome,
    owner.workspaceId,
    "admin",
  );
  const leaverHome = await register(leaverEmail, "Leaver home");
  const leaver = await joinWorkspace(
    leaverHome,
    owner.workspaceId,
    "admin",
  );
  const suspendedToken = await mintToken(suspended, "Suspended token");
  const homeToken = await mintToken(suspendedHome, "Home token");
  const leaverToken = await mintToken(leaver, "Leaver token");
  const feed = await api.request(
    leaver,
    "/api/v1/settings/calendar-feed",
    "POST",
  );
  assert(feed.status === 201, `the leaver has a calendar feed: ${feed.status}`);

  for (
    const status of [
      { role: "admin", status: "suspended" },
      { role: "member", status: "active" },
    ]
  ) {
    const updated = await api.request(
      owner,
      `/api/v1/settings/members/${suspended.memberId}`,
      "PATCH",
      status,
    );
    assert(updated.status === 200, `member updated: ${updated.status}`);
  }
  assert(
    (await tokenBearer(suspendedToken.secret, owner.workspaceId)).status ===
      401,
    "a suspended and reinstated member's token stays dead",
  );
  assert(
    (await tokenBearer(homeToken.secret, suspendedHome.workspaceId))
      .status === 200,
    "the same person's token in their own workspace is untouched",
  );

  const left = await api.request(
    leaver,
    "/api/v1/settings/personal-lifecycle/leave",
    "POST",
    { confirmation: "LEAVE Removal", password: PASSWORD },
  );
  assert(left.status === 200, `the admin leaves: ${left.status}`);
  const rows = await sql<{ id: string; revoked: boolean; scopes: string[] }[]>`
    select id::text, revoked_at is not null revoked, scopes from crm.api_tokens
    where workspace_id = ${owner.workspaceId}::uuid
      and user_id in (${suspended.userId}::uuid, ${leaver.userId}::uuid)
  `;
  assert(
    rows.length === 3 && rows.every((row) => row.revoked),
    `every token and feed of a removed member is revoked: ${
      JSON.stringify(rows)
    }`,
  );
  assert(
    (await tokenBearer(leaverToken.secret, owner.workspaceId)).status === 401,
    "the leaver's token no longer authenticates",
  );
  const audit = await sql<{ subject_id: string }[]>`
    select subject_id::text from crm.audit_events
    where action = 'api-token-revoked' and workspace_id = ${owner.workspaceId}::uuid
  `;
  assert(
    [suspendedToken.record.id, leaverToken.record.id].every((id) =>
      audit.some((row) => row.subject_id === id)
    ),
    `each revocation is audited: ${JSON.stringify(audit)}`,
  );
});

// --- MCP-A1 --------------------------------------------------------------

Deno.test("[MCP-A1] PostgreSQL names the token on every audit event a bearer write causes, and no token for a cookie write", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(
    `attribution-${suffix}@example.test`,
    "Attribution",
  );
  const person = await api.request(owner, "/api/v1/people", "POST", {
    givenName: "Ada",
    isPartial: false,
  });
  assert(person.status === 201, `person created: ${person.status}`);
  const personId = (await person.json()).person.id as string;
  const writer = await personalTokens.mint(owner, [
    "tasks:create",
    "tasks:write",
    "interactions:create",
  ]);
  const bearerWrite = async (
    path: string,
    method: HttpMethod,
    body: unknown,
  ) => {
    const response = await personalTokens.bearer(writer.secret, path, {
      body,
      method,
    });
    assert(
      response.status === 200 || response.status === 201,
      `${method} ${path} by token: ${response.status} ${await response
        .clone().text()}`,
    );
    return await response.json();
  };
  const tokenTask = (await bearerWrite("/api/v1/tasks", "POST", {
    personId,
    requestId: crypto.randomUUID(),
    title: "Token task",
  })).task as Task;
  await bearerWrite(`/api/v1/tasks/${tokenTask.id}`, "PATCH", {
    expectedUpdatedAt: tokenTask.updatedAt,
    title: "Token task, renamed",
  });
  await bearerWrite(`/api/v1/tasks/${tokenTask.id}/completion`, "PUT", {
    completed: true,
  });
  const note = (await bearerWrite("/api/v1/interactions", "POST", {
    body: "Token note",
    kind: "note",
    personId,
    requestId: crypto.randomUUID(),
  })).record as { readonly id: string };
  const cookie = await api.request(owner, "/api/v1/tasks", "POST", {
    requestId: crypto.randomUUID(),
    title: "Cookie task",
  });
  assert(cookie.status === 201, `cookie task created: ${cookie.status}`);
  const cookieTask = (await cookie.json()).task as Task;

  const rows = await sql<
    {
      action: string;
      api_token_id: string | null;
      request_id: string | null;
      subject_id: string | null;
    }[]
  >`select action, payload ->> 'apiTokenId' as api_token_id,
      payload ->> 'requestId' as request_id, subject_id::text
    from crm.audit_events where workspace_id = ${owner.workspaceId}::uuid`;
  const byToken = rows.filter((row) =>
    row.subject_id === tokenTask.id || row.subject_id === note.id
  );
  assert(
    byToken.length >= 4 &&
      byToken.every((row) =>
        row.api_token_id === writer.record.id && row.request_id !== null
      ),
    `every audit event a token write caused names the token: ${
      JSON.stringify(byToken)
    }`,
  );
  const byCookie = rows.filter((row) =>
    row.subject_id !== tokenTask.id && row.subject_id !== note.id
  );
  assert(
    byCookie.some((row) => row.subject_id === cookieTask.id) &&
      byCookie.some((row) => row.subject_id === writer.record.id) &&
      byCookie.every((row) => row.api_token_id === null),
    `a cookie write names no token: ${JSON.stringify(byCookie)}`,
  );
});

Deno.test("[MCP-A1] PostgreSQL GET /api/v1/me describes any current personal token and nothing else", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`context-${suffix}@example.test`, "Context");
  const foreign = await register(
    `context-foreign-${suffix}@example.test`,
    "Foreign context",
  );
  const agent = await personalTokens.mint(owner, ["tasks:write"], {
    expiresAt: "2099-01-01T00:00:00.000Z",
    name: "Agent",
  });
  const me = (secret: string, headers: Record<string, string> = {}) =>
    personalTokens.bearer(secret, "/api/v1/me", { headers });
  const status = async (response: Response) => {
    await response.body?.cancel();
    return response.status;
  };

  const answered = await me(agent.secret, {
    "X-Workspace-Id": owner.workspaceId,
  });
  assert(answered.status === 200, `context answered: ${answered.status}`);
  const body = await answered.json();
  assert(
    JSON.stringify(body) === JSON.stringify({
      memberId: owner.memberId,
      role: "owner",
      token: {
        expiresAt: agent.record.expiresAt,
        id: agent.record.id,
        name: "Agent",
        scopes: ["tasks:write"],
      },
      workspaceId: owner.workspaceId,
    }),
    `a grant unrelated to the route is enough: ${JSON.stringify(body)}`,
  );
  const [used] = await sql<{ last_used_at: Date | null }[]>`
    select last_used_at from crm.api_tokens where id = ${agent.record.id}::uuid`;
  assert(used?.last_used_at, "an introspection records the token's use");

  assert(
    await status(
      await api.request(owner, "/api/v1/me"),
    ) === 401,
    "a session cookie is never read",
  );
  assert(
    await status(
      await me(agent.secret, { "X-Workspace-Id": foreign.workspaceId }),
    ) ===
      401,
    "the token cannot name another workspace",
  );
  assert(
    await status(
      await me(agent.secret.replace(/\.[^.]*$/, ".wrong-secret-with-entropy")),
    ) === 401,
    "the secret is compared",
  );

  // A feed's secret, presented under the personal prefix, is still a feed.
  const feed = await api.request(
    owner,
    "/api/v1/settings/calendar-feed",
    "POST",
  );
  assert(feed.status === 201, `calendar feed minted: ${feed.status}`);
  const [feedRow] = await sql<{ id: string }[]>`
    select id::text from crm.api_tokens
    where workspace_id = ${owner.workspaceId}::uuid
      and 'calendar.read' = any(scopes)`;
  const feedSecret = /kin_cal_([^.]+)\.([A-Za-z0-9_-]+)/.exec(
    JSON.stringify(await feed.json()),
  );
  assert(feedRow && feedSecret, "the feed's secret is in its answer");
  assert(
    await status(await me(`kin_pat_${feedSecret[1]}.${feedSecret[2]}`)) ===
      401,
    "a calendar feed is not a personal token",
  );

  await sql`update crm.api_tokens set expires_at = now() - interval '1 minute'
    where id = ${agent.record.id}::uuid`;
  assert(await status(await me(agent.secret)) === 401, "an expired token");
  await sql`update crm.api_tokens set expires_at = null
    where id = ${agent.record.id}::uuid`;
  assert(await status(await me(agent.secret)) === 200, "a renewed token");
  const revoked = await api.request(
    owner,
    `/api/v1/settings/api-tokens/${agent.record.id}`,
    "DELETE",
  );
  assert(revoked.status === 200, `token revoked: ${revoked.status}`);
  assert(await status(await me(agent.secret)) === 401, "a revoked token");

  const member = await personalTokens.mint(owner, ["people:read"]);
  await revokeMembership(sql, owner.memberId);
  assert(
    await status(await me(member.secret)) === 401,
    "a token whose member is gone",
  );
});

Deno.test({
  name: "close API token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await configured.close();
    await sql.end();
  },
});
