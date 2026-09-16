import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createLegalAcceptance,
  PostgresLegalAcceptanceRepository,
} from "../../packages/backend/modules/governance/public.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/public.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/public.ts";
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

async function waitForLegalDocumentLock(): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [state] = await sql<[{ readonly waiting: boolean }]>`
      select exists (
        select 1 from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query like '%from crm.legal_documents%for update%'
      ) waiting`;
    if (state?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("acceptance did not reach the legal-document row lock");
}

async function cleanupLegalDocumentFixtures(
  documentIds: readonly string[],
): Promise<void> {
  await sql.begin(async (transaction) => {
    for (const documentId of documentIds) {
      await transaction`delete from crm.legal_acceptances
        where legal_document_id = ${documentId}::uuid`;
      await transaction`delete from crm.audit_events
        where subject_type = 'legal_document'
          and subject_id = ${documentId}::uuid`;
      await transaction`delete from crm.legal_documents
        where id = ${documentId}::uuid`;
    }
  });
}

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

interface LegalDocumentFixtureLifecycle {
  publication?: Promise<unknown>;
  racingAcceptance?: Promise<unknown>;
  releasePublication: () => void;
}

async function runLegalDocumentAcceptanceFixture(
  firstDocumentId: string,
  secondDocumentId: string,
  lifecycle: LegalDocumentFixtureLifecycle,
): Promise<void> {
  const suffix = crypto.randomUUID();
  const owner = await register(
    `legal-owner-${suffix}@example.test`,
    "Legal workspace",
  );
  const outsider = await register(
    `legal-outsider-${suffix}@example.test`,
    "Other legal workspace",
  );
  await sql`insert into crm.legal_documents
    (id, document_type, version, content, published_at, is_active)
    values (${firstDocumentId}::uuid, 'terms', '2026-08',
      'Exact terms version one', now() - interval '1 minute', true)`;

  const publicDocument = await configured.app.request(
    "http://localhost/api/v1/legal-documents/terms",
  );
  const absentPublicDocument = await configured.app.request(
    "http://localhost/api/v1/legal-documents/privacy",
  );
  assert(
    publicDocument.status === 200 && absentPublicDocument.status === 404,
    "active and absent public legal versions were not distinguished",
  );

  const pending = await configured.app.request(
    "http://localhost/api/v1/session",
    {
      headers: {
        cookie: owner.cookie,
        "X-Workspace-Id": owner.workspaceId,
      },
    },
  );
  const pendingBody = await pending.json() as {
    readonly requiredLegalDocuments?: readonly { readonly id: string }[];
  };
  assert(
    pending.status === 200 &&
      pendingBody.requiredLegalDocuments?.[0]?.id === firstDocumentId,
    "active version did not interrupt the selected workspace",
  );
  const interrupted = await configured.app.request(
    "http://localhost/api/v1/people?limit=1",
    { headers: { cookie: owner.cookie } },
  );
  assert(
    interrupted.status === 403,
    "pending legal acceptance did not block a direct protected API call",
  );

  const accept = () =>
    configured.app.request(
      "http://localhost/api/v1/legal-acceptances",
      {
        body: JSON.stringify({ documentId: firstDocumentId }),
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
          origin: "http://localhost",
          "X-Kinship-Client-Address": "2001:db8::42",
          "X-Workspace-Id": owner.workspaceId,
        },
        method: "POST",
      },
    );
  const concurrent = await Promise.all([accept(), accept()]);
  assert(
    concurrent.map((response) => response.status).sort().join(",") ===
      "200,201",
    "concurrent acceptance was not serialized into accepted plus immutable replay",
  );
  const [recorded] = await sql<
    [{
      readonly acceptances: number;
      readonly audits: number;
      readonly ip_address: string;
      readonly user_id: string;
    }]
  >`select count(*)::int acceptances,
      min(acceptance.user_id::text) user_id,
      min(host(acceptance.ip_address)) ip_address,
      (select count(*)::int from crm.audit_events audit
        where audit.workspace_id = ${owner.workspaceId}::uuid
          and audit.actor_member_id = ${owner.memberId}::uuid
          and audit.subject_type = 'legal_document'
          and audit.subject_id = ${firstDocumentId}::uuid
          and audit.action = 'legal-document-accepted') audits
    from crm.legal_acceptances acceptance
    join crm.workspace_members member on member.user_id = acceptance.user_id
      and member.workspace_id = acceptance.workspace_id
    where acceptance.workspace_id = ${owner.workspaceId}::uuid
      and acceptance.legal_document_id = ${firstDocumentId}::uuid`;
  assert(
    recorded?.acceptances === 1 && recorded.user_id &&
      recorded.ip_address === "2001:db8::42" && recorded.audits === 1,
    `acceptance was duplicated or lost identity, client, or audit attribution: ${
      JSON.stringify(recorded)
    }`,
  );

  const satisfied = await configured.app.request(
    "http://localhost/api/v1/legal-requirements",
    {
      headers: {
        cookie: owner.cookie,
        "X-Workspace-Id": owner.workspaceId,
      },
    },
  );
  const satisfiedBody = await satisfied.json() as {
    readonly documents?: readonly unknown[];
  };
  assert(
    satisfied.status === 200 && satisfiedBody.documents?.length === 0,
    "accepted version continued to interrupt access",
  );
  const continuedAccess = await configured.app.request(
    "http://localhost/api/v1/people?limit=1",
    { headers: { cookie: owner.cookie } },
  );
  assert(
    continuedAccess.status === 200,
    "accepted version did not restore direct protected API access",
  );

  let publicationLocked: () => void = () => {};
  const release = new Promise<void>((resolve) => {
    lifecycle.releasePublication = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    publicationLocked = resolve;
  });
  const startedPublication = sql.begin(async (transaction) => {
    await transaction`update crm.legal_documents set is_active = false
      where id = ${firstDocumentId}::uuid`;
    publicationLocked();
    await Promise.race([
      release,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("publication coordination timed out")),
          3_000,
        )
      ),
    ]);
    await transaction`insert into crm.legal_documents
      (id, document_type, version, content, published_at, is_active)
      values (${secondDocumentId}::uuid, 'terms', '2026-09',
        'Exact terms version two', now() - interval '1 minute', true)`;
  });
  lifecycle.publication = Promise.resolve(startedPublication);
  await locked;
  const startedRacingAcceptance = Promise.resolve(accept());
  lifecycle.racingAcceptance = startedRacingAcceptance;
  try {
    await waitForLegalDocumentLock();
  } finally {
    lifecycle.releasePublication();
  }
  await startedPublication;
  const stale = await Promise.race([
    startedRacingAcceptance,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("racing acceptance timed out")),
        3_000,
      )
    ),
  ]);
  assert(
    stale.status === 409,
    "acceptance did not serialize with active-version publication",
  );
  const [afterRace] = await sql<
    [{ readonly acceptances: number; readonly audits: number }]
  >`select
      (select count(*)::int from crm.legal_acceptances
        where legal_document_id = ${firstDocumentId}::uuid) acceptances,
      (select count(*)::int from crm.audit_events
        where subject_id = ${firstDocumentId}::uuid
          and action = 'legal-document-accepted') audits`;
  assert(
    afterRace?.acceptances === 1 && afterRace.audits === 1,
    "supersede race duplicated acceptance or audit effect",
  );

  const forgedWorkspace = await configured.app.request(
    "http://localhost/api/v1/legal-acceptances",
    {
      body: JSON.stringify({ documentId: secondDocumentId }),
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
        origin: "http://localhost",
        "X-Workspace-Id": outsider.workspaceId,
      },
      method: "POST",
    },
  );
  assert(
    forgedWorkspace.status === 401,
    "foreign workspace context was accepted for the authenticated identity",
  );
}

