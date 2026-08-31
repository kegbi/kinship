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
  createPersonLifecycle,
  createProfileFactManagement,
  type PeopleActor,
  type PeopleRepository,
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
  PostgresPersonLifecycleRepository,
  PostgresProfileFactOrganizations,
  PostgresProfileFactRepository,
  PostgresRelationshipPersonBoundary,
} from "../../packages/backend/modules/people/public.ts";
import {
  PostgresPersonCreatedAudit,
  PostgresPersonLifecycleAudit,
  PostgresProfileFactAudit,
  PostgresRelationshipAudit,
} from "../../packages/backend/modules/governance/public.ts";
import {
  DEFAULT_RELATIONSHIP_TYPE_VOCABULARY,
  PostgresProfileFactConfiguration,
  PostgresRelationshipWorkspaceBoundary,
} from "../../packages/backend/modules/workspaces/public.ts";
import {
  createRelationshipManagement,
  PostgresRelationshipRepository,
  type RelationshipDependencies,
} from "../../packages/backend/modules/relationships/public.ts";
import {
  type ApplicationDatabase,
  connectDatabase,
} from "../../packages/backend/platform/postgres/database.ts";
import {
  createPeopleDirectory,
  createPeopleTagOptions,
  PostgresPeopleDirectoryRepository,
} from "../../packages/backend/read-models/people-directory/public.ts";
import {
  createPersonProfile,
  PostgresPersonProfileRepository,
} from "../../packages/backend/read-models/person-profile/public.ts";

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
const profileFacts = createProfileFactManagement({
  audit: new PostgresProfileFactAudit(),
  clock: { now: () => new Date() },
  ids: { create: () => crypto.randomUUID() },
  organizations: new PostgresProfileFactOrganizations(),
  repository: new PostgresProfileFactRepository(),
  transaction: new PostgresPeopleTransaction(peopleConnection.db),
  workspace: new PostgresProfileFactConfiguration(),
});
const directory = createPeopleDirectory({
  repository: new PostgresPeopleDirectoryRepository(peopleConnection.db),
});
const personProfile = createPersonProfile({
  repository: new PostgresPersonProfileRepository(peopleConnection.db),
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

async function getPersonSummary(
  fixture: Fixture,
  personId: string,
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people/${personId}?include=summary`,
    {
      headers: {
        cookie: fixture.cookie,
        "X-Workspace-Id": workspaceId,
      },
    },
  );
}

async function listPersonLifeEvents(
  fixture: Fixture,
  personId: string,
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people/${personId}/life-events`,
    {
      headers: {
        cookie: fixture.cookie,
        "X-Workspace-Id": fixture.workspaceId,
      },
    },
  );
}

async function listPersonTimeline(
  fixture: Fixture,
  personId: string,
  query = "",
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people/${personId}/timeline${
      query ? `?${query}` : ""
    }`,
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

async function importantDateRequest(
  fixture: Fixture,
  personId: string,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  body?: Readonly<Record<string, unknown>>,
  dateId?: string,
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people/${personId}/dates${
      dateId ? `/${dateId}` : ""
    }`,
    {
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: {
        cookie: fixture.cookie,
        ...(method === "GET"
          ? {}
          : { "content-type": "application/json", origin: "http://localhost" }),
        "X-Workspace-Id": fixture.workspaceId,
      },
      method,
    },
  );
}

