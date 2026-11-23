/**
 * Personal tokens on the people-identity routes (MCP-B1), through the real
 * composition over the disposable database.
 *
 * Each grant family — `people:write`, `people:delete`, `people:merge`, the
 * `people:read` lookups, `search:read`, and `today:read` — is proven the same
 * way: the granted call works and its effect is visible to the member's
 * browser session; a token without the grant, one holding only the
 * neighbouring grant, a revoked one, and an expired one are refused, and a
 * refused bearer never borrows the session cookie sent beside it; another
 * workspace's token cannot reach this workspace's people; a bearer write's
 * audit events name the token. The destructive routes keep demanding what
 * they demand of a browser: deletion its confirmation and revision, a merge
 * its preview digest and both revisions.
 */

import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import type { HttpMethod, SignedInFixture } from "../support/api.ts";
import { composeTokenSuite, type MintedToken } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

/** What a request answered: its status and its parsed body, if any. */
interface Answer {
  // deno-lint-ignore no-explicit-any
  readonly body: any;
  readonly status: number;
}

async function answer(response: Response): Promise<Answer> {
  const text = await response.text();
  return { body: text ? JSON.parse(text) : undefined, status: response.status };
}

/** A bearer request: the token and nothing else, unless `headers` adds it. */
async function bearer(
  token: MintedToken | string,
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const secret = typeof token === "string" ? token : token.secret;
  return await answer(
    await tokens.bearer(secret, path, { body, headers, method }),
  );
}

/** A browser request: the session cookie, the workspace, and the Origin. */
async function browser(
  fixture: SignedInFixture,
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
): Promise<Answer> {
  return await answer(await api.request(fixture, path, method, body));
}

function expect(result: Answer, status: number, label: string): Answer {
  assert(
    result.status === status,
    `${label}: expected ${status}, received ${result.status} ${
      JSON.stringify(result.body)
    }`,
  );
  return result;
}

async function owner(label: string): Promise<SignedInFixture> {
  const suffix = crypto.randomUUID();
  const local = label.toLowerCase().replaceAll(" ", "-");
  return await register(`identity-${local}-${suffix}@example.test`, label);
}

async function person(
  fixture: SignedInFixture,
  givenName: string,
  familyName?: string,
): Promise<string> {
  const created = expect(
    await browser(fixture, "/api/v1/people", "POST", {
      duplicateOverride: true,
      ...(familyName ? { familyName } : {}),
      givenName,
      isPartial: false,
    }),
    201,
    `${givenName} created by the browser`,
  );
  return created.body.person.id as string;
}

/** The person's current revision, as the browser's own page reads it. */
async function revision(
  fixture: SignedInFixture,
  personId: string,
): Promise<string> {
  const read = expect(
    await browser(fixture, `/api/v1/people/${personId}`),
    200,
    "person read by the browser",
  );
  return read.body.person.updatedAt as string;
}

/**
 * The tokens every family is refused with beside its own grant: one with an
 * unrelated grant, the neighbouring grant, a revoked one, and an expired one.
 */
