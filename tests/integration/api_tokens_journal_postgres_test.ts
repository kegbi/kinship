/**
 * Personal tokens over the journal and a person's life events (MCP-B6),
 * through the deployment's composition and the disposable database.
 *
 * `journal:read` and `journal:write` are independent grants, and the three
 * life-event writes answer to `people:write`. A token acts in its one bound
 * workspace and never borrows the cookie it travels beside.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import type { HttpMethod, SignedInFixture } from "../support/api.ts";
import { composeTokenSuite } from "../support/tokens.ts";
import { holdWorkspaceWrites } from "../support/workspace_write_queue.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

interface Call {
  readonly body?: unknown;
  readonly method: HttpMethod;
  readonly path: string;
}

async function status(
  secret: string,
  call: Call,
  headers?: Record<string, string>,
): Promise<number> {
  const response = await tokens.bearer(secret, call.path, {
    ...(call.body === undefined ? {} : { body: call.body }),
    ...(headers ? { headers } : {}),
    method: call.method,
  });
  await response.body?.cancel();
  return response.status;
}

async function json(
  secret: string,
  call: Call,
  expected: number,
): Promise<Record<string, unknown>> {
  const response = await tokens.bearer(secret, call.path, {
    ...(call.body === undefined ? {} : { body: call.body }),
    method: call.method,
  });
  const text = await response.text();
  assert(
    response.status === expected,
    `${call.method} ${call.path}: ${response.status} ${text}`,
  );
  return JSON.parse(text);
}

async function createPerson(owner: SignedInFixture): Promise<string> {
  const person = await api.request(owner, "/api/v1/people", "POST", {
    givenName: "Ada",
    isPartial: false,
  });
  assert(person.status === 201, `person created: ${person.status}`);
  return (await person.json()).person.id as string;
}

async function seedActivity(workspaceId: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`insert into crm.activities (id, workspace_id, summary, happened_at) values
    (${id}, ${workspaceId}, 'Lunch together', '2026-08-22T12:00:00Z')`;
  return id;
}

async function journalItemIds(workspaceId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id::text from crm.journal_items
    where workspace_id = ${workspaceId}::uuid order by id`;
  return rows.map((row) => row.id);
}

const occurredAt = "2026-11-20T09:00:00.000Z";

Deno.test("[MCP-B6] PostgreSQL journal grants read and write the workspace journal independently", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`journal-token-${suffix}@example.test`, "Diary");
  const reader = await tokens.mint(owner, ["journal:read"]);
  const writer = await tokens.mint(owner, ["journal:write"]);
  const people = await tokens.mint(owner, ["people:write"]);

  const created = await json(writer.secret, {
    body: { body: "First entry", occurredAt, title: "Monday" },
    method: "POST",
    path: "/api/v1/journal/posts",
  }, 201);
  const postId = (created.post as { id: string }).id;
  const item = (id: string) => ({
    method: "GET" as const,
    path: `/api/v1/journal/items/${id}`,
  });
  const read = await json(reader.secret, item(postId), 200);
  const readPost = (read.item as {
    post: { body: string; id: string; title?: string };
  }).post;
  assert(
    readPost.body === "First entry" && readPost.id === postId &&
      readPost.title === "Monday",
    `the reader sees the created post: ${JSON.stringify(read)}`,
  );

  await json(writer.secret, {
    body: { body: "Edited entry", occurredAt },
    method: "PUT",
    path: `/api/v1/journal/posts/${postId}`,
  }, 200);
  const edited = await json(reader.secret, item(postId), 200);
  const editedPost = (edited.item as {
    post: { body: string; title?: string };
  }).post;
  assert(
    editedPost.body === "Edited entry" && editedPost.title === undefined,
    `the reader sees the replacement, title cleared: ${
      JSON.stringify(editedPost)
    }`,
  );

  const rating = {
    body: { comment: "Calm", ratedOn: "2026-11-20", rating: 4 },
    method: "PUT" as const,
    path: "/api/v1/journal/day-ratings",
  };
  const rated = await json(writer.secret, rating, 201);
  const ratingId = (rated.rating as { id: string }).id;
  const rerated = await json(writer.secret, {
    ...rating,
    body: { ratedOn: "2026-11-20", rating: 2 },
  }, 200);
  assert(
    (rerated.rating as { id: string }).id === ratingId,
    "the same date's rating is upserted",
  );
  const ratingItem = await json(reader.secret, item(ratingId), 200);
  const dayRating = (ratingItem.item as {
    dayRating: { comment?: string; id: string; rating: number };
  }).dayRating;
  assert(
    dayRating.id === ratingId && dayRating.rating === 2 &&
      dayRating.comment === undefined,
    `the reader sees the upserted rating: ${JSON.stringify(ratingItem)}`,
  );

  const activityId = await seedActivity(owner.workspaceId);
  const linked = await json(writer.secret, {
    body: { activityId },
    method: "POST",
    path: "/api/v1/journal/activities",
  }, 201);
  const linkId = linked.id as string;
  assert(
    await status(writer.secret, {
      body: { activityId },
      method: "POST",
      path: "/api/v1/journal/activities",
    }) === 404,
    "a duplicate link is refused",
  );
  const listed = await json(reader.secret, {
    method: "GET",
    path: "/api/v1/journal",
  }, 200);
  assert(
    JSON.stringify(
      (listed.items as { id: string }[]).map((entry) => entry.id).sort(),
    ) === JSON.stringify([postId, ratingId, linkId].sort()),
    `the reader lists every item: ${JSON.stringify(listed)}`,
  );

  const writes: Call[] = [
    {
      body: { body: "Denied", occurredAt },
      method: "POST",
      path: "/api/v1/journal/posts",
    },
    {
      body: { body: "Denied", occurredAt },
      method: "PUT",
      path: `/api/v1/journal/posts/${postId}`,
    },
    { ...rating, body: { ratedOn: "2026-11-20", rating: 5 } },
    {
      body: { activityId },
      method: "POST",
      path: "/api/v1/journal/activities",
    },
    { method: "DELETE", path: `/api/v1/journal/items/${postId}` },
  ];
  const reads: Call[] = [
    { method: "GET", path: "/api/v1/journal" },
    item(postId),
  ];
  const before = await journalItemIds(owner.workspaceId);
  for (const call of writes) {
    for (const secret of [reader.secret, people.secret]) {
      assert(
        await status(secret, call) === 401,
        `${call.method} ${call.path} refuses a token without journal:write`,
      );
    }
  }
  for (const call of reads) {
    for (const secret of [writer.secret, people.secret]) {
      assert(
        await status(secret, call) === 401,
        `${call.method} ${call.path} refuses a token without journal:read`,
      );
    }
  }
  assert(
    JSON.stringify(await journalItemIds(owner.workspaceId)) ===
      JSON.stringify(before),
    "a refused write changed nothing",
  );

  const removed = await json(writer.secret, {
    method: "DELETE",
    path: `/api/v1/journal/items/${linkId}`,
  }, 200);
  assert(removed.itemType === "activity", "the link is removed");
  const [activity] = await sql<{ count: string }[]>`
    select count(*)::text as count from crm.activities where id = ${activityId}::uuid`;
  assert(activity?.count === "1", "removing a link keeps the activity");
  await json(writer.secret, {
    method: "DELETE",
    path: `/api/v1/journal/items/${postId}`,
  }, 200);
  assert(
    await status(reader.secret, item(postId)) === 404,
    "the reader sees the post deleted",
  );

  const audit = await sql<
    { action: string; api_token_id: string | null; subject_id: string }[]
  >`select action, payload ->> 'apiTokenId' as api_token_id, subject_id::text
    from crm.audit_events
    where workspace_id = ${owner.workspaceId}::uuid
      and subject_type = 'journal_item'`;
  for (
    const [subject, action] of [
      [postId, "journal.item-created"],
      [postId, "journal.item-updated"],
      [postId, "journal.item-deleted"],
      [ratingId, "journal.item-created"],
      [ratingId, "journal.item-updated"],
      [linkId, "journal.item-created"],
      [linkId, "journal.item-deleted"],
    ] as const
  ) {
    assert(
      audit.some((row) =>
        row.subject_id === subject && row.action === action &&
        row.api_token_id === writer.record.id
      ),
      `${action} on ${subject} names the token: ${JSON.stringify(audit)}`,
    );
  }
  assert(
    audit.every((row) => row.api_token_id === writer.record.id),
    "every journal event a bearer wrote names the writing token",
  );
});

Deno.test("[MCP-B6] PostgreSQL people:write writes life events, and the journal grants do not", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`life-token-${suffix}@example.test`, "Lives");
  const personId = await createPerson(owner);
  const people = await tokens.mint(owner, ["people:write"]);
  const writer = await tokens.mint(owner, ["journal:write"]);
  const path = `/api/v1/people/${personId}/life-events`;

  const created = await json(people.secret, {
    body: { name: "Moved to Lisbon", precision: "year", year: 2019 },
    method: "POST",
    path,
  }, 201);
  const event = created.event as { id: string; updatedAt: string };
  const updated = await json(people.secret, {
    body: {
      expectedUpdatedAt: event.updatedAt,
      name: "Moved to Porto",
      precision: "year",
      year: 2020,
    },
    method: "PATCH",
    path: `${path}/${event.id}`,
  }, 200);
  const revised = updated.event as { name: string; updatedAt: string };
  assert(revised.name === "Moved to Porto", "the event was replaced");
  assert(
    await status(people.secret, {
      body: {
        expectedUpdatedAt: event.updatedAt,
        name: "Stale",
        precision: "unknown",
      },
      method: "PATCH",
      path: `${path}/${event.id}`,
    }) === 409,
    "a stale revision is refused",
  );
  assert(
    await status(people.secret, {
      body: { expectedUpdatedAt: event.updatedAt },
      method: "DELETE",
      path: `${path}/${event.id}`,
    }) === 409,
    "a stale deletion is refused",
  );

  const lifeEventWrites: Call[] = [
    { body: { name: "Denied", precision: "unknown" }, method: "POST", path },
    {
      body: {
        expectedUpdatedAt: revised.updatedAt,
        name: "Denied",
        precision: "unknown",
      },
      method: "PATCH",
      path: `${path}/${event.id}`,
    },
    {
      body: { expectedUpdatedAt: revised.updatedAt },
      method: "DELETE",
      path: `${path}/${event.id}`,
    },
  ];
  for (const call of lifeEventWrites) {
    assert(
      await status(writer.secret, call) === 401,
      `${call.method} ${call.path} refuses journal:write`,
    );
  }
  for (
    const call of [
      { method: "GET", path: "/api/v1/journal" },
      {
        body: { body: "Denied", occurredAt },
        method: "POST",
        path: "/api/v1/journal/posts",
      },
      {
        body: { ratedOn: "2026-11-20", rating: 3 },
        method: "PUT",
        path: "/api/v1/journal/day-ratings",
      },
    ] satisfies Call[]
  ) {
    assert(
      await status(people.secret, call) === 401,
      `${call.method} ${call.path} refuses people:write`,
    );
  }

  await json(people.secret, {
    body: { expectedUpdatedAt: revised.updatedAt },
    method: "DELETE",
    path: `${path}/${event.id}`,
  }, 200);
  const remaining = await sql<{ count: string }[]>`
    select count(*)::text as count from crm.life_events where id = ${event.id}::uuid`;
  assert(remaining[0]?.count === "0", "the event was removed");

  const audit = await sql<{ action: string; api_token_id: string | null }[]>`
    select action, payload ->> 'apiTokenId' as api_token_id
    from crm.audit_events
    where workspace_id = ${owner.workspaceId}::uuid
      and subject_id = ${event.id}::uuid order by occurred_at`;
  assert(
    JSON.stringify(audit.map((row) => row.action)) ===
        JSON.stringify([
          "journal.life-event-created",
          "journal.life-event-updated",
          "journal.life-event-deleted",
        ]) &&
      audit.every((row) => row.api_token_id === people.record.id),
    `each life-event event names the token: ${JSON.stringify(audit)}`,
  );
});

Deno.test("[MCP-B6] PostgreSQL journal and life-event tokens stay in their workspace and never borrow a cookie", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`journal-home-${suffix}@example.test`, "Home");
  const foreign = await register(
    `journal-away-${suffix}@example.test`,
    "Away",
  );
  const personId = await createPerson(owner);
  const post = await api.request(owner, "/api/v1/journal/posts", "POST", {
    body: "Private to Home",
    occurredAt,
  });
  assert(post.status === 201, `cookie post created: ${post.status}`);
  const postId = (await post.json()).post.id as string;
  const event = await api.request(
    owner,
    `/api/v1/people/${personId}/life-events`,
    "POST",
    { name: "Graduated", precision: "unknown" },
  );
  assert(event.status === 201, `cookie life event created: ${event.status}`);
  const lifeEvent = (await event.json()).event as {
    id: string;
    updatedAt: string;
  };
  const activityId = await seedActivity(owner.workspaceId);

  const away = await tokens.mint(foreign, [
    "journal:read",
    "journal:write",
    "people:write",
  ]);
  const before = {
    items: await journalItemIds(owner.workspaceId),
    lifeEvents: (await sql<{ updated_at: string }[]>`
      select updated_at::text from crm.life_events where id = ${lifeEvent.id}::uuid`)
      .map((row) => row.updated_at),
  };
  const path = `/api/v1/people/${personId}/life-events`;
  const foreignCalls: [Call, readonly number[]][] = [
    [{ method: "GET", path: `/api/v1/journal/items/${postId}` }, [404]],
    [{
      body: { body: "Hijacked", occurredAt },
      method: "PUT",
      path: `/api/v1/journal/posts/${postId}`,
    }, [404]],
    [{ method: "DELETE", path: `/api/v1/journal/items/${postId}` }, [404]],
    [{
      body: { activityId },
      method: "POST",
      path: "/api/v1/journal/activities",
    }, [404]],
    [
      {
        body: { name: "Hijacked", precision: "unknown" },
        method: "POST",
        path,
      },
      [404],
    ],
    [{
      body: {
        expectedUpdatedAt: lifeEvent.updatedAt,
        name: "Hijacked",
        precision: "unknown",
      },
      method: "PATCH",
      path: `${path}/${lifeEvent.id}`,
    }, [404]],
    [{
      body: { expectedUpdatedAt: lifeEvent.updatedAt },
      method: "DELETE",
      path: `${path}/${lifeEvent.id}`,
    }, [404]],
  ];
  for (const [call, expected] of foreignCalls) {
    const answered = await status(away.secret, call);
    assert(
      expected.includes(answered),
      `${call.method} ${call.path} by a foreign token answered ${answered}`,
    );
    const asked = await status(away.secret, call, {
      "X-Workspace-Id": owner.workspaceId,
    });
    assert(
      asked === 401 || asked === 403 || asked === 404,
      `${call.method} ${call.path} naming the other workspace answered ${asked}`,
    );
  }
  const awayList = await json(away.secret, {
    method: "GET",
    path: "/api/v1/journal",
  }, 200);
  assert(
    (awayList.items as unknown[]).length === 0,
    "a foreign token lists only its own workspace's journal",
  );
  const linkedAway = await sql<{ count: string }[]>`
    select count(*)::text as count from crm.journal_items
    where activity_id = ${activityId}::uuid`;
  assert(linkedAway[0]?.count === "0", "the foreign activity was not linked");
  assert(
    JSON.stringify(await journalItemIds(owner.workspaceId)) ===
        JSON.stringify(before.items) &&
      JSON.stringify(
          (await sql<{ updated_at: string }[]>`
            select updated_at::text from crm.life_events where id = ${lifeEvent.id}::uuid`)
            .map((row) => row.updated_at),
        ) === JSON.stringify(before.lifeEvents),
    "nothing in the other workspace changed",
  );
  const [stillThere] = await sql<{ body: string }[]>`
    select body from crm.journal_posts where id = ${postId}::uuid`;
  assert(stillThere?.body === "Private to Home", "the post is untouched");

  const home = await tokens.mint(owner, ["journal:read", "journal:write"]);
  const expired = await tokens.mint(owner, ["journal:read", "journal:write"]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second' where id = ${expired.record.id}::uuid`;
  const revoked = await tokens.mint(owner, ["journal:read", "journal:write"]);
  const revocation = await api.request(
    owner,
    `/api/v1/settings/api-tokens/${revoked.record.id}`,
    "DELETE",
  );
  assert(revocation.status === 200, `token revoked: ${revocation.status}`);
  await revocation.body?.cancel();
  for (const secret of [expired.secret, revoked.secret]) {
    for (
      const call of [
        { method: "GET", path: "/api/v1/journal" },
        {
          body: { body: "Late", occurredAt },
          method: "POST",
          path: "/api/v1/journal/posts",
        },
      ] satisfies Call[]
    ) {
      assert(
        await status(secret, call) === 401,
        `${call.method} ${call.path} refuses an expired or revoked token`,
      );
    }
  }
  assert(
    await status(home.secret, { method: "GET", path: "/api/v1/journal" }) ===
      200,
    "a current token of the workspace reads its journal",
  );

  for (
    const call of [
      { method: "GET", path: "/api/v1/journal" },
      { method: "GET", path: `/api/v1/journal/items/${postId}` },
      {
        body: { body: "Borrowed", occurredAt },
        method: "POST",
        path: "/api/v1/journal/posts",
      },
      {
        body: { name: "Borrowed", precision: "unknown" },
        method: "POST",
        path,
      },
    ] satisfies Call[]
  ) {
    const response = await suite.app.request(`http://localhost${call.path}`, {
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      headers: {
        authorization: "Bearer kin_pat_invalid",
        "content-type": "application/json",
        cookie: owner.cookie,
        origin: "http://localhost",
      },
      method: call.method,
    });
    await response.body?.cancel();
    assert(
      response.status === 401,
      `${call.method} ${call.path} with an invalid bearer borrowed the cookie: ${response.status}`,
    );
  }
  assert(
    JSON.stringify(await journalItemIds(owner.workspaceId)) ===
      JSON.stringify(before.items),
    "no refused request wrote a journal item",
  );
});

async function postRows(
  workspaceId: string,
  body: string,
): Promise<readonly { id: string }[]> {
  return await sql<{ id: string }[]>`
    select id::text from crm.journal_posts
    where workspace_id = ${workspaceId}::uuid and body = ${body}`;
}

async function browserJson(
  owner: SignedInFixture,
  call: Call,
  expected: number,
): Promise<Record<string, unknown>> {
  const response = await api.request(owner, call.path, call.method, call.body);
  const text = await response.text();
  assert(
    response.status === expected,
    `browser ${call.method} ${call.path}: ${response.status} ${text}`,
  );
  return JSON.parse(text);
}

Deno.test("[MCP-D4] PostgreSQL journal post creates are retry-safe by token and by cookie, and scoped to the workspace", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`journal-retry-${suffix}@example.test`, "Retry");
  const foreign = await register(
    `journal-retry-foreign-${suffix}@example.test`,
    "Foreign retry",
  );
  const writer = await tokens.mint(owner, ["journal:write"]);
  const foreignWriter = await tokens.mint(foreign, ["journal:write"]);
  const create = (body: Record<string, unknown>): Call => ({
    body,
    method: "POST",
    path: "/api/v1/journal/posts",
  });
  const post = {
    body: `Retried entry ${suffix}`,
    occurredAt,
    requestId: crypto.randomUUID(),
    title: "Retry",
  };
  const created = await json(writer.secret, create(post), 201);
  const replay = await json(writer.secret, create(post), 201);
  assert(
    JSON.stringify(replay) === JSON.stringify(created),
    `a retry returns the post it created: ${JSON.stringify(replay)}`,
  );
  assert(
    (await postRows(owner.workspaceId, post.body)).length === 1,
    "a retry creates no second post",
  );
  const conflict = await json(
    writer.secret,
    create({ ...post, title: "Another title" }),
    409,
  );
  assert(
    conflict.code === "journal_request_conflict",
    `conflict code: ${JSON.stringify(conflict)}`,
  );

  const cookiePost = {
    body: `Browser entry ${suffix}`,
    occurredAt,
    requestId: crypto.randomUUID(),
  };
  const byCookie = await browserJson(owner, create(cookiePost), 201);
  const cookieReplay = await browserJson(owner, create(cookiePost), 201);
  assert(
    (cookieReplay.post as { id: string }).id ===
      (byCookie.post as { id: string }).id,
    "a browser retry returns the post it created",
  );
  await browserJson(owner, create({ ...cookiePost, body: "Changed" }), 409);

  const concurrent = {
    body: `Concurrent entry ${suffix}`,
    occurredAt,
    requestId: crypto.randomUUID(),
  };
  const statuses = await Promise.all(
    Array.from(
      { length: 6 },
      () => status(writer.secret, create(concurrent)),
    ),
  );
  assert(
    statuses.every((value) => value === 201),
    `concurrent retries all succeed: ${statuses}`,
  );
  assert(
    (await postRows(owner.workspaceId, concurrent.body)).length === 1,
    "concurrent retries create one post",
  );

  const createdId = (created.post as { id: string }).id;
  const foreignCreated = await json(foreignWriter.secret, create(post), 201);
  const foreignId = (foreignCreated.post as { id: string }).id;
  assert(foreignId !== createdId, "request identifiers are workspace-scoped");
  const foreignRows = await postRows(foreign.workspaceId, post.body);
  assert(
    foreignRows.length === 1 && foreignRows[0]?.id === foreignId,
    "the foreign request created the foreign workspace's own post",
  );
  const ownRows = await postRows(owner.workspaceId, post.body);
  assert(
    ownRows.length === 1 && ownRows[0]?.id === createdId,
    "the foreign request never touched this workspace's post",
  );

  const plain = { body: `Plain entry ${suffix}`, occurredAt };
  await json(writer.secret, create(plain), 201);
  await json(writer.secret, create(plain), 201);
  assert(
    (await postRows(owner.workspaceId, plain.body)).length === 2,
    "without a request identifier each create is a new post",
  );

  // Schema v16 (MCP-E3): the delete leaves the post's request tombstone, so
  // a retry after it is refused rather than writing the post again.
  await json(writer.secret, {
    method: "DELETE",
    path: `/api/v1/journal/items/${createdId}`,
  }, 200);
  const [tombstone] = await sql<{ record_type: string }[]>`
    select record_type from crm.request_tombstones
    where workspace_id = ${owner.workspaceId}::uuid
      and record_id = ${createdId}::uuid`;
  assert(tombstone?.record_type === "journal_post", "the delete left one");
  const refused = await json(writer.secret, create(post), 409);
  assert(
    refused.code === "journal_request_deleted",
    `replay after delete: ${JSON.stringify(refused)}`,
  );
  await browserJson(owner, create(post), 409);
  assert(
    (await postRows(owner.workspaceId, post.body)).length === 0,
    "a retry after deletion writes nothing",
  );
  // The tombstone is this workspace's: the same key there still names the
  // foreign workspace's own post.
  await json(foreignWriter.secret, create(post), 201);
  // A plain post's id was never derived from a key, so its delete leaves no
  // tombstone (the adapter keeps only derived ids).
  const plainId = (await postRows(owner.workspaceId, plain.body))[0]!.id;
  await json(writer.secret, {
    method: "DELETE",
    path: `/api/v1/journal/items/${plainId}`,
  }, 200);
  const [plainTombstones] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.request_tombstones
    where record_id = ${plainId}::uuid`;
  assert(plainTombstones?.count === 0, "a random id leaves no tombstone");
});

/**
 * A delete and a replay of the create that made the post, queued on the
 * workspace row in both orders (MCP-E3): the replay that runs first returns
 * the post, which the delete then removes; the replay that runs second is
 * refused. Neither order writes the post again.
 */