async function relationshipRequest(
  fixture: Fixture,
  personId: string,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  body?: Readonly<Record<string, unknown>>,
  relationshipId?: string,
): Promise<Response> {
  return await configured.app.request(
    `http://localhost/api/v1/people/${personId}/relationships${
      relationshipId ? `/${relationshipId}` : ""
    }`,
    {
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: {
        cookie: fixture.cookie,
        ...(method === "GET"
          ? {}
          : { "content-type": "application/json", origin: "http://localhost" }),
        "X-Workspace-Id": fixture.workspaceId,
      },
      method,
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
    lockRequest: () => Promise.resolve(),
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
    "RELATIONSHIP-001 PostgreSQL keeps directional edges tenant-safe, audited, idempotent, and archive-aware",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const own = await register(
      `relationships-${crypto.randomUUID()}@example.test`,
      "Relationship circle",
    );
    const foreign = await register(
      `relationships-foreign-${crypto.randomUUID()}@example.test`,
      "Other circle",
    );
    const sourceResponse = await createPerson(own, {
      givenName: "Ada",
      isPartial: false,
    });
    const targetResponse = await createPerson(own, {
      givenName: "Byron",
      isPartial: false,
    });
    const foreignResponse = await createPerson(foreign, {
      givenName: "Mallory",
      isPartial: false,
    });
    const sourceId = (await sourceResponse.json()).person.id as string;
    const targetId = (await targetResponse.json()).person.id as string;
    const foreignId = (await foreignResponse.json()).person.id as string;
    const [defaultParentType] = await sql<{ id: string }[]>`
      select id::text from crm.relationship_types
      where workspace_id = ${own.workspaceId}::uuid and is_system = true
        and forward_label = 'parent' and reverse_label = 'child'
    `;
    assert(defaultParentType, "fresh workspace default parent type exists");
    const parentTypeId = defaultParentType.id;
    const guardianTypeId = crypto.randomUUID();
    const foreignTypeId = crypto.randomUUID();
    await sql`
      insert into crm.relationship_types (id, workspace_id, forward_label, reverse_label, sort_order)
      values (${guardianTypeId}, ${own.workspaceId}, 'guardian', 'ward', 30),
        (${foreignTypeId}, ${foreign.workspaceId}, 'foreign', 'foreign inverse', 1)
    `;
    const typeOptions = await configured.app.request(
      `http://localhost/api/v1/relationship-types?search=par&selected=${guardianTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    const typeOptionsBody = await typeOptions.json() as {
      readonly options: readonly { readonly id: string }[];
      readonly selected: readonly { readonly id: string }[];
    };
    assert(
      typeOptions.status === 200 &&
        typeOptionsBody.options.some((option) => option.id === parentTypeId) &&
        typeOptionsBody.selected[0]?.id === guardianTypeId,
      "relationship type search remains tenant-scoped and hydrates the selected type",
    );
    const defaultTypeOptions = await configured.app.request(
      "http://localhost/api/v1/relationship-types",
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      defaultTypeOptions.status === 200 &&
        (await defaultTypeOptions.json() as {
            readonly options: readonly { readonly id: string }[];
          }).options.length === 20,
      "relationship type defaults remain bounded to the active workspace",
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${own.workspaceId}, 'relationships', false)
    `;
    const hiddenTypes = await configured.app.request(
      `http://localhost/api/v1/relationship-types?selected=${guardianTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    const hiddenTypesBody = await hiddenTypes.json() as {
      readonly options: readonly unknown[];
      readonly selected: readonly unknown[];
      readonly status: string;
    };
    const [retainedType] = await sql`
      select count(*)::int as count from crm.relationship_types
      where id = ${guardianTypeId}::uuid
        and workspace_id = ${own.workspaceId}::uuid
    `;
    const hiddenRelationships = await relationshipRequest(
      own,
      sourceId,
      "GET",
    );
    assert(
      hiddenTypes.status === 200 &&
        hiddenTypesBody.status === "hidden" &&
        hiddenTypesBody.options.length === 0 &&
        hiddenTypesBody.selected.length === 0 &&
        retainedType?.count === 1 &&
        hiddenRelationships.status === 200 &&
        (await hiddenRelationships.json() as { readonly status: string })
            .status === "hidden",
      "disabled relationships module conceals its type options and projection",
    );
    await sql`
      update crm.workspace_profile_modules set is_active = true
      where workspace_id = ${own.workspaceId}::uuid and key = 'relationships'
    `;
    const restoredTypes = await configured.app.request(
      `http://localhost/api/v1/relationship-types?selected=${guardianTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      restoredTypes.status === 200 &&
        (await restoredTypes.json() as {
            readonly selected: readonly { readonly id: string }[];
            readonly status: string;
          }).selected[0]?.id === guardianTypeId,
      "re-enabled relationships module did not restore its retained type",
    );
    const additionalTypeIds = Array.from(
      { length: 55 },
      () => crypto.randomUUID(),
    );
    const mutableTypeId = additionalTypeIds[19]!;
    const tailTypeId = additionalTypeIds[54]!;
    const unicodeTypeSearch = "Родство关系😀";
    await sql`
      insert into crm.relationship_types (
        id, workspace_id, forward_label, reverse_label, sort_order
      )
      select type_id, ${own.workspaceId}::uuid,
        ${unicodeTypeSearch} || ' ' || lpad(sequence::text, 2, '0'),
        'Обратно关系🧭 ' || lpad(sequence::text, 2, '0'), sequence + 9
      from unnest(${additionalTypeIds}::uuid[])
        with ordinality as generated(type_id, sequence)
    `;
    const typePages: {
      readonly nextCursor?: string;
      readonly options: readonly { readonly id: string }[];
    }[] = [];
    let typeCursor: string | undefined;
    do {
      const page = await configured.app.request(
        `http://localhost/api/v1/relationship-types?search=${
          encodeURIComponent(unicodeTypeSearch)
        }${typeCursor ? `&cursor=${encodeURIComponent(typeCursor)}` : ""}`,
        {
          headers: {
            cookie: own.cookie,
            "X-Workspace-Id": own.workspaceId,
          },
        },
      );
      assert(page.status === 200, `type continuation returned ${page.status}`);
      const body = await page.json() as {
        readonly nextCursor?: string;
        readonly options: readonly { readonly id: string }[];
      };
      typePages.push(body);
      typeCursor = body.nextCursor;
    } while (typeCursor && typePages.length < 10);
    assert(
      typePages.length === 3 &&
        typePages.every((page) => page.options.length <= 20) &&
        new Set(
            typePages.flatMap((page) => page.options.map((type) => type.id)),
          )
            .size === 55,
      "Unicode relationship type keysets are not complete and bounded",
    );
    const malformedTypePage = await configured.app.request(
      `http://localhost/api/v1/relationship-types?search=${
        encodeURIComponent(unicodeTypeSearch)
      }&cursor=not-base64url`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      malformedTypePage.status === 409,
      "malformed Unicode relationship type cursor was accepted",
    );
    const selectedTypes = await configured.app.request(
      `http://localhost/api/v1/relationship-types?selected=${tailTypeId},${foreignTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      selectedTypes.status === 200 &&
        (await selectedTypes.json() as {
            readonly selected: readonly { readonly id: string }[];
          }).selected.map((type) => type.id).join(",") ===
          tailTypeId,
      "selected relationship type hydration disclosed a foreign descriptor",
    );
    const mutableCursor = typePages[0]?.nextCursor;
    await sql`
      update crm.relationship_types set forward_label = 'Renamed anchor'
      where id = ${mutableTypeId}::uuid
    `;
    const staleTypePage = await configured.app.request(
      `http://localhost/api/v1/relationship-types?search=${
        encodeURIComponent(unicodeTypeSearch)
      }&cursor=${encodeURIComponent(mutableCursor ?? "")}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      mutableCursor && staleTypePage.status === 409,
      "mutable relationship type cursor was not rejected",
    );
    const created = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: parentTypeId,
      targetPersonId: targetId,
    });
    const createdBody = await created.json();
    assert(
      created.status === 201 && createdBody.inverse.label === "child",
      `directional create failed: ${JSON.stringify(createdBody)}`,
    );
    const relationshipId = createdBody.relationship.id as string;
    const firstUpdatedAt = createdBody.relationship.updatedAt as string;
    const inverse = await relationshipRequest(own, targetId, "GET");
    const inverseBody = await inverse.json();
    assert(
      inverseBody.relationships[0]?.display.label === "child" &&
        inverseBody.relationships[0]?.display.personId === sourceId,
      "inverse person workspace is inconsistent",
    );
    const malformedRelationshipId = crypto.randomUUID();
    await sql`
      insert into crm.relationships (
        id, workspace_id, from_person_id, to_person_id, relationship_type_id
      ) values (
        ${malformedRelationshipId}::uuid, ${own.workspaceId}::uuid,
        ${sourceId}::uuid, ${foreignId}::uuid, ${parentTypeId}::uuid
      )
    `;
    const concealedMalformed = await relationshipRequest(
      own,
      sourceId,
      "GET",
    );
    const concealedMalformedText = await concealedMalformed.text();
    assert(
      concealedMalformed.status === 200 &&
        !concealedMalformedText.includes(foreignId) &&
        !concealedMalformedText.includes(malformedRelationshipId) &&
        concealedMalformedText.includes(relationshipId),
      "malformed foreign endpoint edge was not completely concealed",
    );
    const historical = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: tailTypeId,
      targetPersonId: targetId,
    });
    const historicalBody = await historical.json() as {
      readonly relationship: {
        readonly id: string;
        readonly updatedAt: string;
      };
    };
    assert(
      historical.status === 201,
      "tail relationship type was not writable",
    );
    await sql`
      update crm.relationship_types set is_archived = true
      where id = ${tailTypeId}::uuid
    `;
    const historicalList = await relationshipRequest(own, sourceId, "GET");
    const historicalListBody = await historicalList.json() as {
      readonly relationships: readonly {
        readonly id: string;
        readonly relationshipTypeArchived: boolean;
      }[];
    };
    const historicalRow = historicalListBody.relationships.find((row) =>
      row.id === historicalBody.relationship.id
    );
    const archivedTypeUpdate = await relationshipRequest(
      own,
      sourceId,
      "PATCH",
      {
        expectedUpdatedAt: historicalBody.relationship.updatedAt,
        relationshipTypeId: tailTypeId,
      },
      historicalBody.relationship.id,
    );
    assert(
      historicalRow?.relationshipTypeArchived === true &&
        archivedTypeUpdate.status === 404,
      "archived historical type was not visible or remained selectable",
    );
    const duplicate = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: parentTypeId,
      targetPersonId: targetId,
    });
    assert(
      duplicate.status === 200 &&
        (await duplicate.json()).status === "existing",
      "duplicate retry was not idempotent",
    );
    const self = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: parentTypeId,
      targetPersonId: sourceId,
    });
    assert(self.status === 400, "self relationship persisted");
    for (
      const body of [
        { relationshipTypeId: parentTypeId, targetPersonId: foreignId },
        { relationshipTypeId: foreignTypeId, targetPersonId: targetId },
      ]
    ) {
      const concealed = await relationshipRequest(own, sourceId, "POST", body);
      assert(
        concealed.status === 404,
        `foreign relationship reference returned ${concealed.status}`,
      );
    }
    const updated = await relationshipRequest(own, sourceId, "PATCH", {
      expectedUpdatedAt: firstUpdatedAt,
      relationshipTypeId: guardianTypeId,
    }, relationshipId);
    const updatedBody = await updated.json();
    assert(
      updated.status === 200 && updatedBody.inverse.label === "ward",
      `directional update failed: ${JSON.stringify(updatedBody)}`,
    );
    await sql`update crm.people set archived_at = now() where id = ${targetId}`;
    const archivedUpdate = await relationshipRequest(own, sourceId, "PATCH", {
      expectedUpdatedAt: updatedBody.relationship.updatedAt,
      relationshipTypeId: parentTypeId,
    }, relationshipId);
    const archivedDelete = await relationshipRequest(own, sourceId, "DELETE", {
      expectedUpdatedAt: updatedBody.relationship.updatedAt,
    }, relationshipId);
    assert(
      archivedUpdate.status === 409 && archivedDelete.status === 409,
      "archived endpoint remained writable",
    );
    await sql`update crm.people set archived_at = null where id = ${targetId}`;
    const removed = await relationshipRequest(own, sourceId, "DELETE", {
      expectedUpdatedAt: updatedBody.relationship.updatedAt,
    }, relationshipId);
    assert(removed.status === 200, `unlink failed: ${await removed.text()}`);
    const counts = await sql<
      { readonly audits: number; readonly edges: number }[]
    >`
      select
        (select count(*)::int from crm.audit_events where subject_id = ${relationshipId} and action = 'relationships.relationship-changed') as audits,
        (select count(*)::int from crm.relationships where id = ${relationshipId}) as edges
    `;
    assert(
      counts[0]?.audits === 3 && counts[0]?.edges === 0,
      `relationship transaction postconditions failed: ${
        JSON.stringify(counts[0])
      }`,
    );

    const atomicUrl =
      `http://localhost/api/v1/people/${sourceId}/relationships/related-person`;
    const atomic = await configured.app.request(atomicUrl, {
      body: JSON.stringify({
        person: { givenName: "Grace", isPartial: false },
        relationshipTypeId: parentTypeId,
      }),
      headers: {
        cookie: own.cookie,
        "content-type": "application/json",
        origin: "http://localhost",
        "X-Workspace-Id": own.workspaceId,
      },
      method: "POST",
    });
    const atomicBody = await atomic.json() as {
      readonly person: { readonly id: string };
      readonly relationship: { readonly id: string };
    };
    assert(
      atomic.status === 201 && atomicBody.person.id &&
        atomicBody.relationship.id,
      "related person and relationship did not commit atomically",
    );
    const atomicProof = await sql<
      {
        readonly audits: number;
        readonly edges: number;
        readonly people: number;
      }[]
    >`
      select
        (select count(*)::int from crm.people where id = ${atomicBody.person.id}) people,
        (select count(*)::int from crm.relationships where id = ${atomicBody.relationship.id}) edges,
        (select count(*)::int from crm.audit_events
          where subject_id in (${atomicBody.person.id}::uuid, ${atomicBody.relationship.id}::uuid)
            and action in ('people.person-created', 'relationships.relationship-changed')) audits
    `;
    assert(
      atomicProof[0]?.people === 1 && atomicProof[0].edges === 1 &&
        atomicProof[0].audits === 2,
      "atomic owner postconditions or audits are incomplete",
    );
    const beforeRejected = await sql<
      {
        readonly audits: number;
        readonly edges: number;
        readonly people: number;
      }[]
    >`
      select
        (select count(*)::int from crm.people where workspace_id = ${own.workspaceId}) people,
        (select count(*)::int from crm.relationships where workspace_id = ${own.workspaceId}) edges,
        (select count(*)::int from crm.audit_events where workspace_id = ${own.workspaceId}) audits
    `;
    const invalidAtomic = await configured.app.request(atomicUrl, {
      body: JSON.stringify({
        person: { givenName: "Orphan", isPartial: false },
        relationshipTypeId: crypto.randomUUID(),
      }),
      headers: {
        cookie: own.cookie,
        "content-type": "application/json",
        origin: "http://localhost",
        "X-Workspace-Id": own.workspaceId,
      },
      method: "POST",
    });
    const replay = await configured.app.request(atomicUrl, {
      body: JSON.stringify({
        person: { givenName: "Grace", isPartial: false },
        relationshipTypeId: parentTypeId,
      }),
      headers: {
        cookie: own.cookie,
        "content-type": "application/json",
        origin: "http://localhost",
        "X-Workspace-Id": own.workspaceId,
      },
      method: "POST",
    });
    const afterRejected = await sql<
      {
        readonly audits: number;
        readonly edges: number;
        readonly people: number;
      }[]
    >`
      select
        (select count(*)::int from crm.people where workspace_id = ${own.workspaceId}) people,
        (select count(*)::int from crm.relationships where workspace_id = ${own.workspaceId}) edges,
        (select count(*)::int from crm.audit_events where workspace_id = ${own.workspaceId}) audits
    `;
    assert(
      invalidAtomic.status === 404 && replay.status === 409 &&
        JSON.stringify(beforeRejected[0]) === JSON.stringify(afterRejected[0]),
      "atomic rejection or duplicate replay retained partial owner effects",
    );

    await sql.begin(async (transaction) => {
      const generated = await transaction<{ readonly id: string }[]>`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name, family_name
        )
        select gen_random_uuid(), ${own.workspaceId}, ${own.memberId},
          'Page', lpad(sequence::text, 2, '0')
        from generate_series(1, 21) sequence
        returning id::text
      `;
      await transaction`
        insert into crm.relationships (
          id, workspace_id, from_person_id, to_person_id,
          relationship_type_id, status, created_at, updated_at
        )
        select gen_random_uuid(), ${own.workspaceId}, ${sourceId}, person_id,
          ${guardianTypeId}, 'active',
          '2026-08-16T12:00:00Z'::timestamptz + sequence * interval '1 second',
          now()
        from unnest(${generated.map((row) => row.id)}::uuid[])
          with ordinality as target(person_id, sequence)
      `;
    });
    const firstPage = await configured.app.request(
      `http://localhost/api/v1/people/${sourceId}/relationships?limit=20`,
      { headers: { cookie: own.cookie, "X-Workspace-Id": own.workspaceId } },
    );
    const firstPageBody = await firstPage.json() as {
      readonly nextCursor?: string;
      readonly relationships: readonly { readonly id: string }[];
    };
    assert(
      firstPage.status === 200 && firstPageBody.relationships.length === 20 &&
        firstPageBody.nextCursor,
      "first relationship page is bounded and continuable",
    );
    const nextPage = await configured.app.request(
      `http://localhost/api/v1/people/${sourceId}/relationships?limit=20&cursor=${
        encodeURIComponent(firstPageBody.nextCursor)
      }`,
      { headers: { cookie: own.cookie, "X-Workspace-Id": own.workspaceId } },
    );
    const nextPageBody = await nextPage.json() as {
      readonly nextCursor?: string;
      readonly relationships: readonly { readonly id: string }[];
    };
    assert(
      nextPage.status === 200 && nextPageBody.relationships.length === 3 &&
        !nextPageBody.nextCursor &&
        new Set([
            ...firstPageBody.relationships,
            ...nextPageBody.relationships,
          ].map((edge) => edge.id)).size === 23,
      "keyset continuation reaches each relationship exactly once",
    );
    const forgedPage = await configured.app.request(
      `http://localhost/api/v1/people/${sourceId}/relationships?cursor=${
        encodeURIComponent(btoa(JSON.stringify({
          createdAt: "2026-08-16T12:00:00.000000Z",
          id: crypto.randomUUID(),
          personId: sourceId,
          version: 1,
          workspaceId: own.workspaceId,
        })))
      }`,
      { headers: { cookie: own.cookie, "X-Workspace-Id": own.workspaceId } },
    );
    assert(
      forgedPage.status === 409,
      "forged relationship anchor was accepted",
    );
  },
});

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
    "[APP-003C] real PostgreSQL person workspace is tenant-safe and lifecycle-aware",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces restart identity cascade`;
    const owner = await register(
      `profile-owner-${crypto.randomUUID()}@example.test`,
      "Profile circle",
    );
    const foreign = await register(
      `profile-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign profile circle",
    );
    const personId = crypto.randomUUID();
    const foreignPersonId = crypto.randomUUID();
    const genderId = crypto.randomUUID();
    const foreignTagId = crypto.randomUUID();
    const lifeEventId = crypto.randomUUID();
    const reminderId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const callId = crypto.randomUUID();
    const contactTypeIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ] as const;
    const relationshipTypeId = crypto.randomUUID();
    const relatedPersonIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ] as const;
    await sql.begin(async (transaction) => {
      await transaction`
        insert into crm.gender_options (id, workspace_id, name)
        values (${genderId}, ${owner.workspaceId}, 'Woman')
      `;
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, gender_option_id,
          given_name, family_name, description, food_preferences, is_starred,
          is_deceased
        ) values (
          ${personId}, ${owner.workspaceId}, ${owner.memberId}, ${genderId},
          'Ada', 'Lovelace', 'Mathematician and correspondent.', 'Tea', true,
          true
        )
      `;
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name
        ) values
          (${relatedPersonIds[0]}, ${owner.workspaceId}, ${owner.memberId},
            'Charles'),
          (${relatedPersonIds[1]}, ${owner.workspaceId}, ${owner.memberId},
            'Mary')
      `;
      await transaction`
        update crm.workspace_members set self_person_id = ${personId}
        where id = ${owner.memberId}
      `;
      await transaction`
        insert into crm.tags (id, workspace_id, name, slug)
        select gen_random_uuid(), ${owner.workspaceId},
          'Profile ' || lpad(sequence::text, 2, '0'),
          'profile-' || lpad(sequence::text, 2, '0')
        from generate_series(1, 10) sequence
      `;
      await transaction`
        insert into crm.person_tags (person_id, tag_id)
        select ${personId}, tag.id from crm.tags tag
        where tag.workspace_id = ${owner.workspaceId}
      `;
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name
        ) values (
          ${foreignPersonId}, ${foreign.workspaceId}, ${foreign.memberId},
          'Foreign'
        )
      `;
      await transaction`
        insert into crm.tags (id, workspace_id, name, slug)
        values (${foreignTagId}, ${foreign.workspaceId}, 'Private', 'private')
      `;
      await transaction`
        insert into crm.person_tags (person_id, tag_id)
        values (${personId}, ${foreignTagId})
      `;
      await transaction`
        insert into crm.contact_method_types (
          id, workspace_id, name, kind, protocol, sort_order
        ) values
          (${contactTypeIds[0]}, ${owner.workspaceId}, 'Email', 'email',
            'mailto', 1),
          (${contactTypeIds[1]}, ${owner.workspaceId}, 'Phone', 'phone',
            'tel', 2),
          (${contactTypeIds[2]}, ${owner.workspaceId}, 'Social', 'social',
            null, 3),
          (${contactTypeIds[3]}, ${owner.workspaceId}, 'Custom', 'custom',
            null, 4)
      `;
      await transaction`
        insert into crm.person_contact_methods (
          person_id, type_id, value, is_primary, sort_order
        ) values
          (${personId}, ${contactTypeIds[0]}, 'ada@example.test', true, 1),
          (${personId}, ${contactTypeIds[1]}, '+381111111', true, 2),
          (${personId}, ${contactTypeIds[2]}, '@ada', true, 3),
          (${personId}, ${contactTypeIds[3]}, 'fourth', true, 4)
      `;
      await transaction`
        insert into crm.relationship_types (
          id, workspace_id, forward_label, reverse_label, sort_order
        ) values (
          ${relationshipTypeId}, ${owner.workspaceId}, 'friend', 'friend', 1
        )
      `;
      await transaction`
        insert into crm.relationships (
          workspace_id, from_person_id, to_person_id, relationship_type_id
        ) values
          (${owner.workspaceId}, ${personId}, ${relatedPersonIds[0]},
            ${relationshipTypeId}),
          (${owner.workspaceId}, ${personId}, ${relatedPersonIds[1]},
            ${relationshipTypeId})
      `;
      await transaction`
        insert into crm.notes (
          workspace_id, person_id, body, created_by_member_id
        ) values
          (${owner.workspaceId}, ${personId}, 'First summary note',
            ${owner.memberId}),
          (${owner.workspaceId}, ${personId}, 'Second summary note',
            ${owner.memberId})
      `;
      await transaction`
        insert into crm.calls (
          id, workspace_id, person_id, called_at, created_by_member_id
        ) values (
          ${callId}, ${owner.workspaceId}, ${personId},
          '2026-08-18T09:00:00.000Z', ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.activities (
          id, workspace_id, summary, happened_at, created_by_member_id
        ) values (
          ${activityId}, ${owner.workspaceId}, 'Analytical engine review',
          '2026-08-19T09:00:00.000Z', ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.activity_participants (activity_id, person_id)
        values (${activityId}, ${personId})
      `;
      await transaction`
        insert into crm.tasks (
          workspace_id, person_id, title, status, created_by_member_id
        ) values (
          ${owner.workspaceId}, ${personId}, 'Review correspondence', 'open',
          ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.reminders (
          id, workspace_id, person_id, target_kind, title, anchor_on,
          created_by_member_id
        ) values (
          ${reminderId}, ${owner.workspaceId}, ${personId}, 'person',
          'Write to Ada', '2026-08-20', ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.reminder_occurrences (
          reminder_id, member_id, occurs_on, deliver_at, title_snapshot
        ) values (
          ${reminderId}, ${owner.memberId}, '2026-08-20',
          '2026-08-20T09:00:00.000Z', 'Write to Ada'
        )
      `;
      await transaction`
        insert into crm.stay_in_touch_cadences (
          person_id, interval_count, interval_unit, next_due_at
        ) values (${personId}, 1, 'month', '2026-08-21T09:00:00.000Z')
      `;
      await transaction`
        insert into crm.life_events (
          id, workspace_id, person_id, name, note, year, month, precision
        ) values (
          ${lifeEventId}, ${owner.workspaceId}, ${personId}, 'Published Notes',
          'The first published computer algorithm.', 1843, 12, 'year_month'
        ), (
          gen_random_uuid(), ${foreign.workspaceId}, ${foreignPersonId},
          'Private event', null, 1900, null, 'year'
        )
      `;
    });

    const ready = await getPerson(owner, personId);
    const readyBody = await ready.json() as {
      readonly dueInformation: {
        readonly nextReminderAt?: string;
        readonly openTaskCount: number;
        readonly stayInTouchAt?: string;
        readonly status: string;
      };
      readonly person: {
        readonly description?: string;
        readonly gender?: string;
        readonly isDeceased: boolean;
        readonly isSelf: boolean;
        readonly isStarred: boolean;
        readonly tagCount: number;
        readonly tags: readonly { readonly name: string }[];
      };
      readonly status: string;
    };
    assert(
      ready.status === 200 && readyBody.status === "ready" &&
        readyBody.person.description ===
          "Mathematician and correspondent." &&
        readyBody.person.gender === "Woman" && readyBody.person.isStarred &&
        readyBody.person.isDeceased && readyBody.person.isSelf,
      "active profile returns current-workspace orientation",
    );
    assert(
      readyBody.person.tags.length === 8 &&
        readyBody.person.tagCount === 10 &&
        readyBody.person.tags.every((tag) => tag.name !== "Private") &&
        readyBody.dueInformation.status === "ready" &&
        readyBody.dueInformation.openTaskCount === 1 &&
        readyBody.dueInformation.nextReminderAt?.startsWith(
            "2026-08-20T09:00:00",
          ) === true &&
        readyBody.dueInformation.stayInTouchAt?.startsWith(
            "2026-08-21T09:00:00",
          ) === true,
      "profile bounds tags and composes real planning orientation",
    );
    const summaryResponse = await getPersonSummary(owner, personId);
    const summaryBody = await summaryResponse.json() as {
      readonly dueInformation: {
        readonly nextReminderAt?: string;
        readonly stayInTouchAt?: string;
      };
      readonly summary: {
        readonly nextReminderAt?: string;
        readonly primaryContactMethods: readonly {
          readonly href?: string;
          readonly kind: string;
        }[];
        readonly relationshipCounts: readonly {
          readonly count: number;
          readonly label: string;
          readonly relationshipTypeId: string;
        }[];
        readonly sectionCounts: readonly {
          readonly count?: number;
          readonly id: string;
          readonly status: string;
        }[];
        readonly stayInTouchAt?: string;
      };
    };
    const sectionCount = (id: string) =>
      summaryBody.summary.sectionCounts.find((entry) => entry.id === id);
    assert(
      summaryResponse.status === 200 &&
        summaryBody.summary.sectionCounts.length === 14 &&
        new Set(summaryBody.summary.sectionCounts.map((entry) => entry.id))
            .size === 14 &&
        sectionCount("activities")?.count === 1 &&
        sectionCount("calls")?.count === 1 &&
        sectionCount("contact-methods")?.count === 4 &&
        sectionCount("food-preferences")?.count === 1 &&
        sectionCount("life-events")?.count === 1 &&
        sectionCount("notes")?.count === 2 &&
        sectionCount("relationships")?.count === 2 &&
        sectionCount("tags")?.count === 10 &&
        sectionCount("tasks")?.count === 1,
      "summary returns every stable section with tenant-local grouped counts",
    );
    assert(
      summaryBody.summary.primaryContactMethods.length === 3 &&
        summaryBody.summary.primaryContactMethods[0]?.href ===
          "mailto:ada@example.test" &&
        summaryBody.summary.primaryContactMethods[1]?.href ===
          "tel:+381111111" &&
        summaryBody.summary.relationshipCounts.length === 1 &&
        summaryBody.summary.relationshipCounts[0]?.relationshipTypeId ===
          relationshipTypeId &&
        summaryBody.summary.relationshipCounts[0]?.label === "friend" &&
        summaryBody.summary.relationshipCounts[0]?.count === 2 &&
        summaryBody.summary.nextReminderAt ===
          summaryBody.dueInformation.nextReminderAt &&
        summaryBody.summary.stayInTouchAt ===
          summaryBody.dueInformation.stayInTouchAt,
      "summary bounds actionable contacts, groups relationships, and reuses due state",
    );

    const [ownerUser] = await sql<{ readonly id: string }[]>`
      select user_id::text as id from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(ownerUser, "owner user exists");
    let summaryQueryCount = 0;
    const observedClient = postgres(databaseUrl, {
      debug: () => {
        summaryQueryCount += 1;
      },
      max: 1,
      onnotice: () => undefined,
    });
    const observedDatabase = new Kysely<ApplicationDatabase>({
      dialect: new PostgresJSDialect({ postgres: observedClient }),
    });
    try {
      await kyselySql`select 1`.execute(observedDatabase);
      summaryQueryCount = 0;
      const observedProfile = createPersonProfile({
        repository: new PostgresPersonProfileRepository(observedDatabase),
      });
      const observedSummary = await observedProfile.get(
        {
          memberId: owner.memberId,
          role: "owner",
          userId: ownerUser.id,
          workspaceId: owner.workspaceId,
        },
        personId,
        { includeSummary: true },
      );
      assert(
        observedSummary.status === "ready" && summaryQueryCount === 1,
        "the complete summary is resolved by one tenant-safe SQL statement",
      );
    } finally {
      await observedDatabase.destroy();
    }
    const history = await listPersonLifeEvents(owner, personId);
    const historyBody = await history.json() as {
      readonly events: readonly {
        readonly date: { readonly month?: number; readonly year?: number };
        readonly id: string;
        readonly name?: string;
      }[];
    };
    assert(
      history.status === 200 && historyBody.events.length === 1 &&
        historyBody.events[0]?.id === lifeEventId &&
        historyBody.events[0]?.name === "Published Notes" &&
        historyBody.events[0]?.date.year === 1843 &&
        historyBody.events[0]?.date.month === 12,
      "person-linked journal history is precise, bounded, and tenant-local",
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${owner.workspaceId}, 'life-events', false)
      on conflict (workspace_id, key) do update set is_active = false,
        updated_at = now()
    `;
    const hiddenHistory = await listPersonLifeEvents(owner, personId);
    const hiddenHistoryBody = await hiddenHistory.json() as {
      readonly events: readonly unknown[];
      readonly status: string;
    };
    const [retainedLifeEvents] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.life_events
      where workspace_id = ${owner.workspaceId} and person_id = ${personId}
    `;
    assert(
      hiddenHistory.status === 200 && hiddenHistoryBody.status === "hidden" &&
        hiddenHistoryBody.events.length === 0 &&
        retainedLifeEvents?.count === 1,
      "disabled life-event history is concealed without deleting retained rows",
    );
    const hiddenSummary = await getPersonSummary(owner, personId);
    const hiddenSummaryBody = await hiddenSummary.json() as {
      readonly summary: {
        readonly sectionCounts: readonly {
          readonly count?: number;
          readonly id: string;
          readonly status: string;
        }[];
      };
    };
    const hiddenLifeEvents = hiddenSummaryBody.summary.sectionCounts.find(
      (entry) => entry.id === "life-events",
    );
    assert(
      hiddenSummary.status === 200 &&
        hiddenLifeEvents?.status === "hidden" &&
        !("count" in hiddenLifeEvents),
      "a hidden section omits its retained record count rather than reporting zero",
    );
    await sql`
      update crm.workspace_profile_modules set is_active = true,
        updated_at = now()
      where workspace_id = ${owner.workspaceId} and key = 'life-events'
    `;
    assert(
      (await getPerson(owner, foreignPersonId)).status === 404 &&
        (await getPersonSummary(owner, foreignPersonId)).status === 404 &&
        (await getPerson(owner, crypto.randomUUID())).status === 404 &&
        (await listPersonLifeEvents(owner, foreignPersonId)).status === 404 &&
        (await listPersonLifeEvents(owner, crypto.randomUUID())).status === 404,
      "foreign and missing person identifiers are indistinguishable across profile reads",
    );
    const forged = await personProfile.get(
      {
        memberId: owner.memberId,
        role: "owner",
        userId: ownerUser.id,
        workspaceId: foreign.workspaceId,
      },
      foreignPersonId,
      { includeSummary: true },
    );
    assert(
      forged.status === "forbidden",
      "forged active-workspace context is denied without identity disclosure",
    );
    const forgedHistory = await personProfile.listLifeEvents({
      memberId: owner.memberId,
      role: "owner",
      userId: ownerUser.id,
      workspaceId: foreign.workspaceId,
    }, foreignPersonId);
    assert(
      forgedHistory.status === "forbidden",
      "forged context is denied before life-event history lookup",
    );

    await sql`update crm.people set archived_at = now() where id = ${personId}`;
    const archived = await getPerson(owner, personId);
    assert(
      archived.status === 200 &&
        (await archived.json() as { readonly status: string }).status ===
          "archived",
      "archived person remains readable",
    );
    await sql`update crm.people set deleted_at = now() where id = ${personId}`;
    assert(
      (await getPerson(owner, personId)).status === 404,
      "soft-deleted person is not exposed",
    );
  },
});

Deno.test({
  name:
    "[UXD-002C2A] real PostgreSQL person timeline merges, pages, personalizes, and isolates tenants",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces restart identity cascade`;
    const owner = await register(
      `timeline-owner-${crypto.randomUUID()}@example.test`,
      "Timeline circle",
    );
    const foreign = await register(
      `timeline-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign timeline circle",
    );
    const personId = "00000000-0000-4000-8000-000000000100";
    const foreignPersonId = "00000000-0000-4000-8000-000000000101";
    const participantId = "00000000-0000-4000-8000-000000000102";
    const activityId = "00000000-0000-4000-8000-000000000900";
    const noteId = "00000000-0000-4000-8000-000000000800";
    const callId = "00000000-0000-4000-8000-000000000700";
    const conversationId = "00000000-0000-4000-8000-000000000600";
    const happenedLifeEventId = "00000000-0000-4000-8000-000000000500";
    const unknownLifeEventId = "00000000-0000-4000-8000-000000000400";
    const partialLifeEventId = "00000000-0000-4000-8000-000000000300";
    const lifeEventTypeId = crypto.randomUUID();
    const activityTypeId = crypto.randomUUID();
    const activityEmotionId = crypto.randomUUID();
    const callEmotionId = crypto.randomUUID();
    const channelTypeId = crypto.randomUUID();
    const contactMethodId = crypto.randomUUID();
    const firstMessageId = crypto.randomUUID();
    const secondMessageId = crypto.randomUUID();
    const activityEmotionName = `Timeline delight ${activityEmotionId}`;
    const callEmotionName = `Timeline gratitude ${callEmotionId}`;

    await sql.begin(async (transaction) => {
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name
        ) values
          (${personId}, ${owner.workspaceId}, ${owner.memberId}, 'Ada'),
          (${participantId}, ${owner.workspaceId}, ${owner.memberId}, 'Grace'),
          (${foreignPersonId}, ${foreign.workspaceId}, ${foreign.memberId},
            'Private')
      `;
      await transaction`
        insert into crm.workspace_profile_modules (
          workspace_id, key, is_active
        ) values
          (${owner.workspaceId}, 'activities', true),
          (${owner.workspaceId}, 'notes', true),
          (${owner.workspaceId}, 'calls', true),
          (${owner.workspaceId}, 'conversations', true),
          (${owner.workspaceId}, 'life-events', true)
        on conflict (workspace_id, key) do update set is_active = true,
          updated_at = now()
      `;
      await transaction`
        insert into crm.activity_types (id, workspace_id, name, sort_order)
        values (${activityTypeId}, ${owner.workspaceId}, 'Shared meal', 1)
      `;
      await transaction`
        insert into crm.emotion_options (id, name, sort_order) values
          (${activityEmotionId}, ${activityEmotionName}, 1),
          (${callEmotionId}, ${callEmotionName}, 2)
      `;
      await transaction`
        insert into crm.contact_method_types (id, workspace_id, name)
        values (${channelTypeId}, ${owner.workspaceId}, 'Email')
      `;
      await transaction`
        insert into crm.person_contact_methods (id, person_id, type_id, value)
        values (${contactMethodId}, ${personId}, ${channelTypeId},
          'ada@example.test')
      `;
      await transaction`
        insert into crm.activities (
          id, workspace_id, summary, description, happened_at, activity_type_id,
          created_by_member_id
        ) values (
          ${activityId}, ${owner.workspaceId}, 'Analytical engine review',
          'Compared the latest plans.', '2026-08-25T12:00:00.000Z',
          ${activityTypeId}, ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.activity_participants (activity_id, person_id)
        values (${activityId}, ${personId}), (${activityId}, ${participantId})
      `;
      await transaction`
        insert into crm.activity_emotions (activity_id, emotion_id)
        values (${activityId}, ${activityEmotionId})
      `;
      await transaction`
        insert into crm.notes (
          id, workspace_id, person_id, body, created_by_member_id, created_at
        ) values (
          ${noteId}, ${owner.workspaceId}, ${personId},
          'A note sharing the call timestamp.', ${owner.memberId},
          '2026-08-24T12:00:00.000Z'
        )
      `;
      await transaction`
        insert into crm.calls (
          id, workspace_id, person_id, called_at, contact_was_caller, content,
          created_by_member_id
        ) values (
          ${callId}, ${owner.workspaceId}, ${personId},
          '2026-08-24T12:00:00.000Z', true, 'Discussed correspondence.',
          ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.call_emotions (call_id, emotion_id)
        values (${callId}, ${callEmotionId})
      `;
      await transaction`
        insert into crm.conversation_threads (
          id, workspace_id, person_id, channel_type_id, contact_method_id,
          happened_at, title
        ) values (
          ${conversationId}, ${owner.workspaceId}, ${personId}, ${channelTypeId},
          ${contactMethodId},
          '2026-08-23T12:00:00.000Z', 'Letters about mathematics'
        )
      `;
      await transaction`
        insert into crm.messages (
          id, conversation_id, content, written_at, direction, author_member_id,
          created_at, updated_at
        ) values
          (${secondMessageId}, ${conversationId}, 'Yes, at noon.',
            '2026-08-23T11:01:00.000Z', 'inbound', null,
            '2026-08-23T12:00:00.000Z', '2026-08-23T12:00:00.000Z'),
          (${firstMessageId}, ${conversationId}, 'Shall we meet?',
            '2026-08-23T11:00:00.000Z', 'outbound', ${owner.memberId},
            '2026-08-23T12:00:00.000Z', '2026-08-23T12:00:00.000Z')
      `;
      await transaction`
        insert into crm.life_event_types (id, workspace_id, name)
        values (${lifeEventTypeId}, ${owner.workspaceId}, 'Publication')
      `;
      await transaction`
        insert into crm.life_events (
          id, workspace_id, person_id, life_event_type_id, name, note, year,
          month, day, happened_at, precision, created_at
        ) values
          (${happenedLifeEventId}, ${owner.workspaceId}, ${personId},
            ${lifeEventTypeId}, 'Full dated event', 'Known timestamp', null,
            null, null, '2026-08-22T12:00:00.000Z', 'full',
            '2026-01-01T00:00:00.000Z'),
          (${unknownLifeEventId}, ${owner.workspaceId}, ${personId},
            ${lifeEventTypeId}, 'Undated event', 'Recorded without a date',
            null, null, null, null, 'unknown',
            '2026-08-21T12:00:00.000Z'),
          (${partialLifeEventId}, ${owner.workspaceId}, ${personId},
            ${lifeEventTypeId}, null, 'Known only to a month', 1843, 12, null,
            null, 'year_month', '2026-08-20T12:00:00.000Z')
      `;
    });

    const merged = await listPersonTimeline(owner, personId, "limit=50");
    const mergedBody = await merged.json() as {
      readonly items: readonly {
        readonly datePrecision: string;
        readonly activityType?: string;
        readonly channelType?: string;
        readonly contactMethod?: string;
        readonly contactWasCaller?: boolean;
        readonly emotions?: readonly {
          readonly id: string;
          readonly name: string;
        }[];
        readonly id: string;
        readonly kind: string;
        readonly messages?: readonly {
          readonly content: string;
          readonly direction: "inbound" | "outbound";
          readonly writtenAt: string;
        }[];
        readonly occurredAt: string;
        readonly participants?: readonly {
          readonly id: string;
          readonly name: string;
        }[];
        readonly title?: string;
      }[];
      readonly status: string;
    };
    assert(
      merged.status === 200 && mergedBody.status === "ready" &&
        mergedBody.items.map((item) => item.kind).join(",") ===
          "activity,note,call,conversation,life-event,life-event,life-event",
      "all five enabled kinds merge in reverse chronological keyset order",
    );
    const activity = mergedBody.items.find((item) => item.id === activityId);
    const call = mergedBody.items.find((item) => item.id === callId);
    const conversation = mergedBody.items.find((item) =>
      item.id === conversationId
    );
    const note = mergedBody.items.find((item) => item.id === noteId);
    const happened = mergedBody.items.find((item) =>
      item.id === happenedLifeEventId
    );
    const unknown = mergedBody.items.find((item) =>
      item.id === unknownLifeEventId
    );
    const partial = mergedBody.items.find((item) =>
      item.id === partialLifeEventId
    );
    assert(
      activity?.activityType === "Shared meal" &&
        JSON.stringify(activity.participants) === JSON.stringify([
            { id: personId, name: "Ada" },
            { id: participantId, name: "Grace" },
          ]) &&
        activity.emotions?.[0]?.id === activityEmotionId &&
        activity.emotions[0].name === activityEmotionName,
      "activity timeline detail preserves its category, participants, and emotions",
    );
    assert(
      call?.contactWasCaller === true &&
        call.emotions?.[0]?.id === callEmotionId &&
        call.emotions[0].name === callEmotionName,
      "call timeline detail preserves caller direction and emotions",
    );
    assert(
      conversation?.channelType === "Email" &&
        conversation.contactMethod === "ada@example.test" &&
        JSON.stringify(conversation.messages) === JSON.stringify([
            {
              content: "Shall we meet?",
              direction: "outbound",
              writtenAt: "2026-08-23T11:00:00.000000Z",
            },
            {
              content: "Yes, at noon.",
              direction: "inbound",
              writtenAt: "2026-08-23T11:01:00.000000Z",
            },
          ]),
      "conversation timeline detail preserves channel, contact method, and ordered messages",
    );
    const detailFields = [
      "activityType",
      "channelType",
      "contactMethod",
      "contactWasCaller",
      "emotions",
      "messages",
      "participants",
    ];
    assert(
      note !== undefined && happened !== undefined &&
        detailFields.every((field) => !Object.hasOwn(note, field)) &&
        detailFields.every((field) => !Object.hasOwn(happened, field)),
      "notes and life events omit every per-kind detail field",
    );
    assert(
      happened?.occurredAt.startsWith("2026-08-22T12:00:00") === true &&
        happened.datePrecision === "full" &&
        unknown?.occurredAt.startsWith("2026-08-21T12:00:00") === true &&
        unknown.datePrecision === "unknown" &&
        partial?.occurredAt.startsWith("1843-12-01T00:00:00") === true &&
        partial.datePrecision === "year_month" &&
        partial.title === "Publication",
      "life events resolve happened_at, partial UTC components, then recorded date with exact precision",
    );

    const firstPage = await listPersonTimeline(owner, personId, "limit=2");
    const firstPageBody = await firstPage.json() as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    assert(
      firstPage.status === 200 && firstPageBody.items[0]?.id === activityId &&
        firstPageBody.items[1]?.id === noteId && firstPageBody.nextCursor,
      "first page ends on the higher id at the duplicate timestamp",
    );
    const secondPage = await listPersonTimeline(
      owner,
      personId,
      `limit=2&cursor=${encodeURIComponent(firstPageBody.nextCursor ?? "")}`,
    );
    const secondPageBody = await secondPage.json() as {
      readonly items: readonly { readonly id: string }[];
    };
    assert(
      secondPage.status === 200 && secondPageBody.items[0]?.id === callId &&
        secondPageBody.items[1]?.id === conversationId,
      "the lower id at a duplicate timestamp begins the next page without a gap",
    );

    const anchorPage = await listPersonTimeline(owner, personId, "limit=4");
    const anchorPageBody = await anchorPage.json() as {
      readonly nextCursor?: string;
    };
    assert(anchorPageBody.nextCursor, "conversation anchor cursor exists");
    await sql`
      update crm.workspace_profile_modules set is_active = false,
        updated_at = now()
      where workspace_id = ${owner.workspaceId} and key = 'conversations'
    `;
    const personalized = await listPersonTimeline(owner, personId, "limit=50");
    const personalizedBody = await personalized.json() as {
      readonly items: readonly { readonly kind: string }[];
    };
    assert(
      personalized.status === 200 &&
        personalizedBody.items.every((item) => item.kind !== "conversation"),
      "a disabled profile module contributes no retained rows",
    );
    const hiddenAnchor = await listPersonTimeline(
      owner,
      personId,
      `cursor=${encodeURIComponent(anchorPageBody.nextCursor ?? "")}`,
    );
    assert(
      hiddenAnchor.status === 409 &&
        (await hiddenAnchor.json() as { readonly code: string }).code ===
          "person_timeline_stale_cursor",
      "a cursor anchored to a newly hidden kind becomes stale",
    );

    assert(
      (await listPersonTimeline(owner, foreignPersonId)).status === 404,
      "a foreign-workspace person is indistinguishable from a missing person",
    );
    const [ownerUser] = await sql<{ readonly id: string }[]>`
      select user_id::text as id from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(ownerUser, "timeline owner user exists");
    const forged = await personProfile.listTimeline({
      memberId: owner.memberId,
      role: "owner",
      userId: ownerUser.id,
      workspaceId: foreign.workspaceId,
    }, foreignPersonId);
    assert(
      forged.status === "forbidden",
      "a forged workspace context is refused before timeline projection",
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
  name:
    "PEOPLE-004 PostgreSQL lifecycle is tenant-safe, atomic, auditable, and retains dependents",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces restart identity cascade`;
    const owner = await register(
      `lifecycle-owner-${crypto.randomUUID()}@example.test`,
      "Lifecycle circle",
    );
    const foreign = await register(
      `lifecycle-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign lifecycle circle",
    );
    const created = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const createdBody = await created.json() as {
      readonly person: { readonly id: string };
    };
    const personId = createdBody.person.id;
    const foreignPerson = await createPerson(foreign, {
      givenName: "Foreign",
      isPartial: false,
    });
    const foreignId = (await foreignPerson.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    await sql`
      insert into crm.person_dates (person_id, kind, precision)
      values (${personId}, 'custom', 'unknown')
    `;
    const headers = {
      "content-type": "application/json",
      cookie: owner.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": owner.workspaceId,
    };
    const ready = await getPerson(owner, personId);
    const readyBody = await ready.json() as {
      readonly person: { readonly updatedAt: string };
    };
    const initialImpact = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/deletion-impact`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const initialImpactBody = await initialImpact.json() as {
      readonly impact: { readonly person: { readonly updatedAt: string } };
    };
    assert(
      initialImpactBody.impact.person.updatedAt === readyBody.person.updatedAt,
      `profile and lifecycle versions agree: ${readyBody.person.updatedAt} / ${initialImpactBody.impact.person.updatedAt}`,
    );
    const edited = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: readyBody.person.updatedAt,
          familyName: "Byron",
          givenName: "Ada",
          isPartial: false,
        }),
        headers,
        method: "PATCH",
      },
    );
    const editedBody = await edited.json() as {
      readonly person: { readonly updatedAt: string };
    };
    assert(
      edited.status === 200,
      `identity edit succeeds: ${edited.status} ${JSON.stringify(editedBody)}`,
    );

    const staleArchive = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/archive`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: readyBody.person.updatedAt,
        }),
        headers,
        method: "POST",
      },
    );
    assert(staleArchive.status === 409, "stale mutation is explicit");
    const archiveRequest = () =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}/archive`,
        {
          body: JSON.stringify({
            expectedUpdatedAt: editedBody.person.updatedAt,
          }),
          headers,
          method: "POST",
        },
      );
    const [archiveA, archiveB] = await Promise.all([
      archiveRequest(),
      archiveRequest(),
    ]);
    const archiveBody = await archiveA.clone().json() as {
      readonly person: { readonly updatedAt: string };
    };
    assert(
      archiveA.status === 200 && archiveB.status === 200,
      "overlapping archive requests serialize and replay idempotently",
    );
    const archivedEdit = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: archiveBody.person.updatedAt,
          familyName: "Blocked",
          givenName: "Ada",
          isPartial: false,
        }),
        headers,
        method: "PATCH",
      },
    );
    assert(
      archivedEdit.status === 409 &&
        (await archivedEdit.json() as { readonly code: string }).code ===
          "archived_write_rejected",
      "archived identity is read-only",
    );
    const restored = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/restore`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: archiveBody.person.updatedAt,
        }),
        headers,
        method: "POST",
      },
    );
    assert(restored.status === 200, "archived person restores");
    const impact = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/deletion-impact`,
      { headers },
    );
    const impactBody = await impact.json() as {
      readonly impact: {
        readonly confirmation: string;
        readonly dependentRecordPolicy: string;
        readonly person: { readonly updatedAt: string };
      };
    };
    assert(
      impact.status === 200 &&
        impactBody.impact.dependentRecordPolicy === "retained",
      "impact exposes canonical dependent retention",
    );
    const cancelled = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          confirmation: "wrong",
          expectedUpdatedAt: impactBody.impact.person.updatedAt,
        }),
        headers,
        method: "DELETE",
      },
    );
    assert(cancelled.status === 400, "incorrect confirmation changes nothing");
    const deleteRequest = () =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}`,
        {
          body: JSON.stringify({
            confirmation: impactBody.impact.confirmation,
            expectedUpdatedAt: impactBody.impact.person.updatedAt,
          }),
          headers,
          method: "DELETE",
        },
      );
    const deleted = await deleteRequest();
    const replayed = await deleteRequest();
    assert(
      deleted.status === 200 && replayed.status === 200 &&
        (await getPerson(owner, personId)).status === 404,
      "soft-delete is hidden and idempotent",
    );
    const [proof] = await sql<{
      readonly audit_count: number;
      readonly date_count: number;
      readonly deleted: boolean;
    }[]>`
      select
        person.deleted_at is not null as deleted,
        (select count(*)::int from crm.person_dates
          where person_id = ${personId}) as date_count,
        (select count(*)::int from crm.audit_events
          where person_id = ${personId}
            and action in (
              'people.person-updated', 'people.person-archived',
              'people.person-restored', 'people.person-deleted'
            )) as audit_count
      from crm.people person where person.id = ${personId}
    `;
    assert(
      proof?.deleted && proof.date_count === 1 && proof.audit_count === 4,
      "delete retains dependent history and each real change has one audit",
    );
    assert(
      (await configured.app.request(
            `http://localhost/api/v1/people/${foreignId}/deletion-impact`,
            { headers },
          )).status === 404 &&
        (await configured.app.request(
            `http://localhost/api/v1/people/${crypto.randomUUID()}/deletion-impact`,
            { headers },
          )).status === 404,
      "foreign and missing lifecycle identifiers are indistinguishable",
    );
  },
});

