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
