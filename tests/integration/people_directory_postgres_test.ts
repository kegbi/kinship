/**
 * People creation and the directory (split from `people_postgres_test.ts`,
 * GAP-035): tenant-safe, duplicate-guided creation, directory search and
 * paging, stale workspace context, revocation races, and recent views.
 *
 * Its final test closes the app and pools it loaded from
 * `people.test-helper.ts`.
 */

import postgres from "postgres";
import { Kysely, sql as kyselySql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import { type PeopleActor } from "../../packages/backend/modules/people/public.ts";
import { type ApplicationDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createPeopleDirectory,
  createPeopleTagOptions,
  type PeopleDirectoryCursor,
} from "../../packages/backend/read-models/people-directory/public.ts";
import {
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresPeopleDirectoryRepository } from "../../packages/backend/read-models/people-directory/adapters/postgres/people_directory_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  actors,
  bounded,
  configured,
  counts,
  createPerson,
  createStaleActorFixture,
  databaseUrl,
  deferred,
  directory,
  type Fixture,
  getPerson,
  listPeople,
  listTagOptions,
  people,
  raceSql,
  racingPeople,
  register,
  revocationScenarios,
  sql,
} from "./people.test-helper.ts";
import { closeResources } from "./people.test-helper.ts";
import {
  assertCrossWorkspaceRefused,
  resetDatabase,
  truncate,
} from "../support/database.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { readWithinWorkspace } from "../../packages/backend/platform/postgres/transactions.ts";
import { apiSupport } from "../support/api.ts";
import {
  describePlan,
  explainedPlan,
  type PlanNode,
  planNodes,
  rowsProduced,
  scansOf,
  withScratchCrm,
} from "../support/query_plan.ts";