Deno.test({
  name:
    "PEOPLE-004 fixed-clock edits advance versions and retain exact audit identity",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces restart identity cascade`;
    const owner = await register(
      `lifecycle-clock-${crypto.randomUUID()}@example.test`,
      "Lifecycle clock circle",
    );
    const created = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const personId = (await created.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const [identity] = await sql<{ readonly user_id: string }[]>`
      select user_id::text from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(identity, "fixed-clock lifecycle actor exists");
    const actor: PeopleActor = {
      memberId: owner.memberId,
      role: "owner",
      userId: identity.user_id,
      workspaceId: owner.workspaceId,
    };
    const fixedClock = new Date("2099-01-01T00:00:00.000Z");
    const lifecycle = createPersonLifecycle({
      audit: new PostgresPersonLifecycleAudit(),
      clock: { now: () => fixedClock },
      repository: new PostgresPersonLifecycleRepository(),
      transaction: new PostgresPeopleTransaction(peopleConnection.db),
    });
    const initial = await getPerson(owner, personId);
    const initialBody = await initial.json() as {
      readonly person: { readonly updatedAt: string };
    };

    const first = await lifecycle.edit(actor, personId, {
      expectedUpdatedAt: initialBody.person.updatedAt,
      familyName: "Byron",
      givenName: "Ada",
      isPartial: false,
    });
    assert(first.status === "updated", "first fixed-clock edit commits");
    const [firstProof] = await sql<{
      readonly family_name: string;
      readonly updated_at: string;
    }[]>`
      select family_name,
        to_char(updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
      from crm.people where id = ${personId}
    `;
    assert(
      firstProof?.family_name === "Byron" &&
        firstProof.updated_at === first.person.updatedAt,
      "first intended identity and returned version are persisted",
    );

    const second = await lifecycle.edit(actor, personId, {
      expectedUpdatedAt: first.person.updatedAt,
      familyName: "King",
      givenName: "Ada",
      isPartial: false,
    });
    assert(second.status === "updated", "second fixed-clock edit commits");
    assert(
      second.person.updatedAt !== first.person.updatedAt &&
        second.person.updatedAt > first.person.updatedAt,
      "each fixed-clock mutation returns a unique strictly newer version",
    );

    const headers = {
      "content-type": "application/json",
      cookie: owner.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": owner.workspaceId,
    };
    const replay = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: first.person.updatedAt,
          familyName: "Replay",
          givenName: "Ada",
          isPartial: false,
        }),
        headers,
        method: "PATCH",
      },
    );
    assert(replay.status === 409, "replaying the earlier token is stale");

    const [proof] = await sql<{
      readonly audit_count: number;
      readonly distinct_audit_count: number;
      readonly family_name: string;
      readonly version_is_newer: boolean;
    }[]>`
      select person.family_name,
        person.updated_at > ${first.person.updatedAt}::timestamptz
          as version_is_newer,
        (select count(*)::int from crm.audit_events
          where person_id = ${personId}
            and action = 'people.person-updated') as audit_count,
        (select count(distinct id)::int from crm.audit_events
          where person_id = ${personId}
            and action = 'people.person-updated') as distinct_audit_count
      from crm.people person where person.id = ${personId}
    `;
    assert(
      proof?.family_name === "King" && proof.version_is_newer,
      "the stale replay cannot alter the second committed identity or version",
    );
    assert(
      proof.audit_count === 2 && proof.distinct_audit_count === 2,
      "both intended fixed-clock edits are audited exactly once by distinct IDs",
    );
  },
});