async function refusedTokens(
  fixture: SignedInFixture,
  scope: string,
  neighbour: string,
): Promise<readonly { readonly label: string; readonly secret: string }[]> {
  const missing = await tokens.mint(fixture, ["tasks:read"]);
  const neighbouring = await tokens.mint(fixture, [neighbour]);
  const revoked = await tokens.mint(fixture, [scope]);
  expect(
    await browser(
      fixture,
      `/api/v1/settings/api-tokens/${revoked.record.id}`,
      "DELETE",
    ),
    200,
    "token revoked through its owning route",
  );
  const expired = await tokens.mint(fixture, [scope]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second'
    where id = ${expired.record.id}::uuid`;
  return [
    { label: "a token without the grant", secret: missing.secret },
    { label: `a ${neighbour} token`, secret: neighbouring.secret },
    { label: "a revoked token", secret: revoked.secret },
    { label: "an expired token", secret: expired.secret },
    { label: "a malformed bearer", secret: "kin_pat_malformed" },
  ];
}

/** Every refused token is a 401, even with a valid session cookie beside it. */
async function refusedEverywhere(
  fixture: SignedInFixture,
  refused: readonly { readonly label: string; readonly secret: string }[],
  calls: readonly (readonly [HttpMethod, string, unknown?])[],
): Promise<void> {
  for (const { label, secret } of refused) {
    for (const [method, path, body] of calls) {
      expect(
        await bearer(secret, path, method, body, {
          cookie: fixture.cookie,
          origin: "http://localhost",
        }),
        401,
        `${method} ${path}: ${label} is refused and never borrows the cookie`,
      );
    }
  }
}

/** The audit events about `subjectId`, with the token each names. */
async function audited(
  workspaceId: string,
  subjectId: string,
): Promise<readonly { action: string; api_token_id: string | null }[]> {
  return await sql<{ action: string; api_token_id: string | null }[]>`
    select action, payload ->> 'apiTokenId' as api_token_id
    from crm.audit_events
    where workspace_id = ${workspaceId}::uuid
      and subject_id = ${subjectId}::uuid
    order by occurred_at`;
}

/**
 * The audit events `call` writes in the workspace, with the token each
 * names: every event that is new after it, whatever its subject.
 */
async function auditedBy(
  workspaceId: string,
  call: () => Promise<unknown>,
): Promise<readonly { action: string; api_token_id: string | null }[]> {
  const before = new Set(
    (await sql<{ id: string }[]>`select id::text from crm.audit_events
      where workspace_id = ${workspaceId}::uuid`).map((row) => row.id),
  );
  await call();
  const rows = await sql<
    { action: string; api_token_id: string | null; id: string }[]
  >`select id::text, action, payload ->> 'apiTokenId' as api_token_id
    from crm.audit_events where workspace_id = ${workspaceId}::uuid`;
  return rows.filter((row) => !before.has(row.id)).map((
    { action, api_token_id },
  ) => ({ action, api_token_id }));
}

Deno.test("[MCP-B1] PostgreSQL people:write creates, edits, archives, restores, stars, and bulk-acts as the token's member", async () => {
  const own = await owner("Writer");
  const foreign = await owner("Foreign writer");
  const writer = await tokens.mint(own, ["people:write"], { name: "Agent" });
  const foreignWriter = await tokens.mint(foreign, ["people:write"]);

  const created = expect(
    await bearer(writer, "/api/v1/people", "POST", {
      givenName: "Ada",
      isPartial: false,
    }),
    201,
    "a bearer creates a person without cookie or Origin",
  );
  const personId = created.body.person.id as string;
  let updatedAt = await revision(own, personId);
  const edited = expect(
    await bearer(writer, `/api/v1/people/${personId}`, "PATCH", {
      expectedUpdatedAt: updatedAt,
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    }),
    200,
    "a bearer edits the person",
  );
  expect(
    await bearer(writer, `/api/v1/people/${personId}`, "PATCH", {
      expectedUpdatedAt: updatedAt,
      givenName: "Stale",
      isPartial: false,
    }),
    409,
    "a bearer edit against an old revision is refused",
  );
  updatedAt = edited.body.person.updatedAt;
  expect(
    await bearer(writer, `/api/v1/people/${personId}/star`, "PUT"),
    200,
    "a bearer stars the person",
  );
  const page = await browser(own, `/api/v1/people/${personId}`);
  assertEquals(
    [page.body.person.familyName, page.body.person.isStarred],
    ["Lovelace", true],
    "the browser sees the token's edit and star",
  );
  expect(
    await bearer(writer, `/api/v1/people/${personId}/star`, "DELETE"),
    200,
    "a bearer unstars the person",
  );
  const archived = expect(
    await bearer(writer, `/api/v1/people/${personId}/archive`, "POST", {
      expectedUpdatedAt: updatedAt,
    }),
    200,
    "a bearer archives the person",
  );
  expect(
    await bearer(writer, `/api/v1/people/${personId}/restore`, "POST", {
      expectedUpdatedAt: archived.body.person.updatedAt,
    }),
    200,
    "a bearer restores the person",
  );
  const bulk = expect(
    await bearer(writer, "/api/v1/people/bulk", "POST", {
      action: "archive",
      personIds: [personId],
    }),
    200,
    "a bearer archives in bulk",
  );
  assertEquals(bulk.body.results[0]?.outcome, "done", "the bulk item is done");
  const [state] = await sql<{ archived: boolean }[]>`
    select archived_at is not null as archived from crm.people
    where id = ${personId}::uuid`;
  assert(state?.archived, "the bulk archive is stored");

  const events = await audited(own.workspaceId, personId);
  assert(
    events.length >= 5 &&
      events.every((event) => event.api_token_id === writer.record.id),
    `every audit event the token's writes caused names it: ${
      JSON.stringify(events)
    }`,
  );

  // Another workspace's token answers this workspace's person as missing.
  for (
    const [method, path, body] of [
      ["PATCH", `/api/v1/people/${personId}`, {
        expectedUpdatedAt: updatedAt,
        givenName: "Foreign",
        isPartial: false,
      }],
      ["PUT", `/api/v1/people/${personId}/star`],
      ["POST", `/api/v1/people/${personId}/restore`, {
        expectedUpdatedAt: updatedAt,
      }],
    ] as const
  ) {
    expect(
      await bearer(foreignWriter, path, method, body),
      404,
      `${method} ${path}: a foreign token finds no such person`,
    );
  }
  const foreignBulk = expect(
    await bearer(foreignWriter, "/api/v1/people/bulk", "POST", {
      action: "restore",
      personIds: [personId],
    }),
    200,
    "a foreign bulk request is answered per person",
  );
  assertEquals(
    [foreignBulk.body.results[0]?.outcome, foreignBulk.body.results[0]?.code],
    ["failed", "not_found"],
    "a foreign token's bulk item is not found",
  );
  expect(
    await bearer(foreignWriter, "/api/v1/people", "POST", {
      givenName: "Intruder",
      isPartial: false,
    }, { "X-Workspace-Id": own.workspaceId }),
    401,
    "a token cannot name another workspace",
  );
  const [stillArchived] = await sql<{ archived: boolean }[]>`
    select archived_at is not null as archived from crm.people
    where id = ${personId}::uuid`;
  assert(stillArchived?.archived, "the foreign token changed nothing");

  await refusedEverywhere(
    own,
    await refusedTokens(own, "people:write", "people:read"),
    [
      ["POST", "/api/v1/people", { givenName: "Refused", isPartial: false }],
      ["PATCH", `/api/v1/people/${personId}`, {
        expectedUpdatedAt: updatedAt,
        givenName: "Refused",
        isPartial: false,
      }],
      ["POST", `/api/v1/people/${personId}/archive`, {
        expectedUpdatedAt: updatedAt,
      }],
      ["POST", `/api/v1/people/${personId}/restore`, {
        expectedUpdatedAt: updatedAt,
      }],
      ["PUT", `/api/v1/people/${personId}/star`],
      ["DELETE", `/api/v1/people/${personId}/star`],
      ["POST", "/api/v1/people/bulk", {
        action: "restore",
        personIds: [personId],
      }],
    ],
  );

  // A browser keeps its rules: the exact Origin on a write.
  const noOrigin = await suite.app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({ givenName: "Cookie", isPartial: false }),
    headers: { "content-type": "application/json", cookie: own.cookie },
    method: "POST",
  });
  assertEquals(noOrigin.status, 403, "a cookie write without Origin");
  await noOrigin.body?.cancel();
  const cookieCreated = await person(own, "Cookie");
  const cookieEvents = await audited(own.workspaceId, cookieCreated);
  assert(
    cookieEvents.length > 0 &&
      cookieEvents.every((event) => event.api_token_id === null),
    "a cookie write names no token",
  );
});

Deno.test("[MCP-B1] PostgreSQL people:delete previews and deletes only with the confirmation and revision", async () => {
  const own = await owner("Deleter");
  const foreign = await owner("Foreign deleter");
  const deleter = await tokens.mint(own, ["people:delete"]);
  const foreignDeleter = await tokens.mint(foreign, ["people:delete"]);
  const personId = await person(own, "Grace", "Hopper");
  const impactPath = `/api/v1/people/${personId}/deletion-impact`;
  const impact = expect(
    await bearer(deleter, impactPath),
    200,
    "a bearer previews the deletion",
  );
  const confirmation = impact.body.impact.confirmation as string;
  const updatedAt = impact.body.impact.person.updatedAt as string;
  const remove = (body: unknown, token: MintedToken = deleter) =>
    bearer(token, `/api/v1/people/${personId}`, "DELETE", body);

  expect(
    await remove({ expectedUpdatedAt: updatedAt }),
    400,
    "a deletion without the confirmation is refused",
  );
  expect(
    await remove({ confirmation }),
    400,
    "a deletion without the revision is refused",
  );
  expect(
    await remove({
      confirmation: "Delete somebody",
      expectedUpdatedAt: updatedAt,
    }),
    400,
    "a deletion with the wrong confirmation is refused",
  );
  expect(
    await remove({
      confirmation,
      expectedUpdatedAt: "2000-01-01T00:00:00.000000Z",
    }),
    409,
    "a deletion against an old revision is refused",
  );
  expect(
    await bearer(
      foreignDeleter,
      impactPath,
    ),
    404,
    "a foreign token finds no such person to preview",
  );
  expect(
    await remove(
      { confirmation, expectedUpdatedAt: updatedAt },
      foreignDeleter,
    ),
    404,
    "a foreign token finds no such person to delete",
  );
  await refusedEverywhere(
    own,
    await refusedTokens(own, "people:delete", "people:write"),
    [
      ["GET", impactPath],
      ["DELETE", `/api/v1/people/${personId}`, {
        confirmation,
        expectedUpdatedAt: updatedAt,
      }],
    ],
  );
  expect(
    await browser(own, `/api/v1/people/${personId}`),
    200,
    "no refusal deleted the person",
  );

  const deletion = await auditedBy(own.workspaceId, async () =>
    expect(
      await remove({ confirmation, expectedUpdatedAt: updatedAt }),
      200,
      "a bearer deletes with the exact confirmation and revision",
    ));
  expect(
    await browser(own, `/api/v1/people/${personId}`),
    404,
    "the browser no longer finds the deleted person",
  );
  assert(
    deletion.length > 0 &&
      deletion.every((event) => event.api_token_id === deleter.record.id),
    `the deletion's audit events name the token: ${JSON.stringify(deletion)}`,
  );
});

