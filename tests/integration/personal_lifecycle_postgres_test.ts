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
const sql = postgres(databaseUrl, {
  max: 4,
  onnotice: () => undefined,
  prepare: false,
});
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const password = "correct horse battery staple";
const originHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
};

interface IdentityFixture {
  readonly cookie: string;
  readonly email: string;
  readonly memberId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

async function register(
  email: string,
  workspaceName: string,
): Promise<IdentityFixture> {
  const registered = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        firstName: "Lifecycle",
        lastName: "Member",
        password,
        workspaceName,
      }),
    },
  );
  assert(registered.status === 202, `${email} registers`);
  const token = mail.latestToken(email);
  assert(token, `${email} verification captured`);
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      },
    )).status === 200,
    `${email} verifies`,
  );
  const signed = await signIn(email);
  const body = await signed.json() as {
    readonly member: { readonly id: string };
    readonly workspace: { readonly id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  const [user] = await sql<{ readonly id: string }[]>`
    select id::text from crm.users where email = ${email}
  `;
  assert(signed.status === 200 && cookie && user, `${email} signs in`);
  return {
    cookie,
    email,
    memberId: body.member.id,
    userId: user.id,
    workspaceId: body.workspace.id,
    workspaceName,
  };
}

async function signIn(email: string, workspaceId?: string): Promise<Response> {
  return await configured.app.request("http://localhost/api/v1/sessions", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({
      email,
      password,
      ...(workspaceId ? { workspaceId } : {}),
    }),
  });
}

async function addMembership(
  identity: IdentityFixture,
  workspaceId: string,
  role: "admin" | "member" | "owner",
  status: "active" | "suspended" = "active",
): Promise<string> {
  const memberId = crypto.randomUUID();
  await sql`
    insert into crm.workspace_members (
      id, workspace_id, user_id, role, status, joined_at, created_at, updated_at
    ) values (
      ${memberId}, ${workspaceId}, ${identity.userId}, ${role}, ${status},
      now(), now(), now()
    )
  `;
  await sql`insert into crm.member_preferences (member_id) values (${memberId})`;
  return memberId;
}