Deno.test({
  name:
    "PEOPLE-004 archived people delete directly without losing archive history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces restart identity cascade`;
    const owner = await register(
      `archived-delete-${crypto.randomUUID()}@example.test`,
      "Archived delete circle",
    );
    const otherOwner = await register(
      `archived-delete-other-${crypto.randomUUID()}@example.test`,
      "Other archived delete circle",
    );
    const created = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const personId = (await created.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const otherCreated = await createPerson(otherOwner, {
      familyName: "Contact",
      givenName: "Foreign",
      isPartial: false,
    });
    const otherPersonId = (await otherCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    await sql`
      insert into crm.person_dates (person_id, kind, precision)
      values (${personId}, 'custom', 'unknown')
    `;
    const headers = {
      "content-type": "application/json",
      cookie: owner.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": owner.workspaceId,
    };
    const readyBody = await (await getPerson(owner, personId)).json() as {
      readonly person: { readonly updatedAt: string };
    };
    const archived = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/archive`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: readyBody.person.updatedAt,
        }),
        headers,
        method: "POST",
      },
    );
    const archivedBody = await archived.json() as {
      readonly person: { readonly updatedAt: string };
    };
    assert(archived.status === 200, "fixture archives the person");
    const impact = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/deletion-impact`,
      { headers },
    );
    const impactBody = await impact.json() as {
      readonly impact: {
        readonly confirmation: string;
        readonly person: { readonly updatedAt: string };
      };
    };
    assert(
      impact.status === 200 &&
        impactBody.impact.person.updatedAt === archivedBody.person.updatedAt,
      "deletion preview preserves the archived version",
    );

    const otherReady = await (await getPerson(otherOwner, otherPersonId))
      .json() as {
        readonly person: { readonly updatedAt: string };
      };
    const crossed = await configured.app.request(
      `http://localhost/api/v1/people/${otherPersonId}`,
      {
        body: JSON.stringify({
          confirmation: "DELETE Foreign Contact",
          expectedUpdatedAt: otherReady.person.updatedAt,
        }),
        headers,
        method: "DELETE",
      },
    );
    assert(crossed.status === 404, "cross-tenant delete remains hidden");

    const deleteRequest = () =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}`,
        {
          body: JSON.stringify({
            confirmation: impactBody.impact.confirmation,
            expectedUpdatedAt: impactBody.impact.person.updatedAt,
          }),
          headers,
          method: "DELETE",
        },
      );
    const deleted = await deleteRequest();
    assert(
      deleted.status === 200,
      `archived person deletes directly: ${deleted.status} ${await deleted
        .text()}`,
    );
    const replayed = await deleteRequest();
    assert(replayed.status === 200, "archived delete replay is idempotent");

    const [proof] = await sql<{
      readonly archived: boolean;
      readonly date_count: number;
      readonly delete_audit_count: number;
      readonly deleted: boolean;
      readonly other_unchanged: boolean;
      readonly other_delete_audit_count: number;
    }[]>`
      select
        person.archived_at is not null as archived,
        person.deleted_at is not null as deleted,
        other.archived_at is null and other.deleted_at is null
          as other_unchanged,
        (select count(*)::int from crm.person_dates
          where person_id = ${personId}) as date_count,
        (select count(*)::int from crm.audit_events
          where person_id = ${personId}
            and action = 'people.person-deleted') as delete_audit_count,
        (select count(*)::int from crm.audit_events
          where person_id = ${otherPersonId}
            and action = 'people.person-deleted') as other_delete_audit_count
      from crm.people person
      cross join crm.people other
      where person.id = ${personId} and other.id = ${otherPersonId}
    `;
    assert(
      proof?.archived && proof.deleted && proof.date_count === 1,
      "delete preserves archive history and dependent records",
    );
    assert(
      proof.delete_audit_count === 1,
      "delete and its replay create exactly one deletion audit",
    );
    assert(
      proof.other_unchanged && proof.other_delete_audit_count === 0,
      "cross-tenant person and audit history remain unchanged",
    );
  },
});

Deno.test({
  name:
    "PEOPLE-005 important dates preserve precision, tenancy, audit, concurrency, and reminder history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces restart identity cascade`;
    const owner = await register(
      `important-dates-${crypto.randomUUID()}@example.test`,
      "Important dates circle",
    );
    const foreignOwner = await register(
      `important-dates-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign important dates circle",
    );
    await sql`
      update crm.workspace_settings
      set default_timezone = 'America/New_York',
        default_reminder_time = '09:30'::time
      where workspace_id = ${owner.workspaceId}
    `;
    await sql`
      update crm.member_preferences
      set timezone = 'America/New_York'
      where member_id = ${owner.memberId}
    `;
    await sql`
      insert into crm.reminder_rules (
        workspace_id, days_before, is_active, created_at, updated_at
      ) values (${owner.workspaceId}, 2, true, now(), now())
    `;
    const createdPerson = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const personId = (await createdPerson.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const foreignPerson = await createPerson(foreignOwner, {
      familyName: "Hidden",
      givenName: "Person",
      isPartial: false,
    });
    const foreignPersonId = (await foreignPerson.json() as {
      readonly person: { readonly id: string };
    }).person.id;

    const invalidLeap = await importantDateRequest(owner, personId, "POST", {
      day: 29,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Impossible leap day",
      month: 2,
      precision: "full",
      year: 1900,
    });
    assert(invalidLeap.status === 400, "non-leap February 29 is rejected");
    const contradictory = await importantDateRequest(
      owner,
      personId,
      "POST",
      {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "custom",
        label: "Contradictory",
        month: 4,
        precision: "year",
        year: 2012,
      },
    );
    assert(
      contradictory.status === 400,
      "components contradicting precision are rejected",
    );

    const [firstMetLeft, firstMetRight] = await Promise.all([
      importantDateRequest(owner, personId, "POST", {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "first_met",
        month: 4,
        precision: "year_month",
        year: 2012,
      }),
      importantDateRequest(owner, personId, "POST", {
        day: 5,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "first_met",
        month: 4,
        precision: "full",
        year: 2012,
      }),
    ]);
    assert(
      [firstMetLeft.status, firstMetRight.status].sort().join(",") ===
        "201,409",
      "the singleton lock permits exactly one concurrent first-meeting date",
    );

    interface DateRecord {
      readonly id: string;
      readonly isYearApproximate: boolean;
      readonly kind: string;
      readonly precision: string;
      readonly scheduling: string;
      readonly updatedAt: string;
      readonly year?: number;
    }
    const createDate = async (
      body: Readonly<Record<string, unknown>>,
    ): Promise<DateRecord> => {
      const response = await importantDateRequest(
        owner,
        personId,
        "POST",
        body,
      );
      const payload = await response.json() as { readonly date: DateRecord };
      assert(
        response.status === 201,
        `date fixture creates: ${response.status}`,
      );
      return payload.date;
    };
    const birthday = await createDate({
      day: 29,
      isAgeBased: true,
      isYearApproximate: true,
      kind: "birthday",
      month: 2,
      precision: "full",
      year: 1984,
    });
    const duplicateBirthday = await importantDateRequest(
      owner,
      personId,
      "POST",
      {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "birthday",
        precision: "unknown",
      },
    );
    assert(duplicateBirthday.status === 409, "birthday is a singleton");
    const deceased = await createDate({
      isAgeBased: false,
      isYearApproximate: true,
      kind: "deceased",
      precision: "year",
      year: 2020,
    });
    const annualCustom = await createDate({
      day: 29,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Leap-day tradition",
      month: 2,
      precision: "month_day",
    });
    await createDate({
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Conference month",
      month: 9,
      precision: "month",
    });
    await createDate({
      day: 12,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Remembered day",
      precision: "day",
    });
    await createDate({
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Unknown anniversary",
      precision: "unknown",
    });

    const listed = await importantDateRequest(owner, personId, "GET");
    const listedBody = await listed.json() as {
      readonly dates: readonly DateRecord[];
      readonly status: string;
    };
    assert(
      listed.status === 200 && listedBody.status === "ready" &&
        listedBody.dates.length === 7,
      "all core and custom date kinds list in the active workspace",
    );
    const listedBirthday = listedBody.dates.find((date) =>
      date.id === birthday.id
    );
    const schedulableDates = listedBody.dates.filter((date) =>
      date.scheduling === "annual-reminder"
    ).length;
    assert(
      listedBirthday?.precision === "full" &&
        listedBirthday.isYearApproximate && listedBirthday.year === 1984,
      "approximation round-trips independently from full precision",
    );
    const crossed = await importantDateRequest(
      owner,
      foreignPersonId,
      "GET",
    );
    assert(crossed.status === 404, "cross-workspace dates stay concealed");

    const [initialSchedule] = await sql<{
      readonly active_definitions: number;
      readonly local_delivery_valid: boolean;
      readonly pending_occurrences: number;
      readonly unscheduled_definitions: number;
    }[]>`
      select
        count(*) filter (where reminder.is_active)::int active_definitions,
        count(*) filter (where not reminder.is_active)::int unscheduled_definitions,
        (select count(*)::int from crm.reminder_occurrences occurrence
          join crm.reminders owned on owned.id = occurrence.reminder_id
          where owned.person_id = ${personId}
            and occurrence.status = 'pending') pending_occurrences,
        bool_and(
          ((occurrence.deliver_at at time zone 'America/New_York')::time =
            '09:30'::time)
          and occurrence.lead_time_days = 2
          and (occurrence.deliver_at at time zone 'America/New_York')::date =
            occurrence.occurs_on - 2
        ) filter (where occurrence.id is not null) local_delivery_valid
      from crm.reminders reminder
      left join crm.reminder_occurrences occurrence
        on occurrence.reminder_id = reminder.id
      where reminder.person_id = ${personId}
    `;
    assert(
      initialSchedule?.active_definitions === schedulableDates &&
        initialSchedule.pending_occurrences === schedulableDates &&
        initialSchedule.unscheduled_definitions === 0 &&
        initialSchedule.local_delivery_valid,
      `only month/day dates generate annual future state in member scheduling time: ${
        JSON.stringify(initialSchedule)
      }`,
    );
    const [firstMeetingProof] = await sql<{
      readonly date_count: number;
      readonly narrative_count: number;
    }[]>`
      select
        (select count(*)::int from crm.person_dates
          where person_id = ${personId} and kind = 'first_met') date_count,
        (select count(*)::int from crm.person_first_meetings
          where person_id = ${personId}) narrative_count
    `;
    assert(
      firstMeetingProof?.date_count === 1 &&
        firstMeetingProof.narrative_count === 0,
      "first meeting remains person_dates kind first_met, not narrative state",
    );

    const timingPersonResponse = await createPerson(owner, {
      familyName: "Timing",
      givenName: "Reminder",
      isPartial: false,
    });
    const timingPersonId = (await timingPersonResponse.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const [localNow] = await sql<{
      readonly local_day: number;
      readonly local_month: number;
      readonly local_year: number;
    }[]>`
      select
        extract(day from current_timestamp at time zone 'America/New_York')::int
          as local_day,
        extract(month from current_timestamp at time zone 'America/New_York')::int
          as local_month,
        extract(year from current_timestamp at time zone 'America/New_York')::int
          as local_year
    `;
    assert(localNow, "member-local reminder date is available");
    const timingDate = async (
      body: Readonly<Record<string, unknown>>,
    ): Promise<DateRecord> => {
      const response = await importantDateRequest(
        owner,
        timingPersonId,
        "POST",
        body,
      );
      const payload = await response.json() as { readonly date: DateRecord };
      assert(response.status === 201, "timing date fixture creates");
      return payload.date;
    };
    const leadBirthday = await timingDate({
      day: localNow.local_day,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: localNow.local_month,
      precision: "month_day",
    });
    const [leadProof] = await sql<{
      readonly bounded: boolean;
      readonly delivery_future: boolean;
      readonly next_annual: boolean;
    }[]>`
      select
        occurrence.occurs_on <=
          ((occurrence.created_at at time zone 'America/New_York')::date + 1461)
          bounded,
        occurrence.deliver_at >= occurrence.created_at delivery_future,
        occurrence.occurs_on >
          (occurrence.created_at at time zone 'America/New_York')::date
          next_annual
      from crm.reminder_occurrences occurrence
      join crm.reminders reminder on reminder.id = occurrence.reminder_id
      where reminder.person_date_id = ${leadBirthday.id}
        and occurrence.member_id = ${owner.memberId}
        and occurrence.status = 'pending'
    `;
    assert(
      leadProof?.delivery_future && leadProof.next_annual && leadProof.bounded,
      `birthday today with two-day lead chooses the next deliverable annual occurrence: ${
        JSON.stringify(leadProof)
      }`,
    );

    await sql`
      update crm.reminder_rules set days_before = 0
      where workspace_id = ${owner.workspaceId} and is_active
    `;
    await sql`
      update crm.workspace_settings set default_reminder_time = '00:00'::time
      where workspace_id = ${owner.workspaceId}
    `;
    const afterSend = await timingDate({
      day: localNow.local_day,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Same-day after send time",
      month: localNow.local_month,
      precision: "month_day",
    });
    const nextYear = localNow.local_year + 1;
    const marchFirstWeekday = new Date(Date.UTC(nextYear, 2, 1)).getUTCDay();
    const dstStartDay = 1 + ((7 - marchFirstWeekday) % 7) + 7;
    const dstBoundary = await timingDate({
      day: dstStartDay,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "DST boundary",
      month: 3,
      precision: "month_day",
    });
    const [futurityProof] = await sql<{
      readonly bounded: boolean;
      readonly count: number;
      readonly dst_local_midnight: boolean;
      readonly future: boolean;
      readonly same_day_advanced: boolean;
    }[]>`
      select
        bool_and(occurrence.occurs_on <=
          ((occurrence.created_at at time zone 'America/New_York')::date + 1461))
          bounded,
        count(*)::int count,
        bool_and(
          (occurrence.deliver_at at time zone 'America/New_York')::time =
            '00:00'::time
        ) filter (where reminder.person_date_id = ${dstBoundary.id})
          dst_local_midnight,
        bool_and(occurrence.deliver_at >= occurrence.created_at) future,
        bool_and(occurrence.occurs_on >
          (occurrence.created_at at time zone 'America/New_York')::date)
          filter (where reminder.person_date_id = ${afterSend.id})
          same_day_advanced
      from crm.reminder_occurrences occurrence
      join crm.reminders reminder on reminder.id = occurrence.reminder_id
      where reminder.person_id = ${timingPersonId}
        and occurrence.member_id = ${owner.memberId}
        and occurrence.status = 'pending'
    `;
    assert(
      futurityProof?.count === 3 && futurityProof.future &&
        futurityProof.bounded && futurityProof.same_day_advanced &&
        futurityProof.dst_local_midnight,
      `every pending member occurrence is future, bounded, and timezone-stable across lead, same-day, and DST dates: ${
        JSON.stringify(futurityProof)
      }`,
    );

    const birthdayUpdated = await importantDateRequest(
      owner,
      personId,
      "PATCH",
      {
        expectedUpdatedAt: birthday.updatedAt,
        isAgeBased: true,
        isYearApproximate: true,
        kind: "birthday",
        precision: "year",
        year: 1984,
      },
      birthday.id,
    );
    assert(
      birthdayUpdated.status === 200,
      "schedulable date updates to honest year-only precision",
    );
    const [birthdaySchedule] = await sql<{
      readonly active: boolean;
      readonly pending: number;
    }[]>`
      select reminder.is_active active,
        count(occurrence.id) filter (where occurrence.status = 'pending')::int pending
      from crm.reminders reminder
      left join crm.reminder_occurrences occurrence
        on occurrence.reminder_id = reminder.id
      where reminder.person_date_id = ${birthday.id}
      group by reminder.id
    `;
    assert(
      birthdaySchedule?.active === false && birthdaySchedule.pending === 0,
      "year-only updates remove pending state without inventing a month or day",
    );

    const updatedDeath = await importantDateRequest(
      owner,
      personId,
      "PATCH",
      {
        expectedUpdatedAt: deceased.updatedAt,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "deceased",
        precision: "year",
        year: 2021,
      },
      deceased.id,
    );
    assert(updatedDeath.status === 200, "singleton death date updates");
    const staleDeath = await importantDateRequest(
      owner,
      personId,
      "PATCH",
      {
        expectedUpdatedAt: deceased.updatedAt,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "deceased",
        precision: "year",
        year: 2022,
      },
      deceased.id,
    );
    assert(staleDeath.status === 409, "stale optimistic version is rejected");

    const [annualReminder] = await sql<{ readonly id: string }[]>`
      select id::text from crm.reminders
      where person_date_id = ${annualCustom.id}
    `;
    assert(annualReminder, "annual custom date owns a reminder definition");
    await sql`
      update crm.reminder_occurrences
      set status = 'sent', sent_at = now(),
        provider_receipt = 'people-005-history:' || id::text,
        provider_result_state = 'confirmed', provider_effect_at = now(),
        visible_at = now(), updated_at = now()
      where reminder_id = ${annualReminder.id}
    `;
    const deletedAnnual = await importantDateRequest(
      owner,
      personId,
      "DELETE",
      { expectedUpdatedAt: annualCustom.updatedAt },
      annualCustom.id,
    );
    assert(deletedAnnual.status === 200, "custom date deletes");
    const [history] = await sql<{
      readonly date_absent: boolean;
      readonly definition_detached: boolean;
      readonly sent_count: number;
    }[]>`
      select
        not exists(select 1 from crm.person_dates
          where id = ${annualCustom.id}) date_absent,
        exists(select 1 from crm.reminders
          where id = ${annualReminder.id} and person_date_id is null
            and target_kind = 'person' and not is_active
            and deleted_at is not null) definition_detached,
        (select count(*)::int from crm.reminder_occurrences
          where reminder_id = ${annualReminder.id}
            and status = 'sent') sent_count
    `;
    assert(
      history?.date_absent && history.definition_detached &&
        history.sent_count === 1,
      "delete removes pending state while preserving detached delivered history",
    );

    const [auditProof] = await sql<{
      readonly audit_count: number;
      readonly distinct_subjects: number;
    }[]>`
      select count(*)::int audit_count,
        count(distinct subject_id)::int distinct_subjects
      from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-date-updated'
    `;
    const auditRows = await sql<{
      readonly payload: unknown;
      readonly subject_type: string;
    }[]>`
      select payload, subject_type
      from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-date-updated'
    `;
    const normalizedAuditRows = auditRows.map((row) => ({
      ...row,
      payload: typeof row.payload === "string"
        ? JSON.parse(row.payload) as Record<string, unknown>
        : row.payload as Record<string, unknown>,
    }));
    const exactAuditRows = normalizedAuditRows.every((row) =>
      row.subject_type === "person_date" &&
      ["create", "delete", "update"].includes(`${row.payload.action}`) &&
      Object.hasOwn(row.payload, "from") && Object.hasOwn(row.payload, "to")
    );
    assert(
      auditProof?.audit_count === 10 && auditProof.distinct_subjects === 7 &&
        exactAuditRows,
      `each successful date effect has exactly one typed governance audit: ${
        JSON.stringify({ auditProof, normalizedAuditRows })
      }`,
    );

    const person = await (await getPerson(owner, personId)).json() as {
      readonly person: { readonly updatedAt: string };
    };
    const archived = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/archive`,
      {
        body: JSON.stringify({ expectedUpdatedAt: person.person.updatedAt }),
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
          origin: "http://localhost",
          "X-Workspace-Id": owner.workspaceId,
        },
        method: "POST",
      },
    );
    assert(archived.status === 200, "person archives for lifecycle proof");
    const archivedWrite = await importantDateRequest(
      owner,
      personId,
      "POST",
      {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "custom",
        label: "Must not persist",
        precision: "unknown",
      },
    );
    const archivedList = await importantDateRequest(owner, personId, "GET");
    const archivedListBody = await archivedList.json() as {
      readonly status: string;
    };
    assert(
      archivedWrite.status === 409 && archivedList.status === 200 &&
        archivedListBody.status === "archived",
      "archived lifecycle is revalidated under lock and remains readable",
    );
  },
});