Deno.test({
  name:
    "PEOPLE-001 real PostgreSQL creation is tenant-safe, duplicate-guided, partial, and audited",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await register("people-owner@example.test", "Owner circle");
    const foreign = await register(
      "people-foreign@example.test",
      "Foreign circle",
    );

    const first = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const firstBody = await first.json() as {
      readonly next: string;
      readonly person: { readonly id: string };
    };
    assert(first.status === 201, "person is created");
    assert(
      firstBody.next === `/app/people/${firstBody.person.id}`,
      "response names the canonical person destination",
    );
    const firstRead = await getPerson(owner, firstBody.person.id);
    assert(firstRead.status === 200, "created identity is directly readable");
    const firstReadBody = await firstRead.json() as {
      readonly person: { readonly familyName?: string; readonly id: string };
      readonly status: string;
    };
    assert(
      firstReadBody.status === "ready" &&
        firstReadBody.person.id === firstBody.person.id &&
        firstReadBody.person.familyName === "Lovelace",
      "canonical read returns the saved identity",
    );

    const warning = await createPerson(owner, {
      familyName: "  lovelace ",
      givenName: " ADA ",
      isPartial: false,
    });
    assert(warning.status === 409, "same-workspace exact name is guidance");
    assert(
      (await warning.json() as { readonly code: string }).code ===
        "possible_duplicate",
      "duplicate guidance uses a stable problem code",
    );
    const override = await createPerson(owner, {
      duplicateOverride: true,
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    assert(override.status === 201, "member can explicitly keep both people");

    const partial = await createPerson(owner, {
      familyName: "Unknown-first-name",
      givenName: "",
      isPartial: true,
    });
    assert(partial.status === 201, "explicit partial identity persists");
    const foreignSameName = await createPerson(foreign, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    assert(
      foreignSameName.status === 201,
      "other workspace names do not conflict",
    );
    const foreignBody = await foreignSameName.json() as {
      readonly person: { readonly id: string };
    };
    assert(
      (await getPerson(owner, foreignBody.person.id)).status === 404,
      "foreign-workspace identity is indistinguishable from not found",
    );
    assert(
      (await getPerson(owner, crypto.randomUUID())).status === 404,
      "missing identity remains explicit",
    );

    const [ownerIdentity] = await sql<{ readonly id: string }[]>`
      select u.id::text
      from crm.users u
      join crm.workspace_members member on member.user_id = u.id
      where member.id = ${owner.memberId}
    `;
    assert(ownerIdentity, "owner identity exists");
    const forgedActor = await people.create({
      memberId: owner.memberId,
      role: "owner",
      userId: ownerIdentity.id,
      workspaceId: foreign.workspaceId,
    }, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    assert(
      forgedActor.status === "forbidden",
      "adapter does not expose foreign-workspace duplicate guidance",
    );

    const crossed = await createPerson(owner, {
      givenName: "Must not exist",
      isPartial: false,
    }, foreign.workspaceId);
    assert(crossed.status === 401, "foreign workspace selection is rejected");

    const [proof] = await sql<{
      readonly audit_count: number;
      readonly foreign_count: number;
      readonly owner_count: number;
      readonly partial_given_name: string;
      readonly partial_value: boolean;
      readonly wrong_creator_count: number;
    }[]>`
      select
        (select count(*)::int from crm.people
          where workspace_id = ${owner.workspaceId}) owner_count,
        (select count(*)::int from crm.people
          where workspace_id = ${foreign.workspaceId}) foreign_count,
        (select count(*)::int from crm.people
          where workspace_id = ${owner.workspaceId}
            and created_by_member_id <> ${owner.memberId}) wrong_creator_count,
        (select given_name from crm.people
          where workspace_id = ${owner.workspaceId}
            and family_name = 'Unknown-first-name') partial_given_name,
        (select is_partial from crm.people
          where workspace_id = ${owner.workspaceId}
            and family_name = 'Unknown-first-name') partial_value,
        (select count(*)::int from crm.audit_events
          where workspace_id = ${owner.workspaceId}
            and action = 'people.person-created'
            and person_id = subject_id
            and actor_member_id = ${owner.memberId}) audit_count
    `;
    assert(
      proof?.owner_count === 3 && proof.foreign_count === 1,
      "duplicate warning and crossed request add no rows",
    );
    assert(
      proof.wrong_creator_count === 0,
      "creator is active workspace member",
    );
    assert(
      proof.partial_given_name === "" && proof.partial_value === true,
      "unknown given name remains empty and explicitly partial",
    );
    assert(proof.audit_count === 3, "every committed owner person is audited");
  },
});

Deno.test({
  name:
    "PEOPLE-002 real PostgreSQL directory isolates, searches, filters, sorts, paginates, and distinguishes lifecycle",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    const owner = await register(
      `directory-owner-${crypto.randomUUID()}@example.test`,
      "Directory circle",
    );
    const foreign = await register(
      `directory-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign directory",
    );
    const adaId = crypto.randomUUID();
    const graceId = crypto.randomUUID();
    const alanId = crypto.randomUUID();
    const archivedId = crypto.randomUUID();
    const deletedId = crypto.randomUUID();
    const foreignPersonId = crypto.randomUUID();
    const friendsTagId = crypto.randomUUID();
    const foreignTagId = crypto.randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name, family_name,
          is_starred, created_at, updated_at
        ) values
          (${adaId}, ${owner.workspaceId}, ${owner.memberId}, 'Ada',
            'Lovelace', true, '2026-08-12T12:00:00Z', now()),
          (${graceId}, ${owner.workspaceId}, ${owner.memberId}, 'Grace',
            'Hopper', false, '2026-08-13T12:00:00Z', now()),
          (${alanId}, ${owner.workspaceId}, ${owner.memberId}, 'Alan',
            'Turing', false, '2026-08-14T12:00:00Z', now()),
          (${archivedId}, ${owner.workspaceId}, ${owner.memberId}, 'Harriet',
            'Tubman', false, '2026-08-11T12:00:00Z', now()),
          (${deletedId}, ${owner.workspaceId}, ${owner.memberId}, 'Deleted',
            'Person', false, '2026-08-10T12:00:00Z', now())
      `;
      await transaction`
        update crm.people set archived_at = '2026-08-15T12:00:00Z'
        where id = ${archivedId}
      `;
      await transaction`
        update crm.people set deleted_at = '2026-08-15T12:00:00Z'
        where id = ${deletedId}
      `;
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name, family_name
        ) values (
          ${foreignPersonId}, ${foreign.workspaceId}, ${foreign.memberId},
          'Foreign', 'Ada'
        )
      `;
      await transaction`
        insert into crm.tags (id, workspace_id, name, slug) values
          (${friendsTagId}, ${owner.workspaceId}, 'Friends', 'friends'),
          (${foreignTagId}, ${foreign.workspaceId}, 'Private', 'private')
      `;
      await transaction`
        insert into crm.tags (id, workspace_id, name, slug)
        select gen_random_uuid(), ${owner.workspaceId},
          'Bulk ' || lpad(sequence::text, 2, '0'),
          'bulk-' || lpad(sequence::text, 2, '0')
        from generate_series(1, 25) sequence
      `;
      await transaction`
        insert into crm.person_tags (person_id, tag_id, workspace_id) values
          (${adaId}, ${friendsTagId}, ${owner.workspaceId}::uuid),
          (${foreignPersonId}, ${foreignTagId}, ${foreign.workspaceId}::uuid)
      `;
      await transaction`
        insert into crm.person_tags (person_id, tag_id, workspace_id)
        select ${adaId}, tag.id, ${owner.workspaceId}::uuid
        from crm.tags tag
        where tag.workspace_id = ${owner.workspaceId}
          and tag.slug between 'bulk-01' and 'bulk-07'
      `;
    });
    // Schema v14 refuses a link from Ada to another workspace's tag outright
    // (ADR 0008), so the listing below can only meet links that can exist.
    await assertCrossWorkspaceRefused(
      () =>
        sql`insert into crm.person_tags (person_id, tag_id, workspace_id)
          values (${adaId}, ${foreignTagId}, ${owner.workspaceId}::uuid)`,
      "a tag link to another workspace's tag",
    );

    const searched = await listPeople(
      owner,
      "search=ada&lifecycle=active&sort=given-name",
    );
    const searchedBody = await searched.json() as {
      readonly people: readonly {
        readonly id: string;
        readonly lifecycle: string;
        readonly tagCount: number;
        readonly tags: readonly {
          readonly id: string;
          readonly name: string;
        }[];
      }[];
    };
    assert(
      searched.status === 200 && searchedBody.people.length === 1 &&
        searchedBody.people[0]?.id === adaId &&
        searchedBody.people[0]?.lifecycle === "active",
      "search returns only the matching active-workspace person",
    );
    assert(
      searchedBody.people[0]?.tags.length === 5 &&
        searchedBody.people[0]?.tagCount === 8 &&
        searchedBody.people[0]?.tags.map((tag) => tag.name).join(",") ===
          "Bulk 01,Bulk 02,Bulk 03,Bulk 04,Bulk 05" &&
        searchedBody.people[0]?.tags.every((tag) =>
          tag.id !== friendsTagId && tag.id !== foreignTagId
        ),
      "person tags are a bounded same-workspace preview with an exact count",
    );
    assert(
      !("availableTags" in searchedBody),
      "people pages never return the workspace tag vocabulary",
    );

    const firstTagPage = await listTagOptions(
      owner,
      `selected=${friendsTagId}`,
    );
    const firstTagBody = await firstTagPage.json() as {
      readonly nextCursor?: string;
      readonly options: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly selected?: { readonly id: string };
    };
    assert(
      firstTagPage.status === 200 && firstTagBody.options.length === 20 &&
        firstTagBody.nextCursor &&
        firstTagBody.selected?.id === friendsTagId &&
        firstTagBody.options.every((tag) => tag.id !== foreignTagId),
      "first tag-options page is bounded and retains a later selected tag",
    );
    const nextTagPage = await listTagOptions(
      owner,
      `selected=${friendsTagId}&cursor=${
        encodeURIComponent(firstTagBody.nextCursor)
      }`,
    );
    const nextTagBody = await nextTagPage.json() as {
      readonly nextCursor?: string;
      readonly options: readonly { readonly id: string }[];
    };
    assert(
      nextTagPage.status === 200 && nextTagBody.options.length === 6 &&
        !nextTagBody.nextCursor &&
        nextTagBody.options.some((tag) => tag.id === friendsTagId),
      "tag cursor reaches every later same-workspace option without overflow",
    );
    const searchedTags = await listTagOptions(owner, "search=FRIENDS");
    const searchedTagsBody = await searchedTags.json() as {
      readonly options: readonly { readonly id: string }[];
    };
    assert(
      searchedTags.status === 200 && searchedTagsBody.options.length === 1 &&
        searchedTagsBody.options[0]?.id === friendsTagId,
      "tag option refinement is normalized and case-insensitive",
    );
    const foreignSelectedTag = await listTagOptions(
      owner,
      `selected=${foreignTagId}&search=private`,
    );
    const foreignSelectedTagBody = await foreignSelectedTag.json() as {
      readonly options: readonly unknown[];
      readonly selected?: unknown;
    };
    assert(
      foreignSelectedTag.status === 200 &&
        foreignSelectedTagBody.options.length === 0 &&
        foreignSelectedTagBody.selected === undefined,
      "foreign selected and searched tags disclose no option or label",
    );

    const tagged = await listPeople(
      owner,
      `tag=${friendsTagId}&sort=family-name`,
    );
    const taggedBody = await tagged.json() as {
      readonly people: readonly {
        readonly id: string;
        readonly tagCount: number;
        readonly tags: readonly { readonly name: string }[];
      }[];
    };
    assert(
      tagged.status === 200 && taggedBody.people.length === 1 &&
        taggedBody.people[0]?.id === adaId &&
        taggedBody.people[0].tagCount === 8 &&
        taggedBody.people[0].tags.length === 5 &&
        taggedBody.people[0].tags.every((tag) => tag.name !== "Friends"),
      "same-workspace tag filter retains the bounded preview and exact count",
    );
    const foreignTagged = await listPeople(owner, `tag=${foreignTagId}`);
    assert(
      foreignTagged.status === 200 &&
        (await foreignTagged.json() as { readonly people: unknown[] }).people
            .length === 0,
      "foreign tag identifiers disclose no matches",
    );

    const firstPage = await listPeople(owner, "sort=family-name&limit=2");
    const firstPageBody = await firstPage.json() as {
      readonly nextCursor?: string;
      readonly people: readonly {
        readonly familyName: string;
        readonly id: string;
      }[];
    };
    assert(
      firstPageBody.people.map((person) => person.familyName).join(",") ===
          "Hopper,Lovelace" && firstPageBody.nextCursor,
      "family-name order is deterministic and paginated",
    );
    const secondPage = await listPeople(
      owner,
      `sort=family-name&limit=2&cursor=${
        encodeURIComponent(firstPageBody.nextCursor)
      }`,
    );
    const secondPageBody = await secondPage.json() as {
      readonly nextCursor?: string;
      readonly people: readonly { readonly id: string }[];
    };
    assert(
      secondPage.status === 200 && secondPageBody.people.length === 1 &&
        secondPageBody.people[0]?.id === alanId && !secondPageBody.nextCursor &&
        !("availableTags" in secondPageBody),
      "cursor continues without duplicates, offsets, or repeated tag vocabulary",
    );

    const budgetUser = await sql<{ readonly id: string }[]>`
      select user_id::text as id from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(budgetUser[0], "query budget actor exists");
    let queryCount = 0;
    const observedClient = postgres(databaseUrl, {
      debug: () => {
        queryCount += 1;
      },
      max: 1,
      onnotice: () => undefined,
    });
    const observedDatabase = new Kysely<ApplicationDatabase>({
      dialect: new PostgresJSDialect({ postgres: observedClient }),
    });
    try {
      // Establish the driver connection before measuring repository statements;
      // postgres.js performs its own type-discovery query on first connection.
      await kyselySql`select 1`.execute(observedDatabase);
      queryCount = 0;
      const observedDirectory = createPeopleDirectory({
        actors,
        repository: new PostgresPeopleDirectoryRepository(observedDatabase),
        transaction: new PostgresPeopleTransaction(observedDatabase),
      });
      const observedTagRepository = new PostgresPeopleDirectoryRepository(
        observedDatabase,
      );
      const observedTags = createPeopleTagOptions({
        actors,
        repository: observedTagRepository,
        transaction: new PostgresPeopleTransaction(observedDatabase),
      });
      const budgetActor = {
        memberId: owner.memberId,
        role: "owner" as const,
        userId: budgetUser[0].id,
        workspaceId: owner.workspaceId,
      };
      const budgetFirst = await observedDirectory.list(budgetActor, {
        limit: 1,
        sort: "given-name",
      });
      assert(
        budgetFirst.status === "ready" && budgetFirst.nextCursor &&
          queryCount === 6,
        // The actor revalidation runs in its own transaction: begin with the
        // workspace's `set local` in one message, one select, commit. Schema
        // v14 reads the page inside its workspace too (ADR 0008), so it is
        // the same bracket around one statement: 6, measured 2026-11-08
        // (4 before v14).
        "first directory page stays within the actor revalidation and one statement",
      );
      const beforeContinuation = queryCount;
      await observedDirectory.list(budgetActor, {
        cursor: budgetFirst.nextCursor,
        limit: 1,
        sort: "given-name",
      });
      assert(
        queryCount - beforeContinuation === 7,
        "cursor anchor validation keeps continuation within the actor revalidation and two statements without tag lookup",
      );
      const beforeTags = queryCount;
      const tagBudgetFirst = await observedTags.list(budgetActor, {
        selectedTagId: friendsTagId,
      });
      assert(
        tagBudgetFirst.status === "ready" &&
          tagBudgetFirst.options.length === 20 &&
          tagBudgetFirst.nextCursor &&
          tagBudgetFirst.selected?.id === friendsTagId &&
          queryCount - beforeTags === 7,
        "bounded tag options use the actor revalidation, one limited page, and one selected lookup",
      );
      const beforeTagContinuation = queryCount;
      await observedTags.list(budgetActor, {
        cursor: tagBudgetFirst.nextCursor,
      });
      assert(
        queryCount - beforeTagContinuation === 6,
        "tag continuation stays within the actor revalidation and one limited seek query",
      );
    } finally {
      await observedDatabase.destroy();
    }

    const archived = await listPeople(owner, "lifecycle=archived");
    const archivedBody = await archived.json() as {
      readonly lifecycle: string;
      readonly people: readonly {
        readonly id: string;
        readonly lifecycle: string;
      }[];
    };
    assert(
      archived.status === 200 && archivedBody.lifecycle === "archived" &&
        archivedBody.people.length === 1 &&
        archivedBody.people[0]?.id === archivedId &&
        archivedBody.people[0]?.lifecycle === "archived",
      "archived list is explicit and separate",
    );
    const archivedSelected = await listPeople(
      owner,
      `lifecycle=archived&limit=1&selectedPersonId=${archivedId}`,
    );
    const archivedSelectedBody = await archivedSelected.json() as {
      readonly selected?: { readonly id: string; readonly lifecycle: string };
    };
    assert(
      archivedSelected.status === 200 &&
        archivedSelectedBody.selected?.id === archivedId &&
        archivedSelectedBody.selected.lifecycle === "archived",
      "selected hydration honors the explicit archived lifecycle",
    );
    for (const concealedId of [foreignPersonId, deletedId]) {
      const concealed = await listPeople(
        owner,
        `lifecycle=archived&limit=1&selectedPersonId=${concealedId}`,
      );
      const body = await concealed.json() as { readonly selected?: unknown };
      assert(
        concealed.status === 200 && body.selected === undefined,
        "foreign and deleted selected identities remain concealed",
      );
    }
    const archivedRead = await getPerson(owner, archivedId);
    assert(
      archivedRead.status === 200 &&
        (await archivedRead.json() as { readonly status: string }).status ===
          "archived",
      "canonical identity read distinguishes an archived person",
    );
    assert(
      (await getPerson(owner, foreignPersonId)).status === 404 &&
        (await getPerson(owner, crypto.randomUUID())).status === 404,
      "foreign and missing identifiers remain indistinguishable not-found",
    );

    const ownerUser = await sql<{ readonly id: string }[]>`
      select user_id::text as id from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(ownerUser[0], "owner user fixture exists");
    const forbidden = await directory.list({
      memberId: owner.memberId,
      role: "owner",
      userId: ownerUser[0].id,
      workspaceId: foreign.workspaceId,
    }, {});
    assert(
      forbidden.status === "forbidden",
      "forged workspace context is forbidden without results",
    );

    await sql`update crm.people set family_name = 'Changed' where id = ${adaId}`;
    const stale = await listPeople(
      owner,
      `sort=family-name&limit=2&cursor=${
        encodeURIComponent(firstPageBody.nextCursor)
      }`,
    );
    assert(
      stale.status === 409 &&
        (await stale.json() as { readonly code: string }).code ===
          "stale_cursor",
      "a mutated cursor anchor is rejected explicitly",
    );
  },
});

Deno.test({
  name:
    "SEARCH-001 real PostgreSQL directory search matches names across scripts and keyboard layouts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await register(
      `directory-scripts-${crypto.randomUUID()}@example.test`,
      "Scripts circle",
    );
    const foreign = await register(
      `directory-scripts-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign scripts",
    );
    const elenaId = crypto.randomUUID();
    const yelenaId = crypto.randomUUID();
    const archivedId = crypto.randomUUID();
    const deletedId = crypto.randomUUID();
    await sql`
      insert into crm.people (
        id, workspace_id, created_by_member_id, given_name, family_name
      ) values
        (${elenaId}, ${owner.workspaceId}, ${owner.memberId}, 'Elena',
          'Petrova'),
        (${yelenaId}, ${owner.workspaceId}, ${owner.memberId}, 'Елена',
          'Смирнова'),
        (${archivedId}, ${owner.workspaceId}, ${owner.memberId}, 'Elena',
          'Archived'),
        (${deletedId}, ${owner.workspaceId}, ${owner.memberId}, 'Елена',
          'Deleted'),
        (${crypto.randomUUID()}, ${foreign.workspaceId}, ${foreign.memberId},
          'Elena', 'Foreign')
    `;
    await sql`
      update crm.people set archived_at = now() where id = ${archivedId}
    `;
    await sql`update crm.people set deleted_at = now() where id = ${deletedId}`;
    const found = async (search: string): Promise<string> => {
      const response = await listPeople(
        owner,
        `search=${encodeURIComponent(search)}&lifecycle=active`,
      );
      assert(response.status === 200, `the directory answers ${search}`);
      const body = await response.json() as {
        readonly people: readonly { readonly id: string }[];
      };
      return body.people.map((person) => person.id).sort().join(",");
    };
    const both = [elenaId, yelenaId].sort().join(",");
    for (const search of ["удутф", "Tktyf", "елена", "elena", "Elena P"]) {
      const expected = search === "Elena P" ? elenaId : both;
      assert(
        await found(search) === expected,
        `${search} finds Elena and Елена, never archived, deleted, or foreign`,
      );
    }
    assert(await found("смирн") === yelenaId, "a family name in Cyrillic");
    assert(await found("smirn") === yelenaId, "and its transliteration");
    assert(await found("zebra") === "", "an unrelated name finds nobody");
  },
});

Deno.test({
  name:
    "PEOPLE-001 stale active-workspace context discloses and writes nothing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const scenarios = [
      {
        actor: await createStaleActorFixture("member-left-at"),
        revoke: (actor: PeopleActor) =>
          sql`update crm.workspace_members set left_at = now()
            where id = ${actor.memberId}`,
      },
      {
        actor: await createStaleActorFixture("user-disabled"),
        revoke: (actor: PeopleActor) =>
          sql`update crm.users set status = 'disabled'
            where id = ${actor.userId}`,
      },
      {
        actor: await createStaleActorFixture("user-deleted-at"),
        revoke: (actor: PeopleActor) =>
          sql`update crm.users set deleted_at = now()
            where id = ${actor.userId}`,
      },
      {
        actor: await createStaleActorFixture("workspace-suspended"),
        revoke: (actor: PeopleActor) =>
          sql`update crm.workspaces set status = 'suspended'
            where id = ${actor.workspaceId}`,
      },
      {
        actor: await createStaleActorFixture("workspace-deleted-at"),
        revoke: (actor: PeopleActor) =>
          sql`update crm.workspaces set deleted_at = now()
            where id = ${actor.workspaceId}`,
      },
    ] as const;

    for (const scenario of scenarios) {
      await scenario.revoke(scenario.actor);
      const duplicate = await people.create(scenario.actor, {
        givenName: scenario.actor.personName,
        isPartial: false,
      });
      const override = await people.create(scenario.actor, {
        duplicateOverride: true,
        givenName: scenario.actor.personName,
        isPartial: false,
      });
      const read = await people.get(
        scenario.actor,
        scenario.actor.personId,
      );
      const [proof] = await sql<{
        readonly audit_count: number;
        readonly people_count: number;
      }[]>`
        select
          (select count(*)::int from crm.people
            where workspace_id = ${scenario.actor.workspaceId}) people_count,
          (select count(*)::int from crm.audit_events
            where workspace_id = ${scenario.actor.workspaceId}) audit_count
      `;
      assert(
        duplicate.status === "forbidden",
        `${scenario.actor.personName} duplicate name is not disclosed`,
      );
      assert(
        override.status === "forbidden",
        `${scenario.actor.personName} override is denied`,
      );
      assert(
        read.status === "forbidden",
        `${scenario.actor.personName} stale identity read is denied`,
      );
      assert(
        proof?.people_count === 1 && proof.audit_count === 0,
        `${scenario.actor.personName} inserts and audits nothing`,
      );
    }
  },
});