Deno.test("[MCP-B1] PostgreSQL people:merge reviews, dismisses, previews, and merges against the digest and revisions", async () => {
  const own = await owner("Merger");
  const foreign = await owner("Foreign merger");
  const merger = await tokens.mint(own, ["people:merge"]);
  const foreignMerger = await tokens.mint(foreign, ["people:merge"]);
  const primaryId = await person(own, "Margaret", "Hamilton");
  const duplicateId = await person(own, "Margaret", "Hamilton");
  const alan = await person(own, "Alan", "Turing");
  const alanAgain = await person(own, "Alan", "Turing");
  await person(foreign, "Margaret", "Hamilton");
  await person(foreign, "Margaret", "Hamilton");
  const pairs = async (token: MintedToken) => {
    const listed = expect(
      await bearer(token, "/api/v1/people/duplicates"),
      200,
      "the duplicate review",
    );
    return (listed.body.pairs as { people: { id: string }[] }[]).map((pair) =>
      pair.people.map((entry) => entry.id).sort().join()
    );
  };
  const reviewed = await pairs(merger);
  assert(
    reviewed.includes([primaryId, duplicateId].sort().join()) &&
      reviewed.includes([alan, alanAgain].sort().join()),
    `a bearer lists the workspace's pairs: ${JSON.stringify(reviewed)}`,
  );
  assert(
    !(await pairs(foreignMerger)).some((pair) => pair.includes(primaryId)),
    "a foreign token never lists this workspace's people",
  );
  expect(
    await bearer(
      foreignMerger,
      "/api/v1/people/duplicates/dismissals",
      "POST",
      { personIds: [alan, alanAgain] },
    ),
    404,
    "a foreign token cannot dismiss this workspace's pair",
  );
  const dismissal = await auditedBy(own.workspaceId, async () =>
    expect(
      await bearer(merger, "/api/v1/people/duplicates/dismissals", "POST", {
        personIds: [alan, alanAgain],
      }),
      200,
      "a bearer dismisses a pair",
    ));
  assert(
    !(await pairs(merger)).includes([alan, alanAgain].sort().join()),
    "the dismissed pair is no longer offered",
  );

  const previewPath =
    `/api/v1/people/${primaryId}/merge-preview?duplicateId=${duplicateId}`;
  const preview = expect(
    await bearer(merger, previewPath),
    200,
    "a bearer previews the merge",
  );
  expect(
    await bearer(foreignMerger, previewPath),
    404,
    "a foreign token cannot preview this workspace's people",
  );
  const confirmed = {
    confirmed: true,
    conflictsDigest: preview.body.conflictsDigest,
    duplicateId,
    duplicateRevision: preview.body.duplicate.updatedAt,
    primaryRevision: preview.body.primary.updatedAt,
  };
  const mergePath = `/api/v1/people/${primaryId}/merge`;
  const { conflictsDigest: _digest, ...undigested } = confirmed;
  expect(
    await bearer(merger, mergePath, "POST", undigested),
    400,
    "a merge without the preview digest is refused",
  );
  const { primaryRevision: _revision, ...unrevised } = confirmed;
  expect(
    await bearer(merger, mergePath, "POST", unrevised),
    400,
    "a merge without both revisions is refused",
  );
  expect(
    await bearer(merger, mergePath, "POST", {
      ...confirmed,
      conflictsDigest: "0".repeat(64),
    }),
    409,
    "a merge against another digest is refused",
  );
  expect(
    await bearer(merger, mergePath, "POST", {
      ...confirmed,
      primaryRevision: "2000-01-01T00:00:00.000000Z",
    }),
    409,
    "a merge against an old revision is refused",
  );
  expect(
    await bearer(foreignMerger, mergePath, "POST", confirmed),
    404,
    "a foreign token cannot merge this workspace's people",
  );
  await refusedEverywhere(
    own,
    await refusedTokens(own, "people:merge", "people:write"),
    [
      ["GET", "/api/v1/people/duplicates"],
      ["POST", "/api/v1/people/duplicates/dismissals", {
        personIds: [primaryId, duplicateId],
      }],
      ["GET", previewPath],
      ["POST", mergePath, confirmed],
    ],
  );
  expect(
    await browser(own, `/api/v1/people/${duplicateId}`),
    200,
    "no refusal merged the duplicate",
  );

  const merged = await auditedBy(own.workspaceId, async () =>
    expect(
      await bearer(merger, mergePath, "POST", confirmed),
      200,
      "a bearer merges with the digest and both revisions",
    ));
  expect(
    await browser(own, `/api/v1/people/${duplicateId}`),
    404,
    "the browser no longer finds the merged duplicate",
  );
  for (
    const [label, events] of [["merge", merged], [
      "dismissal",
      dismissal,
    ]] as const
  ) {
    assert(
      events.length > 0 &&
        events.every((event) => event.api_token_id === merger.record.id),
      `the ${label}'s audit events name the token: ${JSON.stringify(events)}`,
    );
  }
});