async function lifecycleRequest(
  identity: Pick<IdentityFixture, "cookie" | "workspaceId">,
  path: string,
  options: {
    readonly body?: unknown;
    readonly clientAddress?: string;
    readonly method?: string;
  } = {},
): Promise<Response> {
  return await configured.app.request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...originHeaders,
      cookie: identity.cookie,
      ...(options.clientAddress
        ? { "X-Kinship-Client-Address": options.clientAddress }
        : {}),
      "X-Workspace-Id": identity.workspaceId,
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

Deno.test({
  name:
    "WORKSPACE-002 PostgreSQL reset preserves workspace shell and deletion result survives cascade",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events, crm.legal_documents, crm.workspace_lifecycle_records restart identity cascade`;
    const owner = await register(
      "workspace-danger@example.test",
      "Danger circle",
    );
    const outsider = await register(
      "workspace-danger-outsider@example.test",
      "Other circle",
    );
    const crossWorkspace = await lifecycleRequest(
      { cookie: owner.cookie, workspaceId: outsider.workspaceId },
      "/api/v1/settings/workspace-lifecycle",
    );
    assert(
      crossWorkspace.status === 401,
      `cross-workspace preview returned ${crossWorkspace.status}`,
    );
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await lifecycleRequest(
        outsider,
        "/api/v1/settings/workspace-lifecycle",
        {
          body: {
            confirmation: "DELETE secret-confirmation",
            impactToken: "a".repeat(64),
            password: "wrong-secret-password",
          },
          clientAddress: "203.0.113.82",
          method: "DELETE",
        },
      );
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    const [attemptAudit] = await sql<{
      readonly clean: boolean;
      readonly rateLimited: number;
      readonly rejected: number;
    }[]>`select
      count(*) filter (where outcome='rate-limited')::int as "rateLimited",
      count(*) filter (where outcome='reauthentication-required')::int as rejected,
      bool_and(object_keys='[]'::jsonb and impact_counts='{}'::jsonb
        and row_to_json(workspace_lifecycle_records)::text not like '%wrong-secret-password%'
        and row_to_json(workspace_lifecycle_records)::text not like '%secret-confirmation%') as clean
      from crm.workspace_lifecycle_records
      where workspace_id=${outsider.workspaceId} and action='delete'`;
    assert(
      limited?.headers.get("retry-after") && attemptAudit?.rateLimited === 1 &&
        attemptAudit.rejected > 0 && attemptAudit.clean,
      "workspace deletion guessing was not bounded and redacted",
    );
    const personId = crypto.randomUUID();
    const relatedPersonId = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, created_by_member_id, given_name)
      values (${personId}, ${owner.workspaceId}, ${owner.memberId}, 'Reset me')`;
    await sql`insert into crm.people (id, workspace_id, created_by_member_id, given_name)
      values (${relatedPersonId}, ${owner.workspaceId}, ${owner.memberId}, 'Related')`;
    await sql`insert into crm.files (workspace_id, uploaded_by_member_id, storage_provider, storage_bucket, storage_key, byte_size)
      values (${owner.workspaceId}, ${owner.memberId}, 'memory', 'test', 'objects/reset-me', 1)`;
    const preview = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle",
    );
    const impact = await preview.json() as {
      readonly confirmations: { readonly resetWorkspace: string };
      readonly counts: {
        readonly files: number;
        readonly operations: number;
        readonly people: number;
      };
      readonly impactToken: string;
    };
    assert(
      preview.status === 200 && impact.counts.people === 2 &&
        impact.counts.files === 1 && impact.counts.operations === 0,
      `reset impact is current: ${preview.status} ${JSON.stringify(impact)}`,
    );

    await sql`insert into crm.relationships (
        workspace_id, from_person_id, to_person_id, relationship_type_id
      ) select ${owner.workspaceId}, ${personId}, ${relatedPersonId}, id
        from crm.relationship_types where workspace_id=${owner.workspaceId}
        order by sort_order, id limit 1`;
    const stale = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle/reset",
      {
        method: "POST",
        body: {
          confirmation: impact.confirmations.resetWorkspace,
          impactToken: impact.impactToken,
          password,
        },
      },
    );
    assert(stale.status === 409, "concurrent impact change was not rejected");

    const operationsPreview = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle",
    );
    const operationsImpact = await operationsPreview.json() as typeof impact;
    await sql`insert into crm.statistics_snapshots (workspace_id, scope, counters)
      values (${owner.workspaceId}, 'workspace', '{"people":2}'::jsonb)`;
    const staleOperations = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle/reset",
      {
        method: "POST",
        body: {
          confirmation: operationsImpact.confirmations.resetWorkspace,
          impactToken: operationsImpact.impactToken,
          password,
        },
      },
    );
    assert(
      staleOperations.status === 409,
      "statistics snapshot change was not rejected",
    );

    const currentPreview = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle",
    );
    const currentImpact = await currentPreview.json() as typeof impact;
    await sql`create function crm.reject_workspace_reset() returns trigger
      language plpgsql as $$ begin raise exception 'forced reset failure'; end $$`;
    await sql`create trigger reject_workspace_reset before delete on crm.workspaces
      for each row execute function crm.reject_workspace_reset()`;
    const rejected = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle/reset",
      {
        method: "POST",
        body: {
          confirmation: currentImpact.confirmations.resetWorkspace,
          impactToken: currentImpact.impactToken,
          password,
        },
      },
    );
    await sql`drop trigger reject_workspace_reset on crm.workspaces`;
    await sql`drop function crm.reject_workspace_reset()`;
    const [rolledBack] = await sql<{
      readonly activeSessions: number;
      readonly staleRecords: number;
      readonly successfulRecords: number;
      readonly transactionalFailures: number;
      readonly workspaces: number;
    }[]>`select
      (select count(*)::int from crm.workspaces where id = ${owner.workspaceId}) workspaces,
      (select count(*)::int from crm.workspace_lifecycle_records where workspace_id = ${owner.workspaceId} and outcome='stale-impact') "staleRecords",
      (select count(*)::int from crm.workspace_lifecycle_records where workspace_id = ${owner.workspaceId} and outcome='succeeded') "successfulRecords",
      (select count(*)::int from crm.workspace_lifecycle_records where workspace_id = ${owner.workspaceId} and outcome='transactional-failure') "transactionalFailures",
      (select count(*)::int from crm.user_sessions where user_id = ${owner.userId}
        and revoked_at is null and expires_at > now()) "activeSessions"`;
    assert(
      rejected.status === 503 && rolledBack?.workspaces === 1 &&
        rolledBack.staleRecords === 2 && rolledBack.successfulRecords === 0 &&
        rolledBack.transactionalFailures === 1 &&
        rolledBack.activeSessions > 0,
      `failed reset did not roll back: ${rejected.status} ${
        JSON.stringify(rolledBack)
      }`,
    );

    const retryPreview = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle",
    );
    const retryImpact = await retryPreview.json() as typeof impact;
    const reset = await lifecycleRequest(
      owner,
      "/api/v1/settings/workspace-lifecycle/reset",
      {
        method: "POST",
        body: {
          confirmation: retryImpact.confirmations.resetWorkspace,
          impactToken: retryImpact.impactToken,
          password,
        },
      },
    );
    const resetBody = await reset.clone().json();
    const [resetState] = await sql<{
      readonly audits: number;
      readonly members: number;
      readonly people: number;
      readonly workspaces: number;
    }[]>`select
      (select count(*)::int from crm.workspaces where id = ${owner.workspaceId}) workspaces,
      (select count(*)::int from crm.workspace_members where workspace_id = ${owner.workspaceId}) members,
      (select count(*)::int from crm.people where workspace_id = ${owner.workspaceId}) people,
      (select count(*)::int from crm.audit_events where workspace_id = ${owner.workspaceId} and action = 'workspace.reset') audits`;
    assert(
      reset.status === 200 && resetState?.workspaces === 1 &&
        resetState.members === 1 && resetState.people === 0 &&
        resetState.audits === 1,
      `reset is atomic and preserves workspace configuration shell: ${reset.status} ${
        JSON.stringify(resetBody)
      } ${JSON.stringify(resetState)}`,
    );

    const signedAgain = await signIn(owner.email, owner.workspaceId);
    const cookie = signedAgain.headers.get("set-cookie")?.split(";")[0];
    assert(signedAgain.status === 200 && cookie, "owner signs in after reset");
    const current = { cookie, workspaceId: owner.workspaceId };
    await sql`insert into crm.people (workspace_id, created_by_member_id, given_name)
      values (${owner.workspaceId}, ${owner.memberId}, 'Delete me')`;
    await sql`insert into crm.files (workspace_id, uploaded_by_member_id, storage_provider, storage_bucket, storage_key, byte_size)
      values (${owner.workspaceId}, ${owner.memberId}, 'memory', 'test', 'objects/delete-me', 1)`;
    const deletePreview = await lifecycleRequest(
      current,
      "/api/v1/settings/workspace-lifecycle",
    );
    const deletionImpact = await deletePreview.json() as {
      readonly confirmations: { readonly deleteWorkspace: string };
      readonly impactToken: string;
    };
    const deletion = await lifecycleRequest(
      current,
      "/api/v1/settings/workspace-lifecycle",
      {
        method: "DELETE",
        body: {
          confirmation: deletionImpact.confirmations.deleteWorkspace,
          impactToken: deletionImpact.impactToken,
          password,
        },
      },
    );
    const [deletedState] = await sql<{
      readonly records: number;
      readonly workspaces: number;
    }[]>`select
      (select count(*)::int from crm.workspaces where id = ${owner.workspaceId}) workspaces,
      (select count(*)::int from crm.workspace_lifecycle_records where workspace_id = ${owner.workspaceId} and actor_user_id = ${owner.userId} and action = 'delete') records`;
    assert(
      deletion.status === 200 && deletedState?.workspaces === 0 &&
        deletedState.records === 1,
      "durable deletion record survives workspace cascade",
    );
  },
});