Deno.test({
  name:
    "PEOPLE-001 overlapping lifecycle revocations serialize with person creation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    for (const scenario of revocationScenarios) {
      const revocationWinsActor = await createStaleActorFixture(
        `race-revocation-${scenario.name}-${crypto.randomUUID()}`,
      );
      const attempted = deferred();
      const service = racingPeople(attempted);
      const revocationApplied = deferred();
      const finishRevocation = deferred();
      const revocation = raceSql.begin(async (transaction) => {
        await scenario.apply(transaction, revocationWinsActor);
        revocationApplied.resolve();
        await finishRevocation.promise;
      });
      try {
        await bounded(
          revocationApplied.promise,
          `${scenario.name} revocation acquired its lifecycle row`,
        );
        const creation = service.create(revocationWinsActor, {
          givenName: revocationWinsActor.personName,
          isPartial: false,
        });
        await bounded(
          attempted.promise,
          `${scenario.name} create reached authorization`,
        );
        finishRevocation.resolve();
        await bounded(revocation, `${scenario.name} revocation commit`);
        const result = await bounded(
          creation,
          `${scenario.name} denied create after revocation`,
        );
        assert(
          result.status === "forbidden",
          `${scenario.name} revocation wins without duplicate disclosure`,
        );
        const proof = await counts(revocationWinsActor);
        assert(
          proof.people === 1 && proof.audits === 0,
          `${scenario.name} revocation winner writes and audits nothing`,
        );
      } finally {
        finishRevocation.resolve();
        await Promise.allSettled([revocation]);
      }

      const createWinsActor = await createStaleActorFixture(
        `race-create-${scenario.name}-${crypto.randomUUID()}`,
      );
      const createAttempted = deferred();
      const createLock = { ready: deferred(), release: deferred() };
      const createService = racingPeople(createAttempted, createLock);
      const createdName = `Created before ${scenario.name}`;
      const creation = createService.create(createWinsActor, {
        givenName: createdName,
        isPartial: false,
      });
      try {
        await bounded(
          createLock.ready.promise,
          `${scenario.name} create acquired lifecycle locks`,
        );
        const lifecycleLockBlockedRevocation = await raceSql.begin(
          async (transaction) => {
            await transaction`set local lock_timeout = '250ms'`;
            try {
              await transaction.savepoint((savepoint) =>
                scenario.apply(savepoint, createWinsActor)
              );
              return false;
            } catch (error) {
              return error instanceof raceSql.PostgresError &&
                error.code === "55P03";
            }
          },
        );
        assert(
          lifecycleLockBlockedRevocation,
          `${scenario.name} competing revocation is bounded by the create lock`,
        );
        createLock.release.resolve();
        const result = await bounded(
          creation,
          `${scenario.name} atomic create commit`,
        );
        assert(
          result.status === "created",
          `${scenario.name} create winner commits before revocation`,
        );
        await bounded(
          raceSql.begin((transaction) =>
            scenario.apply(transaction, createWinsActor)
          ),
          `${scenario.name} post-create revocation`,
        );
        const subsequent = await bounded(
          createService.create(createWinsActor, {
            givenName: createdName,
            isPartial: false,
          }),
          `${scenario.name} subsequent create denial`,
        );
        assert(
          subsequent.status === "forbidden",
          `${scenario.name} subsequent create is forbidden without disclosure`,
        );
        const proof = await counts(createWinsActor);
        assert(
          proof.people === 2 && proof.audits === 1,
          `${scenario.name} create winner is atomic before revocation`,
        );
      } finally {
        createLock.release.resolve();
        await Promise.allSettled([creation]);
      }
    }
  },
});