Deno.test("[MCP-B1] PostgreSQL people:read lookups, search:read, and today:read answer only their own workspace", async () => {
  const own = await owner("Reader");
  const foreign = await owner("Foreign reader");
  const marker = `Zephyrine${crypto.randomUUID().slice(0, 8)}`;
  const personId = await person(own, marker);
  const foreignPersonId = await person(foreign, marker);
  const tag = async (fixture: SignedInFixture, name: string, id: string) => {
    const [row] = await sql<{ id: string }[]>`
      insert into crm.tags (workspace_id, name, slug)
      values (${fixture.workspaceId}, ${name}, ${name.toLowerCase()})
      returning id::text`;
    await sql`insert into crm.person_tags (person_id, tag_id, workspace_id)
      values (${id}, ${row!.id}, ${fixture.workspaceId})`;
    return row!.id;
  };
  const ownTag = await tag(own, `Own ${marker}`, personId);
  const foreignTag = await tag(foreign, `Foreign ${marker}`, foreignPersonId);
  expect(
    await browser(own, `/api/v1/people/${personId}/view`, "POST"),
    200,
    "the browser records a view",
  );
  expect(
    await browser(foreign, `/api/v1/people/${foreignPersonId}/view`, "POST"),
    200,
    "the foreign browser records a view",
  );

  const reader = await tokens.mint(own, ["people:read"]);
  const searcher = await tokens.mint(own, ["search:read"]);
  const today = await tokens.mint(own, ["today:read"]);
  const families = [
    {
      calls: [
        `/api/v1/people/tag-options?search=${marker}`,
        "/api/v1/people/tag-facet",
      ],
      neighbour: "people:profile:read",
      scope: "people:read",
      token: reader,
    },
    {
      calls: [`/api/v1/search?q=${marker}`],
      neighbour: "people:read",
      scope: "search:read",
      token: searcher,
    },
    {
      calls: ["/api/v1/today/recent-people"],
      neighbour: "people:read",
      scope: "today:read",
      token: today,
    },
  ];
  for (const family of families) {
    for (const path of family.calls) {
      const read = expect(
        await bearer(family.token, path),
        200,
        `${path}: ${family.scope} reads it`,
      );
      const text = JSON.stringify(read.body);
      assert(
        !text.includes(foreignPersonId) && !text.includes(foreignTag),
        `${path}: another workspace's rows never answer`,
      );
    }
    await refusedEverywhere(
      own,
      await refusedTokens(own, family.scope, family.neighbour),
      family.calls.map((path) => ["GET", path] as const),
    );
  }

  const options = await bearer(
    reader,
    `/api/v1/people/tag-options?search=${marker}`,
  );
  assert(
    JSON.stringify(options.body).includes(ownTag),
    "the tag options answer this workspace's tag",
  );
  const facet = await bearer(reader, "/api/v1/people/tag-facet");
  assert(
    JSON.stringify(facet.body).includes(ownTag),
    "the tag facet counts this workspace's tag",
  );
  const found = await bearer(searcher, `/api/v1/search?q=${marker}`);
  assert(
    found.body.groups[0].results.some((entry: { id: string }) =>
      entry.id === personId
    ),
    "the search finds this workspace's person",
  );
  const recent = await bearer(today, "/api/v1/today/recent-people");
  assert(
    recent.body.people.some((entry: { id: string }) => entry.id === personId),
    "the recent people are the token's member's views",
  );
  // Recording a view stays a browser write: Origin first, then the cookie.
  expect(
    await bearer(today, `/api/v1/people/${personId}/view`, "POST"),
    403,
    "a bearer cannot record a view without the browser's Origin",
  );
  expect(
    await bearer(today, `/api/v1/people/${personId}/view`, "POST", undefined, {
      origin: "http://localhost",
    }),
    401,
    "nor with it, since recording a view accepts no token",
  );
  expect(
    await bearer(searcher, `/api/v1/search?q=${marker}`, "GET", undefined, {
      "X-Workspace-Id": foreign.workspaceId,
    }),
    401,
    "a token cannot name another workspace",
  );
});

