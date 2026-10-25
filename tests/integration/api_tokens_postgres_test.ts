import type postgres from "postgres";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createApiTokenManagement,
} from "../../packages/backend/modules/api-access/public.ts";
import { apiTokenAuditFrom } from "../../packages/backend/modules/api-access/public.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
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
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";
import type { Task } from "../../packages/contracts/generated/auth-client.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);
const register = (email: string, workspaceName: string) =>
  api.register(email, workspaceName, { firstName: "API", lastName: "Tester" });

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
  const mint = async (fixture: SignedInFixture, scopes: string[]) => {
    const response = await management(fixture, undefined, "POST", {
      name: "Capture connector",
      scopes,
    });
    assert(response.status === 201, `capture grant minted: ${response.status}`);
    return await response.json() as {
      secret: string;
      record: { id: string; scopes: string[] };
    };
  };
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
    configured.app.request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  await sql`insert into crm.person_contact_methods (id, person_id, type_id, value) values
    (${contactMethodId}, ${personId}, ${channelTypeId}, 'ada@example.test'),
    (${otherContactId}, ${otherPersonId}, ${channelTypeId}, 'grace@example.test'),
    (${foreignContactId}, ${foreignPersonId}, ${foreignChannelId}, 'foreign-secret@example.test')`;
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
  const mint = async (scopes: string[]) => {
    const response = await management(own, undefined, "POST", {
      name: "Task connector",
      scopes,
    });
    assert(response.status === 201, `task grants minted: ${response.status}`);
    return await response.json() as { secret: string; record: { id: string } };
  };
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
    configured.app.request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
      "/api/v1/today/tasks",
      "/api/v1/today/attention",
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
  await sql`insert into crm.person_contact_methods (person_id, type_id, value, updated_at)
    select ${sourceId}::uuid, ${typeId}::uuid, 'contact-' || n || '@example.test',
      '2026-01-01T00:00:00Z'::timestamptz + n * interval '1 second'
    from generate_series(1, 51) n`;
  await sql`insert into crm.person_contact_methods (person_id, type_id, value)
    values (${targetId}, ${typeId}, 'other-parent@example.test'),
      (${foreignId}, ${foreignTypeId}, 'foreign-secret@example.test')`;
  await sql`insert into crm.person_dates (person_id, kind, precision, month, day)
    values (${sourceId}, 'birthday', 'month_day', 12, 10), (${foreignId}, 'birthday', 'month_day', 1, 1)`;
  await sql`insert into crm.relationship_types (id, workspace_id, forward_label, reverse_label)
    values (${relationshipTypeId}, ${own.workspaceId}, 'Connector parent', 'Connector child'),
      (${foreignRelationshipTypeId}, ${foreign.workspaceId}, 'Foreign secret relation', 'Foreign secret inverse')`;
  await sql`insert into crm.relationships (workspace_id, from_person_id, to_person_id, relationship_type_id)
    values (${own.workspaceId}, ${sourceId}, ${targetId}, ${relationshipTypeId})`;
  const mint = async (scopes: readonly string[]) => {
    const response = await management(own, undefined, "POST", {
      name: scopes.join(" + "),
      scopes,
    });
    assert(response.status === 201, `mint ${scopes}: ${response.status}`);
    return await response.json() as {
      secret: string;
      record: { id: string; scopes: string[] };
    };
  };
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
  ) =>
    configured.app.request(`http://localhost${path}`, {
      headers: { authorization: `Bearer ${secret}`, ...extra },
    });
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
      `${root}/life-events`,
      "/api/v1/search?q=Ada",
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
      scopes: ["people:write"],
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

Deno.test({
  name: "close API token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await configured.close();
    await sql.end();
  },
});
