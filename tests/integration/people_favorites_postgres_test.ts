/**
 * Starred people, the tag facet, and the directory's orders against
 * PostgreSQL (GAP-053, PEOPLE-010).
 *
 * The star is `people.is_starred`, one flag the workspace shares. These
 * suites prove it is written only through the people use case, audited once
 * per change, refused for an archived person and outside the workspace, and
 * never moves the person's revision; that the tag facet counts the people of
 * the view shown and nothing else; and that every order, with and without
 * starred people first, pages by cursor to exactly the list read whole.
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
import { apiSupport, ORIGIN, type SignedInFixture } from "../support/api.ts";
import {
  createPersonStarManagement,
  personStarAuditFrom,
} from "../../packages/backend/modules/people/public.ts";
import { PostgresPersonStarRepository } from "../../packages/backend/modules/people/adapters/postgres/person_star_repository.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
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

interface DirectoryPage {
  readonly nextCursor?: string;
  readonly people: readonly {
    readonly givenName: string;
    readonly id: string;
    readonly isStarred: boolean;
  }[];
}

function register(label: string): Promise<SignedInFixture> {
  return api.register(
    `stars-${label}-${crypto.randomUUID()}@example.test`,
    `Stars ${label}`,
  );
}

function person(owner: SignedInFixture, givenName: string): Promise<string> {
  return createPerson(api, owner, {
    duplicateOverride: true,
    familyName: "Tester",
    givenName,
    isPartial: false,
  });
}

async function audits(personId: string, action: string): Promise<number> {
  const [row] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.audit_events
    where person_id = ${personId} and action = ${action}
  `;
  return row?.count ?? 0;
}

async function starState(personId: string) {
  const [row] = await sql<
    { readonly is_starred: boolean; readonly updated_at: string }[]
  >`
    select is_starred, updated_at::text from crm.people where id = ${personId}
  `;
  return row!;
}

async function directory(
  owner: SignedInFixture,
  query: string,
): Promise<DirectoryPage> {
  const response = await api.request(owner, `/api/v1/people?${query}`);
  assertEquals(response.status, 200, await response.clone().text());
  return await response.json() as DirectoryPage;
}

/** Every page of `query`, two people at a time. */
async function paged(
  owner: SignedInFixture,
  query: string,
): Promise<readonly string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const answer = await directory(
      owner,
      `${query}&limit=2${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`,
    );
    ids.push(...answer.people.map((row) => row.id));
    cursor = answer.nextCursor;
    if (!cursor) return ids;
  }
  throw new Error("the directory never stopped paging");
}

Deno.test("[PEOPLE-010] starring goes through people, is audited once, and keeps the revision", async () => {
  const owner = await register("write");
  const ada = await person(owner, "Ada");
  const before = await starState(ada);

  const starred = await api.request(owner, `/api/v1/people/${ada}/star`, "PUT");
  assertEquals(starred.status, 200, await starred.clone().text());
  assertEquals(await starred.json(), { isStarred: true, status: "ready" });
  const after = await starState(ada);
  assertEquals(after.is_starred, true);
  assertEquals(after.updated_at, before.updated_at, "the revision stays");
  assertEquals(await audits(ada, "people.person-starred"), 1);

  const again = await api.request(owner, `/api/v1/people/${ada}/star`, "PUT");
  assertEquals(again.status, 200);
  assertEquals(
    await audits(ada, "people.person-starred"),
    1,
    "a repeated star audits nothing",
  );

  const listed = await directory(owner, "sort=given-name");
  assertEquals(listed.people.find((row) => row.id === ada)?.isStarred, true);

  const unstarred = await api.request(
    owner,
    `/api/v1/people/${ada}/star`,
    "DELETE",
  );
  assertEquals(unstarred.status, 200);
  assertEquals(await unstarred.json(), { isStarred: false, status: "ready" });
  assertEquals((await starState(ada)).is_starred, false);
  assertEquals(await audits(ada, "people.person-unstarred"), 1);
});

