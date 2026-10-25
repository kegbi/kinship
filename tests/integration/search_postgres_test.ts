/**
 * Workspace search against real PostgreSQL (GAP-048, `SEARCH-001`).
 *
 * Every group is read through the PostgreSQL repository and the public
 * facade, with a second workspace holding the same words, so each suite
 * observes rows the search must return beside rows it must never return:
 * another workspace's, a soft-deleted one's, a hidden section's, and a
 * revoked member's whole answer.
 */

import {
  PostgresSearchRepository,
  SEARCH_STATEMENT_TIMEOUT_MS,
} from "../../packages/backend/read-models/search/adapters/postgres/search_repository.ts";
import { createSearchRoutes } from "../../packages/backend/modules/people/transport/http/search.ts";
import * as fixtures from "../../packages/backend/testing/fixtures.ts";
import {
  createWorkspaceSearch,
  type SearchResult,
} from "../../packages/backend/read-models/search/public.ts";
import { type KyselyPlugin, RawNode, sql as sqlQuery } from "kysely";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { openSql, revokeMembership, type Sql } from "../support/database.ts";
import {
  connectDatabase,
  DATABASE_POOL_MAX,
  type DatabaseConnection,
} from "../../packages/backend/platform/postgres/database.ts";
import {
  actors,
  addActivity,
  addNote,
  addPerson,
  closeResources,
  connection,
  databaseUrl,
  memberOf,
  type SeededActor,
  sql,
  transaction,
  twoWorkspaces,
} from "./read_models.test-helper.ts";

const repository = new PostgresSearchRepository(connection.db);
const search = createWorkspaceSearch({ actors, repository, transaction });

function actorOf(seeded: SeededActor) {
  return {
    memberId: seeded.memberId,
    role: seeded.role,
    userId: seeded.userId,
    workspaceId: seeded.workspaceId,
  };
}

/** A word no other suite writes, so each case reads only its own rows. */
function word(): string {
  return `zq${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

async function addJournalPost(
  actor: SeededActor,
  title: string | null,
  body: string,
): Promise<{ readonly itemId: string; readonly postId: string }> {
  const postId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  await sql`
    insert into crm.journal_posts (id, workspace_id, title, body, occurred_at,
      created_by_member_id)
    values (${postId}, ${actor.workspaceId}, ${title}, ${body},
      '2026-03-01T09:00:00Z', ${actor.memberId})
  `;
  await sql`
    insert into crm.journal_items (id, workspace_id, occurred_at,
      journal_post_id, created_by_member_id)
    values (${itemId}, ${actor.workspaceId}, '2026-03-01T09:00:00Z', ${postId},
      ${actor.memberId})
  `;
  return { itemId, postId };
}

async function addTask(
  actor: SeededActor,
  title: string,
  personId: string | null,
  description: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.tasks (id, workspace_id, person_id, title, description,
      created_by_member_id)
    values (${id}, ${actor.workspaceId}, ${personId}, ${title}, ${description},
      ${actor.memberId})
  `;
  return id;
}

async function hideSection(actor: SeededActor, key: string): Promise<void> {
  await sql`
    insert into crm.workspace_profile_modules (workspace_id, key, is_active)
    values (${actor.workspaceId}, ${key}, false)
  `;
}

function ready(result: SearchResult) {
  assert(result.status === "ready", `search refused: ${result.status}`);
  const [people, notes, activities, journalPosts, tasks] = result.groups;
  return { activities, journalPosts, notes, people, tasks };
}

const ids = (group: { readonly results: readonly { readonly id: string }[] }) =>
  group.results.map((result) => result.id);

