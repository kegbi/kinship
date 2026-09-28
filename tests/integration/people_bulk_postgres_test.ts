/**
 * Bulk directory actions against PostgreSQL (GAP-051, PEOPLE-009).
 *
 * Each person in a bulk action runs through the single-person use case in its
 * own transaction. These suites prove what the unit suites cannot: that each
 * item writes and audits exactly as the single action would, that one refused
 * person leaves the others done, that a repeat is `unchanged`, that another
 * workspace's people and tags never leak, that a removed member is refused,
 * that the request cap holds, and that the selection vCard holds the right
 * cards and counts who was skipped.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revokeMembership,
} from "../support/database.ts";
import {
  apiSupport,
  ORIGIN,
  type SignedInFixture,
  workspaceHeaders,
} from "../support/api.ts";
import { createBulkPeopleActions } from "../../packages/backend/modules/people/public.ts";
import { PostgresBulkTagLookup } from "../../packages/backend/modules/people/adapters/postgres/bulk_tag_lookup.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
import { createBulkRoutes } from "../../packages/backend/modules/people/transport/http/bulk.ts";
import { workspaceActors } from "../../packages/backend/modules/workspaces/composition.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { createPerson } from "../support/fixtures.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
);
const api = apiSupport(configured.app, mail, sql);

interface BulkAnswer {
  readonly action: string;
  readonly results: readonly {
    readonly code?: string;
    readonly outcome: string;
    readonly personId: string;
  }[];
  readonly summary: Readonly<Record<string, number>>;
}

function register(label: string): Promise<SignedInFixture> {
  return api.register(
    `bulk-${label}-${crypto.randomUUID()}@example.test`,
    `Bulk ${label}`,
  );
}

function person(owner: SignedInFixture, name: string): Promise<string> {
  const [givenName, familyName] = name.split(" ");
  return createPerson(api, owner, {
    duplicateOverride: true,
    ...(familyName ? { familyName } : {}),
    givenName,
    isPartial: false,
  });
}

async function tag(owner: SignedInFixture, name: string): Promise<string> {
  const [row] = await sql<{ readonly id: string }[]>`
    insert into crm.tags (workspace_id, name, slug)
    values (${owner.workspaceId}, ${name}, ${name.toLowerCase()})
    returning id::text
  `;
  return row!.id;
}

function bulk(
  owner: SignedInFixture,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  return api.request(owner, "/api/v1/people/bulk", "POST", body);
}

async function answered(
  owner: SignedInFixture,
  body: Readonly<Record<string, unknown>>,
): Promise<BulkAnswer> {
  const response = await bulk(owner, body);
  assertEquals(response.status, 200, await response.clone().text());
  return await response.json() as BulkAnswer;
}

function outcomes(answer: BulkAnswer): readonly string[] {
  return answer.results.map((item) =>
    item.code ? `${item.outcome}:${item.code}` : item.outcome
  );
}

async function lifecycle(personId: string): Promise<string> {
  const [row] = await sql<{ readonly state: string }[]>`
    select case when deleted_at is not null then 'deleted'
      when archived_at is not null then 'archived' else 'active' end as state
    from crm.people where id = ${personId}
  `;
  return row?.state ?? "missing";
}

async function tagsOf(personId: string): Promise<readonly string[]> {
  const rows = await sql<{ readonly tag_id: string }[]>`
    select tag_id::text from crm.person_tags where person_id = ${personId}
    order by tag_id
  `;
  return rows.map((row) => row.tag_id);
}

async function audits(personId: string, action: string): Promise<number> {
  const [row] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.audit_events
    where person_id = ${personId} and action = ${action}
  `;
  return row?.count ?? 0;
}

Deno.test("[PEOPLE-009] bulk archive and restore answer per person, audit each, and repeat as unchanged", async () => {
  const owner = await register("archive");
  const ada = await person(owner, "Ada Lovelace");
  const grace = await person(owner, "Grace Hopper");
  const alan = await person(owner, "Alan Turing");
  const missing = crypto.randomUUID();

  const archived = await answered(owner, {
    action: "archive",
    personIds: [ada, grace, missing],
  });
  assertEquals(archived.action, "archive");
  assertEquals(archived.results.map((item) => item.personId), [
    ada,
    grace,
    missing,
  ], "request order");
  assertEquals(outcomes(archived), ["done", "done", "failed:not_found"]);
  assertEquals(archived.summary, {
    done: 2,
    failed: 1,
    skipped: 0,
    unchanged: 0,
  });
  assertEquals(await lifecycle(ada), "archived");
  assertEquals(await lifecycle(grace), "archived");
  assertEquals(await lifecycle(alan), "active", "an unselected person stays");
  assertEquals(await audits(ada, "people.person-archived"), 1, "Ada audited");

  const again = await answered(owner, {
    action: "archive",
    personIds: [ada, alan],
  });
  assertEquals(outcomes(again), ["unchanged", "done"], "idempotent repeat");
  assertEquals(
    await audits(ada, "people.person-archived"),
    1,
    "an unchanged person is not audited again",
  );

  const restored = await answered(owner, {
    action: "restore",
    personIds: [grace, ada, alan],
  });
  assertEquals(outcomes(restored), ["done", "done", "done"]);
  assertEquals(await lifecycle(grace), "active");
  assertEquals(await audits(grace, "people.person-restored"), 1);
  const restoredAgain = await answered(owner, {
    action: "restore",
    personIds: [grace],
  });
  assertEquals(outcomes(restoredAgain), ["unchanged"]);
});

Deno.test("[PEOPLE-009] bulk tagging goes through the tags profile fact and refuses archived people per item", async () => {
  const owner = await register("tag");
  const friends = await tag(owner, "Friends");
  const family = await tag(owner, "Family");
  const ada = await person(owner, "Ada Lovelace");
  const grace = await person(owner, "Grace Hopper");
  const alan = await person(owner, "Alan Turing");
  await sql`insert into crm.person_tags (person_id, tag_id)
    values (${grace}, ${friends}), (${ada}, ${family})`;
  await answered(owner, { action: "archive", personIds: [alan] });

  const tagged = await answered(owner, {
    action: "tag",
    personIds: [ada, grace, alan],
    tagId: friends,
  });
  assertEquals(
    outcomes(tagged),
    ["done", "unchanged", "failed:archived_write_rejected"],
    "partial success",
  );
  assertEquals(
    await tagsOf(ada),
    [family, friends].sort(),
    "Ada keeps her other tag",
  );
  assertEquals(await tagsOf(alan), [], "the archived person is untouched");
  assertEquals(
    await audits(ada, "people.person-profile-fact-updated"),
    1,
    "the tag change is audited as a profile fact",
  );
  assertEquals(
    await audits(grace, "people.person-profile-fact-updated"),
    0,
    "an unchanged person is not written",
  );

  const untagged = await answered(owner, {
    action: "untag",
    personIds: [ada, grace, alan],
    tagId: family,
  });
  assertEquals(
    outcomes(untagged),
    ["done", "unchanged", "failed:archived_write_rejected"],
  );
  assertEquals(await tagsOf(ada), [friends]);
  assertEquals(await tagsOf(grace), [friends], "Grace keeps Friends");
});

Deno.test("[PEOPLE-009] another workspace's people fail as not found and its tags refuse the request", async () => {
  const owner = await register("tenant");
  const foreign = await register("tenant-foreign");
  const ada = await person(owner, "Ada Lovelace");
  const outsider = await person(foreign, "Outside Person");
  const foreignTag = await tag(foreign, "Theirs");
  const ownTag = await tag(owner, "Ours");

  const archived = await answered(owner, {
    action: "archive",
    personIds: [outsider, ada],
  });
  assertEquals(outcomes(archived), ["failed:not_found", "done"]);
  assertEquals(await lifecycle(outsider), "active", "not archived");

  const tagged = await answered(owner, {
    action: "tag",
    personIds: [outsider],
    tagId: ownTag,
  });
  assertEquals(outcomes(tagged), ["failed:not_found"]);
  assertEquals(await tagsOf(outsider), []);

  const refused = await bulk(owner, {
    action: "tag",
    personIds: [ada],
    tagId: foreignTag,
  });
  assertEquals(refused.status, 400, "a foreign tag refuses the request");
  assertEquals(
    (await refused.json() as { code: string }).code,
    "profile_fact_reference_invalid",
  );
  const unknown = await bulk(owner, {
    action: "untag",
    personIds: [ada],
    tagId: crypto.randomUUID(),
  });
  assertEquals(unknown.status, 400, "an unknown tag refuses the request");
  assertEquals(await tagsOf(ada), [], "nothing was written");

  const vcard = await api.request(
    owner,
    "/api/v1/people/bulk/vcard",
    "POST",
    { personIds: [outsider] },
  );
  assertEquals(vcard.status, 404, "another workspace's person is never a card");
});

Deno.test("[PEOPLE-009] a removed member is refused, and the cap and body are enforced", async () => {
  const owner = await register("access");
  const ada = await person(owner, "Ada Lovelace");
  const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
  const capped = await bulk(owner, { action: "archive", personIds: ids });
  assertEquals(capped.status, 400, "101 people are refused");
  const hundred = await answered(owner, {
    action: "archive",
    personIds: [ada, ...ids.slice(0, 99)],
  });
  assertEquals(hundred.results.length, 100, "100 people are accepted");
  assertEquals(hundred.summary.done, 1);
  assertEquals(hundred.summary.failed, 99);
  for (
    const body of [
      { action: "archive", personIds: [ada, ada] },
      { action: "tag", personIds: [ada] },
      { action: "archive", personIds: [ada], tagId: crypto.randomUUID() },
    ]
  ) {
    assertEquals((await bulk(owner, body)).status, 400, JSON.stringify(body));
  }
  const vcardCapped = await api.request(
    owner,
    "/api/v1/people/bulk/vcard",
    "POST",
    { personIds: ids },
  );
  assertEquals(vcardCapped.status, 400, "the vCard cap");

  // The session was read before the removal committed: the request is
  // authenticated as the member, and the bulk action's own revalidation
  // against PostgreSQL refuses the whole request with 403.
  const connection = connectDatabase(databaseUrl);
  try {
    const unreached = () => Promise.reject(new Error("no person is touched"));
    const stale = createBulkRoutes({
      browserSecurity: browserSecurityPolicy("test", ORIGIN),
      bulk: createBulkPeopleActions({
        actors: workspaceActors(),
        lifecycle: {
          archiveInTransaction: unreached,
          inspectInTransaction: unreached,
          restoreInTransaction: unreached,
        },
        profileFacts: { create: unreached, list: unreached, update: unreached },
        tags: new PostgresBulkTagLookup(),
        transaction: peopleTransactionRunner(connection.db),
      }),
      protectedSessions: {
        resolve: () =>
          Promise.resolve({
            accessibleWorkspaces: [],
            memberId: owner.memberId,
            role: owner.role,
            userId: owner.userId,
            workspaceId: owner.workspaceId,
            workspaceName: "Bulk access",
          }),
      },
    });
    const staleRequest = (body: Readonly<Record<string, unknown>>) =>
      stale.request(`${ORIGIN}/api/v1/people/bulk`, {
        body: JSON.stringify(body),
        headers: workspaceHeaders(owner, { json: true, method: "POST" }),
        method: "POST",
      });
    assertEquals(
      (await staleRequest({ action: "restore", personIds: [ada] })).status,
      200,
      "the member may act before the removal",
    );
    await revokeMembership(sql, owner.memberId);
    const refused = await staleRequest({ action: "restore", personIds: [ada] });
    assertEquals(refused.status, 403, "a removed member is refused");
    const problem = await refused.json() as Record<string, unknown>;
    assertEquals(
      [problem.status, problem.code, problem.title, problem.detail],
      [
        403,
        "people_forbidden",
        "People unavailable",
        "Your active workspace membership no longer permits this change.",
      ],
      "the bulk action's own refusal (PEOPLE_BULK_FORBIDDEN)",
    );
  } finally {
    await connection.destroy();
  }

  // Through the whole app the removed member's session no longer resolves.
  const revoked = await bulk(owner, { action: "restore", personIds: [ada] });
  assertEquals(revoked.status, 401, "a removed member's session is refused");
  const revokedCards = await api.request(
    owner,
    "/api/v1/people/bulk/vcard",
    "POST",
    { personIds: [ada] },
  );
  assertEquals(revokedCards.status, 401, "and cannot export");
});

Deno.test("[PEOPLE-009] the selection vCard holds the selected cards in order and counts the skipped", async () => {
  const owner = await register("vcard");
  const foreign = await register("vcard-foreign");
  const ada = await person(owner, "Ada Lovelace");
  const grace = await person(owner, "Grace Hopper");
  const alan = await person(owner, "Alan Turing");
  const outsider = await person(foreign, "Outside Person");
  await answered(owner, { action: "archive", personIds: [alan] });

  const response = await api.request(
    owner,
    "/api/v1/people/bulk/vcard",
    "POST",
    { personIds: [grace, outsider, ada, crypto.randomUUID()] },
  );
  assertEquals(response.status, 200, await response.clone().text());
  assertEquals(
    response.headers.get("content-type"),
    "text/vcard; charset=utf-8",
  );
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  assert(
    response.headers.get("content-disposition")?.startsWith("attachment;") ===
      true,
    "a download",
  );
  assertEquals(response.headers.get("x-skipped-count"), "2");
  const text = await response.text();
  const names = [...text.matchAll(/^FN:(.*)$/gm)].map((match) =>
    match[1]!.trim()
  );
  assertEquals(names, ["Grace Hopper", "Ada Lovelace"], "cards in order");
  assert(!text.includes("Outside"), "no other workspace's card");
  assertEquals(await audits(ada, "export.downloaded"), 1, "Ada's download");
  assertEquals(await audits(grace, "export.downloaded"), 1, "Grace's download");

  const archivedCard = await api.request(
    owner,
    "/api/v1/people/bulk/vcard",
    "POST",
    { personIds: [alan] },
  );
  assertEquals(archivedCard.status, 200, "an archived person is exported");
  assertEquals(archivedCard.headers.get("x-skipped-count"), "0");
  assert((await archivedCard.text()).includes("FN:Alan Turing"), "Alan");
});