Deno.test({
  name:
    "TODAY-001 PostgreSQL recent views serialize by member and remain tenant-safe",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = await register("rv-owner@example.test", "Recent circle");
    const foreign = await register("rv-foreign@example.test", "Other circle");
    const add = async (owner: Fixture, givenName: string) => {
      const created = await createPerson(owner, {
        givenName,
        isPartial: false,
      });
      const body = await created.json() as {
        readonly person: { readonly id: string };
      };
      assert(created.status === 201, `${givenName} fixture creates`);
      return body.person.id;
    };
    const [adaId, graceId, foreignId, deletedId] = await Promise.all([
      add(fixture, "Ada"),
      add(fixture, "Grace"),
      add(foreign, "Foreign"),
      add(fixture, "Deleted"),
    ]);
    const peerMemberId = crypto.randomUUID();
    const [foreignAccount] = await sql<{ readonly userId: string }[]>`
      select user_id::text as "userId" from crm.workspace_members
      where id = ${foreign.memberId}::uuid
    `;
    assert(foreignAccount, "peer account exists");
    await sql.begin(async (transaction) => {
      await transaction`
        insert into crm.workspace_members (
          id, workspace_id, user_id, role, status, joined_at
        ) values (
          ${peerMemberId}, ${fixture.workspaceId}, ${foreignAccount.userId},
          'member', 'active', now()
        )
      `;
      await transaction`
        insert into crm.member_preferences (member_id)
        values (${peerMemberId})
      `;
    });
    const peer: Fixture = {
      cookie: foreign.cookie,
      memberId: peerMemberId,
      workspaceId: fixture.workspaceId,
    };
    await sql`
      update crm.people set archived_at = now()
      where id = ${adaId}::uuid and workspace_id = ${fixture.workspaceId}::uuid
    `;
    await sql`
      update crm.people set deleted_at = now()
      where id = ${deletedId}::uuid and workspace_id = ${fixture.workspaceId}::uuid
    `;
    await sql`
      update crm.member_preferences
      set ui_state = '{"dismissedWelcome":true,"recentPersonIds":"bad"}'::jsonb
      where member_id = ${fixture.memberId}::uuid
    `;
    const view = (personId: string) =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}/view`,
        {
          headers: {
            cookie: fixture.cookie,
            origin: "http://localhost",
            "X-Workspace-Id": fixture.workspaceId,
          },
          method: "POST",
        },
      );
    assert((await view(foreignId)).status === 404, "foreign view is rejected");

    const clientOptions = { max: 1, onnotice: () => undefined };
    const locker = postgres(databaseUrl, clientOptions);
    const observer = postgres(databaseUrl, clientOptions);
    let signalLocked!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => signalLocked = resolve);
    let releaseLocker!: () => void;
    const release = new Promise<void>((resolve) => releaseLocker = resolve);
    const lockerWork = locker.begin(async (transaction) => {
      const [backend] = await transaction<{ readonly pid: number }[]>`
        select pg_backend_pid()::int as pid
      `;
      assert(backend, "recent-view locker PID exists");
      await transaction`
        select member_id from crm.member_preferences
        where member_id = ${fixture.memberId}::uuid for update
      `;
      signalLocked(backend.pid);
      await release;
    });
    const lockerPid = await locked;
    const first = view(adaId);
    const waiters = async (blockerPid: number, expected: number) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await observer<{ readonly pid: number }[]>`
          select activity.pid::int from pg_stat_activity activity
          where ${blockerPid}::int = any(pg_blocking_pids(activity.pid))
            and activity.wait_event_type = 'Lock'
          order by activity.pid
        `;
        if (rows.length === expected) return rows.map((row) => row.pid);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`expected ${expected} waiters blocked by ${blockerPid}`);
    };
    try {
      const [firstPid] = await waiters(lockerPid, 1);
      assert(firstPid, "first recent-view backend PID exists");
      const second = view(graceId);
      await waiters(firstPid, 1);
      releaseLocker();
      const responses = await Promise.all([first, second]);
      await lockerWork;
      assert(
        responses.every((response) => response.status === 200),
        "queued views commit",
      );

      const today = (owner: Fixture) =>
        configured.app.request("http://localhost/api/v1/today/recent-people", {
          headers: {
            cookie: owner.cookie,
            "X-Workspace-Id": owner.workspaceId,
          },
        });
      const recent = await today(fixture);
      const body = await recent.json() as Record<string, unknown>;
      const people = body.people as
        | readonly { readonly archived: boolean; readonly id: string }[]
        | undefined;
      const [state] = await sql<{
        readonly stored: string;
        readonly type: string;
      }[]>`
        select ui_state::text as stored, jsonb_typeof(ui_state) as type
        from crm.member_preferences
        where member_id = ${fixture.memberId}::uuid
      `;
      assert(
        recent.status === 200 && people?.[0]?.id === graceId &&
          people[1]?.id === adaId && people[1]?.archived === true &&
          state?.stored.includes('"dismissedWelcome": true'),
        `serialized ordering, archived visibility, or sparse state was lost: ${
          JSON.stringify({ body, responseStatus: recent.status, state })
        }`,
      );
      const staleId = crypto.randomUUID();
      await sql`
        update crm.member_preferences
        set ui_state = jsonb_set(
          ui_state, '{recentPersonIds}', jsonb_build_array(
            'invalid'::text, ${staleId}::text, ${deletedId}::text,
            ${graceId.toUpperCase()}::text, ${graceId}::text, ${adaId}::text
          )
        )
        where member_id = ${fixture.memberId}::uuid
      `;
      const peerRecent = await today(peer);
      const ownerAgain = await today(fixture);
      const peerPeople = (await peerRecent.json() as {
        readonly people: readonly { readonly id: string }[];
      }).people;
      const ownerPeople = (await ownerAgain.json() as {
        readonly people: readonly { readonly id: string }[];
      }).people;
      assert(
        peerPeople.length === 0 && ownerPeople[0]?.id === graceId &&
          ownerPeople[1]?.id === adaId,
        `same-workspace member history leaked or changed owner ordering: ${
          JSON.stringify({ ownerPeople, peerPeople })
        }`,
      );
      const foreignRecent = await today(foreign);
      assert(
        (await foreignRecent.json() as { readonly people: unknown[] }).people
          .length === 0,
        "one member's recent history leaked to another tenant",
      );
    } finally {
      releaseLocker();
      await Promise.allSettled([lockerWork]);
      await Promise.all([locker.end(), observer.end()]);
    }
  },
});

Deno.test({
  name:
    "AUD-K3 a directory page costs at most 8 statements, and a stalled one answers 503 within the timeout",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // A pool of its own whose every statement is observed, so the count is
    // the request's alone: each statement is one round trip (BEQ-04).
    let observed: string[] | undefined;
    const countedMail = new CapturedVerificationMail();
    const counted = createConfiguredApiApp(
      databaseUrl,
      countedMail,
      browserSecurityPolicy("test", "http://localhost"),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (url) =>
        connectDatabase(url, {
          onStatement: (text) => observed?.push(text),
        }),
    );
    const countedApi = apiSupport(counted.app, countedMail, sql);
    await resetDatabase(sql);
    const locker = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const owner = await countedApi.register(
        "round-trips-owner@example.test",
        "Round trips circle",
      );
      for (const givenName of ["Ada", "Grace", "Katherine"]) {
        const created = await countedApi.request(
          owner,
          "/api/v1/people",
          "POST",
          { givenName, isPartial: false },
        );
        assert(created.status === 201, `${givenName} is created`);
      }
      // The first read prepares what later reads reuse.
      const warm = await countedApi.request(owner, "/api/v1/people?limit=20");
      assert(warm.status === 200, "the warm-up read answers");
      await warm.body?.cancel();

      observed = [];
      const listed = await countedApi.request(owner, "/api/v1/people?limit=20");
      const statements = observed;
      observed = undefined;
      const body = await listed.json() as { readonly people: unknown[] };
      assert(
        listed.status === 200 && body.people.length === 3,
        "the counted read answers the directory",
      );
      assert(
        statements.length <= 8,
        `GET /api/v1/people?limit=20 sent ${statements.length} statements:\n${
          statements.map((text) => text.replace(/\s+/g, " ").slice(0, 90))
            .join("\n")
        }`,
      );

      // Each parameterized statement is prepared once per connection and
      // reused, so a repeated one is neither parsed nor planned again.
      const prepared = connectDatabase(databaseUrl);
      try {
        const statements = await prepared.db.connection().execute(
          async (connection) => {
            for (const name of ["first", "second"]) {
              await kyselySql`select ${name}::text as aud_k3_prepared`
                .execute(connection);
            }
            const result = await kyselySql<{ readonly count: number }>`
              select count(*)::int as count from pg_prepared_statements
              where statement like '%aud_k3_prepared%'
            `.execute(connection);
            return result.rows[0]?.count;
          },
        );
        assert(statements === 1, `the statement was prepared ${statements}x`);
      } finally {
        await prepared.destroy();
      }

      // A statement that cannot finish is cancelled by the pool's timeout,
      // and the request answers 503 well before the gateway's 15 s.
      const held = deferred();
      const released = deferred();
      const holding = locker.begin(async (transaction) => {
        await transaction`lock table crm.people in access exclusive mode`;
        held.resolve();
        await released.promise;
      });
      await held.promise;
      const started = performance.now();
      try {
        const stalled = await bounded(
          Promise.resolve(
            countedApi.request(owner, "/api/v1/people?limit=20"),
          ),
          "the stalled directory read",
          13_000,
        );
        const elapsed = performance.now() - started;
        assert(stalled.status === 503, `a stalled read answers 503`);
        await stalled.body?.cancel();
        assert(
          elapsed >= 9_000 && elapsed < 12_000,
          `the stalled read gave up after ${Math.round(elapsed)} ms`,
        );
      } finally {
        released.resolve();
        await holding.catch(() => undefined);
      }

      // A read trusts only the resolution of its own request, and that
      // resolution holds the revalidation's predicate: an account marked
      // deleted is refused on its very next request.
      await sql`update crm.users set deleted_at = now()
        where id = ${owner.userId}`;
      const refused = await countedApi.request(
        owner,
        "/api/v1/people?limit=20",
      );
      assert(
        refused.status === 401,
        `a deleted account's next read is refused (${refused.status})`,
      );
      await refused.body?.cancel();
    } finally {
      await locker.end();
      await counted.close();
    }
  },
});

