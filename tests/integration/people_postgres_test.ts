import postgres from "postgres";
import { Kysely, sql as kyselySql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createPeopleManagement,
  type PeopleActor,
  type PeopleRepository,
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/public.ts";
import { PostgresPersonCreatedAudit } from "../../packages/backend/modules/governance/public.ts";
import {
  type ApplicationDatabase,
  connectDatabase,
} from "../../packages/backend/platform/postgres/database.ts";
import {
  createPeopleDirectory,
  createPeopleTagOptions,
  PostgresPeopleDirectoryRepository,
} from "../../packages/backend/read-models/people-directory/public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests");
}
const sql = postgres(databaseUrl, { max: 3, onnotice: () => undefined });
const raceSql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const peopleConnection = connectDatabase(databaseUrl);
const people = createPeopleManagement({
  audit: new PostgresPersonCreatedAudit(),
  clock: { now: () => new Date() },
  ids: { create: () => crypto.randomUUID() },
  repository: new PostgresPeopleRepository(),
  transaction: new PostgresPeopleTransaction(peopleConnection.db),
});
const directory = createPeopleDirectory({
  repository: new PostgresPeopleDirectoryRepository(peopleConnection.db),
});
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const password = "correct horse battery staple";

interface Fixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly workspaceId: string;
}

async function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  const registration = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "Test",
        lastName: "Member",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registration.status === 202, "fixture registers");
  const token = mail.latestToken(email);
  assert(token, "fixture verification token captured");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )).status === 200,
    "fixture verifies",
  );
  const signed = await configured.app.request(
    "http://localhost/api/v1/sessions",
    {
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  const body = await signed.json() as {
    readonly member: { readonly id: string };
    readonly workspace: { readonly id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  assert(signed.status === 200 && cookie, "fixture signs in");
  return {
    cookie,
    memberId: body.member.id,
    workspaceId: body.workspace.id,
  };
}

async function createPerson(
  fixture: Fixture,
  body: Readonly<Record<string, unknown>>,
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return await configured.app.request("http://localhost/api/v1/people", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: fixture.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": workspaceId,
    },
    method: "POST",
  });
}

async function getPerson(
  fixture: Fixture,
  personId: string,
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people/${personId}`,
    {
      headers: {
        cookie: fixture.cookie,
        "X-Workspace-Id": workspaceId,
      },
    },
  );
}

async function listPeople(
  fixture: Fixture,
  query = "",
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people${query ? `?${query}` : ""}`,
    {
      headers: {
        cookie: fixture.cookie,
        "X-Workspace-Id": fixture.workspaceId,
      },
    },
  );
}