Deno.test("GOVERNANCE-001 PostgreSQL serializes immutable acceptance and isolates workspace context", async () => {
  const firstDocumentId = crypto.randomUUID();
  const secondDocumentId = crypto.randomUUID();
  const lifecycle: LegalDocumentFixtureLifecycle = {
    releasePublication: () => {},
  };
  try {
    await runLegalDocumentAcceptanceFixture(
      firstDocumentId,
      secondDocumentId,
      lifecycle,
    );
  } finally {
    lifecycle.releasePublication();
    const inFlight = [lifecycle.publication, lifecycle.racingAcceptance].filter(
      (pending): pending is Promise<unknown> => pending !== undefined,
    );
    await Promise.allSettled(inFlight);
    await cleanupLegalDocumentFixtures([firstDocumentId, secondDocumentId]);
  }
});

Deno.test("GOVERNANCE-001 PostgreSQL cleans an interrupted legal-document fixture", async () => {
  const documentId = crypto.randomUUID();
  let interrupted = false;
  try {
    await sql`insert into crm.legal_documents
      (id, document_type, version, content, published_at, is_active)
      values (${documentId}::uuid, 'terms', ${documentId},
        'Interrupted fixture', now() - interval '1 minute', true)`;
    throw new Error("forced fixture interruption");
  } catch (error) {
    interrupted = error instanceof Error &&
      error.message === "forced fixture interruption";
  } finally {
    await cleanupLegalDocumentFixtures([documentId]);
  }
  const [remaining] = await sql<[{ readonly count: number }]>`
    select count(*)::int count from crm.legal_documents
    where id = ${documentId}::uuid`;
  assert(interrupted && remaining?.count === 0, "interrupted fixture leaked");
});