/**
 * What `GET /api/v1/session` sends, measured with this harness on 2026-11-08:
 * 4 statements before AUD-F3 (the session, the membership, the legal
 * requirements, the UI state) and 4 after it, because the preferences are
 * read by the UI-state statement. Schema v14 (ADR 0008) reads the legal
 * requirements and the UI state inside the member's workspace, each in a
 * read-only transaction whose `begin` carries the `set local` in one message
 * and ends with a `commit`: 8, measured the same day. The preferences still
 * add no statement of their own.
 */
const SESSION_STATEMENTS = 8;

Deno.test({
  name:
    "AUD-F3 the session carries the member's own preferences at no extra statement",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // A pool of its own whose every statement is observed (AUD-K3).
    let observed: string[] | undefined;
    const countedMail = new CapturedVerificationMail();
    const counted = createConfiguredApiApp(
      databaseUrl,
      countedMail,
      browserSecurityPolicy("test", "http://localhost"),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (url) =>
        connectDatabase(url, {
          onStatement: (text) => observed?.push(text),
        }),
    );
    const countedApi = apiSupport(counted.app, countedMail, sql);
    await resetDatabase(sql);
    try {
      const owner = await countedApi.register(
        "session-preferences-owner@example.test",
        "Session preferences circle",
      );
      const peer = await countedApi.register(
        "session-preferences-peer@example.test",
        "Peer circle",
      );
      await sql`
        update crm.member_preferences set locale = 'sr-Latn',
          timezone = 'Europe/Belgrade', contact_name_order = 'family_given_nickname',
          fluid_layout = true
        where member_id = ${owner.memberId}::uuid
      `;
      // The first read prepares what later reads reuse.
      const warm = await countedApi.request(owner, "/api/v1/session");
      assert(warm.status === 200, "the warm-up session read answers");
      await warm.body?.cancel();

      observed = [];
      const read = await countedApi.request(owner, "/api/v1/session");
      const statements = observed;
      observed = undefined;
      const body = await read.json() as {
        readonly preferences?: Readonly<Record<string, unknown>>;
        readonly uiState?: unknown;
      };
      // The preferences add no round trip to the session (AUD-K3's budget).
      assert(
        statements.length <= SESSION_STATEMENTS,
        `GET /api/v1/session sent ${statements.length} statements:\n${
          statements.map((text) => text.replace(/\s+/g, " ").slice(0, 90))
            .join("\n")
        }`,
      );

      assert(
        read.status === 200 && body.preferences?.locale === "sr-Latn" &&
          body.preferences.effectiveTimezone === "Europe/Belgrade" &&
          body.preferences.contactNameOrder === "family_given_nickname" &&
          body.preferences.fluidLayout === true && body.uiState !== undefined,
        `the session omitted the member's preferences: ${JSON.stringify(body)}`,
      );
      const peerRead = await countedApi.request(peer, "/api/v1/session");
      const peerBody = await peerRead.json() as {
        readonly preferences?: Readonly<Record<string, unknown>>;
      };
      assert(
        peerRead.status === 200 && peerBody.preferences?.locale !== "sr-Latn" &&
          peerBody.preferences?.fluidLayout === false,
        `another member's session carried the owner's preferences: ${
          JSON.stringify(peerBody)
        }`,
      );

      // A membership without a preference row still has a session; its
      // islands fall back to their neutral defaults.
      await sql`delete from crm.member_preferences
        where member_id = ${peer.memberId}::uuid`;
      const bare = await countedApi.request(peer, "/api/v1/session");
      const bareBody = await bare.json() as Record<string, unknown>;
      assert(
        bare.status === 200 && !("preferences" in bareBody) &&
          JSON.stringify(bareBody.uiState) === "{}",
        `a membership without preferences broke its session: ${
          JSON.stringify(bareBody)
        }`,
      );
    } finally {
      await counted.close();
    }
  },
});