Deno.test("[MCP-E3] PostgreSQL a journal delete racing its create's replay never records the post again", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`journal-race-${suffix}@example.test`, "Race");
  const writer = await tokens.mint(owner, ["journal:write"]);
  for (const first of ["delete", "replay"] as const) {
    const post = {
      body: `Raced entry ${first} ${suffix}`,
      occurredAt,
      requestId: crypto.randomUUID(),
    };
    const create: Call = {
      body: post,
      method: "POST",
      path: "/api/v1/journal/posts",
    };
    const created = await json(writer.secret, create, 201);
    const postId = (created.post as { id: string }).id;
    const remove: Call = {
      method: "DELETE",
      path: `/api/v1/journal/items/${postId}`,
    };
    const queue = await holdWorkspaceWrites(sql, owner.workspaceId);
    let deleted: Promise<number>;
    let replayed: Promise<Response>;
    try {
      if (first === "delete") {
        deleted = status(writer.secret, remove);
        await queue.queued(1);
        replayed = tokens.bearer(writer.secret, create.path, {
          body: create.body,
          method: create.method,
        });
        await queue.queued(2);
      } else {
        replayed = tokens.bearer(writer.secret, create.path, {
          body: create.body,
          method: create.method,
        });
        await queue.queued(1);
        deleted = status(writer.secret, remove);
        await queue.queued(2);
      }
    } finally {
      await queue.release();
    }
    const replay = await replayed!;
    const replayBody = await replay.json();
    assert(await deleted! === 200, `${first} first: the delete answered`);
    assert(
      first === "delete"
        ? replay.status === 409 &&
          replayBody.code === "journal_request_deleted"
        : replay.status === 201 && replayBody.post?.id === postId,
      `${first} first: ${replay.status} ${JSON.stringify(replayBody)}`,
    );
    assert(
      (await postRows(owner.workspaceId, post.body)).length === 0,
      `${first} first: the post was recorded again`,
    );
  }
});

