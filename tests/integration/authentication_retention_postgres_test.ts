/**
 * Registrations and authentication rows are bounded and purged (SECA-04,
 * BEQ-15, AUD-A2).
 *
 * A registration writes only the pending identity: its workspace, membership,
 * preferences, settings, vocabulary, and creation audit wait for the address
 * to be proved. One run of the configured worker then deletes what nobody can
 * use any more — a pending registration older than seven days with its
 * tokens, a session that ended more than thirty days ago, and a reset request
 * or spent verification token older than seven days — and nothing anybody
 * still can.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { createConfiguredReminderWorker } from "../../apps/worker/composition.ts";
import { PostgresAuthenticationRetention } from "../../packages/backend/modules/identity/adapters/postgres/authentication_retention.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { recordingLogger } from "../../packages/backend/testing/fakes.ts";
import { apiSupport, ORIGIN, originHeaders } from "../support/api.ts";
import {
  openSql,
  requireDatabaseUrl,
  requireWorkerDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import {
  describePlan,
  explainedPlan,
  planNodes,
  scansOf,
} from "../support/query_plan.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { prepare: false });
const capturedMail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  capturedMail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, capturedMail, sql);

/** One run of the configured worker, as the deployed process runs it. */
async function runWorkerOnce(): Promise<void> {
  // The worker's own role, as Compose runs it (ADR 0008).
  const worker = createConfiguredReminderWorker(
    requireWorkerDatabaseUrl(),
    recordingLogger(),
    { get: (name) => name === "APP_ENV" ? "test" : undefined },
  );
  try {
    await worker.worker.tick({ owner: "retention-test" });
  } finally {
    await worker.close();
  }
}

async function userId(email: string): Promise<string | undefined> {
  const [row] = await sql<{ id: string }[]>`
    select id::text from crm.users where email = ${email}
  `;
  return row?.id;
}

/** Moves a user and everything identity wrote for them `days` into the past. */
async function age(id: string, days: number): Promise<void> {
  const interval = `${days} days`;
  await sql`
    update crm.users set created_at = now() - ${interval}::interval
    where id = ${id}::uuid
  `;
  await sql`
    update crm.email_verification_tokens
    set created_at = now() - ${interval}::interval
    where user_id = ${id}::uuid
  `;
}

async function session(cookie: string): Promise<number> {
  const response = await configured.app.request(`${ORIGIN}/api/v1/session`, {
    headers: { cookie },
  });
  await response.body?.cancel();
  return response.status;
}

Deno.test({
  name:
    "[AUD-A2] a registration provisions nothing before verification, and one purge run removes a stale registration and an ended session but not a live one",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await api.register("owner@example.test", "Owner home");
    const ended = await api.register("ended@example.test", "Ended home");

    const pending = await api.submitRegistration(
      "stale@example.test",
      "Stale circle",
    );
    assertEquals(pending.status, 202);
    const staleId = await userId("stale@example.test");
    assert(staleId, "the registration wrote a pending identity");
    const [unprovisioned] = await sql<{
      audits: number;
      members: number;
      settings: number;
      types: number;
      workspaces: number;
    }[]>`
      select
        (select count(*)::int from crm.workspaces) workspaces,
        (select count(*)::int from crm.workspace_members
          where user_id = ${staleId}::uuid) members,
        (select count(*)::int from crm.workspace_settings) settings,
        (select count(*)::int from crm.relationship_types) types,
        (select count(*)::int from crm.audit_events
          where action = 'workspace.created') audits
    `;
    assertEquals(
      unprovisioned,
      { workspaces: 2, members: 0, settings: 2, types: 52, audits: 2 },
      "an unverified registration provisions no workspace rows",
    );

    await age(staleId, 8);
    await sql`
      update crm.user_sessions
      set created_at = now() - interval '32 days',
        last_seen_at = now() - interval '32 days',
        expires_at = now() - interval '31 days'
      where user_id = ${ended.userId}::uuid
    `;

    await runWorkerOnce();

    assertEquals(await userId("stale@example.test"), undefined);
    const [remaining] = await sql<{ tokens: number; ended: number }[]>`
      select
        (select count(*)::int from crm.email_verification_tokens
          where user_id = ${staleId}::uuid) tokens,
        (select count(*)::int from crm.user_sessions
          where user_id = ${ended.userId}::uuid) ended
    `;
    assertEquals(remaining, { tokens: 0, ended: 0 });
    assertEquals(await session(owner.cookie), 200);
    assertEquals(await session(ended.cookie), 401);
    assert(
      await userId("ended@example.test"),
      "a verified user outlives their ended session",
    );
  },
});

