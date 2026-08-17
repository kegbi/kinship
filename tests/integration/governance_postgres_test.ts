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
  readonly memberId: string;
  readonly workspaceId: string;
}

function forgeCursorAnchor(
  cursor: string,
  id: string,
  timestamp: string,
): string {
  const parts = cursor.split(".");
  assert(parts.length === 4, "audit cursor is not authenticated");
  const encoded = parts[2]!;
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - encoded.length % 4) % 4);
  const body = JSON.parse(atob(padded)) as Record<string, unknown>;
  body.id = id;
  body.timestamp = timestamp;
  parts[2] = btoa(JSON.stringify(body)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
  return parts.join(".");
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
        firstName: "Audit",
        lastName: "Owner",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registration.status === 202, "audit fixture registers");
  const token = mail.latestToken(email);
  assert(token, "audit fixture captures verification");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )).status === 200,
    "audit fixture verifies",
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
  assert(signed.status === 200 && cookie, "audit fixture signs in");
  return {
    cookie,
    memberId: body.member.id,
    workspaceId: body.workspace.id,
  };
}

async function createPerson(fixture: Fixture): Promise<string> {
  const response = await configured.app.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers: {
        "content-type": "application/json",
        cookie: fixture.cookie,
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  const body = await response.json() as {
    readonly person: { readonly id: string };
  };
  assert(response.status === 201, "audit fixture creates person");
  return body.person.id;
}

Deno.test("GOVERNANCE-002 PostgreSQL keeps authorized audit tenant-safe, redacted, and read-only", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(
    `audit-owner-${suffix}@example.test`,
    "Audit workspace",
  );
  const outsider = await register(
    `audit-outsider-${suffix}@example.test`,
    "Other audit workspace",
  );
  const personId = await createPerson(owner);
  const createdResponse = await configured.app.request(
    `http://localhost/api/v1/people/${personId}/audit?action=people.person-created`,
    { headers: { cookie: owner.cookie } },
  );
  const createdBody = await createdResponse.json() as {
    readonly items: readonly {
      readonly actor: { readonly id?: string; readonly name: string };
    }[];
  };
  assert(
    createdResponse.status === 200 &&
      createdBody.items[0]?.actor.id === owner.memberId &&
      createdBody.items[0]?.actor.name ===
        `Workspace member ${owner.memberId}`,
    `existing writer actor fallback was misleading: ${
      JSON.stringify(createdBody)
    }`,
  );
  const personalization = await configured.app.request(
    "http://localhost/api/v1/settings/personalization/tags",
    {
      body: JSON.stringify({ name: `Audit tag ${suffix}` }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  assert(personalization.status === 200, "actual personalization writer runs");
  const personalizationAudit = await configured.app.request(
    "http://localhost/api/v1/audit-events?action=workspace-personalization-updated",
    { headers: { cookie: owner.cookie } },
  );
  const personalizationBody = await personalizationAudit.json() as {
    readonly items: readonly {
      readonly details: Readonly<Record<string, unknown>>;
      readonly redacted: boolean;
    }[];
  };
  assert(
    personalizationAudit.status === 200 &&
      personalizationBody.items[0]?.details.action === "create" &&
      personalizationBody.items[0]?.details.section === "tags" &&
      personalizationBody.items[0]?.redacted === false,
    `actual personalization audit payload was lost: ${
      JSON.stringify(personalizationBody)
    }`,
  );
  const eventId = "00000000-0000-4000-8000-000000000901";
  const olderEventId = "00000000-0000-4000-8000-000000000902";
  await sql`
    insert into crm.audit_events (
      id, workspace_id, actor_member_id, person_id, subject_type, subject_id,
      action, payload, actor_name_snapshot, occurred_at, created_at
    ) values (
      ${eventId}::uuid, ${owner.workspaceId}::uuid, ${owner.memberId}::uuid,
      ${personId}::uuid, 'person_date', ${personId}::uuid,
      'people.person-date-updated',
      ${
    JSON.stringify({
      from: {
        isYearApproximate: false,
        password: "nested-password",
        precision: "full",
        status: "Bearer nested-secret-token",
      },
      password: "must-never-leak",
      action: "update",
    })
  }::jsonb,
      'Recorded operator',
      '2026-08-17T12:30:00.000Z'::timestamptz,
      '2026-08-17T12:30:00.000Z'::timestamptz
    ), (
      ${olderEventId}::uuid, ${owner.workspaceId}::uuid,
      ${owner.memberId}::uuid, ${personId}::uuid, 'person_date',
      ${personId}::uuid, 'people.person-date-updated',
      '{"action":"update","from":null,"to":{"isYearApproximate":false,"precision":"year"}}'::jsonb, null,
      '2026-08-17T11:30:00.000Z'::timestamptz,
      '2026-08-17T11:30:00.000Z'::timestamptz
    )
  `;
  await sql`update crm.people set archived_at = now()
    where id = ${personId}::uuid and workspace_id = ${owner.workspaceId}::uuid`;
  const before = await sql<
    [{ readonly events: number }]
  >`select count(*)::int events from crm.audit_events
      where workspace_id = ${owner.workspaceId}::uuid`;
  const response = await configured.app.request(
    `http://localhost/api/v1/people/${personId}/audit?limit=1&action=people.person-date-updated`,
    { headers: { cookie: owner.cookie } },
  );
  const body = await response.json() as {
    readonly items: readonly {
      readonly actor: { readonly name: string };
      readonly details: Readonly<Record<string, unknown>>;
      readonly id: string;
      readonly redacted: boolean;
    }[];
    readonly nextCursor?: string;
    readonly status: string;
  };
  const after = await sql<
    [{ readonly events: number }]
  >`select count(*)::int events from crm.audit_events
      where workspace_id = ${owner.workspaceId}::uuid`;
  assert(
    response.status === 200 && body.status === "archived" &&
      body.items[0]?.id === eventId && body.items[0].redacted === true &&
      body.items[0].actor.name === "Recorded operator" &&
      body.items[0].details.action === "update" &&
      JSON.stringify(body.items[0].details.from).includes(
        '"precision":"full"',
      ) &&
      !JSON.stringify(body).includes("must-never-leak") &&
      !JSON.stringify(body).includes("nested-secret-token") &&
      !JSON.stringify(body).includes("nested-password") &&
      before[0]?.events === after[0]?.events,
    `authorized audit projection failed: ${JSON.stringify(body)}`,
  );
  assert(body.nextCursor, "bounded audit page omitted continuation");
  const continued = await configured.app.request(
    `http://localhost/api/v1/people/${personId}/audit?limit=1&action=people.person-date-updated&cursor=${
      encodeURIComponent(body.nextCursor)
    }`,
    { headers: { cookie: owner.cookie } },
  );
  const continuedBody = await continued.json() as {
    readonly items: readonly {
      readonly actor: { readonly name: string };
      readonly id: string;
    }[];
  };
  assert(
    continued.status === 200 && continuedBody.items[0]?.id === olderEventId &&
      continuedBody.items[0].actor.name ===
        `Workspace member ${owner.memberId}`,
    `stable audit continuation failed: ${JSON.stringify(continuedBody)}`,
  );
  const forged = forgeCursorAnchor(
    body.nextCursor,
    olderEventId,
    "2026-08-17T11:30:00.000Z",
  );
  const forgedResponse = await configured.app.request(
    `http://localhost/api/v1/people/${personId}/audit?limit=1&action=people.person-date-updated&cursor=${
      encodeURIComponent(forged)
    }`,
    { headers: { cookie: owner.cookie } },
  );
  assert(
    forgedResponse.status === 409,
    "forged existing audit anchor bypassed cursor authentication",
  );

  const concealed = await configured.app.request(
    `http://localhost/api/v1/people/${personId}/audit`,
    { headers: { cookie: outsider.cookie } },
  );
  assert(concealed.status === 404, "cross-workspace person was not concealed");

  const crossActor = await configured.app.request(
    `http://localhost/api/v1/audit-events?actorMemberId=${outsider.memberId}`,
    { headers: { cookie: owner.cookie } },
  );
  assert(crossActor.status === 404, "cross-workspace actor was not concealed");

  await sql`update crm.workspace_members set role = 'member'
    where id = ${owner.memberId}::uuid`;
  const forbidden = await configured.app.request(
    "http://localhost/api/v1/audit-events",
    { headers: { cookie: owner.cookie } },
  );
  assert(forbidden.status === 403, "ordinary member received audit history");
  await sql`update crm.workspace_members set role = 'owner'
    where id = ${owner.memberId}::uuid`;
});

Deno.test({
  name: "GOVERNANCE-002 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await configured.close();
  },
});