Deno.test("[SEARCH-001] each kind is found in the reader's workspace and never in another", async () => {
  const { foreign, reader } = await twoWorkspaces("search-tenancy");
  const shared = word();
  const person = await addPerson(reader, `Ada ${shared}`);
  const note = await addNote(
    reader,
    reader.personId,
    `Met at the ${shared} café`,
    "2026-02-01T09:00:00Z",
  );
  const activity = await addActivity(
    reader,
    `${shared} walk`,
    "2026-02-02T09:00:00Z",
    [reader.personId],
  );
  const post = await addJournalPost(reader, null, `A ${shared} evening`);
  const task = await addTask(reader, `Call about ${shared}`, reader.personId);

  const foreignPerson = await addPerson(foreign, `Foreign ${shared}`);
  const foreignNote = await addNote(
    foreign,
    foreign.personId,
    `Foreign ${shared} note`,
    "2026-02-03T09:00:00Z",
  );
  const foreignActivity = await addActivity(
    foreign,
    `Foreign ${shared} activity`,
    "2026-02-04T09:00:00Z",
    [foreign.personId],
  );
  const foreignPost = await addJournalPost(foreign, shared, "Foreign post");
  const foreignTask = await addTask(foreign, `Foreign ${shared}`, null);
  // Rows that cross the tenant boundary: a reader's activity attended only by
  // the foreign person, a reader's note on the foreign person, and a reader's
  // task naming the foreign person. None may surface or name that person.
  const crossActivity = await addActivity(
    reader,
    `${shared} crossing`,
    "2026-02-05T09:00:00Z",
    [foreign.personId],
  );
  const crossNote = crypto.randomUUID();
  await sql`
    insert into crm.notes (id, workspace_id, person_id, body)
    values (${crossNote}, ${reader.workspaceId}, ${foreign.personId},
      ${`${shared} across`})
  `;
  const crossTask = await addTask(
    reader,
    `${shared} crossed`,
    foreign.personId,
  );

  const found = ready(
    await search.search(actorOf(reader), { query: shared, limit: 10 }),
  );
  assertEquals(ids(found.people), [person]);
  assertEquals(ids(found.notes), [note]);
  assertEquals(ids(found.activities), [activity]);
  assertEquals(ids(found.journalPosts), [post.postId]);
  assertEquals(ids(found.tasks).sort(), [crossTask, task].sort());
  const serialized = JSON.stringify(found);
  for (
    const hidden of [
      foreign.personId,
      foreignPerson,
      foreignNote,
      foreignActivity,
      foreignPost.postId,
      foreignTask,
      crossActivity,
      crossNote,
      "Foreign",
    ]
  ) {
    assert(!serialized.includes(hidden), `search leaked ${hidden}`);
  }
  assertEquals(
    found.notes.results[0]?.href,
    `/app/people/${reader.personId}?section=notes`,
  );
  assertEquals(
    found.activities.results[0]?.href,
    `/app/people/${reader.personId}?section=activities`,
  );
  assertEquals(
    found.journalPosts.results[0]?.href,
    `/app/journal/${post.itemId}`,
  );
  const tasks = new Map(
    found.tasks.results.map((result) => [result.id, result]),
  );
  assertEquals(
    tasks.get(task)?.href,
    `/app/people/${reader.personId}?section=tasks`,
  );
  assertEquals(tasks.get(task)?.person, {
    archived: false,
    id: reader.personId,
    name: "Reader subject",
  });
  assertEquals(tasks.get(crossTask)?.href, "/app/tasks");
  assertEquals(tasks.get(crossTask)?.person, undefined);

  const member = await memberOf(reader, "member");
  const asMember = ready(
    await search.search(actorOf(member), { query: shared, limit: 10 }),
  );
  assertEquals(JSON.stringify(asMember), JSON.stringify(found));

  await revokeMembership(sql, reader.memberId);
  const refused = await search.search(actorOf(reader), { query: shared });
  assertEquals(refused.status, "forbidden");
});

