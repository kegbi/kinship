import type postgres from "postgres";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createApiTokenManagement,
} from "../../packages/backend/modules/api-access/public.ts";
import { apiTokenAuditFrom } from "../../packages/backend/modules/api-access/public.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  PostgresApiTokenRepository,
  PostgresApiTokenTransaction,
} from "../../packages/backend/modules/api-access/adapters/postgres/api_token_repository.ts";
import {
  WebCryptoApiTokenSecrets,
} from "../../packages/backend/modules/api-access/adapters/crypto/api_token_secrets.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);
const register = (email: string, workspaceName: string) =>
  api.register(email, workspaceName, { firstName: "API", lastName: "Tester" });

function management(
  fixture: SignedInFixture,
  path = "/api/v1/settings/api-tokens",
  method: "DELETE" | "GET" | "POST" = "GET",
  body?: unknown,
) {
  return api.request(fixture, path, method, body);
}

Deno.test("scoped person tokens preserve projections, parent boundaries, lookups, cursors, and current membership", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(
    `profile-api-${suffix}@example.test`,
    "Profile API",
  );
  const foreign = await register(
    `profile-foreign-${suffix}@example.test`,
    "Foreign API",
  );
  const person = async (fixture: SignedInFixture, givenName: string) => {
    const response = await api.request(fixture, "/api/v1/people", "POST", {
      givenName,
      isPartial: false,
    });
    assert(response.status === 201, "person fixture created");
    return (await response.json()).person.id as string;
  };
  const sourceId = await person(own, "Ada");
  const targetId = await person(own, "Byron");
  const foreignId = await person(foreign, "Foreign secret name");
  const typeId = crypto.randomUUID();
  const foreignTypeId = crypto.randomUUID();
  const relationshipTypeId = crypto.randomUUID();
  const foreignRelationshipTypeId = crypto.randomUUID();
  await sql`insert into crm.contact_method_types (id, workspace_id, name, kind)
    values (${typeId}, ${own.workspaceId}, 'Connector email', 'email'),
      (${foreignTypeId}, ${foreign.workspaceId}, 'Foreign secret type', 'email')`;
  // Stable whole-second revisions match the owning profile-fact paging fixture.
  await sql`insert into crm.person_contact_methods (person_id, type_id, value, updated_at)
    select ${sourceId}::uuid, ${typeId}::uuid, 'contact-' || n || '@example.test',
      '2026-01-01T00:00:00Z'::timestamptz + n * interval '1 second'
    from generate_series(1, 51) n`;
  await sql`insert into crm.person_contact_methods (person_id, type_id, value)
    values (${targetId}, ${typeId}, 'other-parent@example.test'),
      (${foreignId}, ${foreignTypeId}, 'foreign-secret@example.test')`;
  await sql`insert into crm.person_dates (person_id, kind, precision, month, day)
    values (${sourceId}, 'birthday', 'month_day', 12, 10), (${foreignId}, 'birthday', 'month_day', 1, 1)`;
  await sql`insert into crm.relationship_types (id, workspace_id, forward_label, reverse_label)
    values (${relationshipTypeId}, ${own.workspaceId}, 'Connector parent', 'Connector child'),
      (${foreignRelationshipTypeId}, ${foreign.workspaceId}, 'Foreign secret relation', 'Foreign secret inverse')`;
  await sql`insert into crm.relationships (workspace_id, from_person_id, to_person_id, relationship_type_id)
    values (${own.workspaceId}, ${sourceId}, ${targetId}, ${relationshipTypeId})`;
  const mint = async (scopes: readonly string[]) => {
    const response = await management(own, undefined, "POST", {
      name: scopes.join(" + "),
      scopes,
    });
    assert(response.status === 201, `mint ${scopes}: ${response.status}`);
    return await response.json() as {
      secret: string;
      record: { id: string; scopes: string[] };
    };
  };
  const directory = await mint(["people:read"]);
  const profile = await mint(["people:profile:read"]);
  const relationships = await mint(["relationships:read"]);
  const combined = await mint(["people:profile:read", "relationships:read"]);
  assert(combined.record.scopes.length === 2, "both explicit grants persisted");
  assert(
    (await management(own, undefined, "POST", {
      name: "Duplicate",
      scopes: ["people:profile:read", "people:profile:read"],
    })).status === 400,
    "duplicates refused at HTTP boundary",
  );

  const read = (
    path: string,
    secret: string,
    extra: Record<string, string> = {},
  ) =>
    configured.app.request(`http://localhost${path}`, {
      headers: { authorization: `Bearer ${secret}`, ...extra },
    });
  const root = `/api/v1/people/${sourceId}`;
  const profilePaths = [
    `${root}/identity`,
    `${root}/facts/contact-methods?includeOptions=true`,
    `${root}/dates`,
  ];
  const relationshipPaths = [
    `${root}/relationships`,
    `/api/v1/relationship-types?selected=${foreignRelationshipTypeId}`,
  ];
  const paths = [...profilePaths, ...relationshipPaths];
  for (const path of paths) {
    const correct = profilePaths.includes(path) ? profile : relationships;
    const wrong = profilePaths.includes(path) ? relationships : profile;
    const accepted = await read(path, correct.secret);
    assert(accepted.status === 200, `token-only ${path}: ${accepted.status}`);
    const body = await accepted.text();
    assert(
      !body.includes("Foreign secret") && !body.includes("foreign-secret") &&
        !body.includes("other-parent@"),
      "no unrelated tenant or parent data",
    );
    for (const secret of [directory.secret, wrong.secret, "malformed"]) {
      assert(
        (await read(path, secret, { cookie: own.cookie })).status === 401,
        "wrong or invalid bearer never falls back to valid cookie",
      );
    }
    assert(
      (await read(path, combined.secret, {
        "X-Workspace-Id": foreign.workspaceId,
      })).status === 401,
      "foreign requested workspace refused",
    );
  }
  for (
    const suffix of [
      "identity",
      "facts/contact-methods?includeOptions=true",
      "dates",
      "relationships",
    ]
  ) {
    assert(
      (await read(`/api/v1/people/${foreignId}/${suffix}`, combined.secret))
        .status === 404,
      "foreign parent refused even when its child rows exist",
    );
  }
  assert(
    (await read("/api/v1/people", directory.secret)).status === 200,
    "old directory grant preserved",
  );
  assert(
    (await read("/api/v1/people", profile.secret)).status === 401,
    "profile does not imply directory grant",
  );
  for (
    const path of [
      root,
      `${root}?include=summary`,
      `${root}/timeline`,
      `${root}/life-events`,
      "/api/v1/search?q=Ada",
    ]
  ) {
    assert(
      (await read(path, combined.secret)).status === 401,
      "aggregates and unrelated content remain cookie-only",
    );
  }
  const facts = await (await read(profilePaths[1]!, profile.secret)).json();
  assert(
    facts.records.length === 50 && facts.nextCursor &&
      facts.options.some((option: { id: string }) => option.id === typeId),
    "facts and member-readable options remain bounded",
  );
  const cursor = encodeURIComponent(facts.nextCursor);
  const next = await (await read(
    `${root}/facts/contact-methods?cursor=${cursor}`,
    profile.secret,
  )).json();
  assert(
    next.records.length === 1 && !next.nextCursor,
    "fact cursor continues without gaps",
  );
  assert(
    (await read(
      `/api/v1/people/${targetId}/facts/contact-methods?cursor=${cursor}`,
      profile.secret,
    )).status === 409,
    "fact cursor cannot change parent",
  );
  assert(
    (await read(`${root}/relationships?cursor=forged`, relationships.secret))
      .status === 409,
    "relationship cursor semantics preserved",
  );
  assert(
    (await read(
      "/api/v1/relationship-types?cursor=forged",
      relationships.secret,
    )).status === 409,
    "lookup cursor semantics preserved",
  );
  const dates = await (await read(`${root}/dates`, profile.secret)).json();
  assert(
    dates.dates[0]?.precision === "month_day" &&
      !Object.hasOwn(dates.dates[0], "year"),
    "unknown year remains absent",
  );
  const edges =
    await (await read(`${root}/relationships`, relationships.secret)).json();
  assert(
    edges.relationships[0]?.display.personId === targetId &&
      edges.relationships[0]?.display.label === "Connector parent",
    "directional edge is scoped to its parent",
  );

  await sql`update crm.people set archived_at = now() where id = ${sourceId}::uuid`;
  for (const path of profilePaths) {
    const response = await read(path, profile.secret);
    assert(
      response.status === 200 && (await response.json()).status === "archived",
      "archived person remains readable",
    );
  }
  assert(
    (await read(`${root}/relationships`, relationships.secret)).status === 200,
    "archived relationships remain readable",
  );
  await sql`insert into crm.workspace_profile_modules (workspace_id, key, is_active)
    values (${own.workspaceId}, 'contact-methods', false), (${own.workspaceId}, 'relationships', false)`;
  for (const path of [profilePaths[1]!, ...relationshipPaths]) {
    const response = await read(path, combined.secret);
    const body = await response.json();
    assert(
      response.status === 200 && body.status === "hidden" &&
        (body.records ?? body.relationships ?? body.options).length === 0,
      "hidden sections and lookups conceal saved data",
    );
  }
  await sql`update crm.api_tokens set expires_at = now() - interval '1 minute' where id = ${combined.record.id}::uuid`;
  for (const path of paths) {
    assert(
      (await read(path, combined.secret, { cookie: own.cookie })).status ===
        401,
      "expired bearer refused",
    );
  }
  await sql`update crm.api_tokens set expires_at = null where id = ${combined.record.id}::uuid`;
  assert(
    (await management(
      own,
      `/api/v1/settings/api-tokens/${combined.record.id}`,
      "DELETE",
    )).status === 200,
    "token revoked through public use case",
  );
  for (const path of paths) {
    assert(
      (await read(path, combined.secret, { cookie: own.cookie })).status ===
        401,
      "revoked bearer refused",
    );
  }
  await revokeMembership(sql, own.memberId);
  assert(
    (await read(profilePaths[0]!, profile.secret)).status === 401 &&
      (await read(relationshipPaths[0]!, relationships.secret)).status === 401,
    "current membership rechecked for both grants",
  );
});

