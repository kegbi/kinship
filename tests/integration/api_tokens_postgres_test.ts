import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const password = "correct horse battery staple";

interface Fixture {
  readonly cookie: string;
  readonly workspaceId: string;
}

async function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  const registered = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "API",
        lastName: "Tester",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registered.status === 202, "API token fixture registers");
  const token = mail.latestToken(email);
  assert(token, "verification token captured");
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
  const body = await signed.json() as { workspace: { id: string } };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  assert(signed.status === 200 && cookie, "fixture signs in");
  return { cookie, workspaceId: body.workspace.id };
}

function management(
  fixture: Fixture,
  path = "/api/v1/settings/api-tokens",
  method: "DELETE" | "GET" | "POST" = "GET",
  body?: unknown,
) {
  return configured.app.request(`http://localhost${path}`, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      "content-type": "application/json",
      cookie: fixture.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": fixture.workspaceId,
    },
    method,
  });
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

Deno.test({
  name: "close API token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await configured.close();
    await sql.end();
  },
});