/** The rows a workspace holds under one identifier, deleted or not. */
async function peopleRows(
  workspaceId: string,
  personId: string,
): Promise<readonly { deleted: boolean; given_name: string }[]> {
  return await sql<{ deleted: boolean; given_name: string }[]>`
    select given_name, deleted_at is not null as deleted from crm.people
    where workspace_id = ${workspaceId}::uuid and id = ${personId}::uuid`;
}

async function peopleNamed(
  workspaceId: string,
  givenName: string,
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.people
    where workspace_id = ${workspaceId}::uuid and given_name = ${givenName}`;
  return row?.count ?? 0;
}

Deno.test("[MCP-D4] PostgreSQL createPerson with a requestId is retry-safe by token and by cookie", async () => {
  const own = await owner("Retrier");
  const writer = await tokens.mint(own, ["people:write"]);
  const grace = {
    familyName: "Hopper",
    givenName: "Grace",
    isPartial: false,
    requestId: crypto.randomUUID(),
  };
  const created = expect(
    await bearer(writer, "/api/v1/people", "POST", grace),
    201,
    "a bearer creates with a request identifier",
  );
  const personId = created.body.person.id as string;
  const replay = expect(
    await bearer(writer, "/api/v1/people", "POST", grace),
    201,
    "a bearer retry answers as the create did",
  );
  assertEquals(replay.body, created.body, "the retry returns the same person");
  assertEquals(
    await peopleNamed(own.workspaceId, "Grace"),
    1,
    "a retry creates no second person",
  );
  assertEquals(
    await peopleRows(own.workspaceId, personId),
    [{ given_name: "Grace", deleted: false }],
    "the one person is the one the request named",
  );
  const conflict = expect(
    await bearer(writer, "/api/v1/people", "POST", {
      ...grace,
      familyName: "Brewster",
    }),
    409,
    "the same request identifier with other names conflicts",
  );
  assertEquals(conflict.body.code, "person_request_conflict", "conflict code");

  const cookieRequest = {
    givenName: "Katherine",
    isPartial: false,
    requestId: crypto.randomUUID(),
  };
  const byCookie = expect(
    await browser(own, "/api/v1/people", "POST", cookieRequest),
    201,
    "a browser creates with a request identifier",
  );
  const cookieReplay = expect(
    await browser(own, "/api/v1/people", "POST", cookieRequest),
    201,
    "a browser retry answers as the create did",
  );
  assertEquals(
    cookieReplay.body.person.id,
    byCookie.body.person.id,
    "the browser retry returns the same person",
  );
  expect(
    await browser(own, "/api/v1/people", "POST", {
      ...cookieRequest,
      nickname: "Kat",
    }),
    409,
    "a browser reuse with other names conflicts",
  );

  const plain = { givenName: "Dorothy", isPartial: false };
  expect(
    await bearer(writer, "/api/v1/people", "POST", plain),
    201,
    "a create without a request identifier works as before",
  );
  expect(
    await bearer(writer, "/api/v1/people", "POST", plain),
    409,
    "and its repeat still meets the duplicate warning",
  );
  expect(
    await bearer(writer, "/api/v1/people", "POST", {
      ...plain,
      duplicateOverride: true,
    }),
    201,
    "and an override still creates a second person",
  );
  assertEquals(
    await peopleNamed(own.workspaceId, "Dorothy"),
    2,
    "without a request identifier each create is a new person",
  );
});

Deno.test("[MCP-D4] PostgreSQL concurrent retries of one person request create one person", async () => {
  const own = await owner("Racer");
  const writer = await tokens.mint(own, ["people:write"]);
  const body = {
    givenName: "Annie",
    isPartial: false,
    requestId: crypto.randomUUID(),
  };
  const answers = await Promise.all(
    Array.from(
      { length: 6 },
      () => bearer(writer, "/api/v1/people", "POST", body),
    ),
  );
  assertEquals(
    answers.map((result) => result.status),
    [201, 201, 201, 201, 201, 201],
    "every concurrent retry succeeds without a server error",
  );
  assertEquals(
    new Set(answers.map((result) => result.body.person.id)).size,
    1,
    "every concurrent retry names the same person",
  );
  assertEquals(
    await peopleNamed(own.workspaceId, "Annie"),
    1,
    "concurrent retries create one person",
  );
});

Deno.test("[MCP-D4] PostgreSQL a duplicate warning creates nothing and its override retry creates once", async () => {
  const own = await owner("Overrider");
  const writer = await tokens.mint(own, ["people:write"]);
  await person(own, "Mary", "Jackson");
  const request = {
    familyName: "Jackson",
    givenName: "Mary",
    isPartial: false,
    requestId: crypto.randomUUID(),
  };
  const warned = expect(
    await bearer(writer, "/api/v1/people", "POST", request),
    409,
    "a requested create still meets the duplicate warning",
  );
  assertEquals(warned.body.code, "possible_duplicate", "warning code");
  assertEquals(
    await peopleNamed(own.workspaceId, "Mary"),
    1,
    "the warning created nothing",
  );
  const overridden = expect(
    await bearer(writer, "/api/v1/people", "POST", {
      ...request,
      duplicateOverride: true,
    }),
    201,
    "the override retry with the same request identifier creates",
  );
  const retried = expect(
    await bearer(writer, "/api/v1/people", "POST", request),
    201,
    "the original request retried after the override returns its person",
  );
  assertEquals(
    retried.body.person.id,
    overridden.body.person.id,
    "duplicateOverride is not part of what a retry compares",
  );
  assertEquals(
    await peopleNamed(own.workspaceId, "Mary"),
    2,
    "the warned request created exactly one person",
  );
});

Deno.test("[MCP-D4] PostgreSQL a deleted person is never resurrected by a replay, and another workspace's request is its own", async () => {
  const own = await owner("Replayer");
  const foreign = await owner("Foreign replayer");
  const writer = await tokens.mint(own, ["people:write"]);
  const deleter = await tokens.mint(own, ["people:delete"]);
  const foreignWriter = await tokens.mint(foreign, ["people:write"]);
  const request = {
    givenName: "Hedy",
    isPartial: false,
    requestId: crypto.randomUUID(),
  };
  const created = expect(
    await bearer(writer, "/api/v1/people", "POST", request),
    201,
    "the request creates its person",
  );
  const personId = created.body.person.id as string;

  const foreignCreated = expect(
    await bearer(foreignWriter, "/api/v1/people", "POST", request),
    201,
    "another workspace's identical request creates its own person",
  );
  const foreignId = foreignCreated.body.person.id as string;
  assert(foreignId !== personId, "request identifiers are workspace-scoped");
  assertEquals(
    await peopleRows(foreign.workspaceId, foreignId),
    [{ given_name: "Hedy", deleted: false }],
    "the foreign person belongs to the foreign workspace",
  );
  assertEquals(
    await peopleRows(foreign.workspaceId, personId),
    [],
    "the foreign request never touched this workspace's person",
  );

  const impact = expect(
    await bearer(deleter, `/api/v1/people/${personId}/deletion-impact`),
    200,
    "the person's deletion is previewed",
  );
  expect(
    await bearer(deleter, `/api/v1/people/${personId}`, "DELETE", {
      confirmation: impact.body.impact.confirmation,
      expectedUpdatedAt: impact.body.impact.person.updatedAt,
    }),
    200,
    "the person is deleted",
  );
  const replay = expect(
    await bearer(writer, "/api/v1/people", "POST", request),
    409,
    "a replay after deletion is refused rather than recreating the person",
  );
  assertEquals(replay.body.code, "person_request_conflict", "replay code");
  assertEquals(
    await peopleRows(own.workspaceId, personId),
    [{ given_name: "Hedy", deleted: true }],
    "the deleted person stays deleted and is not duplicated",
  );
  expect(
    await bearer(foreignWriter, "/api/v1/people", "POST", request),
    201,
    "the foreign workspace's replay still returns its own person",
  );
});

Deno.test("[MCP-R3] PostgreSQL a person created with a requestId can be recorded for, related, starred, viewed, and listed", async () => {
  // A retry-safe create derives the person's version 8 identifier; every
  // path below used to refuse it with a version 1-5 check (MCP-R3).
  const own = await owner("Derived");
  const created = expect(
    await browser(own, "/api/v1/people", "POST", {
      familyName: "Derived",
      givenName: "Aaron",
      isPartial: false,
      requestId: crypto.randomUUID(),
    }),
    201,
    "a person is created with a request identifier",
  );
  const derived = created.body.person.id as string;
  assertEquals(derived[14], "8", "the person's identifier is a derived one");
  const beth = await person(own, "Beth");
  await person(own, "Cara");
  const channelTypeId = crypto.randomUUID();
  await sql`insert into crm.contact_method_types (id, workspace_id, name)
    values (${channelTypeId}, ${own.workspaceId}, 'Derived email')`;

  const recorded = (input: Record<string, unknown>, label: string) =>
    browser(own, "/api/v1/interactions", "POST", {
      ...input,
      requestId: crypto.randomUUID(),
    }).then((result) => expect(result, 201, label));
  const note = await recorded(
    { body: "Met at the library", kind: "note", personId: derived },
    "a note is recorded for the derived person",
  );
  const activity = await recorded({
    happenedAt: "2026-11-20T18:00:00.000Z",
    kind: "activity",
    participantIds: [beth],
    summary: "Dinner",
  }, "an activity is recorded");
  expect(
    await browser(
      own,
      `/api/v1/interactions/activity/${activity.body.record.id}`,
      "PATCH",
      {
        expectedUpdatedAt: activity.body.record.updatedAt,
        participantIds: [beth, derived],
      },
    ),
    200,
    "an activity is edited to name the derived person as a participant",
  );
  await recorded({
    happenedAt: "2026-11-20T19:00:00.000Z",
    kind: "activity",
    participantIds: [derived, beth],
    summary: "Concert",
  }, "an activity is recorded with the derived person as a participant");
  await recorded({
    calledAt: "2026-11-20T20:00:00.000Z",
    contactWasCaller: true,
    kind: "call",
    personId: derived,
  }, "a call is recorded for the derived person");
  await recorded({
    channelTypeId,
    happenedAt: "2026-11-20T21:00:00.000Z",
    kind: "conversation",
    messages: [{
      content: "Hello",
      direction: "outbound",
      writtenAt: "2026-11-20T21:00:00.000Z",
    }],
    personId: derived,
  }, "a conversation is recorded for the derived person");
  assert(note.body.record.id, "the note has an identifier");

  const types = expect(
    await browser(own, "/api/v1/relationship-types"),
    200,
    "relationship types are listed",
  );
  expect(
    await browser(own, `/api/v1/people/${derived}/relationships`, "POST", {
      relationshipTypeId: types.body.options[0].id,
      targetPersonId: beth,
    }),
    201,
    "the derived person is related to another",
  );
  expect(
    await browser(own, `/api/v1/people/${beth}/relationships`, "POST", {
      relationshipTypeId: types.body.options[0].id,
      targetPersonId: derived,
    }),
    201,
    "another person is related to the derived person",
  );
  expect(
    await browser(own, `/api/v1/people/${derived}/star`, "PUT"),
    200,
    "the derived person is starred",
  );
  expect(
    await browser(own, `/api/v1/people/${derived}/view`, "POST"),
    200,
    "a view of the derived person is recorded",
  );
  const recent = expect(
    await browser(own, "/api/v1/today/recent-people"),
    200,
    "Today lists recent people",
  );
  assertEquals(
    recent.body.people.map((entry: { id: string }) => entry.id),
    [derived],
    "Today's recent people include the derived person",
  );

  const first = expect(
    await browser(own, `/api/v1/people?limit=1&selectedPersonId=${derived}`),
    200,
    "the directory selects the derived person",
  );
  assertEquals(first.body.selected?.id, derived, "the selection is hydrated");
  assertEquals(first.body.people[0].id, derived, "the first page ends on it");
  const second = expect(
    await browser(
      own,
      `/api/v1/people?limit=1&selectedPersonId=${derived}&cursor=${first.body.nextCursor}`,
    ),
    200,
    "a cursor ending on the derived person resumes",
  );
  assertEquals(second.body.people[0].id, beth, "the next page follows it");
  const excluding = expect(
    await browser(own, `/api/v1/people?limit=1&excludePersonId=${derived}`),
    200,
    "the directory excludes the derived person",
  );
  expect(
    await browser(
      own,
      `/api/v1/people?limit=1&excludePersonId=${derived}&cursor=${excluding.body.nextCursor}`,
    ),
    200,
    "a cursor excluding the derived person resumes",
  );
});

Deno.test("[MCP-E1] PostgreSQL the create and identity answers carry the revision an edit, archive, and restore accept", async () => {
  const own = await owner("Revision");
  const agent = await tokens.mint(own, ["people:write", "people:profile:read"]);
  const ada = {
    familyName: "Lovelace",
    givenName: "Ada",
    isPartial: false,
    requestId: crypto.randomUUID(),
  };
  const created = expect(
    await bearer(agent, "/api/v1/people", "POST", ada),
    201,
    "a bearer creates a person",
  );
  const personId = created.body.person.id as string;
  const createdRevision = created.body.person.updatedAt as string;
  assertEquals(
    createdRevision,
    await revision(own, personId),
    "the create answers the stored revision, to the microsecond",
  );
  assertEquals(
    /\.\d{6}Z$/.test(createdRevision),
    true,
    `the revision is rendered with six fractional digits: ${createdRevision}`,
  );
  const { requestId: _requestId, ...names } = ada;
  const edited = expect(
    await bearer(agent, `/api/v1/people/${personId}`, "PATCH", {
      ...names,
      description: "First edit",
      expectedUpdatedAt: createdRevision,
    }),
    200,
    "the created revision is accepted by an edit as it was answered",
  );
  expect(
    await bearer(agent, `/api/v1/people/${personId}`, "PATCH", {
      ...names,
      description: "Stale edit",
      expectedUpdatedAt: createdRevision,
    }),
    409,
    "the created revision is stale once the person moved",
  );

  const read = expect(
    await bearer(agent, `/api/v1/people/${personId}/identity`),
    200,
    "the identity read answers",
  );
  assertEquals(
    read.body.person.updatedAt,
    edited.body.person.updatedAt,
    "the identity read answers the revision the edit left",
  );
  const reEdited = expect(
    await bearer(agent, `/api/v1/people/${personId}`, "PATCH", {
      ...names,
      description: "Second edit",
      expectedUpdatedAt: read.body.person.updatedAt,
    }),
    200,
    "the identity revision is accepted by an edit as it was answered",
  );

  const replay = expect(
    await bearer(agent, "/api/v1/people", "POST", ada),
    201,
    "a keyed retry answers as the create did",
  );
  assertEquals(replay.body.person.id, personId, "the retry names the person");
  assertEquals(
    replay.body.person.updatedAt,
    reEdited.body.person.updatedAt,
    "a keyed retry answers the person's current revision, not the first one",
  );
  const archived = expect(
    await bearer(agent, `/api/v1/people/${personId}/archive`, "POST", {
      expectedUpdatedAt: replay.body.person.updatedAt,
    }),
    200,
    "the replayed revision is accepted by an archive",
  );
  const archivedRead = expect(
    await bearer(agent, `/api/v1/people/${personId}/identity`),
    200,
    "an archived person's identity still answers",
  );
  assertEquals(archivedRead.body.status, "archived", "it says archived");
  assertEquals(
    archivedRead.body.person.updatedAt,
    archived.body.person.updatedAt,
    "and carries the revision the archive left",
  );
  expect(
    await bearer(agent, `/api/v1/people/${personId}/restore`, "POST", {
      expectedUpdatedAt: archivedRead.body.person.updatedAt,
    }),
    200,
    "the archived identity's revision is accepted by a restore",
  );

  const types = expect(
    await browser(own, "/api/v1/relationship-types"),
    200,
    "relationship types listed",
  );
  const related = expect(
    await browser(
      own,
      `/api/v1/people/${personId}/relationships/related-person`,
      "POST",
      {
        person: { givenName: "Byron", isPartial: false },
        relationshipTypeId: types.body.options[0].id,
      },
    ),
    201,
    "a related person is created",
  );
  expect(
    await bearer(agent, `/api/v1/people/${related.body.person.id}`, "PATCH", {
      expectedUpdatedAt: related.body.person.updatedAt,
      givenName: "Byron",
      isPartial: false,
      nickname: "George",
    }),
    200,
    "the related person's revision is accepted by an edit",
  );
});

Deno.test({
  name: "close the people-identity token fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await suite.close();
  },
});