Deno.test("[SEARCH-001] soft-deleted, archived, and hidden-section rows follow their owners' lists", async () => {
  const { reader } = await twoWorkspaces("search-visibility");
  const shared = word();
  const archived = await addPerson(reader, `Archie ${shared}`);
  await sql`update crm.people set archived_at = now() where id = ${archived}`;
  const deleted = await addPerson(reader, `Dee ${shared}`);
  const archivedNote = await addNote(
    reader,
    archived,
    `${shared} about an archived friend`,
    "2026-02-01T09:00:00Z",
  );
  await addNote(reader, deleted, `${shared} deleted`, "2026-02-02T09:00:00Z");
  const alone = await addActivity(
    reader,
    `${shared} alone`,
    "2026-02-03T09:00:00Z",
    [
      deleted,
    ],
  );
  const together = await addActivity(
    reader,
    `${shared} together`,
    "2026-02-04T09:00:00Z",
    [deleted, archived],
  );
  const deletedTask = await addTask(reader, `${shared} gone`, null);
  await sql`update crm.tasks set deleted_at = now() where id = ${deletedTask}`;
  const orphanTask = await addTask(reader, `${shared} orphan`, deleted);
  await sql`update crm.people set deleted_at = now() where id = ${deleted}`;

  const found = ready(
    await search.search(actorOf(reader), { query: shared, limit: 10 }),
  );
  // The directory's default list leaves archived people out; the notes,
  // activities, and tasks their owners still list stay, marked archived.
  assertEquals(ids(found.people), []);
  assertEquals(ids(found.notes), [archivedNote]);
  assertEquals(found.notes.results[0]?.person, {
    archived: true,
    id: archived,
    name: `Archie ${shared}`,
  });
  assertEquals(ids(found.activities), [together]);
  assertEquals(found.activities.results[0]?.person?.id, archived);
  assert(!ids(found.activities).includes(alone), "a deleted-only activity");
  assertEquals(ids(found.tasks), [orphanTask]);
  assertEquals(found.tasks.results[0]?.href, "/app/tasks");
  assertEquals(found.tasks.results[0]?.person, undefined);

  const shownTask = await addTask(reader, `${shared} shown`, archived);
  await hideSection(reader, "notes");
  await hideSection(reader, "activities");
  await hideSection(reader, "tasks");
  const hidden = ready(
    await search.search(actorOf(reader), { query: shared, limit: 10 }),
  );
  assertEquals(ids(hidden.notes), []);
  assertEquals(ids(hidden.activities), []);
  const hiddenTask = hidden.tasks.results.find((result) =>
    result.id === shownTask
  );
  assertEquals(hiddenTask?.href, "/app/tasks");
  assertEquals(hiddenTask?.person?.id, archived);
});

Deno.test("[SEARCH-001] names match by prefix and substring, text by its words", async () => {
  const { reader } = await twoWorkspaces("search-matching");
  const shared = word();
  const zephyrine = await addPerson(reader, `${shared}ine`);
  await sql`
    update crm.people set family_name = 'Quill', nickname = 'Zed'
    where id = ${zephyrine}
  `;
  const byPrefix = ready(
    await search.search(actorOf(reader), { query: shared.slice(0, 6) }),
  );
  assertEquals(ids(byPrefix.people), [zephyrine]);
  // People follow the directory's own pattern: one substring of the name.
  const byOrder = ready(
    await search.search(actorOf(reader), { query: `${shared}ine Quill` }),
  );
  assertEquals(ids(byOrder.people), [zephyrine]);
  const byNickname = ready(
    await search.search(actorOf(reader), { query: "zed" }),
  );
  assertEquals(ids(byNickname.people), [zephyrine]);

  const note = await addNote(
    reader,
    reader.personId,
    `The ${shared} lighthouse keeper`,
    "2026-02-01T09:00:00Z",
  );
  const words = ready(
    await search.search(actorOf(reader), { query: `lighthouse ${shared}` }),
  );
  assertEquals(ids(words.notes), [note]);
  const phrase = ready(
    await search.search(actorOf(reader), { query: `"keeper ${shared}"` }),
  );
  assertEquals(ids(phrase.notes), []);
  const partialWord = ready(
    await search.search(actorOf(reader), { query: "lighthou" }),
  );
  assertEquals(ids(partialWord.notes), []);

  // PostgreSQL reports a query without a word as a notice, which the driver
  // would print; the search asks it nothing it has to warn about.
  const printed: unknown[] = [];
  const log = console.log;
  console.log = (...values: unknown[]) => printed.push(values);
  try {
    for (
      const query of ["!!!", "&|:*", "-", "<b>", "' or 1=1 --", "a:*", "or"]
    ) {
      const odd = await search.search(actorOf(reader), { query });
      assertEquals(odd.status, "ready", `query ${query}`);
    }
  } finally {
    console.log = log;
  }
  assertEquals(printed, []);
});

