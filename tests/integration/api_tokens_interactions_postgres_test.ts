/**
 * MCP-B4: personal tokens read interaction history and the two interaction
 * Today regions through the deployment's real composition.
 *
 * `interactions:read` admits a person's activity report and communication
 * history; `today:read` admits the favorite-note and recent-activity regions.
 * Each grant is independent: neither one, nor `interactions:create`, nor
 * `people:profile:read`, admits a route of another. A refused bearer never
 * borrows the cookie, and a token never reads another workspace's person.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import type { HttpMethod, SignedInFixture } from "../support/api.ts";
import { composeTokenSuite } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

interface Item {
  readonly body?: string;
  readonly content?: string;
  readonly id: string;
  readonly kind: string;
  readonly messages?: readonly { readonly content: string }[];
  readonly summary?: string;
  readonly title?: string;
}

interface Page {
  readonly items: readonly Item[];
  readonly nextCursor?: string;
}

async function expect(
  response: Response,
  status: number,
  label: string,
): Promise<Page> {
  const text = await response.text();
  assert(
    response.status === status,
    `${label}: expected ${status}, received ${response.status}: ${text}`,
  );
  return JSON.parse(text) as Page;
}

async function refused(response: Response, label: string): Promise<void> {
  await expect(response, 401, label);
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
): Promise<string> {
  const response = await api.request(fixture, "/api/v1/interactions", "POST", {
    ...input,
    requestId: crypto.randomUUID(),
  });
  assert(response.status === 201, `${input.kind} recorded: ${response.status}`);
  return (await response.json()).record.id as string;
}

Deno.test("[MCP-B4] PostgreSQL interaction history and Today reads admit only their own token grant", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`history-${suffix}@example.test`, "History API");
  const foreign = await register(
    `history-foreign-${suffix}@example.test`,
    "Foreign history",
  );
  const personId = await person(own, "Ada");
  const otherPersonId = await person(own, "Grace");
  await person(foreign, "Foreign person");
  const channelTypeId = crypto.randomUUID();
  await sql`insert into crm.contact_method_types (id, workspace_id, name)
    values (${channelTypeId}, ${own.workspaceId}, 'History email')`;

  const firstNoteId = await record(own, {
    body: `First history note ${suffix}`,
    isFavorited: true,
    kind: "note",
    personId,
  });
  const secondNoteId = await record(own, {
    body: `Second history note ${suffix}`,
    kind: "note",
    personId,
  });
  const activityId = await record(own, {
    description: "Together",
    happenedAt: "2026-10-24T18:00:00.000Z",
    kind: "activity",
    participantIds: [personId, otherPersonId],
    summary: `History dinner ${suffix}`,
  });
  const callId = await record(own, {
    calledAt: "2026-10-24T19:00:00.000Z",
    contactWasCaller: false,
    content: `History call ${suffix}`,
    kind: "call",
    personId,
  });
  const conversationId = await record(own, {
    channelTypeId,
    happenedAt: "2026-10-24T20:00:00.000Z",
    kind: "conversation",
    messages: [{
      content: `History message ${suffix}`,
      direction: "outbound",
      writtenAt: "2026-10-24T20:00:00.000Z",
    }],
    personId,
    title: `History conversation ${suffix}`,
  });

  const reader = await tokens.mint(own, ["interactions:read"]);
  const today = await tokens.mint(own, ["today:read"]);
  const capture = await tokens.mint(own, ["interactions:create"]);
  const profile = await tokens.mint(own, ["people:profile:read"]);
  const foreignReader = await tokens.mint(foreign, [
    "interactions:read",
    "today:read",
  ]);
  const send = (
    secret: string,
    path: string,
    method: HttpMethod = "GET",
    body?: unknown,
  ) => tokens.bearer(secret, path, { body, method });

  const report = `/api/v1/people/${personId}/activity-report`;
  const communications = `/api/v1/people/${personId}/communications`;
  const favorites = "/api/v1/today/favorite-notes";
  const recent = "/api/v1/today/recent-activity";

  // interactions:read reads the person's history, with its filters and paging.
  const all = await expect(
    await send(reader.secret, report),
    200,
    "report with interactions:read",
  );
  assert(
    [firstNoteId, secondNoteId, activityId].every((id) =>
      all.items.some((item) => item.id === id)
    ) && all.items.some((item) => item.summary === `History dinner ${suffix}`),
    "report returns the notes and the activity with their content",
  );
  const firstPage = await expect(
    await send(reader.secret, `${report}?kind=note&limit=1`),
    200,
    "first note page",
  );
  assert(
    firstPage.items.length === 1 && firstPage.items[0]?.kind === "note" &&
      firstPage.nextCursor !== undefined,
    "a bounded note page continues",
  );
  const cursor = encodeURIComponent(firstPage.nextCursor ?? "");
  const secondPage = await expect(
    await send(reader.secret, `${report}?kind=note&limit=1&cursor=${cursor}`),
    200,
    "second note page",
  );
  assert(
    secondPage.items.length === 1 && secondPage.items[0]?.kind === "note" &&
      secondPage.nextCursor === undefined &&
      new Set([firstPage.items[0]?.id, secondPage.items[0]?.id]).size === 2 &&
      [firstNoteId, secondNoteId].includes(secondPage.items[0]?.id ?? ""),
    "the continuation returns the other note and ends",
  );
  await expect(
    await send(
      reader.secret,
      `${report}?kind=activity&limit=1&cursor=${cursor}`,
    ),
    409,
    "a cursor stays bound to its filters",
  );
  const thisYear = await expect(
    await send(reader.secret, `${report}?kind=activity&year=2026`),
    200,
    "activity filter by year",
  );
  assert(
    thisYear.items.length === 1 && thisYear.items[0]?.id === activityId,
    "the year and kind filters return the one activity",
  );
  const otherYear = await expect(
    await send(reader.secret, `${report}?kind=activity&year=2025`),
    200,
    "activity filter by another year",
  );
  assert(otherYear.items.length === 0, "another year returns nothing");
  await expect(
    await send(reader.secret, `${report}?limit=51`),
    400,
    "the page size stays bounded",
  );
  const history = await expect(
    await send(reader.secret, communications),
    200,
    "communications with interactions:read",
  );
  const call = history.items.find((item) => item.id === callId);
  const conversation = history.items.find((item) => item.id === conversationId);
  assert(
    call?.content === `History call ${suffix}` &&
      conversation?.title === `History conversation ${suffix}` &&
      conversation.messages?.[0]?.content === `History message ${suffix}`,
    "communications return the call and the conversation with their content",
  );

  // today:read reads both Today regions.
  const favorite = await expect(
    await send(today.secret, favorites),
    200,
    "favorite notes with today:read",
  );
  assert(
    favorite.items.some((item) =>
      item.id === firstNoteId && item.body === `First history note ${suffix}`
    ) && !favorite.items.some((item) => item.id === secondNoteId),
    "favorite notes return the favorited note only",
  );
  const latest = await expect(
    await send(today.secret, recent),
    200,
    "recent activity with today:read",
  );
  assert(
    latest.items.some((item) => item.id === activityId),
    "recent activity returns the activity",
  );

  // Grants are independent.
  for (const token of [capture, profile]) {
    for (const path of [report, communications, favorites, recent]) {
      await refused(
        await send(token.secret, path),
        `${token.record.scopes.join()} on ${path}`,
      );
    }
  }
  for (const path of [favorites, recent]) {
    await refused(await send(reader.secret, path), `interactions:read ${path}`);
  }
  await refused(
    await send(reader.secret, "/api/v1/interactions", "POST", {
      body: "Denied",
      kind: "note",
      personId,
      requestId: crypto.randomUUID(),
    }),
    "interactions:read cannot capture",
  );
  for (
    const path of [
      "/api/v1/interaction-options",
      "/api/v1/communication-options",
    ]
  ) {
    await refused(await send(reader.secret, path), `interactions:read ${path}`);
  }
  for (const path of [report, communications]) {
    await refused(await send(today.secret, path), `today:read ${path}`);
  }

  // Revoked and expired tokens are refused.
  const revoked = await tokens.mint(own, ["interactions:read", "today:read"]);
  const revocation = await api.request(
    own,
    `/api/v1/settings/api-tokens/${revoked.record.id}`,
    "DELETE",
  );
  assert(revocation.status === 200, "token revoked through the owning route");
  const expired = await tokens.mint(own, ["interactions:read", "today:read"]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second'
    where id = ${expired.record.id}::uuid`;
  for (const token of [revoked, expired]) {
    for (const path of [report, communications, favorites, recent]) {
      await refused(await send(token.secret, path), `unusable token ${path}`);
    }
  }

  // Another workspace's token never reads this workspace's person.
  for (const path of [report, communications]) {
    const response = await send(foreignReader.secret, path);
    const text = await response.text();
    assert(
      response.status === 404 && !text.includes(suffix),
      `foreign token on ${path}: ${response.status} ${text}`,
    );
  }
  await expect(
    await send(
      foreignReader.secret,
      `/api/v1/people/${personId}/activity-report?kind=note&limit=1&cursor=${cursor}`,
    ),
    409,
    "a cursor stays bound to its workspace",
  );
  for (const path of [favorites, recent]) {
    const response = await send(foreignReader.secret, path);
    const text = await response.text();
    assert(
      response.status === 200 && !text.includes(suffix),
      `foreign Today ${path} holds none of this workspace's content`,
    );
  }
  await refused(
    await tokens.bearer(reader.secret, report, {
      headers: { "X-Workspace-Id": foreign.workspaceId },
    }),
    "a token cannot select another workspace",
  );

  // A present bearer never borrows the cookie; the cookie alone still reads.
  for (const path of [report, communications, favorites, recent]) {
    for (
      const authorization of [
        "Bearer kin_pat_invalid",
        `Bearer ${capture.secret}`,
        "Basic invalid",
      ]
    ) {
      await refused(
        await tokens.bearer(reader.secret, path, {
          headers: { authorization, cookie: own.cookie },
        }),
        `${authorization.split(" ")[0]} with a cookie on ${path}`,
      );
    }
    const cookie = await api.request(own, path);
    assert(cookie.status === 200, `cookie still reads ${path}`);
    await cookie.body?.cancel();
  }
});

Deno.test({
  name: "close MCP-B4 token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => suite.close(),
});