Deno.test({
  name:
    "[AUD-A2] the purge keeps what somebody can still use: invitees, members, imported accounts, a verified address's proof, and anything younger than its window",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await api.register("keeper@example.test", "Keeper home");

    // Pending registrations past the week that somebody still waits on, one
    // that is not past it, and one made before provisioning waited.
    for (
      const email of [
        "invitee@example.test",
        "member@example.test",
        "recent@example.test",
        "legacy@example.test",
      ]
    ) {
      assertEquals(
        (await api.submitRegistration(email, "Pending")).status,
        202,
      );
    }
    const inviteeId = (await userId("invitee@example.test"))!;
    const memberId = (await userId("member@example.test"))!;
    const recentId = (await userId("recent@example.test"))!;
    const legacyId = (await userId("legacy@example.test"))!;
    await sql`
      insert into crm.workspace_invitations (
        workspace_id, email, token_hash, role, status, expires_at
      ) values (
        ${owner.workspaceId}::uuid, 'invitee@example.test', 'retention-test',
        'member', 'pending', now() + interval '1 day'
      )
    `;
    await sql`
      insert into crm.workspace_members (workspace_id, user_id, role, status)
      values (${owner.workspaceId}::uuid, ${memberId}::uuid, 'member', 'active')
    `;
    const [legacyWorkspace] = await sql<{ id: string }[]>`
      insert into crm.workspaces (name, status, created_by_user_id)
      values ('Legacy pending', 'active', ${legacyId}::uuid)
      returning id::text
    `;
    await sql`
      insert into crm.workspace_members (workspace_id, user_id, role, status)
      values (${
      legacyWorkspace!.id
    }::uuid, ${legacyId}::uuid, 'owner', 'active')
    `;
    // An imported account never registered here: unverified, no token.
    const [imported] = await sql<{ id: string }[]>`
      insert into crm.users (email, password_hash, status, created_at)
      values (
        'imported@example.test', '$2y$10$legacy', 'active',
        now() - interval '90 days'
      )
      returning id::text
    `;
    for (const id of [inviteeId, memberId, legacyId]) await age(id, 8);
    await age(recentId, 6);
    await age(owner.userId, 8);

    // Sessions that ended either side of thirty days, and reset requests
    // either side of a week.
    await sql`
      insert into crm.user_sessions (
        user_id, session_hash, purpose, created_at, last_seen_at, expires_at,
        revoked_at
      ) values
        (${owner.userId}::uuid, 'revoked-31', 'authenticated',
          now() - interval '32 days', now() - interval '32 days',
          now() + interval '1 day', now() - interval '31 days'),
        (${owner.userId}::uuid, 'revoked-29', 'authenticated',
          now() - interval '30 days', now() - interval '30 days',
          now() + interval '1 day', now() - interval '29 days'),
        (${owner.userId}::uuid, 'expired-1', 'authenticated',
          now() - interval '2 days', now() - interval '2 days',
          now() - interval '1 day', null)
    `;
    await sql`
      insert into crm.password_reset_requests (
        user_id, email, token_hash, expires_at, created_at
      ) values
        (${owner.userId}::uuid, 'keeper@example.test', 'reset-8',
          now() - interval '8 days', now() - interval '8 days'),
        (null, 'nobody@example.test', 'reset-8-unknown',
          now() - interval '8 days', now() - interval '8 days'),
        (${owner.userId}::uuid, 'keeper@example.test', 'reset-6',
          now() - interval '6 days', now() - interval '6 days')
    `;

    await runWorkerOnce();

    const survivors = await sql<{ email: string }[]>`
      select email::text from crm.users order by email
    `;
    assertEquals(survivors.map((row) => row.email), [
      "imported@example.test",
      "invitee@example.test",
      "keeper@example.test",
      "member@example.test",
      "recent@example.test",
    ]);
    assert(imported, "the imported account was seeded");
    const [legacy] = await sql<{ workspaces: number }[]>`
      select count(*)::int workspaces from crm.workspaces
      where id = ${legacyWorkspace!.id}::uuid
    `;
    assertEquals(legacy?.workspaces, 0, "a legacy pending workspace goes too");
    const sessions = await sql<{ session_hash: string }[]>`
      select session_hash from crm.user_sessions
      where session_hash in ('revoked-31', 'revoked-29', 'expired-1')
      order by session_hash
    `;
    assertEquals(sessions.map((row) => row.session_hash), [
      "expired-1",
      "revoked-29",
    ]);
    const resets = await sql<{ token_hash: string }[]>`
      select token_hash from crm.password_reset_requests order by token_hash
    `;
    assertEquals(resets.map((row) => row.token_hash), ["reset-6"]);
    const [proof] = await sql<{ spent: number; total: number }[]>`
      select count(*)::int total,
        count(*) filter (where used_at is not null)::int spent
      from crm.email_verification_tokens where user_id = ${owner.userId}::uuid
    `;
    assertEquals(proof, { total: 1, spent: 1 }, "one spent token proves it");
    assertEquals((await api.signIn("keeper@example.test")).status, 200);
    const [pendingTokens] = await sql<{ count: number }[]>`
      select count(*)::int count from crm.email_verification_tokens
      where user_id = any(${[inviteeId, memberId, recentId]}::uuid[])
    `;
    assertEquals(pendingTokens?.count, 6, "a kept registration keeps its link");
  },
});