/** Rows a scan read and then discarded on its filter, across its loops. */
function rowsFiltered(node: PlanNode): number {
  const removed = (node as { readonly "Rows Removed by Filter"?: number })[
    "Rows Removed by Filter"
  ] ?? 0;
  return removed * (node["Actual Loops"] ?? 1);
}

Deno.test({
  name:
    "PEOPLE-001 AUD-V1 the name order, its continuation, and the duplicate check read their people through an index",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withScratchCrm(sql, databaseUrl, async ({ sql: scratch, url }) => {
      const [userId, workspaceId, memberId] = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      await scratch`insert into crm.users (id, email) values (${userId}, 'plan@example.test')`;
      await scratch`
        insert into crm.workspaces (id, name, created_by_user_id)
        values (${workspaceId}, 'Large', ${userId})
      `;
      await scratch`
        insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at)
        values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now())
      `;
      // Enough people that reading them all is visibly different from
      // reading a page, some archived and some with a nickname only.
      await scratch`
        insert into crm.people (workspace_id, given_name, family_name,
          nickname, archived_at)
        select ${workspaceId}::uuid,
          case when n % 7 = 0 then '' else 'Given ' || lpad(n::text, 5, '0') end,
          'Family ' || (n % 97), 'Nick ' || n,
          case when n % 11 = 0 then now() end
        from generate_series(1, 6000) n
      `;
      await scratch`analyze`;
      const actor = { memberId, role: "owner" as const, userId, workspaceId };
      const explaining = connectDatabase(url);
      try {
        const directoryRepository = new PostgresPeopleDirectoryRepository(
          explaining.db,
        );
        const criteria = {
          ...actor,
          lifecycle: "active" as const,
          limit: 20,
          nameFold: [],
          nameForms: [],
          search: "",
          sort: "given-name" as const,
          starred: false,
          starredFirst: false,
        };
        let middle: PeopleDirectoryCursor | undefined;
        for (let index = 0; index < 50; index++) {
          const page = await directoryRepository.list({
            ...criteria,
            ...(middle ? { after: middle } : {}),
          });
          assert(page.status === "ready", "a page reads");
          middle = page.people.at(-1)!.cursor;
        }
        for (
          const [label, after] of [
            ["the first page", undefined],
            ["a continuation a thousand people in", middle],
          ] as const
        ) {
          const plan = await explainedPlan(
            explaining.db,
            (statement) => statement.includes("row_number() over"),
            (database) =>
              new PostgresPeopleDirectoryRepository(database).list({
                ...criteria,
                ...(after ? { after } : {}),
              }),
          );
          const scans = scansOf(plan, "people");
          const read = scans.reduce(
            (sum, scan) => sum + rowsProduced(scan) + rowsFiltered(scan),
            0,
          );
          assert(
            scans.some((scan) =>
              scan["Index Name"] === "people_active_given_name_idx"
            ) && read <= 4 * criteria.limit,
            `${label} reads ${read} people rather than its page: ${
              describePlan(plan)
            }`,
          );
        }

        const duplicates = await explainedPlan(
          explaining.db,
          (statement) => statement.includes("duplicate_given_name ="),
          // In the actor's workspace, as the people runner opens it (ADR
          // 0008): the stored keys are what the index seeks under RLS (Q4).
          (database) =>
            readWithinWorkspace(
              database,
              workspaceId,
              (transaction) =>
                new PostgresPeopleRepository().findPossibleDuplicates({
                  ...actor,
                  familyName: "Family 3",
                  givenName: "Given 00003",
                  isPartial: false,
                  nickname: "Nick 3",
                  transaction: { opaque: transaction },
                }),
            ),
        );
        const duplicateScans = scansOf(duplicates, "people");
        assert(
          planNodes(duplicates).some((node) =>
            node["Index Name"] === "people_active_duplicate_name_idx"
          ) &&
            duplicateScans.every((scan) => scan["Node Type"] !== "Seq Scan") &&
            duplicateScans.reduce(
                (sum, scan) => sum + rowsProduced(scan) + rowsFiltered(scan),
                0,
              ) <= 5,
          `the duplicate check scans the workspace's people: ${
            describePlan(duplicates)
          }`,
        );
      } finally {
        await explaining.destroy();
      }
    });
  },
});

Deno.test({
  name: "PEOPLE-001 PostgreSQL directory resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
