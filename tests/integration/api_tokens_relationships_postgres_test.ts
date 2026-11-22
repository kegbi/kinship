/**
 * Relationship writes under a personal token (MCP-B3), through the deployment's
 * own composition over the disposable database.
 *
 * `relationships:write` admits creating, retyping, and unlinking an edge
 * between two active people of the token's one workspace. It grants no read,
 * and no other grant admits it; the related-person route, which also creates a
 * person, accepts no token at all.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import {
  type HttpMethod,
  ORIGIN,
  type SignedInFixture,
} from "../support/api.ts";
import { revokeMembership } from "../support/database.ts";
import { composeTokenSuite } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

interface Edge {
  readonly id: string;
  readonly relationshipTypeId: string;
  readonly updatedAt: string;
}

async function status(response: Response): Promise<number> {
  await response.body?.cancel();
  return response.status;
}

async function person(
  fixture: SignedInFixture,
  givenName: string,
): Promise<string> {
  const response = await api.request(fixture, "/api/v1/people", "POST", {
    givenName,
    isPartial: false,
  });
  assert(response.status === 201, `person ${givenName} created`);
  return (await response.json()).person.id;
}

async function typeIds(fixture: SignedInFixture): Promise<string[]> {
  const response = await api.request(fixture, "/api/v1/relationship-types");
  assert(response.status === 200, `types listed: ${response.status}`);
  const body = await response.json() as {
    readonly options: readonly { readonly id: string }[];
  };
  assert(body.options.length >= 2, "the default vocabulary has two types");
  return body.options.map((option) => option.id);
}

async function storedEdges(workspaceId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.relationships
    where workspace_id = ${workspaceId}::uuid`;
  return row?.count ?? -1;
}

Deno.test("[MCP-B3] PostgreSQL relationships:write creates, retypes, and unlinks edges in its one workspace", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`rel-token-${suffix}@example.test`, "Rel token");
  const foreign = await register(
    `rel-token-foreign-${suffix}@example.test`,
    "Foreign rel token",
  );
  const source = await person(own, "Ada");
  const target = await person(own, "Byron");
  const archived = await person(own, "Charles");
  const foreignPerson = await person(foreign, "Foreign secret");
  const [firstType, secondType] = await typeIds(own);
  const [foreignType] = await typeIds(foreign);
  assert(firstType && secondType && foreignType, "types resolved");

  const writer = await tokens.mint(own, ["relationships:write"]);
  const reader = await tokens.mint(own, ["relationships:read"]);
  const people = await tokens.mint(own, ["people:write"]);
  const foreignWriter = await tokens.mint(foreign, ["relationships:write"]);

  const root = `/api/v1/people/${source}/relationships`;
  const write = (
    secret: string,
    path: string,
    method: HttpMethod,
    body: unknown,
    headers: Record<string, string> = {},
  ) => tokens.bearer(secret, path, { body, headers, method });
  const listed = async () => {
    const response = await tokens.bearer(reader.secret, root);
    assert(response.status === 200, `edges read: ${response.status}`);
    return (await response.json()).relationships as readonly Edge[];
  };

  // Create, and a repeat that answers the stored edge.
  const createBody = {
    relationshipTypeId: firstType,
    targetPersonId: target,
  };
  const created = await write(writer.secret, root, "POST", createBody);
  assert(created.status === 201, `bearer create: ${created.status}`);
  const edge = (await created.json()).relationship as Edge;
  const repeated = await write(writer.secret, root, "POST", createBody);
  const repeatedBody = await repeated.json();
  assert(
    repeated.status === 200 && repeatedBody.status === "existing" &&
      repeatedBody.relationship.id === edge.id,
    `a repeated create answers the existing edge: ${repeated.status}`,
  );
  assert(await storedEdges(own.workspaceId) === 1, "one edge stored");
  assert(
    (await listed()).map((row) => row.id).join() === edge.id,
    "the created edge is readable",
  );

  // A grant of another kind never admits a write, and a write grant no read.
  const edgePath = `${root}/${edge.id}`;
  const writes: readonly [HttpMethod, string, unknown][] = [
    ["POST", root, createBody],
    ["PATCH", edgePath, {
      expectedUpdatedAt: edge.updatedAt,
      relationshipTypeId: secondType,
    }],
    ["DELETE", edgePath, { expectedUpdatedAt: edge.updatedAt }],
  ];
  for (const secret of [reader.secret, people.secret]) {
    for (const [method, path, body] of writes) {
      assert(
        await status(await write(secret, path, method, body)) === 401,
        `${method} refused without relationships:write`,
      );
    }
  }
  for (const path of [root, "/api/v1/relationship-types"]) {
    assert(
      await status(await tokens.bearer(writer.secret, path)) === 401,
      `${path} is not readable with relationships:write`,
    );
  }

  // A present invalid bearer never borrows the valid session cookie.
  for (const [method, path, body] of writes) {
    assert(
      await status(
        await write(reader.secret, path, method, body, {
          cookie: own.cookie,
          origin: ORIGIN,
        }),
      ) === 401,
      `${method} with a wrong-scope bearer and a cookie`,
    );
  }

  // Retype, with the stale version refused first.
  const stale = await write(writer.secret, edgePath, "PATCH", {
    expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    relationshipTypeId: secondType,
  });
  assert(await status(stale) === 409, "a stale retype conflicts");
  const retyped = await write(writer.secret, edgePath, "PATCH", {
    expectedUpdatedAt: edge.updatedAt,
    relationshipTypeId: secondType,
  });
  assert(retyped.status === 200, `bearer retype: ${retyped.status}`);
  const current = (await retyped.json()).relationship as Edge;
  assert(
    (await listed())[0]?.relationshipTypeId === secondType,
    "the new type is readable",
  );

  // Foreign workspaces: their token, their person, their type.
  for (const [method, path, body] of writes) {
    assert(
      await status(await write(foreignWriter.secret, path, method, body)) ===
        404,
      `${method} a foreign token cannot reach this workspace's ids`,
    );
    assert(
      await status(
        await write(foreignWriter.secret, path, method, body, {
          "X-Workspace-Id": own.workspaceId,
        }),
      ) === 401,
      `${method} a foreign token cannot name this workspace`,
    );
  }
  for (
    const body of [
      { relationshipTypeId: firstType, targetPersonId: foreignPerson },
      { relationshipTypeId: foreignType, targetPersonId: archived },
    ]
  ) {
    assert(
      await status(await write(writer.secret, root, "POST", body)) === 404,
      "an edge to a foreign person or with a foreign type",
    );
  }
  assert(
    await status(
      await write(writer.secret, edgePath, "PATCH", {
        expectedUpdatedAt: current.updatedAt,
        relationshipTypeId: foreignType,
      }),
    ) === 404,
    "a retype to a foreign type",
  );
  assert(
    await storedEdges(own.workspaceId) === 1 &&
      await storedEdges(foreign.workspaceId) === 0,
    "nothing was stored by a refused write",
  );

  // An archived person is read-only.
  const profile = await (await api.request(own, `/api/v1/people/${archived}`))
    .json();
  const archive = await api.request(
    own,
    `/api/v1/people/${archived}/archive`,
    "POST",
    { expectedUpdatedAt: profile.person.updatedAt },
  );
  assert(await status(archive) === 200, `person archived: ${archive.status}`);
  assert(
    await status(
      await write(writer.secret, root, "POST", {
        relationshipTypeId: firstType,
        targetPersonId: archived,
      }),
    ) === 409,
    "an edge to an archived person",
  );

  // Unlink, with the stale version refused first.
  assert(
    await status(
      await write(writer.secret, edgePath, "DELETE", {
        expectedUpdatedAt: edge.updatedAt,
      }),
    ) === 409,
    "a stale unlink conflicts",
  );
  const removed = await write(writer.secret, edgePath, "DELETE", {
    expectedUpdatedAt: current.updatedAt,
  });
  assert(removed.status === 200, `bearer unlink: ${removed.status}`);
  assert((await listed()).length === 0, "the unlinked edge is gone");

  // Every audit event the token's writes caused names the token.
  const audited = await sql<
    { action: string; api_token_id: string | null }[]
  >`select payload ->> 'action' as action,
      payload ->> 'apiTokenId' as api_token_id
    from crm.audit_events
    where workspace_id = ${own.workspaceId}::uuid
      and subject_id = ${edge.id}::uuid`;
  assert(
    audited.length >= 3 &&
      audited.every((row) => row.api_token_id === writer.record.id),
    `the token is named on each relationship event: ${JSON.stringify(audited)}`,
  );

  // A cookie client keeps its route, Origin included.
  const cookieEdge = await api.request(own, root, "POST", createBody);
  assert(cookieEdge.status === 201, `cookie create: ${cookieEdge.status}`);
  const cookieId = (await cookieEdge.json()).relationship.id as string;
  const [cookieAudit] = await sql<{ api_token_id: string | null }[]>`
    select payload ->> 'apiTokenId' as api_token_id from crm.audit_events
    where subject_id = ${cookieId}::uuid`;
  assert(
    cookieAudit && cookieAudit.api_token_id === null,
    "a cookie write names no token",
  );
  const noOrigin = await suite.app.request(`${ORIGIN}${root}`, {
    body: JSON.stringify(createBody),
    headers: { "content-type": "application/json", cookie: own.cookie },
    method: "POST",
  });
  assert(await status(noOrigin) === 403, "a cookie write still needs Origin");
});

Deno.test("[MCP-B3] PostgreSQL relationship writes refuse revoked, expired, and departed tokens, and the related-person route any bearer", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`rel-life-${suffix}@example.test`, "Rel life");
  const source = await person(own, "Ada");
  const target = await person(own, "Byron");
  const [typeId] = await typeIds(own);
  assert(typeId, "a type resolved");
  const root = `/api/v1/people/${source}/relationships`;
  const createBody = { relationshipTypeId: typeId, targetPersonId: target };

  const related = await tokens.mint(own, [
    "people:write",
    "relationships:write",
  ]);
  for (const headers of [{}, { origin: ORIGIN }]) {
    assert(
      [401, 403].includes(
        await status(
          await tokens.bearer(related.secret, `${root}/related-person`, {
            body: {
              person: { givenName: "Grace", isPartial: false },
              relationshipTypeId: typeId,
            },
            headers,
            method: "POST",
          }),
        ),
      ),
      "the related-person route accepts no token",
    );
  }
  const [people] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.people
    where workspace_id = ${own.workspaceId}::uuid`;
  assert(people?.count === 2, "no related person was created by a bearer");

  const revoked = await tokens.mint(own, ["relationships:write"]);
  const revoke = await api.request(
    own,
    `/api/v1/settings/api-tokens/${revoked.record.id}`,
    "DELETE",
  );
  assert(await status(revoke) === 200, "token revoked");
  const expired = await tokens.mint(own, ["relationships:write"]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 minute'
    where id = ${expired.record.id}::uuid`;
  for (const token of [revoked, expired]) {
    assert(
      await status(
        await tokens.bearer(token.secret, root, {
          body: createBody,
          headers: { cookie: own.cookie, origin: ORIGIN },
          method: "POST",
        }),
      ) === 401,
      "a revoked or expired token never borrows the cookie",
    );
  }
  assert(await storedEdges(own.workspaceId) === 0, "nothing was stored");

  const departed = await tokens.mint(own, ["relationships:write"]);
  await revokeMembership(sql, own.memberId);
  assert(
    await status(
      await tokens.bearer(departed.secret, root, {
        body: createBody,
        method: "POST",
      }),
    ) === 401,
    "a token acts only while its member does",
  );
});

Deno.test({
  name: "close relationship token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await suite.close();
  },
});