Deno.test("[SEARCH-001] names match across scripts and keyboard layouts over HTTP", async () => {
  const { foreign, reader } = await twoWorkspaces("search-scripts");
  const elena = await addPerson(reader, "Elena");
  const yelena = await addPerson(reader, "Елена");
  const archived = await addPerson(reader, "Elena Archived");
  await sql`update crm.people set archived_at = now() where id = ${archived}`;
  const deleted = await addPerson(reader, "Елена Deleted");
  await sql`update crm.people set deleted_at = now() where id = ${deleted}`;
  await addPerson(foreign, "Elena Foreign");
  const routes = createSearchRoutes({
    protectedSessions: {
      resolve: () =>
        Promise.resolve(
          fixtures.sessionActor({
            ...actorOf(reader),
            workspaceName: "search-scripts reader",
          }),
        ),
    },
    search,
  });
  const people = async (query: string): Promise<string[]> => {
    const response = await routes.request(
      `http://localhost/api/v1/search?limit=10&q=${encodeURIComponent(query)}`,
      { headers: { cookie: "kinship_session=current-token" } },
    );
    assertEquals(response.status, 200, `search for ${query}`);
    const body = await response.json() as {
      readonly groups: readonly {
        readonly results: readonly { id: string }[];
      }[];
    };
    return body.groups[0]!.results.map((person) => person.id).sort();
  };
  const both = [elena, yelena].sort();
  // Elena typed on the Russian layout, Елена typed on the English one.
  assertEquals(await people("удутф"), both);
  assertEquals(await people("Tktyf"), both);
  // Either script's spelling finds the other's.
  assertEquals(await people("елена"), both);
  assertEquals(await people("elena"), both);
  assertEquals(await people("Yelena"), both);
  // The plain match still answers a partly typed spelling the fold collapses.
  assertEquals(await people("Ele"), both);
  assertEquals(await people("Petrova"), []);
});

Deno.test("[SEARCH-001] snippets are the stored text, never markup, and groups are bounded", async () => {
  const { reader } = await twoWorkspaces("search-bounds");
  const shared = word();
  // The text parser skips what sits inside a tag or a script, so the word
  // is written between tags, where it is still text.
  const markup = `<script>alert(1)</script> <b>${shared}</b> & "more"`;
  const note = await addNote(
    reader,
    reader.personId,
    markup,
    "2026-01-01T09:00:00Z",
  );
  const long = await addNote(
    reader,
    reader.personId,
    `${"lead ".repeat(80)}${shared} ${"tail ".repeat(80)}`,
    "2026-01-02T09:00:00Z",
  );
  const found = ready(
    await search.search(actorOf(reader), { query: shared, limit: 10 }),
  );
  const snippets = new Map(
    found.notes.results.map((result) => [result.id, result.snippet]),
  );
  assertEquals(snippets.get(note), markup);
  const cut = snippets.get(long) ?? "";
  assert(
    cut.startsWith("…") && cut.endsWith("…") && cut.includes(shared) &&
      cut.length <= 162,
    `long note snippet: ${cut}`,
  );

  for (let index = 0; index < 12; index++) {
    await addNote(
      reader,
      reader.personId,
      `${shared} number ${index}`,
      `2026-03-${String(index + 1).padStart(2, "0")}T09:00:00Z`,
    );
    await addTask(reader, `${shared} task ${index}`, null);
    await addPerson(reader, `${shared} person ${index}`);
  }
  const defaulted = ready(
    await search.search(actorOf(reader), { query: shared }),
  );
  assertEquals(defaulted.notes.results.length, 5);
  assertEquals(defaulted.people.results.length, 5);
  assertEquals(defaulted.tasks.results.length, 5);
  assertEquals(
    defaulted.notes.results[0]?.snippet,
    `${shared} number 11`,
    "the newest note leads",
  );
  const widest = ready(
    await search.search(actorOf(reader), { query: shared, limit: 50 }),
  );
  assertEquals(widest.notes.results.length, 10);
  assertEquals(widest.people.results.length, 10);
  assertEquals(widest.tasks.results.length, 10);
  const narrow = ready(
    await search.search(actorOf(reader), { query: shared, limit: 1 }),
  );
  assertEquals(narrow.notes.results.length, 1);
});