Deno.test("[MCP-D4] PostgreSQL journal post updates refuse a stale expectedUpdatedAt by token and by cookie", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`journal-stale-${suffix}@example.test`, "Stale");
  const reader = await tokens.mint(owner, ["journal:read"]);
  const writer = await tokens.mint(owner, ["journal:write"]);
  const created = await json(writer.secret, {
    body: { body: "Draft", occurredAt },
    method: "POST",
    path: "/api/v1/journal/posts",
  }, 201);
  const postId = (created.post as { id: string }).id;
  const readRevision = async (): Promise<string> => {
    const item = await json(reader.secret, {
      method: "GET",
      path: `/api/v1/journal/items/${postId}`,
    }, 200);
    return (item.item as { post: { updatedAt: string } }).post.updatedAt;
  };
  const listed = await json(reader.secret, {
    method: "GET",
    path: "/api/v1/journal",
  }, 200);
  const listedPost = (listed.items as {
    post?: { id: string; updatedAt: string };
  }[]).find((item) => item.post?.id === postId);
  const revision = await readRevision();
  assert(
    listedPost?.post?.updatedAt === revision &&
      revision === (created.post as { updatedAt: string }).updatedAt,
    "the list, the item, and the create all expose one revision",
  );
  const put = (body: Record<string, unknown>): Call => ({
    body,
    method: "PUT",
    path: `/api/v1/journal/posts/${postId}`,
  });

  const fresh = await json(
    writer.secret,
    put({ body: "First edit", expectedUpdatedAt: revision, occurredAt }),
    200,
  );
  const next = (fresh.post as { updatedAt: string }).updatedAt;
  assert(next !== revision, "an edit issues a new revision");
  const stale = await json(
    writer.secret,
    put({ body: "Lost edit", expectedUpdatedAt: revision, occurredAt }),
    409,
  );
  assert(
    stale.code === "journal_post_stale",
    `stale: ${JSON.stringify(stale)}`,
  );
  await browserJson(
    owner,
    put({ body: "Lost by cookie", expectedUpdatedAt: revision, occurredAt }),
    409,
  );
  assert(await readRevision() === next, "a stale edit changes nothing");

  await browserJson(
    owner,
    put({ body: "Browser edit", expectedUpdatedAt: next, occurredAt }),
    200,
  );
  const unchecked = await json(
    writer.secret,
    put({ body: "Unchecked edit", occurredAt }),
    200,
  );
  assert(
    (unchecked.post as { body: string }).body === "Unchecked edit",
    "without expectedUpdatedAt the edit overwrites as before",
  );
  const missing = await json(writer.secret, {
    body: { body: "Nobody", expectedUpdatedAt: revision, occurredAt },
    method: "PUT",
    path: `/api/v1/journal/posts/${crypto.randomUUID()}`,
  }, 404);
  assert(
    missing.code === "journal_item_not_found",
    `a missing post is not stale: ${JSON.stringify(missing)}`,
  );
});

Deno.test({
  name: "close journal token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await suite.close();
  },
});