Deno.test("[PEOPLE-010] an archived person's star, another workspace's person, and a revoked member are refused", async () => {
  const owner = await register("refusals");
  const foreign = await register("foreign");
  const ada = await person(owner, "Ada");
  const grace = await person(owner, "Grace");
  const outsider = await person(foreign, "Outsider");
  await api.request(owner, `/api/v1/people/${grace}/star`, "PUT");
  await sql`update crm.people set archived_at = now() where id in (${ada}, ${grace})`;

  const archived = await api.request(
    owner,
    `/api/v1/people/${ada}/star`,
    "PUT",
  );
  assertEquals(archived.status, 409);
  assertEquals((await archived.json()).code, "archived_write_rejected");
  const archivedUnstar = await api.request(
    owner,
    `/api/v1/people/${grace}/star`,
    "DELETE",
  );
  assertEquals(archivedUnstar.status, 409);
  assertEquals(
    (await starState(grace)).is_starred,
    true,
    "an archived person keeps the star they had",
  );
  assertEquals((await starState(ada)).is_starred, false);

  const crossWorkspace = await api.request(
    owner,
    `/api/v1/people/${outsider}/star`,
    "PUT",
  );
  assertEquals(crossWorkspace.status, 404);
  assertEquals((await starState(outsider)).is_starred, false);

  const connection = connectDatabase(databaseUrl);
  try {
    const stars = createPersonStarManagement({
      actors: workspaceActors(),
      audit: personStarAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => new Date() },
      repository: new PostgresPersonStarRepository(),
      transaction: peopleTransactionRunner(connection.db),
    });
    const active = await person(owner, "Mary");
    await revokeMembership(sql, owner.memberId);
    assertEquals(
      await stars.set(owner, active, true),
      { status: "forbidden" },
    );
    assertEquals((await starState(active)).is_starred, false);
  } finally {
    await connection.destroy();
  }
});

Deno.test("[PEOPLE-010] the tag facet counts the view's people and nothing else", async () => {
  const owner = await register("facet");
  const foreign = await register("facet-foreign");
  const people = await Promise.all(
    ["Ada", "Grace", "Alan", "Mary"].map((name) => person(owner, name)),
  );
  const tags = new Map<string, string>();
  for (const name of ["Friends", "Family", "Work"]) {
    const [row] = await sql<{ readonly id: string }[]>`
      insert into crm.tags (workspace_id, name, slug)
      values (${owner.workspaceId}, ${name}, ${name.toLowerCase()})
      returning id::text
    `;
    tags.set(name, row!.id);
  }
  const link = async (personId: string, tag: string) =>
    await sql`
      insert into crm.person_tags (person_id, tag_id)
      values (${personId}, ${tags.get(tag)!})
    `;
  const [ada, grace, alan, mary] = people as [string, string, string, string];
  await link(ada, "Friends");
  await link(grace, "Friends");
  await link(alan, "Friends");
  await link(ada, "Family");
  await link(mary, "Work");
  await sql`update crm.people set archived_at = now() where id = ${mary}`;
  await sql`update crm.people set deleted_at = now() where id = ${alan}`;
  const outsider = await person(foreign, "Outsider");
  const [foreignTag] = await sql<{ readonly id: string }[]>`
    insert into crm.tags (workspace_id, name, slug)
    values (${foreign.workspaceId}, 'Friends', 'friends') returning id::text
  `;
  await sql`
    insert into crm.person_tags (person_id, tag_id)
    values (${outsider}, ${foreignTag!.id})
  `;

  const facet = async (lifecycle: string) => {
    const response = await api.request(
      owner,
      `/api/v1/people/tag-facet?lifecycle=${lifecycle}`,
    );
    assertEquals(response.status, 200, await response.clone().text());
    return await response.json();
  };
  assertEquals(await facet("active"), {
    lifecycle: "active",
    status: "ready",
    tags: [
      { count: 2, id: tags.get("Friends"), name: "Friends" },
      { count: 1, id: tags.get("Family"), name: "Family" },
    ],
    truncated: false,
  });
  assertEquals(await facet("archived"), {
    lifecycle: "archived",
    status: "ready",
    tags: [{ count: 1, id: tags.get("Work"), name: "Work" }],
    truncated: false,
  });

  for (let index = 0; index < 30; index++) {
    const [row] = await sql<{ readonly id: string }[]>`
      insert into crm.tags (workspace_id, name, slug)
      values (${owner.workspaceId}, ${`Extra ${index}`}, ${`extra-${index}`})
      returning id::text
    `;
    await sql`insert into crm.person_tags (person_id, tag_id) values (${grace}, ${
      row!.id
    })`;
  }
  const bounded = await facet("active");
  assertEquals(bounded.tags.length, 30);
  assertEquals(bounded.truncated, true);
  assertEquals(bounded.tags[0].name, "Friends", "most carried first");
});