async function listTagOptions(
  fixture: Fixture,
  query = "",
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people/tag-options${query ? `?${query}` : ""}`,
    {
      headers: {
        cookie: fixture.cookie,
        "X-Workspace-Id": fixture.workspaceId,
      },
    },
  );
}

async function createStaleActorFixture(
  name: string,
): Promise<
  PeopleActor & { readonly personId: string; readonly personName: string }
> {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  const personName = `Hidden ${name}`;
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.users (id, email, first_name, status)
      values (${userId}, ${`${name}@example.test`}, 'Stale', 'active')
    `;
    await transaction`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values (${workspaceId}, ${`${name} circle`}, 'active', ${userId})
    `;
    await transaction`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (
        ${memberId}, ${workspaceId}, ${userId}, 'member', 'active', now()
      )
    `;
    await transaction`
      insert into crm.people (
        id, workspace_id, created_by_member_id, given_name
      ) values (${personId}, ${workspaceId}, ${memberId}, ${personName})
    `;
  });
  return {
    memberId,
    personId,
    personName,
    role: "member",
    userId,
    workspaceId,
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

async function bounded<T>(
  operation: Promise<T>,
  label: string,
  milliseconds = 3_000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

interface RevocationScenario {
  readonly name: string;
  apply(
    transaction: postgres.TransactionSql,
    actor: PeopleActor,
  ): Promise<void>;
}

const revocationScenarios: readonly RevocationScenario[] = [
  {
    name: "member-left-at",
    async apply(transaction, actor) {
      await transaction`update crm.workspace_members set left_at = now()
        where id = ${actor.memberId}`;
    },
  },
  {
    name: "user-disabled",
    async apply(transaction, actor) {
      await transaction`update crm.users set status = 'disabled'
        where id = ${actor.userId}`;
    },
  },
  {
    name: "user-deleted-at",
    async apply(transaction, actor) {
      await transaction`update crm.users set deleted_at = now()
        where id = ${actor.userId}`;
    },
  },
  {
    name: "workspace-suspended",
    async apply(transaction, actor) {
      await transaction`update crm.workspaces set status = 'suspended'
        where id = ${actor.workspaceId}`;
    },
  },
  {
    name: "workspace-deleted-at",
    async apply(transaction, actor) {
      await transaction`update crm.workspaces set deleted_at = now()
        where id = ${actor.workspaceId}`;
    },
  },
];

function racingPeople(
  authorizationAttempted: Deferred,
  authorizationLocked?: {
    readonly release: Deferred;
    readonly ready: Deferred;
  },
) {
  const delegate = new PostgresPeopleRepository();
  const repository: PeopleRepository = {
    async revalidateAndLockCreateContext(command) {
      authorizationAttempted.resolve();
      const authorized = await delegate.revalidateAndLockCreateContext(command);
      if (authorized && authorizationLocked) {
        authorizationLocked.ready.resolve();
        await authorizationLocked.release.promise;
      }
      return authorized;
    },
    assertCreatedPostcondition: (command) =>
      delegate.assertCreatedPostcondition(command),
    create: (command) => delegate.create(command),
    findPossibleDuplicates: (command) =>
      delegate.findPossibleDuplicates(command),
    getIdentity: (command) => delegate.getIdentity(command),
  };
  return createPeopleManagement({
    audit: new PostgresPersonCreatedAudit(),
    clock: { now: () => new Date() },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: new PostgresPeopleTransaction(peopleConnection.db),
  });
}

async function counts(actor: PeopleActor): Promise<{
  readonly audits: number;
  readonly people: number;
}> {
  const [proof] = await sql<{
    readonly audits: number;
    readonly people: number;
  }[]>`
    select
      (select count(*)::int from crm.people
        where workspace_id = ${actor.workspaceId}) people,
      (select count(*)::int from crm.audit_events
        where workspace_id = ${actor.workspaceId}
          and action = 'people.person-created') audits
  `;
  assert(proof, "race proof is present");
  return proof;
}

Deno.test({
  name:
    "PEOPLE-001 real PostgreSQL creation is tenant-safe, duplicate-guided, partial, and audited",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
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
    await sql`truncate table crm.users, crm.workspaces restart identity cascade`;
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
            'Tubman', false, '2026-08-11T12:00:00Z', now())
      `;
      await transaction`
        update crm.people set archived_at = '2026-08-15T12:00:00Z'
        where id = ${archivedId}
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
        insert into crm.person_tags (person_id, tag_id) values
          (${adaId}, ${friendsTagId}),
          (${adaId}, ${foreignTagId}),
          (${foreignPersonId}, ${foreignTagId})
      `;
      await transaction`
        insert into crm.person_tags (person_id, tag_id)
        select ${adaId}, tag.id
        from crm.tags tag
        where tag.workspace_id = ${owner.workspaceId}
          and tag.slug between 'bulk-01' and 'bulk-07'
      `;
    });

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
        repository: new PostgresPeopleDirectoryRepository(observedDatabase),
      });
      const observedTagRepository = new PostgresPeopleDirectoryRepository(
        observedDatabase,
      );
      const observedTags = createPeopleTagOptions({
        repository: observedTagRepository,
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
          queryCount === 2,
        "first directory page stays within two SQL statements",
      );
      const beforeContinuation = queryCount;
      await observedDirectory.list(budgetActor, {
        cursor: budgetFirst.nextCursor,
        limit: 1,
        sort: "given-name",
      });
      assert(
        queryCount - beforeContinuation === 3,
        "cursor anchor validation keeps continuation within three statements without tag lookup",
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
          queryCount - beforeTags === 3,
        "bounded tag options use authorization, one limited page, and one selected lookup",
      );
      const beforeTagContinuation = queryCount;
      await observedTags.list(budgetActor, {
        cursor: tagBudgetFirst.nextCursor,
      });
      assert(
        queryCount - beforeTagContinuation === 2,
        "tag continuation stays within authorization and one limited seek query",
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
  name: "PEOPLE-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await raceSql.end();
    await peopleConnection.destroy();
    await configured.close();
  },
});