Deno.test({
  name: "AUTH-005 PostgreSQL concurrent leave preserves a final active owner",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events, crm.legal_documents restart identity cascade`;
    const first = await register("leave-first@example.test", "Shared circle");
    const second = await register("leave-second@example.test", "Second home");
    await addMembership(second, first.workspaceId, "owner");
    const secondSession = await signIn(second.email, first.workspaceId);
    const secondCookie = secondSession.headers.get("set-cookie")?.split(";")[0];
    assert(
      secondSession.status === 200 && secondCookie,
      "second owner enters shared workspace",
    );
    const secondInShared = {
      cookie: secondCookie,
      workspaceId: first.workspaceId,
    };

    const responses = await Promise.all([
      lifecycleRequest(first, "/api/v1/settings/personal-lifecycle/leave", {
        method: "POST",
        body: { confirmation: "LEAVE Shared circle", password },
      }),
      lifecycleRequest(
        secondInShared,
        "/api/v1/settings/personal-lifecycle/leave",
        {
          method: "POST",
          body: { confirmation: "LEAVE Shared circle", password },
        },
      ),
    ]);
    assert(
      responses.map((response) => response.status).sort().join(",") ===
        "200,409",
      "exactly one concurrent owner leaves",
    );
    const [owners] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.workspace_members
      where workspace_id = ${first.workspaceId} and role = 'owner'
        and status = 'active' and left_at is null
    `;
    assert(owners?.count === 1, "one active owner remains");
  },
});