Deno.test({
  name:
    "[AUD-A2] a verification whose provisioning fails unwinds: the address stays unproved, the link unspent, and no workspace or entry is written",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const email = "rollback@example.test";
    assertEquals(
      (await api.submitRegistration(email, "Rollback home")).status,
      202,
    );
    const id = await userId(email);
    assert(id, "the registration wrote a pending identity");
    // The last write provisioning makes, the creation audit, is refused by
    // PostgreSQL inside the verification's transaction.
    await sql.unsafe(`
      create function crm.aud_a2_refuse_workspace_audit() returns trigger
      language plpgsql as $body$
      begin raise exception 'AUD-A2 provisioning refused'; end $body$;
      create trigger aud_a2_refuse_workspace_audit
      before insert on crm.audit_events for each row
      when (new.action = 'workspace.created')
      execute function crm.aud_a2_refuse_workspace_audit();
    `);
    let refused: Response;
    try {
      refused = await api.verify(email);
    } finally {
      await sql.unsafe(`
        drop trigger if exists aud_a2_refuse_workspace_audit on crm.audit_events;
        drop function if exists crm.aud_a2_refuse_workspace_audit();
      `);
    }
    assertEquals(refused.status, 503);
    assertEquals(
      ((await refused.json()) as { code?: string }).code,
      "verification_unavailable",
    );
    const state = async () => {
      const [row] = await sql<{
        entries: number;
        members: number;
        spent: number;
        verified: boolean;
        workspaces: number;
      }[]>`
        select
          (select email_verified_at is not null from crm.users
            where id = ${id}::uuid) verified,
          (select count(*)::int from crm.email_verification_tokens
            where user_id = ${id}::uuid and used_at is not null
              and token_hash not like 'registrant:%') spent,
          (select count(*)::int from crm.user_sessions
            where user_id = ${id}::uuid and purpose = 'verified-entry') entries,
          (select count(*)::int from crm.workspaces
            where created_by_user_id = ${id}::uuid) workspaces,
          (select count(*)::int from crm.workspace_members
            where user_id = ${id}::uuid) members
      `;
      return row;
    };
    assertEquals(await state(), {
      verified: false,
      spent: 0,
      entries: 0,
      workspaces: 0,
      members: 0,
    });

    const verified = await api.verify(email);
    assertEquals(verified.status, 200, "the same link works on the next try");
    await verified.body?.cancel();
    assertEquals(await state(), {
      verified: true,
      spent: 1,
      entries: 1,
      workspaces: 1,
      members: 1,
    });
  },
});