Deno.test({
  name:
    "[PEOPLE-006] real PostgreSQL profile facts enforce tenant vocabularies and hidden retention",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await register(
      `facts-${crypto.randomUUID()}@example.test`,
      "Facts circle",
    );
    const foreign = await register(
      `facts-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign facts circle",
    );
    const created = await createPerson(owner, {
      givenName: "Ada",
      isPartial: false,
    });
    const personId =
      (await created.json() as { readonly person: { readonly id: string } })
        .person.id;
    const introducerCreated = await createPerson(owner, {
      givenName: "Charles",
      isPartial: false,
    });
    const introducerId = (await introducerCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const colleagueCreated = await createPerson(owner, {
      givenName: "Barbara",
      isPartial: false,
    });
    const colleagueId = (await colleagueCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const foreignPersonCreated = await createPerson(foreign, {
      givenName: "Private",
      isPartial: false,
    });
    const foreignPersonId = (await foreignPersonCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const introducerPage = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&search=Ada&selectedPersonId=${introducerId}&excludePersonId=${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const introducerPageBody = await introducerPage.json() as {
      readonly people?: readonly { readonly id: string }[];
      readonly selected?: { readonly id: string; readonly givenName: string };
    };
    assert(
      introducerPage.status === 200 &&
        introducerPageBody.people?.every((person) =>
          person.id !== introducerId
        ) &&
        introducerPageBody.selected?.id === introducerId &&
        introducerPageBody.selected.givenName === "Charles",
      "an existing introducer is hydrated outside the bounded search page",
    );
    const concealedSelected = async (selectedPersonId: string) => {
      const response = await configured.app.request(
        `http://localhost/api/v1/people?limit=1&selectedPersonId=${selectedPersonId}&excludePersonId=${personId}`,
        {
          headers: {
            cookie: owner.cookie,
            "X-Workspace-Id": owner.workspaceId,
          },
        },
      );
      return await response.json() as { readonly selected?: unknown };
    };
    assert(
      (await concealedSelected(personId)).selected === undefined &&
        (await concealedSelected(foreignPersonId)).selected === undefined,
      "self and foreign introducer hydration are concealed",
    );
    const excludedPage = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&excludePersonId=${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const excludedPageBody = await excludedPage.json() as {
      readonly nextCursor?: string;
      readonly people: readonly { readonly id: string }[];
    };
    const excludedTail = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&excludePersonId=${personId}&cursor=${
        encodeURIComponent(excludedPageBody.nextCursor ?? "")
      }`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const excludedTailBody = await excludedTail.json() as {
      readonly people: readonly { readonly id: string }[];
    };
    const mismatchedExclude = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&excludePersonId=${colleagueId}&cursor=${
        encodeURIComponent(excludedPageBody.nextCursor ?? "")
      }`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    assert(
      excludedPage.status === 200 && excludedPageBody.people.length === 1 &&
        excludedPageBody.nextCursor && excludedTail.status === 200 &&
        excludedTailBody.people.length === 1 &&
        [...excludedPageBody.people, ...excludedTailBody.people].every((
          person,
        ) => person.id !== personId) && mismatchedExclude.status === 409,
      "excluded subject never consumes a page slot and remains cursor-bound",
    );
    const typeId = crypto.randomUUID();
    const foreignTypeId = crypto.randomUUID();
    const inactiveTypeId = crypto.randomUUID();
    const labelId = crypto.randomUUID();
    const foreignLabelId = crypto.randomUUID();
    const petCategoryId = crypto.randomUUID();
    const tagId = crypto.randomUUID();
    const foreignTagId = crypto.randomUUID();
    const foreignOrganizationId = crypto.randomUUID();
    await sql`
      insert into crm.contact_method_types (id, workspace_id, name, is_archived)
      values (${typeId}, ${owner.workspaceId}, 'Email', false),
        (${inactiveTypeId}, ${owner.workspaceId}, 'Disabled custom', true)
    `;
    await sql`
      insert into crm.contact_method_types (id, workspace_id, name, is_archived)
      values (${foreignTypeId}, ${foreign.workspaceId}, 'Foreign', false)
    `;
    await sql`
      insert into crm.contact_labels (id, workspace_id, label, applies_to)
      values (${labelId}, ${owner.workspaceId}, 'Home', 'any')
    `;
    await sql`
      insert into crm.contact_labels (id, workspace_id, label, applies_to)
      values (${foreignLabelId}, ${foreign.workspaceId}, 'Foreign', 'any')
    `;
    await sql`
      insert into crm.pet_categories (id, name, is_common, is_active)
      values (${petCategoryId}, ${`Cat ${petCategoryId}`}, true, true)
    `;
    await sql`
      insert into crm.tags (id, workspace_id, name, slug)
      values (${tagId}, ${owner.workspaceId}, 'Friend', ${`friend-${tagId}`}),
        (${foreignTagId}, ${foreign.workspaceId}, 'Private', ${`private-${foreignTagId}`})
    `;
    await sql`
      insert into crm.organizations (id, workspace_id, name)
      values (${foreignOrganizationId}, ${foreign.workspaceId}, 'Private Engines')
    `;
    const boundedOrganizations = await sql<{
      readonly id: string;
      readonly name: string;
    }[]>`
      insert into crm.organizations (workspace_id, name)
      select ${owner.workspaceId}::uuid,
        'Bounded organization ' || lpad(series::text, 3, '0')
      from generate_series(1, 74) series
      returning id::text, name
    `;
    const assignedTagRows = await sql<{ readonly id: string }[]>`
      insert into crm.tags (workspace_id, name, slug)
      select ${owner.workspaceId}::uuid, 'Assigned tag ' || series,
        ${`assigned-${personId}-`} || series
      from generate_series(1, 74) series
      returning id::text
    `;
    const assignedTagIds = [tagId, ...assignedTagRows.map((row) => row.id)];
    const request = (
      section: string,
      method: string,
      body?: Readonly<Record<string, unknown>>,
      factId?: string,
    ) => {
      const updateId = method === "PUT" && typeof body?.id === "string"
        ? body.id
        : undefined;
      const actualMethod = method === "PUT" && !updateId ? "POST" : method;
      const targetId = factId ?? updateId;
      return configured.app.request(
        `http://localhost/api/v1/people/${personId}/facts/${section}${
          targetId ? `/${targetId}` : ""
        }`,
        {
          ...(body
            ? {
              body: JSON.stringify(
                ["POST", "PUT", "DELETE"].includes(actualMethod)
                  ? { section, ...body }
                  : body,
              ),
            }
            : {}),
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
            origin: "http://localhost",
            "X-Workspace-Id": owner.workspaceId,
          },
          method: actualMethod,
        },
      );
    };
    const [ownerIdentity] = await sql<{ readonly user_id: string }[]>`
      select user_id::text from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(ownerIdentity, "owner actor identity resolves");
    const factActor = {
      memberId: owner.memberId,
      role: "owner" as const,
      userId: ownerIdentity.user_id,
      workspaceId: owner.workspaceId,
    };
    const initialFacts = await request("contact-methods", "GET");
    let personRevision = (await initialFacts.json() as {
      readonly personUpdatedAt: string;
    }).personUpdatedAt;
    const savedContact = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isPrimary: true,
      labelIds: [labelId],
      typeId,
      value: "ada@example.test",
    });
    const savedContactDiagnostic = await savedContact.clone().text();
    if (savedContact.status !== 200) {
      try {
        const direct = await profileFacts.create(
          factActor,
          personId,
          "contact-methods",
          {
            expectedPersonUpdatedAt: personRevision,
            isPrimary: true,
            labelIds: [labelId],
            typeId,
            value: "ada@example.test",
          },
        );
        throw new Error(
          `HTTP concealed a save while direct facade returned ${
            JSON.stringify(direct)
          }`,
        );
      } catch (error) {
        const details = error instanceof Error
          ? `${error.name}: ${error.message}; cause=${String(error.cause)}`
          : String(error);
        throw new Error(
          `workspace contact save raw diagnostic (${savedContact.status}: ${savedContactDiagnostic}): ${details}`,
        );
      }
    }
    assert(
      savedContact.status === 200,
      `workspace contact type and label save (${savedContact.status}: ${savedContactDiagnostic})`,
    );
    const contact = await savedContact.json() as {
      readonly personUpdatedAt: string;
      readonly record: { readonly id: string; readonly updatedAt: string };
    };
    personRevision = contact.personUpdatedAt;
    const factIds = new Map<string, string>([[
      "contact-methods",
      contact.record.id,
    ]]);
    const factRevisions = new Map<string, string>([[
      "contact-methods",
      contact.record.updatedAt,
    ]]);
    for (
      const [section, body] of [
        ["addresses", {
          city: "London",
          displayName: "Home",
          isPrimary: true,
          labelIds: [labelId],
          street: "1 Analytical Engine Way",
        }],
        ["first-meeting", {
          introducedByPersonId: introducerId,
          notes: "Introduced at a mathematics salon",
          placeText: "London",
        }],
        ["work", {
          isCurrent: true,
          organizationName: "Analytical Engines",
          title: "Mathematician",
        }],
        ["tags", { tagIds: assignedTagIds }],
        ["pets", { categoryId: petCategoryId, name: "Byron" }],
        ["food-preferences", { foodPreferences: "Tea; no shellfish" }],
      ] as const
    ) {
      const response = await request(section, "PUT", {
        ...body,
        expectedPersonUpdatedAt: personRevision,
        ...(section === "tags"
          ? { expectedUpdatedAt: personRevision, id: personId }
          : {}),
      });
      assert(
        response.status === 200,
        `${section} saves through its local fact action`,
      );
      const changed = await response.clone().json() as {
        readonly personUpdatedAt: string;
        readonly record: { readonly id: string; readonly updatedAt: string };
      };
      personRevision = changed.personUpdatedAt;
      factIds.set(section, changed.record.id);
      factRevisions.set(section, changed.record.updatedAt);
      const listed = await request(section, "GET");
      assert(listed.status === 200, `${section} refreshes independently`);
    }
    const organizationOptions = await request(
      "work?includeOptions=true&optionSearch=analytical",
      "GET",
    );
    const organizationOptionsBody = await organizationOptions.json() as {
      readonly options: readonly {
        readonly id: string;
        readonly kind?: string;
        readonly name: string;
      }[];
    };
    const foreignOrganizationOptions = await request(
      "work?includeOptions=true&optionSearch=private",
      "GET",
    );
    assert(
      organizationOptions.status === 200 &&
        organizationOptionsBody.options.length === 1 &&
        organizationOptionsBody.options[0]?.kind === "organization" &&
        organizationOptionsBody.options[0]?.name === "Analytical Engines" &&
        foreignOrganizationOptions.status === 200 &&
        (await foreignOrganizationOptions.json() as {
            readonly options: readonly unknown[];
          }).options.length === 0,
      "work options expose only searchable organizations from the active workspace",
    );
    const workOptionPage = async (search: string, cursor?: string) => {
      const response = await request(
        `work?includeOptions=true&optionSearch=${encodeURIComponent(search)}${
          cursor ? `&optionCursor=${encodeURIComponent(cursor)}` : ""
        }`,
        "GET",
      );
      return {
        body: await response.json() as {
          readonly nextOptionsCursor?: string;
          readonly options?: readonly {
            readonly id: string;
            readonly kind?: string;
            readonly name: string;
          }[];
        },
        status: response.status,
      };
    };
    const boundedFirst = await workOptionPage(
      "  BoUnDeD OrGaNiZaTiOn  ",
    );
    const boundedContinuation = await workOptionPage(
      "bounded organization",
      boundedFirst.body.nextOptionsCursor,
    );
    const boundedIds = [
      ...(boundedFirst.body.options ?? []),
      ...(boundedContinuation.body.options ?? []),
    ].map((option) => option.id);
    const mismatchedOrganizationSearch = await workOptionPage(
      "other organization",
      boundedFirst.body.nextOptionsCursor,
    );
    const anchor = boundedFirst.body.options?.at(-1);
    assert(anchor, "the first organization page exposes its keyset anchor");
    await sql`
      update crm.organizations set name = 'Changed organization anchor'
      where id = ${anchor.id}::uuid and workspace_id = ${owner.workspaceId}
    `;
    const staleOrganizationCursor = await workOptionPage(
      "bounded organization",
      boundedFirst.body.nextOptionsCursor,
    );
    const hydratedWork = await request("work", "GET");
    const hydratedWorkBody = await hydratedWork.json() as {
      readonly records: readonly {
        readonly referencesResolved?: boolean;
        readonly selectedOptions?: readonly {
          readonly id: string;
          readonly kind?: string;
          readonly name: string;
        }[];
        readonly value: { readonly organizationId?: string };
      }[];
    };
    const savedWork = hydratedWorkBody.records[0];
    assert(
      boundedOrganizations.length === 74 && boundedFirst.status === 200 &&
        boundedFirst.body.options?.length === 50 &&
        boundedFirst.body.nextOptionsCursor &&
        boundedContinuation.status === 200 &&
        boundedContinuation.body.options?.length === 24 &&
        !boundedContinuation.body.nextOptionsCursor &&
        boundedIds.length === 74 && new Set(boundedIds).size === 74 &&
        mismatchedOrganizationSearch.status === 409 &&
        staleOrganizationCursor.status === 409 && hydratedWork.status === 200 &&
        savedWork?.referencesResolved === true &&
        savedWork.selectedOptions?.length === 1 &&
        savedWork.selectedOptions[0]?.kind === "organization" &&
        savedWork.selectedOptions[0]?.id === savedWork.value.organizationId &&
        savedWork.selectedOptions[0]?.name === "Analytical Engines",
      `People-owned organization options are bounded, search-bound, tenant-safe, and hydrated: ${
        JSON.stringify({
          continuation: boundedContinuation.status,
          first: boundedFirst.body.options?.length,
          hydrated: savedWork,
          stale: staleOrganizationCursor.status,
          total: boundedIds.length,
        })
      }`,
    );
    const foodProof = () =>
      sql<{
        readonly audit_count: number;
        readonly food_preferences: string | null;
        readonly updated_at: string;
      }[]>`
        select person.food_preferences,
          to_char(person.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') updated_at,
          (select count(*)::int from crm.audit_events audit
            where audit.person_id = person.id
              and audit.action = 'people.person-profile-fact-updated'
              and audit.subject_type = 'person_profile_fact') audit_count
        from crm.people person where person.id = ${personId}
      `;
    const [beforeBlankFood] = await foodProof();
    const blankFood = await profileFacts.update(
      factActor,
      personId,
      "food-preferences",
      {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        foodPreferences: "   ",
        id: personId,
      },
    );
    const [afterBlankFood] = await foodProof();
    assert(
      blankFood.status === "validation-error" && beforeBlankFood &&
        afterBlankFood &&
        beforeBlankFood.food_preferences === afterBlankFood.food_preferences &&
        beforeBlankFood.updated_at === afterBlankFood.updated_at &&
        beforeBlankFood.audit_count === afterBlankFood.audit_count,
      "public facade rejects blank food without row, revision, or audit change",
    );
    const malformedContactId = crypto.randomUUID();
    await sql`
      insert into crm.person_contact_methods (id, person_id, type_id, value)
      values (${malformedContactId}, ${personId}, ${foreignTypeId}, 'concealed')
    `;
    await sql`
      insert into crm.person_contact_method_labels (contact_method_id, label_id)
      values (${factIds.get("contact-methods")!}, ${foreignLabelId})
    `;
    await sql`
      insert into crm.person_address_labels (address_id, label_id)
      values (${factIds.get("addresses")!}, ${foreignLabelId})
    `;
    await sql`
      update crm.person_first_meetings
      set introduced_by_person_id = ${foreignPersonId}
      where person_id = ${personId}
    `;
    const scopedContact = await request("contact-methods", "GET");
    const scopedAddress = await request("addresses", "GET");
    const scopedMeeting = await request("first-meeting", "GET");
    const scopedContactBody = await scopedContact.json() as {
      readonly records: readonly {
        readonly id: string;
        readonly value: { readonly labelIds: readonly string[] };
      }[];
    };
    const scopedAddressBody = await scopedAddress.json() as {
      readonly records: readonly {
        readonly value: { readonly labelIds: readonly string[] };
      }[];
    };
    const scopedMeetingBody = await scopedMeeting.json() as {
      readonly records: readonly {
        readonly value: { readonly introducedByPersonId?: string };
      }[];
    };
    assert(
      scopedContact.status === 200 && scopedAddress.status === 200 &&
        scopedMeeting.status === 200 &&
        scopedContactBody.records.every((record) =>
          record.id !== malformedContactId &&
          !record.value.labelIds.includes(foreignLabelId)
        ) &&
        scopedAddressBody.records.every((record) =>
          !record.value.labelIds.includes(foreignLabelId)
        ) &&
        scopedMeetingBody.records[0]?.value.introducedByPersonId === undefined,
      "foreign type, labels, and introducer references are concealed on reads",
    );

    const foreignContactId = crypto.randomUUID();
    const foreignLocationId = crypto.randomUUID();
    const foreignAddressId = crypto.randomUUID();
    const foreignWorkId = crypto.randomUUID();
    const foreignPetId = crypto.randomUUID();
    await sql`
      insert into crm.person_contact_methods (id, person_id, type_id, value)
      values (${foreignContactId}, ${foreignPersonId}, ${foreignTypeId}, 'private')
    `;
    await sql`
      insert into crm.locations (id, workspace_id, city)
      values (${foreignLocationId}, ${foreign.workspaceId}, 'Private')
    `;
    await sql`
      insert into crm.person_addresses (id, person_id, location_id)
      values (${foreignAddressId}, ${foreignPersonId}, ${foreignLocationId})
    `;
    await sql`
      insert into crm.person_occupations (id, person_id, title)
      values (${foreignWorkId}, ${foreignPersonId}, 'Private')
    `;
    await sql`
      insert into crm.pets (id, person_id, name)
      values (${foreignPetId}, ${foreignPersonId}, 'Private')
    `;
    const missingFactId = crypto.randomUUID();
    const concealedUpdates = await Promise.all([
      request("contact-methods", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignContactId,
        isPrimary: false,
        labelIds: [],
        typeId,
        value: "oracle@example.test",
      }),
      request("addresses", "PUT", {
        city: "Oracle",
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignAddressId,
        isPrimary: false,
        labelIds: [],
      }),
      request("work", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignWorkId,
        isCurrent: false,
        title: "Oracle",
      }),
      request("pets", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignPetId,
        name: "Oracle",
      }),
      request("pets", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: missingFactId,
        name: "Unused",
      }),
      request("first-meeting", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignPersonId,
        notes: "Oracle",
      }),
    ]);
    assert(
      concealedUpdates.every((response) => response.status === 404),
      "foreign and missing update IDs are indistinguishable and never upsert",
    );
    const assignedTags = await request("tags", "GET");
    const assignedTagsBody = await assignedTags.json() as {
      readonly options: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly records: readonly {
        readonly value: { readonly tagIds: readonly string[] };
      }[];
    };
    assert(
      assignedTags.status === 200 && assignedTagsBody.options.length === 75 &&
        assignedTagsBody.records[0]?.value.tagIds.length === 75 &&
        assignedTagsBody.options.every((option) => option.name.length > 0),
      "all assigned tag descriptors are hydrated in one bounded fact read",
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${owner.workspaceId}, 'tags', false)
      on conflict (workspace_id, key) do update set is_active = false,
        updated_at = now()
    `;
    const hiddenTags = await request("tags", "GET");
    const hiddenProfile = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const hiddenProfileBody = await hiddenProfile.json() as {
      readonly person: {
        readonly tagCount: number;
        readonly tags: readonly unknown[];
      };
    };
    const retainedTags = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.person_tags
      where person_id = ${personId}
    `;
    await sql`
      update crm.workspace_profile_modules set is_active = true,
        updated_at = now()
      where workspace_id = ${owner.workspaceId} and key = 'tags'
    `;
    const restoredTags = await request("tags", "GET");
    const restoredProfile = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const restoredProfileBody = await restoredProfile.json() as {
      readonly person: { readonly tagCount: number };
    };
    assert(
      hiddenTags.status === 200 &&
        (await hiddenTags.json() as { readonly status: string }).status ===
          "hidden" &&
        hiddenProfile.status === 200 &&
        hiddenProfileBody.person.tagCount === 0 &&
        hiddenProfileBody.person.tags.length === 0 &&
        retainedTags[0]?.count === 75 && restoredTags.status === 200 &&
        (await restoredTags.json() as { readonly options: readonly unknown[] })
            .options.length === 75 &&
        restoredProfile.status === 200 &&
        restoredProfileBody.person.tagCount === 75,
      "disabled tags hide every projection while re-enable restores retained links",
    );
    const stale = await request("contact-methods", "PUT", {
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      expectedPersonUpdatedAt: personRevision,
      id: contact.record.id,
      isPrimary: true,
      labelIds: [labelId],
      typeId,
      value: "changed@example.test",
    });
    assert(stale.status === 409, "stale fact version is rejected");
    const disabledType = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isPrimary: false,
      labelIds: [],
      typeId: inactiveTypeId,
      value: "private",
    });
    const foreignTag = await request("tags", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
      id: personId,
      tagIds: [foreignTagId],
    });
    const foreignOrganization = await request("work", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isCurrent: false,
      organizationId: foreignOrganizationId,
      title: "Private analyst",
    });
    assert(
      disabledType.status === 400 && foreignTag.status === 409 &&
        foreignOrganization.status === 400,
      "disabled and cross-workspace vocabulary or organization links persist nothing",
    );
    const selfIntroducer = await request("first-meeting", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: factRevisions.get("first-meeting")!,
      id: personId,
      introducedByPersonId: personId,
    });
    const foreignIntroducer = await request("first-meeting", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: factRevisions.get("first-meeting")!,
      id: personId,
      introducedByPersonId: foreignPersonId,
    });
    const invalidRange = await request("work", "PUT", {
      endOn: "2025-12-31",
      expectedPersonUpdatedAt: personRevision,
      isCurrent: false,
      startOn: "2026-01-01",
      title: "Analyst",
    });
    const rangeProblem = await invalidRange.json() as {
      readonly errors?: Readonly<Record<string, string>>;
    };
    assert(
      selfIntroducer.status === 400 && foreignIntroducer.status === 400 &&
        invalidRange.status === 400 && rangeProblem.errors?.endOn,
      "self/foreign introducers and reversed work dates fail safely",
    );
    const tagAgain = await request("tags", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
      id: personId,
      tagIds: [tagId],
    });
    const tagRevision = (await tagAgain.json() as {
      readonly personUpdatedAt: string;
    }).personUpdatedAt;
    const staleFood = await request("food-preferences", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
      foodPreferences: "Stale",
      id: personId,
    });
    const foodAgain = await request("food-preferences", "PUT", {
      expectedPersonUpdatedAt: tagRevision,
      expectedUpdatedAt: tagRevision,
      foodPreferences: "Tea",
      id: personId,
    });
    const foodRevision = (await foodAgain.json() as {
      readonly personUpdatedAt: string;
    }).personUpdatedAt;
    const lifecycle = (
      action: "archive" | "restore",
      expectedUpdatedAt: string,
    ) =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}/${action}`,
        {
          body: JSON.stringify({ expectedUpdatedAt }),
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
            origin: "http://localhost",
            "X-Workspace-Id": owner.workspaceId,
          },
          method: "POST",
        },
      );
    const archived = await lifecycle("archive", foodRevision);
    const archivedRevision = (await archived.json() as {
      readonly person: { readonly updatedAt: string };
    }).person.updatedAt;
    const restored = await lifecycle("restore", archivedRevision);
    personRevision = (await restored.json() as {
      readonly person: { readonly updatedAt: string };
    }).person.updatedAt;
    assert(
      tagAgain.status === 200 && staleFood.status === 409 &&
        foodAgain.status === 200 && archived.status === 200 &&
        restored.status === 200,
      "tag to food to lifecycle uses one propagated person revision",
    );
    const clearedFood = await profileFacts.delete(
      factActor,
      personId,
      "food-preferences",
      personId,
      personRevision,
      personRevision,
    );
    const replayClear = await request("food-preferences", "DELETE", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
    }, personId);
    const emptyFood = await request("food-preferences", "GET");
    const emptyFoodBody = await emptyFood.json() as {
      readonly records: readonly unknown[];
    };
    assert(
      clearedFood.status === "deleted" && replayClear.status === 409 &&
        emptyFood.status === 200 && emptyFoodBody.records.length === 0,
      "public facade clears food once with audit and no synthetic null record",
    );
    personRevision = clearedFood.status === "deleted"
      ? clearedFood.personUpdatedAt
      : personRevision;
    await sql`
      insert into crm.pets (person_id, name, created_at, updated_at)
      select ${personId}::uuid, 'Bounded pet ' || series,
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second',
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second'
      from generate_series(1, 120) series
    `;
    await sql`
      insert into crm.contact_method_types (
        id, workspace_id, name, is_archived
      )
      select gen_random_uuid(), ${owner.workspaceId}::uuid,
        'Bounded type ' || series, false
      from generate_series(1, 120) series
    `;
    await sql`
      insert into crm.contact_labels (id, workspace_id, label, applies_to)
      select gen_random_uuid(), ${owner.workspaceId}::uuid,
        'Bounded label ' || series, 'any'
      from generate_series(1, 120) series
    `;
    await sql`
      insert into crm.person_contact_methods (
        person_id, type_id, value, is_primary, sort_order, created_at,
        updated_at
      )
      select ${personId}::uuid, method_type.id,
        'bounded-' || series || '@example.test', false, series,
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second',
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second'
      from generate_series(1, 120) series
      join crm.contact_method_types method_type
        on method_type.workspace_id = ${owner.workspaceId}::uuid
        and method_type.name = 'Bounded type ' || series
    `;
    await sql`
      insert into crm.person_contact_method_labels (contact_method_id, label_id)
      select method.id, label.id
      from crm.person_contact_methods method
      join crm.contact_labels label
        on label.workspace_id = ${owner.workspaceId}::uuid
        and label.label = 'Bounded label ' ||
          substring(method.value from 'bounded-([0-9]+)@')
      where method.person_id = ${personId}::uuid
        and method.value like 'bounded-%@example.test'
    `;
    await sql`
      insert into crm.pet_categories (id, name, is_common, is_active)
      select gen_random_uuid(),
        ${`Bounded category ${personId} `} || series, false, true
      from generate_series(1, 120) series
    `;
    await sql`
      update crm.pets pet set category_id = category.id
      from crm.pet_categories category
      where pet.person_id = ${personId}::uuid
        and pet.name like 'Bounded pet %'
        and category.name = ${`Bounded category ${personId} `} ||
          substring(pet.name from 'Bounded pet ([0-9]+)')
    `;
    const replaceCursorId = (cursor: string) => {
      const padded = cursor.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - cursor.length % 4) % 4);
      const decoded = JSON.parse(atob(padded)) as Record<string, unknown>;
      decoded.id = "00000000-0000-4000-8000-000000000999";
      return btoa(JSON.stringify(decoded)).replaceAll("+", "-")
        .replaceAll("/", "_").replaceAll("=", "");
    };
    const petPage = await request("pets", "GET");
    const petPageBody = await petPage.json() as {
      readonly nextCursor?: string;
      readonly records: readonly unknown[];
    };
    const petPages = [petPageBody];
    let petCursor = petPageBody.nextCursor;
    while (petCursor && petPages.length < 10) {
      const page = await request(
        `pets?cursor=${encodeURIComponent(petCursor)}`,
        "GET",
      );
      assert(
        page.status === 200,
        `pet continuation is available: ${page.status}`,
      );
      const pageBody = await page.json() as typeof petPageBody;
      petPages.push(pageBody);
      petCursor = pageBody.nextCursor;
    }
    assert(
      petPage.status === 200 && petPageBody.records.length === 50 &&
        petPages.length === 3 &&
        petPages.every((page) => page.records.length <= 50) &&
        petPages.flatMap((page) => page.records).length === 121 && !petCursor,
      `fact rows are bounded across every continuation: ${
        JSON.stringify(petPages.map((page) => page.records.length))
      }`,
    );
    const forgedFactPage = await request(
      `pets?cursor=${
        encodeURIComponent(replaceCursorId(petPageBody.nextCursor ?? ""))
      }`,
      "GET",
    );
    assert(
      forgedFactPage.status === 409,
      `forged fact anchor is rejected: ${forgedFactPage.status}`,
    );
    const contactFactPage = await request("contact-methods", "GET");
    const contactFactPageBody = await contactFactPage.json() as {
      readonly nextCursor?: string;
      readonly records: readonly {
        readonly id: string;
        readonly referencesResolved?: boolean;
        readonly selectedOptions?: readonly { readonly id: string }[];
        readonly updatedAt: string;
        readonly value: {
          readonly isPrimary: boolean;
          readonly labelIds: readonly string[];
          readonly typeId: string;
          readonly value: string;
        };
      }[];
    };
    const contactFactPages = [contactFactPageBody];
    let contactFactCursor = contactFactPageBody.nextCursor;
    while (contactFactCursor && contactFactPages.length < 10) {
      const page = await request(
        `contact-methods?cursor=${encodeURIComponent(contactFactCursor)}`,
        "GET",
      );
      assert(
        page.status === 200,
        `contact continuation is available: ${page.status}`,
      );
      const pageBody = await page.json() as typeof contactFactPageBody;
      contactFactPages.push(pageBody);
      contactFactCursor = pageBody.nextCursor;
    }
    const allContactRecords = contactFactPages.flatMap((page) => page.records);
    const tailContact = allContactRecords.find((record) =>
      record.value.value === "bounded-120@example.test"
    );
    const archivedContact = allContactRecords.find((record) =>
      record.value.value === "bounded-2@example.test"
    );
    const tailPet = petPages.flatMap((page) => page.records).find((record) =>
      (record as { readonly value?: { readonly name?: string } }).value
        ?.name ===
        "Bounded pet 120"
    ) as {
      readonly id: string;
      readonly referencesResolved?: boolean;
      readonly selectedOptions?: readonly { readonly id: string }[];
      readonly updatedAt: string;
      readonly value: {
        readonly categoryId: string;
        readonly name: string;
      };
    } | undefined;
    assert(
      contactFactPage.status === 200 &&
        contactFactPageBody.records.length === 50 &&
        contactFactPageBody.records.every((record) =>
          record.referencesResolved === true &&
          record.selectedOptions?.length === 2
        ) && contactFactPages.length === 3 && !contactFactCursor &&
        tailContact &&
        tailContact.referencesResolved === true &&
        tailContact.selectedOptions?.length === 2 && tailPet &&
        tailPet.referencesResolved === true &&
        tailPet.selectedOptions?.some((option) =>
          option.id === tailPet.value.categoryId
        ),
      "fact pages hydrate every record's selected labels, types, and categories",
    );
    const optionSearch = `Bounded type`;
    const optionPage = (cursor?: string) =>
      request(
        `contact-methods?includeOptions=true&optionSearch=${
          encodeURIComponent(optionSearch)
        }${cursor ? `&optionCursor=${encodeURIComponent(cursor)}` : ""}`,
        "GET",
      );
    const readOptionBody = (response: Response) =>
      response.json() as Promise<{
        readonly nextOptionsCursor?: string;
        readonly options: readonly {
          readonly id: string;
          readonly name: string;
        }[];
      }>;
    const contactOptionPage = await optionPage();
    const contactOptionBody = await readOptionBody(contactOptionPage);
    const optionCursorVariants = [
      contactOptionBody.nextOptionsCursor ?? "",
      replaceCursorId(contactOptionBody.nextOptionsCursor ?? ""),
      "forged-option-cursor",
    ];
    for (const optionCursor of optionCursorVariants) {
      const missingInclude = await request(
        `contact-methods?optionCursor=${encodeURIComponent(optionCursor)}`,
        "GET",
      );
      assert(
        missingInclude.status === 400,
        `HTTP option continuation requires includeOptions=true: ${missingInclude.status}`,
      );
      const directMissingInclude = await profileFacts.list(
        factActor,
        personId,
        "contact-methods",
        { optionCursor, optionSearch: optionSearch } as never,
      );
      assert(
        directMissingInclude.status === "stale-cursor",
        `public facade rejects option continuation without options mode: ${directMissingInclude.status}`,
      );
    }
    const insertedOptionName = `${
      contactOptionBody.options.at(-1)?.name
    } inserted`;
    await sql`
      insert into crm.contact_method_types (
        workspace_id, name, is_archived
      ) values (${owner.workspaceId}, ${insertedOptionName}, false)
    `;
    const continuationAfterInsert = await optionPage(
      contactOptionBody.nextOptionsCursor,
    );
    const continuationAfterInsertBody = await readOptionBody(
      continuationAfterInsert,
    );
    const afterInsertPage = await optionPage();
    const afterInsertBody = await readOptionBody(afterInsertPage);
    const renameAnchor = afterInsertBody.options.at(-1);
    assert(
      renameAnchor && afterInsertBody.nextOptionsCursor,
      "rename anchor exists",
    );
    await sql`
      update crm.contact_method_types
      set name = 'Bounded type renamed', updated_at = now()
      where workspace_id = ${owner.workspaceId}
        and id = ${renameAnchor.id}::uuid
    `;
    const staleAfterRename = await optionPage(
      afterInsertBody.nextOptionsCursor,
    );
    const afterRenamePage = await optionPage();
    const afterRenameBody = await readOptionBody(afterRenamePage);
    const archiveAnchor = afterRenameBody.options.at(-1);
    assert(
      archiveAnchor && afterRenameBody.nextOptionsCursor,
      "archive anchor exists",
    );
    await sql`
      update crm.contact_method_types
      set is_archived = true, updated_at = now()
      where workspace_id = ${owner.workspaceId}
        and id = ${archiveAnchor.id}::uuid
    `;
    const staleAfterArchive = await optionPage(
      afterRenameBody.nextOptionsCursor,
    );
    await sql`
      update crm.contact_method_types
      set is_archived = true, updated_at = now()
      where workspace_id = ${owner.workspaceId}
        and name = 'Bounded type 2'
    `;
    assert(
      archivedContact !== undefined,
      `archived-reference fixture is present: ${
        JSON.stringify({
          firstPage: contactFactPageBody.records.length,
          pages: contactFactPages.map((page) => page.records.length),
        })
      }`,
    );
    const archivedBefore = await sql<{
      readonly audit_count: number;
      readonly person_revision: string;
      readonly value: string;
    }[]>`
      select method.value,
        to_char(person.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as person_revision,
        (select count(*)::int from crm.audit_events audit
          where audit.person_id = ${personId}
            and audit.action = 'people.person-profile-fact-updated'
            and audit.subject_type = 'person_profile_fact') as audit_count
      from crm.person_contact_methods method
      join crm.people person on person.id = method.person_id
      where method.id = ${archivedContact.id}::uuid
    `;
    const archivedUpdate = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: archivedContact.updatedAt,
      id: archivedContact.id,
      isPrimary: archivedContact.value.isPrimary,
      labelIds: archivedContact.value.labelIds,
      typeId: archivedContact.value.typeId,
      value: "must-not-update-archived-reference@example.test",
    });
    const archivedProblem = await archivedUpdate.clone().json() as {
      readonly code?: string;
    };
    const archivedAfter = await sql<{
      readonly audit_count: number;
      readonly person_revision: string;
      readonly value: string;
    }[]>`
      select method.value,
        to_char(person.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as person_revision,
        (select count(*)::int from crm.audit_events audit
          where audit.person_id = ${personId}
            and audit.action = 'people.person-profile-fact-updated'
            and audit.subject_type = 'person_profile_fact') as audit_count
      from crm.person_contact_methods method
      join crm.people person on person.id = method.person_id
      where method.id = ${archivedContact.id}::uuid
    `;
    assert(
      archivedUpdate.status === 400 &&
        archivedProblem.code === "profile_fact_reference_invalid",
      `archived contact type is rejected: ${
        JSON.stringify({
          code: archivedProblem.code,
          status: archivedUpdate.status,
        })
      }`,
    );
    assert(
      archivedAfter[0]?.value === archivedBefore[0]?.value &&
        archivedAfter[0]?.person_revision ===
          archivedBefore[0]?.person_revision &&
        archivedAfter[0]?.audit_count === archivedBefore[0]?.audit_count,
      `archived contact rejection has no mutation: ${
        JSON.stringify({
          after: archivedAfter[0],
          before: archivedBefore[0],
        })
      }`,
    );
    const stableOptionPage = await optionPage();
    const stableOptionBody = await readOptionBody(stableOptionPage);
    const stableOptionPages = [stableOptionBody];
    let stableOptionCursor = stableOptionBody.nextOptionsCursor;
    while (stableOptionCursor && stableOptionPages.length < 10) {
      const page = await optionPage(stableOptionCursor);
      assert(
        page.status === 200,
        `option continuation is available: ${page.status}`,
      );
      const body = await readOptionBody(page);
      stableOptionPages.push(body);
      stableOptionCursor = body.nextOptionsCursor;
    }
    const contactOptionIds = stableOptionPages.flatMap((page) => page.options)
      .map((option) => option.id);
    const forgedOptionPage = await optionPage(
      replaceCursorId(stableOptionBody.nextOptionsCursor ?? ""),
    );
    const mismatchedSearch = await request(
      `contact-methods?includeOptions=true&optionSearch=other&optionCursor=${
        encodeURIComponent(stableOptionBody.nextOptionsCursor ?? "")
      }`,
      "GET",
    );
    assert(
      contactOptionPage.status === 200 &&
        contactOptionBody.options.length === 50 &&
        contactOptionBody.nextOptionsCursor &&
        continuationAfterInsert.status === 200 &&
        continuationAfterInsertBody.options.some((option) =>
          option.name === insertedOptionName
        ) && staleAfterRename.status === 409 &&
        staleAfterArchive.status === 409 && stableOptionPage.status === 200 &&
        stableOptionBody.options.length === 50 &&
        stableOptionBody.nextOptionsCursor &&
        stableOptionPages.length === 3 &&
        stableOptionPages.every((page) => page.options.length <= 50) &&
        !stableOptionCursor &&
        new Set(contactOptionIds).size === contactOptionIds.length &&
        forgedOptionPage.status === 409 && mismatchedSearch.status === 409,
      `workspace option keysets handle insert/rename/archive and remain bounded: ${
        JSON.stringify({
          forged: forgedOptionPage.status,
          mismatch: mismatchedSearch.status,
          pages: stableOptionPages.map((page) => page.options.length),
        })
      }`,
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${owner.workspaceId}, 'contact-methods', false)
    `;
    const hidden = await request("contact-methods", "GET");
    const [beforeHiddenWrite] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.person_contact_methods
      where person_id = ${personId}
    `;
    const hiddenWrite = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isPrimary: false,
      labelIds: [],
      typeId,
      value: "must-not-save@example.test",
    });
    const retained = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.person_contact_methods
      where person_id = ${personId}
    `;
    assert(
      hidden.status === 200 &&
        (await hidden.json() as { readonly status: string }).status ===
          "hidden" &&
        hiddenWrite.status === 409 && beforeHiddenWrite &&
        retained[0]?.count === beforeHiddenWrite.count,
      "disabled section hides but retains existing rows and rejects new writes",
    );
    const audits = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-profile-fact-updated'
        and subject_type = 'person_profile_fact'
    `;
    assert(
      audits[0]?.count === 10,
      "each successful fact transaction has one exact governance audit",
    );
    await sql`
      update crm.workspace_profile_modules set is_active = true
      where workspace_id = ${owner.workspaceId}::uuid
        and key = 'contact-methods'
    `;
    assert(tailContact && tailPet, "continuation records remain available");
    const updatedTailContact = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: tailContact.updatedAt,
      id: tailContact.id,
      isPrimary: tailContact.value.isPrimary,
      labelIds: tailContact.value.labelIds,
      typeId: tailContact.value.typeId,
      value: "updated-continuation@example.test",
    });
    const updatedTailContactBody = await updatedTailContact.json() as {
      readonly personUpdatedAt?: string;
    };
    personRevision = updatedTailContactBody.personUpdatedAt ?? personRevision;
    const updatedTailPet = await request("pets", "PUT", {
      categoryId: tailPet.value.categoryId,
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: tailPet.updatedAt,
      id: tailPet.id,
      name: "Updated continuation pet",
    });
    const retainedReferences = await sql<{
      readonly contact_labels: number;
      readonly pet_category_id: string | null;
    }[]>`
      select
        (select count(*)::int from crm.person_contact_method_labels
          where contact_method_id = ${tailContact.id}::uuid) as contact_labels,
        (select category_id::text from crm.pets
          where id = ${tailPet.id}::uuid) as pet_category_id
    `;
    const finalAudits = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-profile-fact-updated'
        and subject_type = 'person_profile_fact'
    `;
    assert(
      updatedTailContact.status === 200,
      `unrelated continuation contact edit succeeds: ${
        JSON.stringify({
          body: updatedTailContactBody,
          status: updatedTailContact.status,
        })
      }`,
    );
    assert(
      updatedTailPet.status === 200,
      `unrelated continuation pet edit succeeds: ${
        JSON.stringify({
          body: await updatedTailPet.clone().text(),
          status: updatedTailPet.status,
        })
      }`,
    );
    assert(
      retainedReferences[0]?.contact_labels === 1,
      `continuation contact edit retains its selected label: ${
        JSON.stringify(
          retainedReferences[0],
        )
      }`,
    );
    assert(
      retainedReferences[0]?.pet_category_id === tailPet.value.categoryId,
      `continuation pet edit retains its selected category: ${
        JSON.stringify({
          actual: retainedReferences[0]?.pet_category_id,
          expected: tailPet.value.categoryId,
        })
      }`,
    );
    assert(
      finalAudits[0]?.count === 12,
      `continuation edits add two scoped governance audits: ${
        JSON.stringify({
          actual: finalAudits[0]?.count,
          expected: 12,
        })
      }`,
    );
  },
});

Deno.test({
  name:
    "RELATIONSHIP-001 PostgreSQL lazily backfills versioned default relationship types for existing workspaces",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const empty = await register(
      `relationship-backfill-empty-${crypto.randomUUID()}@example.test`,
      "Existing empty relationship workspace",
    );
    const partial = await register(
      `relationship-backfill-partial-${crypto.randomUUID()}@example.test`,
      "Existing partial relationship workspace",
    );
    const hidden = await register(
      `relationship-backfill-hidden-${crypto.randomUUID()}@example.test`,
      "Existing hidden relationship workspace",
    );
    const failing = await register(
      `relationship-backfill-failing-${crypto.randomUUID()}@example.test`,
      "Existing invalid relationship workspace",
    );
    const history = await register(
      `relationship-backfill-history-${crypto.randomUUID()}@example.test`,
      "Existing relationship history workspace",
    );
    await sql`
      delete from crm.relationship_types
      where workspace_id in (
        ${empty.workspaceId}::uuid, ${partial.workspaceId}::uuid,
        ${hidden.workspaceId}::uuid, ${failing.workspaceId}::uuid
      )
    `;
    const partialDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[7]!;
    const archivedDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[19]!;
    await sql`
      insert into crm.relationship_types (
        workspace_id, forward_label, reverse_label, is_system, can_delete,
        is_archived, sort_order
      ) values
        (${partial.workspaceId}::uuid, 'custom kin', 'custom inverse', false,
          true, false, 900),
        (${partial.workspaceId}::uuid, ${partialDefault.forwardLabel},
          ${partialDefault.reverseLabel}, true, false, false,
          ${partialDefault.sortOrder}),
        (${partial.workspaceId}::uuid, ${archivedDefault.forwardLabel},
          ${archivedDefault.reverseLabel}, true, false, true,
          ${archivedDefault.sortOrder})
    `;
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${hidden.workspaceId}::uuid, 'relationships', false)
    `;
    const duplicate = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[0]!;
    await sql`
      insert into crm.relationship_types (
        workspace_id, forward_label, reverse_label, is_system, can_delete,
        is_archived, sort_order
      ) values
        (${failing.workspaceId}::uuid, ${duplicate.forwardLabel},
          ${duplicate.reverseLabel}, true, false, false, ${duplicate.sortOrder}),
        (${failing.workspaceId}::uuid, ${duplicate.forwardLabel},
          ${duplicate.reverseLabel}, true, false, false, ${duplicate.sortOrder})
    `;
    const typeAccess = (fixture: Fixture) =>
      configured.app.request("http://localhost/api/v1/relationship-types", {
        headers: {
          cookie: fixture.cookie,
          "X-Workspace-Id": fixture.workspaceId,
        },
      });
    const historicalDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[0]!;
    const missingDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[1]!;
    const [historicalType] = await sql<{ readonly id: string }[]>`
      select id::text
      from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${historicalDefault.forwardLabel}
        and reverse_label = ${historicalDefault.reverseLabel}
        and sort_order = ${historicalDefault.sortOrder}
    `;
    assert(historicalType, "provisioned historical default is present");
    const historicalSource = await createPerson(history, {
      givenName: "Historical source",
      isPartial: false,
    });
    const historicalTarget = await createPerson(history, {
      givenName: "Historical target",
      isPartial: false,
    });
    const rejectedTarget = await createPerson(history, {
      givenName: "Rejected target",
      isPartial: false,
    });
    const historicalSourceId = (await historicalSource.json()).person
      .id as string;
    const historicalTargetId = (await historicalTarget.json()).person
      .id as string;
    const rejectedTargetId = (await rejectedTarget.json()).person.id as string;
    assert(
      (await relationshipRequest(history, historicalSourceId, "POST", {
        relationshipTypeId: historicalType.id,
        targetPersonId: historicalTargetId,
      })).status === 201,
      "historical relationship was not created before archiving its type",
    );
    await sql`
      update crm.relationship_types set is_archived = true
      where id = ${historicalType.id}::uuid
    `;
    await sql`
      delete from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${missingDefault.forwardLabel}
        and reverse_label = ${missingDefault.reverseLabel}
        and sort_order = ${missingDefault.sortOrder}
    `;
    const initialized = await Promise.all([
      typeAccess(history),
      typeAccess(history),
      relationshipRequest(history, historicalSourceId, "POST", {
        relationshipTypeId: historicalType.id,
        targetPersonId: rejectedTargetId,
      }),
    ]);
    assert(
      initialized[0].status === 200 && initialized[1].status === 200 &&
        initialized[2].status === 404 &&
        (await typeAccess(history)).status === 200,
      "concurrent list/mutation initialization did not preserve archived type semantics",
    );
    const archivedIdentity = await sql<{
      readonly id: string;
      readonly is_archived: boolean;
    }[]>`
      select id::text, is_archived
      from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${historicalDefault.forwardLabel}
        and reverse_label = ${historicalDefault.reverseLabel}
    `;
    const backfilledIdentity = await sql<{
      readonly id: string;
      readonly is_archived: boolean;
    }[]>`
      select id::text, is_archived
      from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${missingDefault.forwardLabel}
        and reverse_label = ${missingDefault.reverseLabel}
    `;
    const historicalList = await relationshipRequest(
      history,
      historicalSourceId,
      "GET",
    );
    const historicalListBody = await historicalList.json() as {
      readonly relationships: readonly {
        readonly forwardLabel: string;
        readonly relationshipTypeArchived: boolean;
        readonly relationshipTypeId: string;
        readonly reverseLabel: string;
      }[];
    };
    const historicalRow = historicalListBody.relationships.find((row) =>
      row.relationshipTypeId === historicalType.id
    );
    const optionBody = await initialized[0].json() as {
      readonly options: readonly { readonly id: string }[];
    };
    assert(
      archivedIdentity.length === 1 &&
        archivedIdentity[0]?.id === historicalType.id &&
        archivedIdentity[0].is_archived === true &&
        backfilledIdentity.length === 1 &&
        backfilledIdentity[0]?.is_archived === false &&
        historicalList.status === 200 &&
        historicalRow?.relationshipTypeArchived === true &&
        historicalRow.forwardLabel === historicalDefault.forwardLabel &&
        historicalRow.reverseLabel === historicalDefault.reverseLabel &&
        !optionBody.options.some((type) => type.id === historicalType.id),
      "archived seeded identity was recreated/reactivated or lost historical display",
    );
    const concurrent = await Promise.all([
      typeAccess(empty),
      typeAccess(empty),
    ]);
    assert(
      concurrent.every((response) => response.status === 200),
      "concurrent first access did not make defaults available",
    );
    assert(
      (await typeAccess(empty)).status === 200 &&
        (await typeAccess(partial)).status === 200,
      "default relationship vocabulary replay or partial backfill failed",
    );
    const readyCounts = await sql<{
      readonly active_system: number;
      readonly archived_system: number;
      readonly custom_count: number;
      readonly workspace_id: string;
    }[]>`
      select workspace_id::text,
        count(*) filter (where is_system and not is_archived)::int active_system,
        count(*) filter (where is_system and is_archived)::int archived_system,
        count(*) filter (where not is_system)::int custom_count
      from crm.relationship_types
      where workspace_id in (${empty.workspaceId}::uuid, ${partial.workspaceId}::uuid)
      group by workspace_id order by workspace_id
    `;
    const byWorkspace = new Map(
      readyCounts.map((row) => [row.workspace_id, row]),
    );
    const emptyCounts = byWorkspace.get(empty.workspaceId);
    const partialCounts = byWorkspace.get(partial.workspaceId);
    assert(
      emptyCounts?.active_system ===
          DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length &&
        emptyCounts.archived_system === 0 && emptyCounts.custom_count === 0,
      "empty existing workspace did not receive exactly one active default vocabulary",
    );
    assert(
      partialCounts?.active_system ===
          DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length - 1 &&
        partialCounts.archived_system === 1 && partialCounts.custom_count === 1,
      "partial backfill changed custom/archive history or duplicated defaults",
    );
    const hiddenResponse = await typeAccess(hidden);
    const hiddenCount = await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.relationship_types
      where workspace_id = ${hidden.workspaceId}::uuid
    `;
    assert(
      hiddenResponse.status === 200 &&
        (await hiddenResponse.json() as { readonly status: string }).status ===
          "hidden" &&
        hiddenCount[0]?.count === 0,
      "hidden relationships module backfilled or disclosed defaults",
    );
    const failingResponse = await typeAccess(failing);
    const failureCounts = await sql<{
      readonly count: number;
      readonly distinct_labels: number;
    }[]>`
      select count(*)::int count,
        count(distinct (forward_label, reverse_label))::int distinct_labels
      from crm.relationship_types
      where workspace_id = ${failing.workspaceId}::uuid
    `;
    assert(
      failingResponse.status === 503 && failureCounts[0]?.count === 2 &&
        failureCounts[0]?.distinct_labels === 1,
      "failed default postcondition left partial backfill rows",
    );
  },
});

Deno.test({
  name:
    "RELATIONSHIP-001 PostgreSQL keeps atomic related-person and ordinary relationship mutations in one lock order",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = await register(
      `relationship-lock-order-${crypto.randomUUID()}@example.test`,
      "Relationship lock-order workspace",
    );
    const [identity] = await sql<{
      readonly role: PeopleActor["role"];
      readonly user_id: string;
    }[]>`
      select user_id::text, role
      from crm.workspace_members
      where id = ${fixture.memberId}::uuid
    `;
    assert(identity, "lock-order actor is available");
    const actor: PeopleActor = {
      memberId: fixture.memberId,
      role: identity.role,
      userId: identity.user_id,
      workspaceId: fixture.workspaceId,
    };
    const sourceResponse = await createPerson(fixture, {
      givenName: "Lock source",
      isPartial: false,
    });
    const targetResponse = await createPerson(fixture, {
      givenName: "Ordinary target",
      isPartial: false,
    });
    const sourceId = (await sourceResponse.json()).person.id as string;
    const ordinaryTargetId = (await targetResponse.json()).person.id as string;
    const [type] = await sql<{ readonly id: string }[]>`
      select id::text
      from crm.relationship_types
      where workspace_id = ${fixture.workspaceId}::uuid
        and is_system = true and is_archived = false
      order by sort_order, id
      limit 1
    `;
    assert(type, "lock-order relationship type is available");

    let releaseRowsLocked!: () => void;
    const rowsLocked = new Promise<void>((resolve) => {
      releaseRowsLocked = resolve;
    });
    let releaseOrdinaryInitialized!: () => void;
    const ordinaryInitialized = new Promise<void>((resolve) => {
      releaseOrdinaryInitialized = resolve;
    });
    let atomicInitialized = false;
    const dependencies = (
      operation: "atomic" | "ordinary",
    ): RelationshipDependencies => {
      const transaction = new PostgresPeopleTransaction(peopleConnection.db);
      const peopleManagement = createPeopleManagement({
        audit: new PostgresPersonCreatedAudit(),
        clock: { now: () => new Date() },
        ids: { create: () => crypto.randomUUID() },
        repository: new PostgresPeopleRepository(),
        transaction,
      });
      const workspace = new PostgresRelationshipWorkspaceBoundary();
      return {
        audit: new PostgresRelationshipAudit(),
        clock: { now: () => new Date() },
        ids: { create: () => crypto.randomUUID() },
        people: new PostgresRelationshipPersonBoundary(),
        peopleCreation: {
          async createInTransaction(commandActor, input, session) {
            const result = await peopleManagement.createInTransaction(
              commandActor,
              input,
              session,
            );
            releaseRowsLocked();
            if (!atomicInitialized) await ordinaryInitialized;
            return result;
          },
        },
        repository: new PostgresRelationshipRepository(),
        transaction,
        workspace: {
          async ensureDefaultRelationshipTypes(command) {
            const result = await workspace.ensureDefaultRelationshipTypes(
              command,
            );
            if (operation === "atomic") atomicInitialized = true;
            else releaseOrdinaryInitialized();
            return result;
          },
          hydrateTypes: (command) => workspace.hydrateTypes(command),
          inspect: (command) => workspace.inspect(command),
          listTypes: (command) => workspace.listTypes(command),
        },
      };
    };
    const atomic = createRelationshipManagement(
      dependencies("atomic"),
    );
    const ordinary = createRelationshipManagement(
      dependencies("ordinary"),
    );
    const atomicOperation = atomic.createRelatedPerson(actor, sourceId, {
      person: {
        givenName: `Atomic ${crypto.randomUUID()}`,
        isPartial: false,
      },
      relationshipTypeId: type.id,
    });
    await Promise.race([
      rowsLocked,
      atomicOperation.then((result) => {
        throw new Error(
          `atomic operation completed before taking people locks: ${result.status}`,
        );
      }),
    ]);
    const ordinaryOperation = ordinary.create(actor, sourceId, {
      relationshipTypeId: type.id,
      targetPersonId: ordinaryTargetId,
    });
    const [atomicOutcome, ordinaryOutcome] = await Promise.race([
      Promise.allSettled([atomicOperation, ordinaryOperation]),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("relationship lock-order test timed out")),
          5_000,
        )
      ),
    ]);
    if (
      atomicOutcome.status === "rejected" ||
      ordinaryOutcome.status === "rejected"
    ) {
      const code = (
        outcome: PromiseRejectedResult | PromiseFulfilledResult<unknown>,
      ) =>
        outcome.status === "rejected" &&
          typeof outcome.reason === "object" && outcome.reason !== null &&
          "code" in outcome.reason
          ? String(outcome.reason.code)
          : outcome.status;
      throw new Error(
        `overlapping relationship mutations failed: atomic=${
          code(atomicOutcome)
        }, ordinary=${code(ordinaryOutcome)}`,
      );
    }
    const atomicResult = atomicOutcome.value;
    const ordinaryResult = ordinaryOutcome.value;
    assert(
      atomicResult.status === "created" &&
        ordinaryResult.status === "created",
      "overlapping relationship mutations did not both complete",
    );
    const proof = await sql<{
      readonly audits: number;
      readonly defaults: number;
      readonly edges: number;
      readonly people: number;
    }[]>`
        select
          (select count(*)::int from crm.people
            where id = ${atomicResult.person.id}::uuid) people,
          (select count(*)::int from crm.relationships
            where id in (${atomicResult.relationship.id}::uuid,
              ${ordinaryResult.relationship.id}::uuid)) edges,
          (select count(*)::int from crm.audit_events
            where subject_id in (${atomicResult.person.id}::uuid,
              ${atomicResult.relationship.id}::uuid,
              ${ordinaryResult.relationship.id}::uuid)
              and action in ('people.person-created',
                'relationships.relationship-changed')) audits,
          (select count(*)::int from crm.relationship_types
            where workspace_id = ${fixture.workspaceId}::uuid
              and is_system = true) defaults
      `;
    assert(
      proof[0]?.people === 1 && proof[0].edges === 2 &&
        proof[0].audits === 3 && proof[0].defaults ===
          DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length,
      `lock-order completion lost atomic effects: ${JSON.stringify(proof[0])}`,
    );
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
