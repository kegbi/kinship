/**
 * Personal tokens over the workspace's vocabularies (MCP-B9), through the
 * deployment's composition and the disposable database.
 *
 * `vocabularies:read` lists a personalization section and `vocabularies:write`
 * changes one; neither implies the other. The sections are owned by several
 * modules, and the owner/admin rule stays in the use case, so a token acts with
 * its issuer's current role in its one bound workspace and never borrows the
 * cookie it travels beside. No other settings route admits either grant.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import type { HttpMethod, SignedInFixture } from "../support/api.ts";
import { addMembership } from "../support/database.ts";
import { composeTokenSuite } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

const BASE = "/api/v1/settings/personalization";

interface Call {
  readonly body?: unknown;
  readonly method: HttpMethod;
  readonly path: string;
}

interface Entry {
  readonly daysBefore?: number;
  readonly forwardLabel?: string;
  readonly id: string;
  readonly name: string;
  readonly referenceCount: number;
  readonly reverseLabel?: string;
  readonly updatedAt: string;
}

async function answer(
  secret: string,
  call: Call,
  headers?: Record<string, string>,
): Promise<
  { readonly body: Record<string, unknown>; readonly status: number }
> {
  const response = await tokens.bearer(secret, call.path, {
    ...(call.body === undefined ? {} : { body: call.body }),
    ...(headers ? { headers } : {}),
    method: call.method,
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : {}, status: response.status };
}

async function json(
  secret: string,
  call: Call,
  expected: number,
): Promise<Record<string, unknown>> {
  const answered = await answer(secret, call);
  assert(
    answered.status === expected,
    `${call.method} ${call.path}: ${answered.status} ${
      JSON.stringify(answered.body)
    }`,
  );
  return answered.body;
}

const list = (section: string): Call => ({
  method: "GET",
  path: `${BASE}/${section}`,
});

const revision = (entry: Entry) =>
  `expectedUpdatedAt=${encodeURIComponent(entry.updatedAt)}`;

/** The four vocabulary routes, aimed at one tag. */
function vocabularyCalls(tag: Entry): Call[] {
  return [
    list("tags"),
    { body: { name: "Refused" }, method: "POST", path: `${BASE}/tags` },
    {
      body: { expectedUpdatedAt: tag.updatedAt, name: "Refused" },
      method: "PATCH",
      path: `${BASE}/tags/${tag.id}`,
    },
    { method: "DELETE", path: `${BASE}/tags/${tag.id}?${revision(tag)}` },
  ];
}

async function createTag(owner: SignedInFixture, name: string): Promise<Entry> {
  const response = await api.request(owner, `${BASE}/tags`, "POST", { name });
  assert(response.status === 200, `cookie tag created: ${response.status}`);
  return (await response.json()).entry as Entry;
}

async function tagRows(workspaceId: string): Promise<string[]> {
  const rows = await sql<{ name: string; updated_at: string }[]>`
    select name, updated_at::text from crm.tags
    where workspace_id = ${workspaceId}::uuid order by name`;
  return rows.map((row) => `${row.name}@${row.updated_at}`);
}

async function personalizationEvents(
  workspaceId: string,
): Promise<{ api_token_id: string | null; operation: string }[]> {
  return await sql<{ api_token_id: string | null; operation: string }[]>`
    select payload ->> 'apiTokenId' as api_token_id,
      payload ->> 'action' as operation
    from crm.audit_events
    where workspace_id = ${workspaceId}::uuid
      and action = 'workspace-personalization-updated'
    order by created_at, id`;
}