Deno.test("[SEARCH-001] a query with no positive term matches no text", async () => {
  const { reader } = await twoWorkspaces("search-negated");
  const shared = word();
  await addNote(
    reader,
    reader.personId,
    `${shared} fox`,
    "2026-01-01T09:00:00Z",
  );
  await addNote(
    reader,
    reader.personId,
    `${shared} dog`,
    "2026-01-02T09:00:00Z",
  );
  await addTask(reader, `${shared} other`, null);
  for (
    const query of ["-fox", "-fox -dog", `-${shared}`, `${shared} or -fox`]
  ) {
    const found = ready(await search.search(actorOf(reader), { query }));
    assertEquals(
      [found.notes, found.activities, found.journalPosts, found.tasks]
        .map((group) => group.results.length),
      [0, 0, 0, 0],
      `query ${query}`,
    );
  }
  const positive = ready(
    await search.search(actorOf(reader), { query: `${shared} -fox` }),
  );
  assertEquals(positive.notes.results.map((note) => note.snippet), [
    `${shared} dog`,
  ]);
});

Deno.test("[SEARCH-001] a match past the stored text's first 2,000 characters reaches its snippet", async () => {
  const { reader } = await twoWorkspaces("search-deep");
  const shared = word();
  const note = await addNote(
    reader,
    reader.personId,
    `${"lead ".repeat(700)}😀 ${shared} İstanbul ${"tail ".repeat(700)}`,
    "2026-01-01T09:00:00Z",
  );
  const found = ready(await search.search(actorOf(reader), { query: shared }));
  const snippet = found.notes.results.find((result) => result.id === note)
    ?.snippet ?? "";
  assert(
    snippet.includes(shared) && snippet.startsWith("…") &&
      snippet.endsWith("…"),
    `the deep match is shown: ${snippet}`,
  );
  const upper = ready(
    await search.search(actorOf(reader), { query: shared.toUpperCase() }),
  );
  const folded = upper.notes.results.find((result) => result.id === note)
    ?.snippet ?? "";
  assert(
    folded.includes(`😀 ${shared} İstanbul`),
    `a case-folded deep match is shown whole: ${folded}`,
  );
});

Deno.test("[SEARCH-001] people follow the member's contact sort order", async () => {
  const { reader } = await twoWorkspaces("search-sort");
  const shared = word();
  const zoe = await addPerson(reader, `Zoe ${shared}`);
  const adam = await addPerson(reader, `Adam ${shared}`);
  await sql`update crm.people set family_name = 'Alpha' where id = ${zoe}`;
  await sql`update crm.people set family_name = 'Zulu' where id = ${adam}`;
  const given = ready(await search.search(actorOf(reader), { query: shared }));
  assertEquals(ids(given.people), [adam, zoe]);
  const family = ready(
    await search.search(actorOf(reader), {
      query: shared,
      sort: "family-name",
    }),
  );
  assertEquals(ids(family.people), [zoe, adam]);
});