Deno.test("[PEOPLE-010] every order pages by cursor to exactly the whole list", async () => {
  const owner = await register("orders");
  const names = ["Zed", "Amy", "Bob", "Cy", "Dee", "Eve", "Flo"];
  const ids = new Map<string, string>();
  for (const name of names) ids.set(name, await person(owner, name));
  const id = (name: string) => ids.get(name)!;
  // Calls and conversations: Bob most recently, then Cy, then Amy; the rest
  // never. Eve's conversation is older, but its newest message is newer.
  const call = async (name: string, at: string) =>
    await sql`
      insert into crm.calls (workspace_id, person_id, called_at)
      values (${owner.workspaceId}, ${id(name)}, ${at}::timestamptz)
    `;
  await call("Amy", "2026-09-01T10:00:00Z");
  await call("Bob", "2026-09-20T10:00:00Z");
  await call("Cy", "2026-09-10T10:00:00Z");
  await call("Cy", "2026-09-02T10:00:00Z");
  const [thread] = await sql<{ readonly id: string }[]>`
    insert into crm.conversation_threads (workspace_id, person_id, happened_at)
    values (${owner.workspaceId}, ${id("Eve")}, '2026-08-01T10:00:00Z')
    returning id::text
  `;
  await sql`
    insert into crm.messages (conversation_id, content, written_at, direction)
    values (${thread!.id}, 'Hello', '2026-09-15T10:00:00Z', 'inbound')
  `;
  // Updated: Dee most recently, then Flo; the rest at creation.
  await sql`update crm.people set updated_at = now() + interval '2 minutes' where id = ${
    id("Dee")
  }`;
  await sql`update crm.people set updated_at = now() + interval '1 minute' where id = ${
    id("Flo")
  }`;
  for (const name of ["Cy", "Flo"]) {
    const starred = await api.request(
      owner,
      `/api/v1/people/${id(name)}/star`,
      "PUT",
    );
    assertEquals(starred.status, 200);
  }

  const whole = async (query: string) =>
    (await directory(owner, `${query}&limit=50`)).people.map((row) => row.id);
  const named = (list: readonly string[]) =>
    list.map((value) => [...ids].find(([, known]) => known === value)?.[0]);

  assertEquals(
    named(await whole("sort=last-contacted")).slice(0, 4),
    ["Bob", "Eve", "Cy", "Amy"],
    "newest contact first, a conversation by its newest message",
  );

  // The directory's rule and the person profile's own copy of it agree: each
  // profile's `lastContactAt` orders the people exactly as the directory does.
  const contacts = await Promise.all(
    [...ids.values()].map(async (personId) => {
      const response = await api.request(owner, `/api/v1/people/${personId}`);
      assertEquals(response.status, 200, await response.clone().text());
      const body = await response.json() as {
        readonly person: { readonly lastContactAt?: string };
      };
      return { at: body.person.lastContactAt, personId };
    }),
  );
  assertEquals(
    contacts.find((entry) => entry.personId === id("Eve"))?.at,
    "2026-09-15T10:00:00.000Z",
    "the profile counts Eve's conversation from its newest message",
  );
  const byProfile = [...contacts].sort((left, right) =>
    left.at === right.at
      ? (left.personId < right.personId ? -1 : 1)
      : left.at === undefined
      ? 1
      : right.at === undefined
      ? -1
      : right.at.localeCompare(left.at)
  ).map((entry) => entry.personId);
  assertEquals(
    await whole("sort=last-contacted"),
    byProfile,
    "the directory's last-contacted order matches every profile's lastContactAt",
  );
  assertEquals(
    named(await whole("sort=recently-updated")).slice(0, 2),
    ["Dee", "Flo"],
  );
  assertEquals(
    named(await whole("sort=given-name&starredFirst=true")).slice(0, 2),
    ["Cy", "Flo"],
    "starred people lead, each group in the order",
  );
  assertEquals(
    named(await whole("sort=given-name&starred=true")),
    ["Cy", "Flo"],
    "the starred filter lists only starred people",
  );

  for (
    const sort of [
      "given-name",
      "family-name",
      "recently-added",
      "last-contacted",
      "recently-updated",
    ]
  ) {
    for (const starredFirst of ["false", "true"]) {
      const query = `sort=${sort}&starredFirst=${starredFirst}`;
      const expected = await whole(query);
      assertEquals(expected.length, names.length, `${query} lists all`);
      assertEquals(await paged(owner, query), expected, `${query} pages`);
    }
  }
  const starredOnly = await paged(owner, "sort=last-contacted&starred=true");
  assertEquals(named(starredOnly), ["Cy", "Flo"]);

  // A cursor for one order is stale for another.
  const first = await directory(owner, "sort=last-contacted&limit=2");
  assert(first.nextCursor, "the first page continues");
  const mismatched = await api.request(
    owner,
    `/api/v1/people?sort=recently-updated&limit=2&cursor=${
      encodeURIComponent(first.nextCursor)
    }`,
  );
  assertEquals(mismatched.status, 409);
  // A page that ended on a person whose last contact then changed is stale.
  const moved = await directory(owner, "sort=last-contacted&limit=1");
  await call("Bob", "2026-09-27T10:00:00Z");
  const changed = await api.request(
    owner,
    `/api/v1/people?sort=last-contacted&limit=1&cursor=${
      encodeURIComponent(moved.nextCursor!)
    }`,
  );
  assertEquals(changed.status, 409, "the anchor's key moved");
});