Deno.test({
  name:
    "[AUD-A2] a pending registration past the week lives on while a link it was re-sent is younger than the week",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    for (const email of ["retried@example.test", "abandoned@example.test"]) {
      assertEquals(
        (await api.submitRegistration(email, "Waiting")).status,
        202,
      );
      await age((await userId(email))!, 8);
    }
    const retry = await configured.app.request(
      `${ORIGIN}/api/v1/email-verification-deliveries`,
      {
        body: JSON.stringify({ email: "retried@example.test" }),
        headers: originHeaders,
        method: "POST",
      },
    );
    assertEquals(retry.status, 202);
    await retry.body?.cancel();
    const retriedId = (await userId("retried@example.test"))!;
    // The retry was mailed an hour ago, on day seven of the registration.
    const moved = await sql`
      update crm.email_verification_tokens
      set created_at = now() - interval '1 hour'
      where user_id = ${retriedId}::uuid
        and created_at > now() - interval '1 day'
      returning id
    `;
    assertEquals(moved.length, 1, "the retry issued one new link");

    await runWorkerOnce();

    assertEquals(await userId("abandoned@example.test"), undefined);
    assertEquals(await userId("retried@example.test"), retriedId);
    const verified = await api.verify("retried@example.test");
    assertEquals(verified.status, 200, "the re-sent link proves the address");
    await verified.body?.cancel();
  },
});

Deno.test({
  name:
    "[AUD-A2] the spent-token purge reads the token table once, not once per verified user, and keeps each user's proof",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const users = 3_000;
    // Every verified user holds the token that proved them, and every other
    // one an older, unspent link that is due to go. User 1 never spent a
    // token, so keeps every row.
    await sql`
      insert into crm.users (
        id, email, password_hash, status, email_verified_at, created_at
      )
      select md5('aud-a2-user-' || n)::uuid, 'verified-' || n || '@example.test',
        '$argon2id$retention', 'active', now() - interval '30 days',
        now() - interval '40 days'
      from generate_series(1, ${users}::int) n
    `;
    await sql`
      insert into crm.email_verification_tokens (
        user_id, email, token_hash, expires_at, used_at, created_at
      )
      select md5('aud-a2-user-' || n)::uuid, 'verified-' || n || '@example.test',
        'proof-' || n, now() - interval '29 days',
        case when n = 1 then null else now() - interval '30 days' end,
        now() - interval '30 days'
      from generate_series(1, ${users}::int) n
      union all
      select md5('aud-a2-user-' || n)::uuid, 'verified-' || n || '@example.test',
        'stale-' || n, now() - interval '39 days', null,
        now() - interval '40 days'
      from generate_series(1, ${users}::int) n where n % 2 = 0 or n = 1
    `;
    await sql`analyze crm.users, crm.email_verification_tokens`;

    const connection = connectDatabase(databaseUrl);
    try {
      const plan = await explainedPlan(
        connection.db,
        (text) => text.includes("delete from crm.email_verification_tokens"),
        (db) =>
          new PostgresAuthenticationRetention(db)
            .deleteSpentVerificationTokens({
              before: new Date(Date.now() - 7 * 86_400_000),
              limit: 5_000,
            }),
      );
      const correlated = planNodes(plan).filter((node) =>
        node["Parent Relationship"] === "SubPlan"
      );
      assertEquals(correlated.length, 0, describePlan(plan));
      const scans = scansOf(plan, "email_verification_tokens");
      assert(scans.length > 0, describePlan(plan));
      for (const scan of scans) {
        assertEquals(scan["Actual Loops"], 1, describePlan(plan));
      }
    } finally {
      await connection.destroy();
    }

    const [kept] = await sql<{
      proofs: number;
      stale: number;
      unproved: number;
    }[]>`
      select
        count(*) filter (
          where token_hash like 'proof-%' and used_at is not null
        )::int proofs,
        count(*) filter (where token_hash like 'stale-%')::int stale,
        count(*) filter (
          where user_id = md5('aud-a2-user-1')::uuid
        )::int unproved
      from crm.email_verification_tokens
    `;
    assertEquals(kept, { proofs: users - 1, stale: 1, unproved: 2 });
  },
});