Deno.test({
  name:
    "AUTH-005 PostgreSQL bounds, audits, and recovers current-password step-up",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events, crm.legal_documents restart identity cascade`;
    const owner = await register(
      "step-up-owner@example.test",
      "Step-up circle",
    );
    const clientAddress = "203.0.113.40";
    let firstProblem:
      | { readonly code: string; readonly detail: string }
      | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await lifecycleRequest(
        owner,
        "/api/v1/settings/personal-lifecycle/leave",
        {
          clientAddress,
          method: "POST",
          body: {
            confirmation: "LEAVE Step-up circle",
            password: `wrong-${attempt}`,
          },
        },
      );
      const problem = await rejected.json() as {
        readonly code: string;
        readonly detail: string;
      };
      firstProblem ??= problem;
      assert(
        rejected.status === 403 &&
          problem.code === "reauthentication_required",
        `failed step-up ${attempt + 1} is uniform`,
      );
    }
    const limited = await lifecycleRequest(
      owner,
      "/api/v1/settings/personal-lifecycle/leave",
      {
        clientAddress,
        method: "POST",
        body: {
          confirmation: "LEAVE Step-up circle",
          password: "still-wrong",
        },
      },
    );
    assert(
      limited.status === 429 &&
        Number(limited.headers.get("Retry-After")) > 0,
      "sixth failure is retryable and bounded",
    );
    const [bounded] = await sql<{
      readonly audits: number;
      readonly nonEmptyPayloads: number;
    }[]>`
      select
        count(*)::int audits,
        count(*) filter (where payload <> '{}'::jsonb)::int as "nonEmptyPayloads"
      from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and subject_id = ${owner.userId}
        and action = 'authentication.failed'
    `;
    assert(
      bounded?.audits === 6 && bounded.nonEmptyPayloads === 0,
      "failed and limited step-ups are audited without submitted secrets",
    );

    const [credential] = await sql<{ readonly passwordHash: string }[]>`
      select password_hash as "passwordHash" from crm.users where id = ${owner.userId}
    `;
    assert(credential, "step-up fixture has a password");
    await sql`update crm.users set password_hash = null where id = ${owner.userId}`;
    const unavailableCredential = await lifecycleRequest(
      owner,
      "/api/v1/settings/personal-lifecycle/leave",
      {
        clientAddress: "203.0.113.41",
        method: "POST",
        body: {
          confirmation: "LEAVE Step-up circle",
          password: "anything",
        },
      },
    );
    const unavailableProblem = await unavailableCredential.json() as {
      readonly code: string;
      readonly detail: string;
    };
    assert(
      unavailableCredential.status === 403 &&
        unavailableProblem.code === firstProblem?.code &&
        unavailableProblem.detail === firstProblem?.detail,
      "missing and invalid password credentials are indistinguishable",
    );
    await sql`
      update crm.users set password_hash = ${credential.passwordHash}
      where id = ${owner.userId}
    `;

    await sql`
      update crm.api_request_logs set occurred_at = now() - interval '6 minutes'
      where client_ip = ${clientAddress}::inet
    `;
    const recovered = await lifecycleRequest(
      owner,
      "/api/v1/settings/personal-lifecycle/leave",
      {
        clientAddress,
        method: "POST",
        body: { confirmation: "LEAVE typo", password },
      },
    );
    assert(recovered.status === 400, "step-up recovers after the retry window");
    const reset = await lifecycleRequest(
      owner,
      "/api/v1/settings/personal-lifecycle/leave",
      {
        clientAddress,
        method: "POST",
        body: {
          confirmation: "LEAVE Step-up circle",
          password: "wrong-after-success",
        },
      },
    );
    assert(
      reset.status === 403,
      "successful step-up resets the failure budget",
    );
  },
});

Deno.test({
  name: "AUTH-005 PostgreSQL serializes lifecycle with owner demotion",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events, crm.legal_documents restart identity cascade`;
    await sql`
      create or replace function crm.delay_owner_removal()
      returns trigger language plpgsql as $$
      begin
        perform pg_sleep(0.5);
        return new;
      end
      $$
    `;
    await sql`
      create trigger delay_owner_removal
      before update on crm.workspace_members for each row
      when (
        old.role = 'owner' and old.status = 'active' and
        (new.role <> 'owner' or new.status <> 'active')
      ) execute function crm.delay_owner_removal()
    `;
    try {
      for (const action of ["leave", "delete"] as const) {
        const owner = await register(
          `race-${action}-owner@example.test`,
          `Race ${action}`,
        );
        const backup = await register(
          `race-${action}-backup@example.test`,
          `Backup ${action}`,
        );
        const backupMemberId = await addMembership(
          backup,
          owner.workspaceId,
          "owner",
        );
        const demotion = lifecycleRequest(
          owner,
          `/api/v1/settings/members/${backupMemberId}`,
          {
            method: "PATCH",
            body: { role: "member", status: "active" },
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        const lifecycle = lifecycleRequest(
          owner,
          action === "leave"
            ? "/api/v1/settings/personal-lifecycle/leave"
            : "/api/v1/settings/personal-lifecycle",
          {
            method: action === "leave" ? "POST" : "DELETE",
            body: {
              confirmation: action === "leave"
                ? `LEAVE ${owner.workspaceName}`
                : `DELETE ${owner.email}`,
              password,
            },
          },
        );
        const statuses = await Promise.all([demotion, lifecycle]).then((
          values,
        ) => values.map((value) => value.status));
        const [owners] = await sql<{ readonly count: number }[]>`
          select count(*)::int count from crm.workspace_members
          where workspace_id = ${owner.workspaceId} and role = 'owner'
            and status = 'active' and left_at is null
        `;
        assert(
          statuses.filter((status) => status >= 400).length === 1,
          `${action} and demotion serialize to one rejection: ${statuses}`,
        );
        assert(owners?.count && owners.count >= 1, `${action} keeps an owner`);
      }
    } finally {
      await sql`drop trigger if exists delay_owner_removal on crm.workspace_members`;
      await sql`drop function if exists crm.delay_owner_removal()`;
    }
  },
});

Deno.test({
  name:
    "AUTH-005 PostgreSQL deletion rolls back atomically then revokes all access",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events, crm.legal_documents restart identity cascade`;
    const deleting = await register("delete-me@example.test", "Primary circle");
    const neighbor = await register("neighbor@example.test", "Neighbor circle");
    await addMembership(neighbor, deleting.workspaceId, "owner");
    const suspendedMemberId = await addMembership(
      deleting,
      neighbor.workspaceId,
      "member",
      "suspended",
    );
    const secondSession = await signIn(deleting.email, deleting.workspaceId);
    assert(secondSession.status === 200, "second deletion session exists");
    const legalDocumentId = crypto.randomUUID();
    await sql`
      insert into crm.legal_documents (
        id, document_type, version, content, published_at, is_active,
        created_at, updated_at
      ) values (
        ${legalDocumentId}, 'terms', ${crypto.randomUUID()}, 'Terms', now(),
        true, now(), now()
      )
    `;
    await sql`
      insert into crm.legal_acceptances (
        workspace_id, user_id, legal_document_id, accepted_at, created_at
      ) values (
        ${deleting.workspaceId}, ${deleting.userId}, ${legalDocumentId}, now(), now()
      )
    `;

    const preview = await lifecycleRequest(
      deleting,
      "/api/v1/settings/personal-lifecycle",
    );
    const previewBody = await preview.json() as {
      readonly activeSessionCount: number;
      readonly blockingWorkspaces: readonly unknown[];
      readonly memberships: readonly { readonly status: string }[];
    };
    assert(
      preview.status === 200 && previewBody.memberships.length === 2 &&
        previewBody.activeSessionCount >= 2 &&
        previewBody.blockingWorkspaces.length === 0 &&
        previewBody.memberships.some((membership) =>
          membership.status === "suspended"
        ),
      "preview reports current cross-workspace impact",
    );
    const wrongPassword = await lifecycleRequest(
      deleting,
      "/api/v1/settings/personal-lifecycle",
      {
        method: "DELETE",
        body: {
          confirmation: `DELETE ${deleting.email}`,
          password: "wrong password",
        },
      },
    );
    assert(wrongPassword.status === 403, "deletion requires current password");

    await sql`
      create or replace function crm.reject_identity_lifecycle_audit()
      returns trigger language plpgsql as $$
      begin
        if new.action = 'identity.deletion-attempted' then
          raise exception 'injected lifecycle audit failure';
        end if;
        return new;
      end
      $$
    `;
    await sql`
      create trigger reject_identity_lifecycle_audit
      before insert on crm.audit_events for each row
      execute function crm.reject_identity_lifecycle_audit()
    `;
    const failed = await lifecycleRequest(
      deleting,
      "/api/v1/settings/personal-lifecycle",
      {
        method: "DELETE",
        body: { confirmation: `DELETE ${deleting.email}`, password },
      },
    );
    assert(failed.status === 503, "injected audit failure is unavailable");
    const [rolledBack] = await sql<{
      readonly activeMemberships: number;
      readonly nonLeftMemberships: number;
      readonly activeSessions: number;
      readonly status: string;
    }[]>`
      select u.status,
        (select count(*)::int from crm.workspace_members wm
          where wm.user_id = u.id and wm.status = 'active' and wm.left_at is null)
          as "activeMemberships",
        (select count(*)::int from crm.workspace_members wm
          where wm.user_id = u.id and wm.status <> 'left' and wm.left_at is null)
          as "nonLeftMemberships",
        (select count(*)::int from crm.user_sessions us
          where us.user_id = u.id and us.revoked_at is null
            and us.expires_at > now()) as "activeSessions"
      from crm.users u where u.id = ${deleting.userId}
    `;
    assert(
      rolledBack?.status === "active" && rolledBack.activeMemberships === 1 &&
        rolledBack.nonLeftMemberships === 2 &&
        rolledBack.activeSessions >= 2,
      "audit failure rolls back identity, memberships, and sessions",
    );
    await sql`drop trigger reject_identity_lifecycle_audit on crm.audit_events`;
    await sql`drop function crm.reject_identity_lifecycle_audit()`;

    const deleted = await lifecycleRequest(
      deleting,
      "/api/v1/settings/personal-lifecycle",
      {
        method: "DELETE",
        body: { confirmation: `DELETE ${deleting.email}`, password },
      },
    );
    assert(
      deleted.status === 200 &&
        deleted.headers.get("set-cookie")?.includes("Max-Age=0"),
      "successful deletion expires current cookie",
    );
    const [state] = await sql<{
      readonly activeMemberships: number;
      readonly activeSessions: number;
      readonly audits: number;
      readonly email: string;
      readonly legalAcceptances: number;
      readonly neighborActive: boolean;
      readonly nonLeftMemberships: number;
      readonly passwordHash: string | null;
      readonly status: string;
    }[]>`
      select u.status, u.email::text, u.password_hash as "passwordHash",
        (select count(*)::int from crm.workspace_members wm
          where wm.user_id = u.id and wm.status = 'active' and wm.left_at is null)
          as "activeMemberships",
        (select count(*)::int from crm.workspace_members wm
          where wm.user_id = u.id and wm.status <> 'left' and wm.left_at is null)
          as "nonLeftMemberships",
        (select count(*)::int from crm.user_sessions us
          where us.user_id = u.id and us.revoked_at is null
            and us.expires_at > now()) as "activeSessions",
        (select count(*)::int from crm.audit_events ae
          where ae.subject_id = u.id and ae.action = 'identity.deletion-attempted')
          as audits,
        (select count(*)::int from crm.legal_acceptances la
          where la.user_id = u.id) as "legalAcceptances",
        (select status = 'active' from crm.users n where n.id = ${neighbor.userId})
          as "neighborActive"
      from crm.users u where u.id = ${deleting.userId}
    `;
    assert(
      state?.status === "deleted" && state.passwordHash === null &&
        state.email.startsWith(`deleted+${deleting.userId}`) &&
        state.activeMemberships === 0 && state.nonLeftMemberships === 0 &&
        state.activeSessions === 0 &&
        state.audits === 2 && state.legalAcceptances === 1 &&
        state.neighborActive,
      "identity is anonymized while legal evidence and tenant isolation remain",
    );
    const [suspendedAfter] = await sql<{ readonly status: string }[]>`
      select status from crm.workspace_members where id = ${suspendedMemberId}
    `;
    assert(
      suspendedAfter?.status === "left",
      "suspended membership cannot be reactivated after identity deletion",
    );
    assert(
      (await lifecycleRequest(
        deleting,
        "/api/v1/settings/personal-lifecycle",
      )).status === 401,
      "revoked cookie cannot regain workspace access",
    );
  },
});

Deno.test({
  name: "AUTH-005 PostgreSQL final owner deletion is rejected and audited",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events, crm.legal_documents restart identity cascade`;
    const owner = await register(
      "final-owner@example.test",
      "Protected circle",
    );
    const beforeLeave = await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.user_sessions
      where user_id = ${owner.userId} and revoked_at is null and expires_at > now()
    `;
    const blockedLeave = await lifecycleRequest(
      owner,
      "/api/v1/settings/personal-lifecycle/leave",
      {
        method: "POST",
        body: { confirmation: "LEAVE Protected circle", password },
      },
    );
    const [leaveState] = await sql<{
      readonly actions: string | null;
      readonly audits: number;
      readonly memberships: number;
      readonly sessions: number;
    }[]>`
      select
        (select string_agg(ae.action || ':' || ae.subject_id::text || ':' || ae.payload::text, ',')
          from crm.audit_events ae where ae.workspace_id = ${owner.workspaceId}) actions,
        (select count(*)::int from crm.audit_events ae
          where ae.workspace_id = ${owner.workspaceId}
            and ae.subject_id = ${owner.memberId}
            and ae.action = 'workspace.member-leave-attempted'
            and ae.payload = '{"outcome":"blocked-final-owner"}'::jsonb) audits,
        (select count(*)::int from crm.workspace_members wm
          where wm.id = ${owner.memberId} and wm.status = 'active'
            and wm.left_at is null) memberships,
        (select count(*)::int from crm.user_sessions us
          where us.user_id = ${owner.userId} and us.revoked_at is null
            and us.expires_at > now()) sessions
    `;
    assert(
      blockedLeave.status === 409 && leaveState?.audits === 1 &&
        leaveState.memberships === 1 &&
        leaveState.sessions === beforeLeave[0]?.count,
      `blocked leave is redacted, audited, and mutation-free: ${
        JSON.stringify({
          beforeSessions: beforeLeave[0]?.count,
          state: leaveState,
          status: blockedLeave.status,
        })
      }`,
    );
    const response = await lifecycleRequest(
      owner,
      "/api/v1/settings/personal-lifecycle",
      {
        method: "DELETE",
        body: { confirmation: `DELETE ${owner.email}`, password },
      },
    );
    const problem = await response.json() as {
      readonly blockingWorkspaces: readonly { readonly name: string }[];
    };
    const [state] = await sql<{
      readonly audits: number;
      readonly status: string;
    }[]>`
      select u.status,
        (select count(*)::int from crm.audit_events ae
          where ae.subject_id = u.id and ae.action = 'identity.deletion-attempted')
          as audits
      from crm.users u where u.id = ${owner.userId}
    `;
    assert(
      response.status === 409 &&
        problem.blockingWorkspaces[0]?.name === "Protected circle" &&
        state?.status === "active" && state.audits === 1,
      "final owner remains active and blocked attempt is audited",
    );
  },
});

globalThis.addEventListener("unload", () => {
  void sql.end();
  void configured.close();
});