Deno.test("[SEARCH-001] a text statement past its timeout still answers people, marked partial", async () => {
  const { reader } = await twoWorkspaces("search-timeout");
  const shared = word();
  const person = await addPerson(reader, `Tia ${shared}`);
  const bounded = createWorkspaceSearch({
    actors,
    repository: new PostgresSearchRepository(connection.db, {
      statementTimeoutMs: 40,
    }),
    transaction,
  });
  // The text groups read their full-text indexes (REL-061), so no fixture of
  // a sensible size makes them slow. Another transaction holds the notes
  // table instead: the text statement waits on it past its bound, while
  // people search never reads notes. Were the bound ever to stop firing, the
  // search would wait on the lock and the lock holder on the search, so the
  // lock holder watches: once a statement has waited on the notes lock far
  // past the bound, it commits, the search finishes, and the test fails.
  let watchdogFired = false;
  const { searching } = await sql.begin(async (locking) => {
    await locking`lock table crm.notes in access exclusive mode`;
    let settled = false;
    const searching = bounded.search(actorOf(reader), { query: shared });
    searching.then(() => settled = true, () => settled = true);
    while (!settled) {
      const stuck = await locking`
        select 1 from pg_locks
        where database = (select oid from pg_database
            where datname = current_database())
          and relation = 'crm.notes'::regclass and not granted
          and pid <> pg_backend_pid()
          and waitstart < clock_timestamp() - interval '2 seconds'`;
      if (stuck.length > 0) {
        watchdogFired = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { searching };
  });
  const partial = ready(await searching);
  assert(
    !watchdogFired,
    "the text statement waited on the notes lock past its 40 ms bound",
  );
  assertEquals(ids(partial.people), [person]);
  for (
    const group of [
      partial.notes,
      partial.activities,
      partial.journalPosts,
      partial.tasks,
    ]
  ) {
    assertEquals([group.results.length, group.unavailable], [0, true]);
  }
  // SET LOCAL ends with the transaction: every connection of the pool that ran
  // the bounded search is clean. The whole pool, `DATABASE_POOL_MAX`
  // connections, is held at once (distinct backends, asserted below) until
  // each has answered; the first failure releases the rest, so no connection
  // stays reserved behind the barrier.
  const held = Promise.withResolvers<void>();
  let answered = 0;
  const settings = await Promise.all(
    Array.from(
      { length: DATABASE_POOL_MAX },
      () =>
        connection.db.connection().execute(async (pooled) => {
          const { rows: [backend] } = await sqlQuery<{ pid: number }>`
            select pg_backend_pid() as pid`.execute(pooled);
          const { rows: [setting] } = await sqlQuery<
            { statement_timeout: string }
          >`show statement_timeout`.execute(pooled);
          if (++answered === DATABASE_POOL_MAX) held.resolve();
          await held.promise;
          return { pid: backend?.pid, timeout: setting?.statement_timeout };
        }).catch((error) => {
          // A failed query or a failed acquisition both land here.
          held.resolve();
          throw error;
        }),
    ),
  );
  assertEquals(new Set(settings.map(({ pid }) => pid)).size, DATABASE_POOL_MAX);
  assert(
    settings.every(({ timeout }) => timeout === "0"),
    `leaked: ${settings.map(({ timeout }) => timeout)}`,
  );
  assert(SEARCH_STATEMENT_TIMEOUT_MS === 1500, "the production bound");
  const { reader: other } = await twoWorkspaces("search-after-timeout");
  const after = ready(await search.search(actorOf(other), { query: "Reader" }));
  assertEquals(after.notes.unavailable, undefined);
  assertEquals(ids(after.people), [other.personId]);
});

Deno.test("[SEARCH-001] a people statement past its timeout answers search_unavailable", async () => {
  const { reader } = await twoWorkspaces("search-people-timeout");
  await sql`
    insert into crm.people (workspace_id, given_name, family_name)
    select ${reader.workspaceId}, 'Filler ' || series, md5(series::text)
    from generate_series(1, 60000) series
  `;
  const repository = new PostgresSearchRepository(connection.db, {
    statementTimeoutMs: 1,
  });
  const bounded = createWorkspaceSearch({ actors, repository, transaction });
  const refused = await bounded.search(actorOf(reader), { query: "zzqq" });
  assertEquals(refused.status, "unavailable");

  const routes = createSearchRoutes({
    protectedSessions: {
      resolve: () =>
        Promise.resolve(
          fixtures.sessionActor({
            ...actorOf(reader),
            workspaceName: "search-people-timeout reader",
          }),
        ),
    },
    search: bounded,
  });
  const response = await routes.request(
    "http://localhost/api/v1/search?q=zzqq",
    { headers: { cookie: "kinship_session=current-token" } },
  );
  assertEquals(response.status, 503);
  assertEquals((await response.json()).code, "search_unavailable");

  const after = await connection.db.transaction().execute(async (trx) =>
    (await sqlQuery`show statement_timeout`.execute(trx)).rows[0]
  );
  assertEquals(after, { statement_timeout: "0" });
  const healthy = await search.search(actorOf(reader), {
    query: "Filler 12345",
  });
  assert(healthy.status === "ready", "the next search is served");
  assertEquals(healthy.groups[0].results.length, 1);
});

Deno.test("[SEARCH-001] a statement that fails for another reason is not a timeout", async () => {
  const { reader } = await twoWorkspaces("search-failure");
  const command = {
    ...actorOf(reader),
    limit: 5,
    nameFold: [],
    nameForms: [],
    query: "ada",
    sort: "given-name" as const,
    terms: ["ada"],
    workspaceId: "not-a-uuid",
  };
  for (
    const statement of [
      () => repository.searchPeople(command),
      () => repository.searchText(command),
    ]
  ) {
    const failed = await statement().then(
      () => undefined,
      (error: unknown) => error,
    );
    assert(failed instanceof Error, "an invalid identifier is thrown");
  }
});

/** Every index a plan node scans, at any depth. */
function scannedIndexes(plan: unknown): readonly string[] {
  if (Array.isArray(plan)) return plan.flatMap(scannedIndexes);
  if (typeof plan !== "object" || plan === null) return [];
  const node = plan as Record<string, unknown>;
  return [
    ...(typeof node["Index Name"] === "string" ? [node["Index Name"]] : []),
    ...Object.values(node).flatMap(scannedIndexes),
  ];
}

/**
 * The plan PostgreSQL chooses for the text statement the repository sends,
 * captured by explaining that exact statement instead of running it.
 */
async function textStatementPlan(
  database: DatabaseConnection["db"],
  command: Parameters<PostgresSearchRepository["searchText"]>[0],
): Promise<unknown> {
  const explained = new Set<unknown>();
  let plan: unknown;
  const explain: KyselyPlugin = {
    transformQuery({ node, queryId }) {
      if (
        RawNode.is(node) && node.sqlFragments[0]?.includes("with parsed as")
      ) {
        explained.add(queryId.queryId);
        return RawNode.create(
          [`explain (format json) ${node.sqlFragments[0]}`].concat(
            node.sqlFragments.slice(1),
          ),
          node.parameters,
        );
      }
      return node;
    },
    transformResult({ queryId, result }) {
      if (!explained.has(queryId.queryId)) return Promise.resolve(result);
      plan = (result.rows[0] as Record<string, unknown>)["QUERY PLAN"];
      return Promise.resolve({
        rows: [{ activities: [], journal_posts: [], notes: [], tasks: [] }],
      });
    },
  };
  const explainer = new PostgresSearchRepository(database.withPlugin(explain));
  assertEquals((await explainer.searchText(command)).status, "ready");
  return plan;
}

/**
 * Runs `work` on a scratch database holding the canonical v10 DDL and nothing
 * else, dropped afterwards. The statistics a plan is costed from are then this
 * suite's own rows, never whatever the other suites left in the shared one.
 */
async function withScratchCrm(
  work: (scratch: { readonly sql: Sql; readonly url: string }) => Promise<void>,
): Promise<void> {
  const name = `kinship_search_${crypto.randomUUID().replaceAll("-", "")}`;
  await sql.unsafe(`create database ${name}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const scratch = openSql(url.toString(), { max: 1, prepare: false });
  try {
    await scratch.unsafe(
      await Deno.readTextFile(
        "personal-crm-schema/v10/personal_crm_schema_v10.sql",
      ),
    );
    await work({ sql: scratch, url: url.toString() });
  } finally {
    await scratch.end();
    await sql.unsafe(`drop database if exists ${name} with (force)`);
  }
}

Deno.test("[REL-061] each text group of a large workspace matches through its full-text index", async () => {
  await withScratchCrm(async ({ sql: scratch, url }) => {
    // REL-061's shape at a smaller scale: one workspace whose text is spread
    // over many people, beside a small one. Every row is written here and
    // each table is below ANALYZE's sample size, so the statistics, and so
    // the plan, are the same on every run.
    const [owner, large, small] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const [people, rows] = [200, 4000];
    await scratch`insert into crm.users (id, email) values (${owner}, 'owner@example.test')`;
    await scratch`
      insert into crm.workspaces (id, name, created_by_user_id)
      values (${large}, 'Large', ${owner}), (${small}, 'Small', ${owner})
    `;
    await scratch`
      insert into crm.people (workspace_id, given_name)
      select case when n <= ${people} then ${large}::uuid else ${small}::uuid end,
        'Person ' || n
      from generate_series(1, ${people} + 5) n
    `;
    await scratch`
      insert into crm.notes (workspace_id, person_id, body)
      select person.workspace_id, person.id, 'note ' || md5(n::text || person.id::text)
      from crm.people person
      cross join generate_series(1, ${rows / people}) n
    `;
    await scratch`
      with created as (
        insert into crm.activities (workspace_id, summary, happened_at)
        select person.workspace_id,
          person.id::text || ' walk ' || md5(n::text), now()
        from crm.people person
        cross join generate_series(1, ${rows / people}) n
        returning id, workspace_id, split_part(summary, ' ', 1) as person_id
      )
      insert into crm.activity_participants (activity_id, person_id)
      select id, person_id::uuid from created
    `;
    await scratch`
      with created as (
        insert into crm.journal_posts (workspace_id, body)
        select workspace.id, 'day ' || md5(n::text)
        from crm.workspaces workspace
        cross join generate_series(1,
          case when workspace.id = ${large}::uuid then ${rows} else 20 end) n
        returning id, workspace_id, occurred_at
      )
      insert into crm.journal_items (workspace_id, occurred_at, journal_post_id)
      select workspace_id, occurred_at, id from created
    `;
    await scratch`
      insert into crm.tasks (workspace_id, person_id, title)
      select person.workspace_id, person.id, 'call ' || md5(n::text)
      from crm.people person
      cross join generate_series(1, ${rows / people}) n
    `;
    await scratch`analyze`;
    const explaining = connectDatabase(url);
    try {
      const shared = word();
      const indexes = scannedIndexes(
        await textStatementPlan(explaining.db, {
          limit: 5,
          nameFold: [],
          nameForms: [],
          memberId: crypto.randomUUID(),
          query: shared,
          role: "owner",
          sort: "given-name",
          terms: [shared],
          userId: owner,
          workspaceId: large,
        }),
      );
      for (
        const index of [
          "notes_search_idx",
          "activities_search_idx",
          "journal_posts_search_idx",
          "tasks_search_idx",
        ]
      ) {
        assert(
          indexes.includes(index),
          `the text statement does not scan ${index}: ${indexes.join(", ")}`,
        );
      }
    } finally {
      await explaining.destroy();
    }
  });
});

Deno.test("[SEARCH-001] closes its connections", async () => {
  await closeResources();
});