Deno.test("[API-001] PostgreSQL API tokens are hashed, scoped, tenant-bound, expiring, and revocable", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`api-${suffix}@example.test`, "API primary");
  const foreign = await register(
    `api-foreign-${suffix}@example.test`,
    "API foreign",
  );
  const person = await configured.app.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers: {
        "content-type": "application/json",
        cookie: primary.cookie,
        origin: "http://localhost",
        "X-Workspace-Id": primary.workspaceId,
      },
      method: "POST",
    },
  );
  assert(person.status === 201, "programmatic fixture person created");

  assert(
    (await management(primary, undefined, "POST", {
      expiresAt: "2026-09-24T10:00:00.000Z",
      name: "Invalid",
      scopes: ["people:write"],
    })).status === 400,
    "unknown scope rejected",
  );
  const created = await management(primary, undefined, "POST", {
    expiresAt: "2027-09-24T10:00:00.000Z",
    name: "Desktop read",
    scopes: ["people:read"],
  });
  const createdBody = await created.json() as {
    record: { id: string };
    secret: string;
  };
  assert(
    created.status === 201 &&
      createdBody.secret?.startsWith(`kin_pat_${createdBody.record?.id}.`),
    `secret returned exactly at creation (${created.status}: ${
      JSON.stringify(createdBody)
    })`,
  );
  const stored = await sql<
    { token_hash: string }[]
  >`select token_hash from crm.api_tokens where id = ${createdBody.record.id}::uuid`;
  assert(
    stored[0]?.token_hash &&
      !createdBody.secret.includes(stored[0].token_hash) &&
      stored[0].token_hash !== createdBody.secret,
    "only verifier stored",
  );
  const listed = await management(primary);
  assert(
    listed.status === 200 &&
      !(await listed.text()).includes(createdBody.secret),
    "metadata list does not reveal secret",
  );

  const bearer = (workspaceId?: string) =>
    configured.app.request("http://localhost/api/v1/people", {
      headers: {
        authorization: `Bearer ${createdBody.secret}`,
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      },
    });
  const accepted = await bearer(primary.workspaceId);
  assert(
    accepted.status === 200 && (await accepted.text()).includes("Ada"),
    "scoped bearer reads its people directory",
  );
  assert(
    (await bearer(foreign.workspaceId)).status === 401,
    "bearer cannot select another workspace",
  );
  assert(
    (await configured.app.request("http://localhost/api/v1/people", {
      headers: { authorization: "Bearer malformed" },
    })).status === 401,
    "invalid bearer rejected",
  );

  await sql`update crm.api_tokens set expires_at = now() - interval '1 minute' where id = ${createdBody.record.id}::uuid`;
  assert(
    (await bearer(primary.workspaceId)).status === 401,
    "expired bearer rejected",
  );
  await sql`update crm.api_tokens set expires_at = now() + interval '1 day' where id = ${createdBody.record.id}::uuid`;
  assert(
    (await management(
      foreign,
      `/api/v1/settings/api-tokens/${createdBody.record.id}`,
      "DELETE",
    )).status === 404,
    "foreign workspace cannot revoke token",
  );
  assert(
    (await management(
      primary,
      `/api/v1/settings/api-tokens/${createdBody.record.id}`,
      "DELETE",
    )).status === 200,
    "owner revokes token",
  );
  assert(
    (await bearer(primary.workspaceId)).status === 401,
    "revoked bearer rejected",
  );

  const audit = await sql<
    { action: string }[]
  >`select action from crm.audit_events where subject_id = ${createdBody.record.id}::uuid order by occurred_at`;
  assert(
    audit.map((row) => row.action).join(",") ===
      "api-token-created,api-token-revoked",
    "create and revoke audited",
  );
});