Deno.test("[MCP-B9] PostgreSQL vocabulary grants read every owner's sections and write tags independently", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`vocab-token-${suffix}@example.test`, "Words");
  const reader = await tokens.mint(owner, ["vocabularies:read"]);
  const writer = await tokens.mint(owner, ["vocabularies:write"]);
  const peopleRead = await tokens.mint(owner, ["people:read"]);
  const peopleWrite = await tokens.mint(owner, ["people:write"]);

  for (const section of ["tags", "relationship-types", "reminder-rules"]) {
    const listed = await json(reader.secret, list(section), 200);
    assert(
      listed.section === section && Array.isArray(listed.entries),
      `${section} lists for vocabularies:read: ${JSON.stringify(listed)}`,
    );
  }
  const relationships = (await json(
    reader.secret,
    list("relationship-types"),
    200,
  )).entries as Entry[];
  assert(
    relationships.length > 0 &&
      relationships.every((entry) => entry.forwardLabel && entry.reverseLabel),
    "relationship types read with their two labels, from the relationships owner",
  );
  const reminderRules = (await json(
    reader.secret,
    list("reminder-rules"),
    200,
  )).entries as Entry[];
  assert(
    reminderRules.every((entry) => typeof entry.daysBefore === "number"),
    "reminder rules read with their lead time, from the planning owner",
  );

  const created = (await json(writer.secret, {
    body: { name: "Neighbours" },
    method: "POST",
    path: `${BASE}/tags`,
  }, 200)).entry as Entry;
  const replacement = (await json(writer.secret, {
    body: { name: "Friends" },
    method: "POST",
    path: `${BASE}/tags`,
  }, 200)).entry as Entry;
  const renamed = (await json(writer.secret, {
    body: { expectedUpdatedAt: created.updatedAt, name: "Close neighbours" },
    method: "PATCH",
    path: `${BASE}/tags/${created.id}`,
  }, 200)).entry as Entry;
  assert(renamed.name === "Close neighbours", "the tag was renamed");
  const stale = await answer(writer.secret, {
    body: { expectedUpdatedAt: created.updatedAt, name: "Stale" },
    method: "PATCH",
    path: `${BASE}/tags/${created.id}`,
  });
  assert(
    stale.status === 409 && stale.body.code === "personalization_stale",
    `a stale revision is refused: ${JSON.stringify(stale)}`,
  );

  const person = await api.request(owner, "/api/v1/people", "POST", {
    givenName: "Ada",
    isPartial: false,
  });
  assert(person.status === 201, `person created: ${person.status}`);
  const personId = (await person.json()).person.id as string;
  await sql`insert into crm.person_tags (person_id, tag_id, workspace_id)
    values (${personId}, ${created.id}, ${owner.workspaceId})`;

  const required = await answer(writer.secret, {
    method: "DELETE",
    path: `${BASE}/tags/${created.id}?${revision(renamed)}`,
  });
  assert(
    required.status === 409 &&
      required.body.code === "personalization_replacement_required" &&
      String(required.body.detail).startsWith("1 references"),
    `a referenced tag needs a replacement: ${JSON.stringify(required)}`,
  );
  const deleted = await json(writer.secret, {
    method: "DELETE",
    path: `${BASE}/tags/${created.id}?${
      revision(renamed)
    }&replacementId=${replacement.id}`,
  }, 200);
  assert(deleted.id === created.id, "the tag was deleted");
  const assigned = await sql<{ tag_id: string }[]>`
    select tag_id::text from crm.person_tags where person_id = ${personId}::uuid`;
  assert(
    JSON.stringify(assigned.map((row) => row.tag_id)) ===
      JSON.stringify([replacement.id]),
    "the person moved to the replacement tag",
  );
  const tagsRead = (await json(reader.secret, list("tags"), 200))
    .entries as Entry[];
  assert(
    tagsRead.length === 1 && tagsRead[0]?.id === replacement.id &&
      tagsRead[0].referenceCount === 1,
    `the reader sees the remaining tag in use: ${JSON.stringify(tagsRead)}`,
  );

  const before = await tagRows(owner.workspaceId);
  const eventsBefore = (await personalizationEvents(owner.workspaceId)).length;
  const [read, ...writes] = vocabularyCalls(replacement);
  for (const call of writes) {
    for (
      const secret of [reader.secret, peopleRead.secret, peopleWrite.secret]
    ) {
      assert(
        (await answer(secret, call)).status === 401,
        `${call.method} ${call.path} refuses a token without vocabularies:write`,
      );
    }
  }
  for (const secret of [writer.secret, peopleRead.secret, peopleWrite.secret]) {
    assert(
      (await answer(secret, read!)).status === 401,
      "the read refuses a token without vocabularies:read",
    );
  }
  for (
    const path of [
      "/api/v1/settings/members",
      "/api/v1/settings/workspace",
      "/api/v1/settings/preferences",
      "/api/v1/settings/profile",
      "/api/v1/settings/sessions",
      "/api/v1/settings/api-tokens",
      "/api/v1/member/ui-state",
    ]
  ) {
    for (const secret of [reader.secret, writer.secret]) {
      assert(
        (await answer(secret, { method: "GET", path })).status === 401,
        `${path} stays session-only for vocabulary tokens`,
      );
    }
  }
  const settingsWrite = (await answer(writer.secret, {
    body: { defaultLocale: "en", defaultReminderTime: "09:00", name: "Taken" },
    method: "PUT",
    path: "/api/v1/settings/workspace",
  })).status;
  const [workspace] = await sql<{ name: string }[]>`
    select name from crm.workspaces where id = ${owner.workspaceId}::uuid`;
  assert(
    (settingsWrite === 401 || settingsWrite === 403) &&
      workspace?.name === "Words",
    `a vocabulary token cannot change the workspace settings: ${settingsWrite}`,
  );
  assert(
    JSON.stringify(await tagRows(owner.workspaceId)) ===
        JSON.stringify(before) &&
      (await personalizationEvents(owner.workspaceId)).length === eventsBefore,
    "a refused request changed nothing",
  );

  const events = await personalizationEvents(owner.workspaceId);
  assert(
    JSON.stringify(events.map((event) => event.operation)) ===
        JSON.stringify(["create", "create", "update", "delete"]) &&
      events.every((event) => event.api_token_id === writer.record.id),
    `each bearer write's audit event names the token: ${
      JSON.stringify(events)
    }`,
  );
});