Deno.test({
  name:
    "[AUD-A2] the workspace a registration asks for waits on the user row, is provisioned once from either browser, and is then cleared",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const names = {
      "own@example.test": "Own home",
      "other@example.test": "Other home",
      "legacy@example.test": "Legacy home",
    } as const;
    for (const [email, name] of Object.entries(names)) {
      assertEquals((await api.submitRegistration(email, name)).status, 202);
    }
    const pending = await sql<{ email: string; name: string | null }[]>`
      select email::text, pending_workspace_name name from crm.users
      order by email
    `;
    assertEquals(pending, [
      { email: "legacy@example.test", name: "Legacy home" },
      { email: "other@example.test", name: "Other home" },
      { email: "own@example.test", name: "Own home" },
    ]);
    const [intentRows] = await sql<{ count: number }[]>`
      select count(*)::int count from crm.email_verification_tokens
      where token_hash like 'intent:%'
    `;
    assertEquals(intentRows?.count, 0, "no token row carries the name");

    // The registering browser enters; any other browser chooses a password.
    const own = await api.verify("own@example.test");
    assertEquals(own.status, 200);
    await own.body?.cancel();
    const otherToken = capturedMail.latestToken("other@example.test");
    assert(otherToken, "the other registration was mailed a link");
    const verifyElsewhere = async (token: string) =>
      await configured.app.request(`${ORIGIN}/api/v1/email-verifications`, {
        body: JSON.stringify({ token }),
        headers: originHeaders,
        method: "POST",
      });
    const other = await verifyElsewhere(otherToken);
    assertEquals(other.status, 200);
    assertEquals(
      ((await other.json()) as { status?: string }).status,
      "password-required",
    );
    // A pending user from before the name waited on the row has none.
    await sql`
      update crm.users set pending_workspace_name = null
      where email = 'legacy@example.test'
    `;
    const legacy = await api.verify("legacy@example.test");
    assertEquals(legacy.status, 200);
    await legacy.body?.cancel();
    // Replays provision nothing more.
    for (
      const replay of [
        await api.verify("own@example.test"),
        await verifyElsewhere(otherToken),
      ]
    ) {
      assert(replay.status !== 200, "a spent link is refused");
      await replay.body?.cancel();
    }

    const provisioned = await sql<{
      email: string;
      name: string | null;
      verified: boolean;
      workspaces: string[];
    }[]>`
      select u.email::text, u.pending_workspace_name name,
        u.email_verified_at is not null verified,
        coalesce(array_agg(w.name order by w.name)
          filter (where w.id is not null), '{}') workspaces
      from crm.users u
      left join crm.workspaces w on w.created_by_user_id = u.id
      group by u.id order by u.email
    `;
    assertEquals(provisioned, [
      {
        email: "legacy@example.test",
        name: null,
        verified: true,
        workspaces: [],
      },
      {
        email: "other@example.test",
        name: null,
        verified: true,
        workspaces: ["Other home"],
      },
      {
        email: "own@example.test",
        name: null,
        verified: true,
        workspaces: ["Own home"],
      },
    ]);
  },
});