// --- GAP-009 -------------------------------------------------------------

/**
 * A workspace whose only member can be revoked mid-test. The actor is built
 * directly so the use case is exercised without the session layer refusing
 * first.
 */
async function revocableActor(name: string): Promise<{
  readonly memberId: string;
  readonly personId: string;
  readonly role: "owner";
  readonly userId: string;
  readonly workspaceId: string;
}> {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.users (id, email, first_name, status)
      values (${userId}, ${`${name}@example.test`}, 'Revocable', 'active')
    `;
    await transaction`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values (${workspaceId}, ${name}, 'active', ${userId})
    `;
    await transaction`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now())
    `;
    await transaction`
      insert into crm.people (id, workspace_id, created_by_member_id, given_name)
      values (${personId}, ${workspaceId}, ${memberId}, 'Revocation subject')
    `;
  });
  return { memberId, personId, role: "owner", userId, workspaceId };
}

async function revokeMembership(memberId: string): Promise<void> {
  await sql`
    update crm.workspace_members set status = 'left', left_at = now()
    where id = ${memberId}
  `;
}

Deno.test({
  name:
    "GOVERNANCE-001 GAP-009 a revoked member cannot read or accept legal terms",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        `legal-revocation-${crypto.randomUUID()}`,
      );
      const legal = createLegalAcceptance({
        actors: new PostgresActorRevalidation(),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        repository: new PostgresLegalAcceptanceRepository(connection.db),
        transaction: new PostgresPeopleTransaction(connection.db),
      });

      const allowed = await legal.requirements(actor);
      assert(
        allowed.status === "ready",
        "an active member reads its legal requirements",
      );
      const allowedAccept = await legal.accept(actor, {
        documentId: crypto.randomUUID(),
      });
      assert(
        allowedAccept.status === "superseded-version",
        "an active member reaches the document lookup",
      );

      await revokeMembership(actor.memberId);

      const refusedRequirements = await legal.requirements(actor);
      const refusedAccept = await legal.accept(actor, {
        documentId: crypto.randomUUID(),
      });
      assert(
        refusedRequirements.status === "forbidden" &&
          refusedAccept.status === "forbidden",
        "a revoked member still reached legal acceptance",
      );
    } finally {
      await connection.destroy();
    }
  },
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