Deno.test("[MCP-B9] PostgreSQL a vocabulary token answers to its issuer's current role", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`vocab-owner-${suffix}@example.test`, "Roles");
  const identity = await register(
    `vocab-admin-${suffix}@example.test`,
    "Admin home",
  );
  const memberId = await addMembership(
    sql,
    identity.userId,
    owner.workspaceId,
    "admin",
  );
  const admin: SignedInFixture = {
    ...identity,
    memberId,
    role: "admin",
    workspaceId: owner.workspaceId,
  };
  const token = await tokens.mint(admin, [
    "vocabularies:read",
    "vocabularies:write",
  ]);
  const tag = await createTag(owner, "Colleagues");
  assert(
    (await answer(token.secret, list("tags"))).status === 200,
    "an admin's vocabulary token lists the workspace's tags",
  );

  const demoted = await api.request(
    owner,
    `/api/v1/settings/members/${admin.memberId}`,
    "PATCH",
    { role: "member", status: "active" },
  );
  assert(demoted.status === 200, `the owner demotes the admin`);
  await demoted.body?.cancel();
  const before = await tagRows(owner.workspaceId);
  const eventsBefore = (await personalizationEvents(owner.workspaceId)).length;
  const cookie = await api.request(admin, `${BASE}/tags`);
  const cookieCode = (await cookie.json()).code;
  assert(
    cookie.status === 403 && cookieCode === "personalization_forbidden",
    `a member's cookie is forbidden: ${cookie.status} ${cookieCode}`,
  );
  for (const call of vocabularyCalls(tag)) {
    const refused = await answer(token.secret, call);
    assert(
      refused.status === 403 && refused.body.code === cookieCode,
      `${call.method} ${call.path} answers the demoted issuer as a member: ${
        JSON.stringify(refused)
      }`,
    );
  }
  assert(
    JSON.stringify(await tagRows(owner.workspaceId)) ===
        JSON.stringify(before) &&
      (await personalizationEvents(owner.workspaceId)).length === eventsBefore,
    "a demoted issuer's token changed nothing",
  );
});

Deno.test("[MCP-B9] PostgreSQL vocabulary tokens stay in their workspace and never borrow a cookie", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`vocab-home-${suffix}@example.test`, "Home");
  const foreign = await register(`vocab-away-${suffix}@example.test`, "Away");
  const tag = await createTag(owner, "Family");
  const awayTag = await createTag(foreign, "Travel");
  const away = await tokens.mint(foreign, [
    "vocabularies:read",
    "vocabularies:write",
  ]);
  const before = {
    away: await tagRows(foreign.workspaceId),
    home: await tagRows(owner.workspaceId),
  };

  const awayList = (await json(away.secret, list("tags"), 200))
    .entries as Entry[];
  assert(
    JSON.stringify(awayList.map((entry) => entry.id)) ===
      JSON.stringify([awayTag.id]),
    "a foreign token lists only its own workspace's tags",
  );
  for (const call of vocabularyCalls(tag).slice(2)) {
    const answered = await answer(away.secret, call);
    assert(
      answered.status === 404,
      `${call.method} ${call.path} by a foreign token answered ${answered.status}`,
    );
  }
  for (const call of vocabularyCalls(tag)) {
    const asked = (await answer(away.secret, call, {
      "X-Workspace-Id": owner.workspaceId,
    })).status;
    assert(
      asked === 401 || asked === 403 || asked === 404,
      `${call.method} ${call.path} naming the other workspace answered ${asked}`,
    );
  }
  const borrowed = await answer(away.secret, {
    method: "DELETE",
    path: `${BASE}/tags/${awayTag.id}?${
      revision(awayTag)
    }&replacementId=${tag.id}`,
  });
  assert(
    borrowed.status === 404,
    `another workspace's tag is no replacement: ${JSON.stringify(borrowed)}`,
  );
  assert(
    JSON.stringify(await tagRows(owner.workspaceId)) ===
        JSON.stringify(before.home) &&
      JSON.stringify(await tagRows(foreign.workspaceId)) ===
        JSON.stringify(before.away),
    "nothing in either workspace changed",
  );

  const expired = await tokens.mint(owner, [
    "vocabularies:read",
    "vocabularies:write",
  ]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second' where id = ${expired.record.id}::uuid`;
  const revoked = await tokens.mint(owner, [
    "vocabularies:read",
    "vocabularies:write",
  ]);
  const revocation = await api.request(
    owner,
    `/api/v1/settings/api-tokens/${revoked.record.id}`,
    "DELETE",
  );
  assert(revocation.status === 200, `token revoked: ${revocation.status}`);
  await revocation.body?.cancel();
  for (const secret of [expired.secret, revoked.secret]) {
    for (const call of vocabularyCalls(tag)) {
      assert(
        (await answer(secret, call)).status === 401,
        `${call.method} ${call.path} refuses an expired or revoked token`,
      );
    }
  }

  for (const call of vocabularyCalls(tag)) {
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
    JSON.stringify(await tagRows(owner.workspaceId)) ===
      JSON.stringify(before.home),
    "no refused request changed a tag",
  );
});

Deno.test({
  name: "close vocabulary token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await suite.close();
  },
});