// --- GAP-009 -------------------------------------------------------------

Deno.test({
  name: "[API-001] GAP-009 a revoked member cannot mint or list API tokens",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-revocation-${crypto.randomUUID()}`,
      );
      const actors = new PostgresActorRevalidation();
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        repository: new PostgresApiTokenRepository(),
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: new PostgresApiTokenTransaction(connection.db),
      });

      const allowed = await tokens.create(actor, {
        name: "Allowed token",
        scopes: ["people:read"],
      });
      assert(allowed.status === "created", "an active member mints a token");

      await revokeMembership(sql, actor.memberId);

      const refusedCreate = await tokens.create(actor, {
        name: "Refused token",
        scopes: ["people:read"],
      });
      const refusedList = await tokens.list(actor);
      const refusedRevoke = await tokens.revoke(
        actor,
        allowed.status === "created" ? allowed.record.id : crypto.randomUUID(),
      );
      const authenticated = await tokens.authenticate(
        allowed.status === "created" ? allowed.secret : "kin_pat_invalid",
        "people:read",
      );
      assert(
        refusedCreate.status === "forbidden" &&
          refusedList.status === "forbidden" &&
          refusedRevoke.status === "forbidden" &&
          authenticated.status === "invalid",
        "a revoked member still reached API tokens",
      );
    } finally {
      await connection.destroy();
    }
  },
});
// --- REL-067 -------------------------------------------------------------

Deno.test({
  name:
    "[API-001] REL-067 a token's use is written at most once per 15 minutes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-use-${crypto.randomUUID()}`,
      );
      const start = new Date(Math.floor(Date.now() / 1_000) * 1_000);
      let now = start;
      const actors = new PostgresActorRevalidation();
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => now },
        ids: { next: () => crypto.randomUUID() },
        repository: new PostgresApiTokenRepository(),
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: new PostgresApiTokenTransaction(connection.db),
      });
      const created = await tokens.create(actor, {
        name: "Polling token",
        scopes: ["people:read"],
      });
      assert(created.status === "created", "token minted");
      const use = async (minutes: number) => {
        now = new Date(start.getTime() + minutes * 60_000);
        const accepted = await tokens.authenticate(
          created.secret,
          "people:read",
        );
        const [row] = await sql<
          { last_used_at: Date | null; updated_at: Date }[]
        >`select last_used_at, updated_at from crm.api_tokens where id = ${created.record.id}::uuid`;
        return {
          lastUsedAt: row?.last_used_at?.getTime(),
          status: accepted.status,
          updatedAt: row?.updated_at.getTime(),
        };
      };
      const minute = (value: number) => start.getTime() + value * 60_000;

      const first = await use(0);
      assert(
        first.status === "authenticated" && first.lastUsedAt === minute(0) &&
          first.updatedAt === minute(0),
        `first use is recorded: ${JSON.stringify(first)}`,
      );
      const soon = await use(14);
      assert(
        soon.status === "authenticated" && soon.lastUsedAt === minute(0) &&
          soon.updatedAt === minute(0),
        `a use within 15 minutes is accepted but not written: ${
          JSON.stringify(soon)
        }`,
      );
      const later = await use(16);
      assert(
        later.status === "authenticated" && later.lastUsedAt === minute(16) &&
          later.updatedAt === minute(16),
        `a use after 15 minutes is recorded: ${JSON.stringify(later)}`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

// --- REL-073 -------------------------------------------------------------

/** Whether `statement`, run on another connection, waits on a row lock. */
function blockedBy(
  statement: (transaction: postgres.TransactionSql) => Promise<unknown>,
) {
  return sql.begin(async (transaction) => {
    await transaction`set local lock_timeout = '250ms'`;
    try {
      await transaction.savepoint(statement);
      return false;
    } catch (error) {
      if (error instanceof sql.PostgresError && error.code === "55P03") {
        return true;
      }
      throw error;
    }
  });
}

Deno.test({
  name:
    "[API-001] REL-073 authentication locks the token against writers but not key-share readers",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-lock-${crypto.randomUUID()}`,
      );
      const actors = new PostgresActorRevalidation();
      const repository = new PostgresApiTokenRepository();
      const transactions = new PostgresApiTokenTransaction(connection.db);
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        repository,
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: transactions,
      });
      const created = await tokens.create(actor, {
        name: "Locked token",
        scopes: ["people:read"],
      });
      assert(created.status === "created", "token minted");
      const id = created.record.id;
      const probes = await transactions.run(async (transaction) => {
        const found = await repository.findForAuthentication({
          id,
          transaction,
        });
        assert(found.status === "found", "token found");
        return {
          // A foreign key check takes this lock; FOR UPDATE would block it.
          keyShare: await blockedBy((t) =>
            t`select 1 from crm.api_tokens where id = ${id}::uuid for key share`
          ),
          revocation: await blockedBy((t) =>
            t`update crm.api_tokens set revoked_at = now() where id = ${id}::uuid`
          ),
        };
      });
      assert(
        !probes.keyShare && probes.revocation,
        `only the revocation waits on the authentication: ${
          JSON.stringify(probes)
        }`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[API-001] REL-073 a last use recorded in the future does not pause the record",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `api-token-skew-${crypto.randomUUID()}`,
      );
      const start = new Date(Math.floor(Date.now() / 1_000) * 1_000);
      let now = start;
      const actors = new PostgresActorRevalidation();
      const tokens = createApiTokenManagement({
        actorContext: actors,
        actors,
        audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => now },
        ids: { next: () => crypto.randomUUID() },
        repository: new PostgresApiTokenRepository(),
        secrets: new WebCryptoApiTokenSecrets(),
        transaction: new PostgresApiTokenTransaction(connection.db),
      });
      const created = await tokens.create(actor, {
        name: "Skewed token",
        scopes: ["people:read"],
      });
      assert(created.status === "created", "token minted");
      // A host whose clock runs an hour ahead records a use first.
      now = new Date(start.getTime() + 60 * 60_000);
      await tokens.authenticate(created.secret, "people:read");
      now = start;
      const accepted = await tokens.authenticate(
        created.secret,
        "people:read",
      );
      const [row] = await sql<
        { last_used_at: Date | null }[]
      >`select last_used_at from crm.api_tokens where id = ${created.record.id}::uuid`;
      assert(
        accepted.status === "authenticated" &&
          row?.last_used_at?.getTime() === start.getTime(),
        `a correct clock replaces a future last use: ${
          JSON.stringify({
            lastUsedAt: row?.last_used_at,
            status: accepted.status,
          })
        }`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name: "close API token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await configured.close();
    await sql.end();
  },
});
