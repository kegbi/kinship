/**
 * Personal tokens on a person's profile facts, important dates, and life-event
 * list (MCP-B2), through the deployment's own composition.
 *
 * A `people:write` token changes facts and dates through the people module's
 * use cases and nothing else: it reads nothing, it reaches no other
 * workspace's person, fact, date, or vocabulary, a stale revision is refused,
 * and every audit event it causes names it. The read grants it does not imply
 * keep their own routes, and a refused bearer never borrows the cookie.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import { ORIGIN, type SignedInFixture } from "../support/api.ts";
import { composeTokenSuite } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

type Method = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

interface FactRecord {
  readonly id: string;
  readonly updatedAt: string;
  readonly value: Readonly<Record<string, unknown>>;
}

interface FactSection {
  readonly personUpdatedAt: string;
  readonly records: readonly FactRecord[];
  readonly status: string;
}

interface DateRecord {
  readonly id: string;
  readonly month?: number;
  readonly updatedAt: string;
}

async function expect(
  response: Response,
  status: number,
  message: string,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  assert(
    response.status === status,
    `${message}: expected ${status}, received ${response.status} ${text}`,
  );
  return text ? JSON.parse(text) : {};
}

async function person(
  fixture: SignedInFixture,
  givenName: string,
): Promise<string> {
  const response = await api.request(fixture, "/api/v1/people", "POST", {
    givenName,
    isPartial: false,
  });
  assert(response.status === 201, "person created through the cookie route");
  return (await response.json()).person.id as string;
}

Deno.test("[MCP-B2] a people:write token changes profile facts and important dates and nothing it was not granted", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`profile-write-${suffix}@example.test`, "Own");
  const foreign = await register(
    `profile-write-foreign-${suffix}@example.test`,
    "Foreign",
  );
  const personId = await person(own, "Ada");
  const foreignPersonId = await person(foreign, "Foreign secret name");
  const [typeId, foreignTypeId, tagId, foreignTagId] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  await sql`insert into crm.contact_method_types (id, workspace_id, name, kind)
    values (${typeId}, ${own.workspaceId}, 'Connector email', 'email'),
      (${foreignTypeId}, ${foreign.workspaceId}, 'Foreign secret type', 'email')`;
  await sql`insert into crm.tags (id, workspace_id, name, slug)
    values (${tagId}, ${own.workspaceId}, 'Connector', 'connector'),
      (${foreignTagId}, ${foreign.workspaceId}, 'Foreign secret tag', 'foreign-secret-tag')`;

  const writer = await tokens.mint(own, ["people:write"]);
  const reader = await tokens.mint(own, ["people:profile:read"]);
  const directory = await tokens.mint(own, ["people:read"]);
  const foreignWriter = await tokens.mint(foreign, ["people:write"]);
  const send = (
    secret: string,
    path: string,
    method: Method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    tokens.bearer(secret, path, {
      method,
      ...(body === undefined ? {} : { body }),
      ...(headers ? { headers } : {}),
    });
  const root = `/api/v1/people/${personId}`;
  const section = async (name: string, ownerRoot = root) =>
    await expect(
      await send(reader.secret, `${ownerRoot}/facts/${name}`),
      200,
      `a people:profile:read token reads ${name}`,
    ) as unknown as FactSection;
  const dates = async () =>
    (await expect(
      await send(reader.secret, `${root}/dates`),
      200,
      "a people:profile:read token reads dates",
    )).dates as readonly DateRecord[];
  const rows = async () =>
    (await sql<{ readonly count: number }[]>`
      select ((select count(*) from crm.person_contact_methods where person_id = ${personId}::uuid)
        + (select count(*) from crm.person_tags where person_id = ${personId}::uuid)
        + (select count(*) from crm.people where id = ${personId}::uuid and food_preferences is not null)
        + (select count(*) from crm.person_dates where person_id = ${personId}::uuid))::int as count`)[
      0
    ]!.count;

  // A write grant reads nothing.
  for (
    const path of [
      `${root}/facts/contact-methods`,
      `${root}/facts/food-preferences`,
      `${root}/dates`,
      `${root}/life-events`,
    ]
  ) {
    await expect(
      await send(writer.secret, path),
      401,
      `people:write does not imply the read ${path}`,
    );
  }

  // A collection section: create, update, a stale revision, a foreign type.
  const initial = await section("contact-methods");
  const contact = {
    expectedPersonUpdatedAt: initial.personUpdatedAt,
    isPrimary: true,
    labelIds: [],
    section: "contact-methods",
    typeId,
    value: "ada@example.test",
  };
  const readOnlyWrites: [string, Method, unknown][] = [
    [`${root}/facts/contact-methods`, "POST", contact],
    [`${root}/facts/food-preferences`, "POST", {
      expectedPersonUpdatedAt: initial.personUpdatedAt,
      foodPreferences: "Tea",
      section: "food-preferences",
    }],
    [`${root}/dates`, "POST", {
      day: 10,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 12,
      precision: "month_day",
    }],
  ];
  for (const secret of [reader.secret, directory.secret]) {
    for (const [path, method, body] of readOnlyWrites) {
      await expect(
        await send(secret, path, method, body),
        401,
        `a read grant cannot ${method} ${path}`,
      );
    }
  }
  await expect(
    await send(writer.secret, `${root}/facts/contact-methods`, "POST", {
      ...contact,
      typeId: foreignTypeId,
    }),
    400,
    "another workspace's contact-method type is refused",
  );
  assert((await rows()) === 0, "no refused write changed anything");

  const created = await expect(
    await send(writer.secret, `${root}/facts/contact-methods`, "POST", contact),
    200,
    "a people:write bearer adds a contact method without Origin or cookie",
  ) as { personUpdatedAt: string; record: FactRecord };
  const afterCreate = await section("contact-methods");
  assert(
    afterCreate.records.length === 1 &&
      afterCreate.records[0]?.value.value === "ada@example.test",
    "the created fact is visible to a read token",
  );
  const updated = await expect(
    await send(
      writer.secret,
      `${root}/facts/contact-methods/${created.record.id}`,
      "PUT",
      {
        ...contact,
        expectedPersonUpdatedAt: created.personUpdatedAt,
        expectedUpdatedAt: created.record.updatedAt,
        id: created.record.id,
        value: "ada@analytical.test",
      },
    ),
    200,
    "a people:write bearer updates the contact method",
  ) as { personUpdatedAt: string; record: FactRecord };
  assert(
    (await section("contact-methods")).records[0]?.value.value ===
      "ada@analytical.test",
    "the update is visible to a read token",
  );
  await expect(
    await send(
      writer.secret,
      `${root}/facts/contact-methods/${created.record.id}`,
      "PUT",
      {
        ...contact,
        expectedPersonUpdatedAt: updated.personUpdatedAt,
        expectedUpdatedAt: created.record.updatedAt,
        id: created.record.id,
        value: "stale@example.test",
      },
    ),
    409,
    "a stale fact revision is refused",
  );

  // A singleton section: food preferences, whose one fact's id is the
  // person's; and tags, whose one fact always exists and is updated.
  const food = await expect(
    await send(writer.secret, `${root}/facts/food-preferences`, "POST", {
      expectedPersonUpdatedAt: updated.personUpdatedAt,
      foodPreferences: "Tea",
      section: "food-preferences",
    }),
    200,
    "a people:write bearer sets the food preferences",
  ) as { personUpdatedAt: string; record: FactRecord };
  assert(
    food.record.id === personId &&
      (await section("food-preferences")).records[0]?.value
          .foodPreferences === "Tea",
    "the singleton fact is visible to a read token",
  );
  const refood = await expect(
    await send(
      writer.secret,
      `${root}/facts/food-preferences/${personId}`,
      "PUT",
      {
        expectedPersonUpdatedAt: food.personUpdatedAt,
        expectedUpdatedAt: food.record.updatedAt,
        foodPreferences: "Tea; no shellfish",
        id: personId,
        section: "food-preferences",
      },
    ),
    200,
    "a people:write bearer updates the food preferences",
  ) as { personUpdatedAt: string; record: FactRecord };
  assert(
    (await section("food-preferences")).records[0]?.value.foodPreferences ===
      "Tea; no shellfish",
    "the singleton update is visible to a read token",
  );
  const tagSection = await section("tags");
  const tagFact = tagSection.records[0]!;
  assert(
    tagSection.personUpdatedAt === refood.personUpdatedAt,
    `the read and the write name one person revision: ${tagSection.personUpdatedAt} ${refood.personUpdatedAt} ${tagFact.updatedAt}`,
  );
  const tagUpdate = (tagIds: readonly string[]) => ({
    expectedPersonUpdatedAt: tagSection.personUpdatedAt,
    expectedUpdatedAt: tagFact.updatedAt,
    id: personId,
    section: "tags",
    tagIds,
  });
  const rowsBeforeTags = await rows();
  // The tag repository answers an unknown tag as a revision miss, as it does
  // for a cookie: refused, and nothing linked.
  const foreignTag = await expect(
    await send(
      writer.secret,
      `${root}/facts/tags/${personId}`,
      "PUT",
      tagUpdate([tagId, foreignTagId]),
    ),
    409,
    "another workspace's tag is refused",
  );
  assert(
    foreignTag.code === "profile_fact_stale" &&
      (await rows()) === rowsBeforeTags,
    "the foreign tag linked nothing",
  );
  await expect(
    await send(
      writer.secret,
      `${root}/facts/tags/${personId}`,
      "PUT",
      tagUpdate([tagId]),
    ),
    200,
    "a people:write bearer updates the tags",
  );
  assert(
    JSON.stringify((await section("tags")).records[0]?.value.tagIds) ===
      JSON.stringify([tagId]),
    "the tags are visible to a read token",
  );

  // An important date: create, update, a stale revision.
  const date = await expect(
    await send(writer.secret, `${root}/dates`, "POST", readOnlyWrites[2]![2]),
    201,
    "a people:write bearer adds an important date",
  ) as { date: DateRecord };
  assert(
    (await dates())[0]?.id === date.date.id,
    "the date is visible to a read token",
  );
  const redated = await expect(
    await send(writer.secret, `${root}/dates/${date.date.id}`, "PATCH", {
      ...readOnlyWrites[2]![2] as object,
      expectedUpdatedAt: date.date.updatedAt,
      month: 11,
    }),
    200,
    "a people:write bearer updates the important date",
  ) as { date: DateRecord };
  assert((await dates())[0]?.month === 11, "the date update is visible");
  await expect(
    await send(writer.secret, `${root}/dates/${date.date.id}`, "PATCH", {
      ...readOnlyWrites[2]![2] as object,
      expectedUpdatedAt: date.date.updatedAt,
      month: 10,
    }),
    409,
    "a stale date revision is refused",
  );

  // Another workspace's token, and this token on another workspace's ids.
  const foreignFact = await expect(
    await api.request(
      foreign,
      `/api/v1/people/${foreignPersonId}/facts/contact-methods`,
      "POST",
      {
        ...contact,
        expectedPersonUpdatedAt: (await expect(
          await api.request(
            foreign,
            `/api/v1/people/${foreignPersonId}/facts/contact-methods`,
          ),
          200,
          "the foreign owner reads their section",
        )).personUpdatedAt,
        typeId: foreignTypeId,
        value: "foreign-secret@example.test",
      },
    ),
    200,
    "the foreign owner adds their own fact",
  ) as { record: FactRecord };
  const foreignDate = await expect(
    await api.request(
      foreign,
      `/api/v1/people/${foreignPersonId}/dates`,
      "POST",
      readOnlyWrites[2]![2],
    ),
    201,
    "the foreign owner adds their own date",
  ) as { date: DateRecord };
  const before = await rows();
  const contactNow = (await section("contact-methods")).records[0]!;
  const personNow = (await section("contact-methods")).personUpdatedAt;
  // Each crossing answers as the owning use case answers a missing id: not
  // found, except a fact delete, which answers any miss as a revision miss.
  const contactDelete = (updatedAt: string) => ({
    expectedPersonUpdatedAt: personNow,
    expectedUpdatedAt: updatedAt,
    section: "contact-methods",
  });
  const crossings: [string, string, Method, unknown, number][] = [
    [foreignWriter.secret, `${root}/facts/contact-methods`, "POST", {
      ...contact,
      expectedPersonUpdatedAt: personNow,
    }, 404],
    [
      foreignWriter.secret,
      `${root}/facts/contact-methods/${contactNow.id}`,
      "DELETE",
      contactDelete(contactNow.updatedAt),
      404,
    ],
    [foreignWriter.secret, `${root}/dates/${date.date.id}`, "DELETE", {
      expectedUpdatedAt: redated.date.updatedAt,
    }, 404],
    [
      writer.secret,
      `/api/v1/people/${foreignPersonId}/facts/contact-methods/${foreignFact.record.id}`,
      "DELETE",
      contactDelete(foreignFact.record.updatedAt),
      404,
    ],
    [
      writer.secret,
      `${root}/facts/contact-methods/${foreignFact.record.id}`,
      "PUT",
      {
        ...contact,
        expectedPersonUpdatedAt: personNow,
        expectedUpdatedAt: foreignFact.record.updatedAt,
        id: foreignFact.record.id,
      },
      404,
    ],
    [
      writer.secret,
      `${root}/facts/contact-methods/${foreignFact.record.id}`,
      "DELETE",
      contactDelete(foreignFact.record.updatedAt),
      409,
    ],
    [
      writer.secret,
      `/api/v1/people/${foreignPersonId}/dates/${foreignDate.date.id}`,
      "DELETE",
      { expectedUpdatedAt: foreignDate.date.updatedAt },
      404,
    ],
    [writer.secret, `${root}/dates/${foreignDate.date.id}`, "DELETE", {
      expectedUpdatedAt: foreignDate.date.updatedAt,
    }, 404],
  ];
  for (const [secret, path, method, body, status] of crossings) {
    const response = await send(secret, path, method, body);
    const text = await response.text();
    assert(
      response.status === status && !text.includes("secret") &&
        !text.includes("ada@") && !text.includes("foreign-secret"),
      `${method} ${path} across workspaces answers ${status} without data: ${response.status} ${text}`,
    );
  }
  await expect(
    await send(
      foreignWriter.secret,
      `${root}/dates`,
      "POST",
      readOnlyWrites[2]![2],
      {
        "X-Workspace-Id": own.workspaceId,
      },
    ),
    401,
    "a token cannot select a workspace it is not bound to",
  );
  assert((await rows()) === before, "no crossing changed anything here");
  const [foreignRows] = await sql<{ readonly count: number }[]>`
    select ((select count(*) from crm.person_contact_methods where person_id = ${foreignPersonId}::uuid)
      + (select count(*) from crm.person_dates where person_id = ${foreignPersonId}::uuid))::int as count`;
  assert(foreignRows!.count === 2, "no crossing changed the other workspace");

  // A present invalid bearer never borrows a valid cookie and Origin.
  const borrowed = await send(
    "kin_pat_not-a-token",
    `${root}/dates/${date.date.id}`,
    "DELETE",
    { expectedUpdatedAt: redated.date.updatedAt },
    { cookie: own.cookie, origin: ORIGIN },
  );
  assert(
    borrowed.status === 401,
    "an invalid bearer is refused despite a cookie",
  );
  assert((await rows()) === before, "the refused bearer changed nothing");

  // Revoked and expired write tokens are refused.
  const revoked = await tokens.mint(own, ["people:write"]);
  await expect(
    await api.request(
      own,
      `/api/v1/settings/api-tokens/${revoked.record.id}`,
      "DELETE",
    ),
    200,
    "a token is revoked through its owning route",
  );
  const expired = await tokens.mint(own, ["people:write"]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second'
    where id = ${expired.record.id}::uuid`;
  for (const secret of [revoked.secret, expired.secret]) {
    await expect(
      await send(secret, `${root}/dates/${date.date.id}`, "DELETE", {
        expectedUpdatedAt: redated.date.updatedAt,
      }, { cookie: own.cookie }),
      401,
      "a revoked or expired bearer is refused and never borrows the cookie",
    );
  }
  assert((await rows()) === before, "refused tokens changed nothing");

  // Deletes, each visible to the read grant.
  await expect(
    await send(
      writer.secret,
      `${root}/facts/contact-methods/${contactNow.id}`,
      "DELETE",
      {
        expectedPersonUpdatedAt: personNow,
        expectedUpdatedAt: contactNow.updatedAt,
        section: "contact-methods",
      },
    ),
    200,
    "a people:write bearer deletes the contact method",
  );
  const afterDelete = await section("contact-methods");
  assert(afterDelete.records.length === 0, "the deletion is visible");
  const foodNow = await section("food-preferences");
  await expect(
    await send(
      writer.secret,
      `${root}/facts/food-preferences/${personId}`,
      "DELETE",
      {
        expectedPersonUpdatedAt: foodNow.personUpdatedAt,
        expectedUpdatedAt: foodNow.records[0]!.updatedAt,
        section: "food-preferences",
      },
    ),
    200,
    "a people:write bearer clears the food preferences",
  );
  assert(
    (await section("food-preferences")).records.length === 0,
    "the cleared singleton is visible",
  );
  // Tags always hold their one fact, so they are cleared, not deleted.
  const tagsNow = await section("tags");
  await expect(
    await send(writer.secret, `${root}/facts/tags/${personId}`, "PUT", {
      expectedPersonUpdatedAt: tagsNow.personUpdatedAt,
      expectedUpdatedAt: tagsNow.records[0]!.updatedAt,
      id: personId,
      section: "tags",
      tagIds: [],
    }),
    200,
    "a people:write bearer clears the tags",
  );
  assert(
    JSON.stringify((await section("tags")).records[0]?.value.tagIds) === "[]",
    "the cleared tags are visible",
  );
  await expect(
    await send(writer.secret, `${root}/dates/${date.date.id}`, "DELETE", {
      expectedUpdatedAt: redated.date.updatedAt,
    }),
    200,
    "a people:write bearer deletes the important date",
  );
  assert((await dates()).length === 0, "the date deletion is visible");

  // Every audit event a token write caused names the token; the cookie's none.
  const audits = await sql<{
    readonly action: string;
    readonly api_token_id: string | null;
  }[]>`select action, payload ->> 'apiTokenId' as api_token_id
    from crm.audit_events where person_id = ${personId}::uuid`;
  const byToken = audits.filter((row) =>
    row.action !== "people.person-created"
  );
  assert(
    byToken.length === 11 &&
      byToken.every((row) => row.api_token_id === writer.record.id),
    `every fact and date event names the token: ${JSON.stringify(audits)}`,
  );
  assert(
    audits.some((row) =>
      row.action === "people.person-created" && row.api_token_id === null
    ),
    "the cookie-created person's event names no token",
  );

  // Cookie clients keep the exact-Origin rule.
  const cookieCreate = await suite.app.request(`${ORIGIN}${root}/dates`, {
    body: JSON.stringify(readOnlyWrites[2]![2]),
    headers: {
      "content-type": "application/json",
      cookie: own.cookie,
      "X-Workspace-Id": own.workspaceId,
    },
    method: "POST",
  });
  assert(
    cookieCreate.status === 403,
    "a cookie write without Origin is refused",
  );
  await expect(
    await api.request(own, `${root}/dates`, "POST", readOnlyWrites[2]![2]),
    201,
    "a same-origin cookie write is unchanged",
  );
});

Deno.test("[MCP-B2] the life-event list answers a people:profile:read token alone", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`life-events-${suffix}@example.test`, "Own");
  const foreign = await register(
    `life-events-foreign-${suffix}@example.test`,
    "Foreign",
  );
  const personId = await person(own, "Ada");
  const foreignPersonId = await person(foreign, "Foreign secret name");
  await expect(
    await api.request(own, `/api/v1/people/${personId}/life-events`, "POST", {
      name: "Published Notes",
      precision: "year",
      year: 1843,
    }),
    201,
    "a life event recorded through the journal's cookie route",
  );
  const reader = await tokens.mint(own, ["people:profile:read"]);
  const directory = await tokens.mint(own, ["people:read"]);
  const writer = await tokens.mint(own, ["people:write"]);
  const path = `/api/v1/people/${personId}/life-events`;

  const listed = await expect(
    await tokens.bearer(reader.secret, path),
    200,
    "a people:profile:read token lists life events",
  ) as { events: readonly { name?: string }[]; status: string };
  assert(
    listed.status === "ready" && listed.events[0]?.name === "Published Notes",
    "the recorded event is listed",
  );
  for (const secret of [directory.secret, writer.secret, "kin_pat_forged"]) {
    await expect(
      await tokens.bearer(secret, path, { headers: { cookie: own.cookie } }),
      401,
      "another grant or an invalid bearer is refused despite the cookie",
    );
  }
  await expect(
    await tokens.bearer(
      reader.secret,
      `/api/v1/people/${foreignPersonId}/life-events`,
    ),
    404,
    "another workspace's person is not found",
  );
  await suite.close();
});
