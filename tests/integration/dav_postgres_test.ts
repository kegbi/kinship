import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/public.ts";
import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  davAuditFrom,
  type DavRemoteChange,
  type DavRemoteClient,
  DavRemoteFailure,
  PostgresDavRepository,
} from "../../packages/backend/modules/integrations/public.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { databaseFromSession } from "../../packages/backend/platform/postgres/session.ts";
import { sql as kyselySql } from "kysely";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => resolve = ready);
  return { promise, resolve };
}
async function assertPending(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  let settled = false;
  void promise.then(() => settled = true, () => settled = true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert(!settled, message);
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const keyset = {
  activeKeyId: "test",
  keys: new Map([["test", new Uint8Array(32).fill(0x69)]]),
};
const password = "correct horse battery staple";

class DurableDav implements DavRemoteClient {
  mode: "auth" | "conflict" | "delete" | "good" | "partial" | "updated" =
    "good";
  pulls: Array<string | undefined> = [];
  pull(command: Parameters<DavRemoteClient["pull"]>[0]) {
    this.pulls.push(command.remoteSyncToken);
    if (this.mode === "auth") {
      throw new DavRemoteFailure("auth", "Remote DAV authentication failed.");
    }
    if (this.mode === "conflict") {
      throw new DavRemoteFailure("conflict", "raw provider detail");
    }
    const changes: DavRemoteChange[] = this.mode === "delete"
      ? [{
        changeType: "delete",
        etag: '"ada-deleted"',
        href: "/ada.vcf",
        kind: "person",
        uid: "ada",
      }, {
        changeType: "delete",
        etag: '"task-deleted"',
        href: "/notes.ics",
        kind: "task",
        uid: "notes",
      }]
      : this.mode === "updated"
      ? [{
        changeType: "update",
        etag: '"ada-2"',
        href: "/ada.vcf",
        kind: "person",
        payload: { familyName: "Byron", givenName: "Ada" },
        uid: "ada",
      }, {
        changeType: "update",
        etag: '"task-2"',
        href: "/notes.ics",
        kind: "task",
        payload: { title: "Write updated notes" },
        uid: "notes",
      }]
      : this.mode === "partial"
      ? [{
        changeType: "create",
        etag: '"bad-1"',
        href: "/bad.vcf",
        kind: "person",
        payload: { givenName: "" },
        raw: "BEGIN:VCARD\nEND:VCARD",
        uid: "bad",
      }]
      : [{
        changeType: "update",
        etag: '"ada-1"',
        href: "/ada.vcf",
        kind: "person",
        payload: { familyName: "Lovelace", givenName: "Ada" },
        raw: "BEGIN:VCARD\nUID:ada\nFN:Ada Lovelace\nEND:VCARD",
        uid: "ada",
      }, {
        changeType: "update",
        etag: '"task-1"',
        href: "/notes.ics",
        kind: "task",
        payload: { title: "Write notes" },
        raw:
          "BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:notes\nSUMMARY:Write notes\nEND:VTODO\nEND:VCALENDAR",
        uid: "notes",
      }];
    return Promise.resolve({
      changes,
      remoteSyncToken: this.mode === "partial" ? "token-partial" : "token-2",
    });
  }
}

const remote = new DurableDav();
let configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
  undefined,
  undefined,
  undefined,
  undefined,
  remote,
  keyset,
);

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
        firstName: "DAV",
        lastName: "Tester",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registered.status === 202, "DAV fixture registers");
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
    "DAV fixture verifies",
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
  assert(signed.status === 200 && cookie, "DAV fixture signs in");
  return { cookie, workspaceId: body.workspace.id };
}

function request(
  fixture: Fixture,
  path: string,
  method: "DELETE" | "GET" | "POST" = "GET",
  body?: unknown,
) {
  return configured.app.request(`http://localhost${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      cookie: fixture.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": fixture.workspaceId,
    },
    method,
  });
}

Deno.test("[INTEGRATION-001] PostgreSQL DAV checkpoints isolate tenants and recover retry/restart", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`dav-${suffix}@example.test`, "DAV primary");
  const foreign = await register(
    `dav-foreign-${suffix}@example.test`,
    "DAV foreign",
  );
  const created = await request(
    primary,
    "/api/v1/settings/integrations/dav",
    "POST",
    {
      name: "Personal DAV",
      password: "remote-secret",
      remoteUrl: "https://dav.example.test/collection/",
      username: "ada",
    },
  );
  const createdBody = await created.json() as { subscription: { id: string } };
  assert(
    created.status === 201 && createdBody.subscription.id,
    "subscription configured",
  );
  const subscriptionId = createdBody.subscription.id;
  const [owner] = await sql<{ member_id: string; user_id: string }[]>`
    select member.id member_id, member.user_id from crm.workspace_members member
    where member.workspace_id=${primary.workspaceId}::uuid and member.role='owner'
  `;
  assert(owner, "owner actor resolved");
  const actor = {
    memberId: owner.member_id,
    role: "owner" as const,
    userId: owner.user_id,
    workspaceId: primary.workspaceId,
  };
  const boundary = connectDatabase(databaseUrl);
  const davRepository = new PostgresDavRepository(
    boundary.db,
    davAuditFrom(new PostgresAuditEventRecorder()),
    new PostgresActorRevalidation(),
  );
  const rollbackId = crypto.randomUUID();
  let auditRolledBack = false;
  try {
    await new PostgresDavRepository(boundary.db, {
      record: () => Promise.reject(new Error("audit unavailable")),
    }, new PostgresActorRevalidation()).create({
      ...actor,
      encryptedPassword: "encrypted",
      id: rollbackId,
      name: "Rollback",
      occurredAt: new Date(),
      remoteUrl: "https://dav.example.test/rollback",
    });
  } catch {
    auditRolledBack = true;
  }
  const [rolledBack] = await sql<{ books: number; subscriptions: number }[]>`
    select (select count(*)::int from crm.dav_address_books where uri=${`subscription-${rollbackId}`}) books,
      (select count(*)::int from crm.dav_address_book_subscriptions where id=${rollbackId}::uuid) subscriptions
  `;
  assert(
    auditRolledBack && rolledBack?.books === 0 &&
      rolledBack.subscriptions === 0,
    "configure and required audit roll back together",
  );
  const [foreignOwner] = await sql<{ member_id: string; user_id: string }[]>`
    select member.id member_id,member.user_id from crm.workspace_members member
    where member.workspace_id=${foreign.workspaceId}::uuid and member.role='owner'
  `;
  assert(
    foreignOwner && !await davRepository.recordAudit({
      memberId: foreignOwner.member_id,
      role: "owner",
      userId: foreignOwner.user_id,
      workspaceId: foreign.workspaceId,
    }, {
      action: "sync",
      occurredAt: new Date(),
      outcome: "success",
      subscriptionId,
    }),
    "foreign tenant cannot audit another workspace subscription",
  );
  const claimA = await davRepository.claim(
    actor,
    subscriptionId,
    "claim-a",
    new Date("2026-08-24T10:00:00.000Z"),
  );
  const claimB = await davRepository.claim(
    actor,
    subscriptionId,
    "claim-b",
    new Date("2026-08-24T10:06:00.000Z"),
  );
  assert(
    claimA?.claimToken === "claim-a" && claimB?.claimToken === "claim-b",
    "stale claim reclaimed with opaque fence",
  );
  assert(
    await davRepository.withClaimedObject(
      {
        ...actor,
        claimToken: "claim-a",
        subscriptionId,
      },
      "/stale.vcf",
      () => Promise.reject(new Error("callback invoked")),
    ) ===
      "claim-lost",
    "expired claimant cannot checkpoint after reclaim",
  );
  assert(
    await davRepository.recordOutcome({
      ...actor,
      claimToken: "claim-b",
      subscriptionId,
    }, {
      error: "dav_sync_failed",
      occurredAt: new Date("2026-08-24T10:06:01.000Z"),
      status: "partial",
    }),
    "current claimant can finish",
  );
  assert(
    await davRepository.claim(
      actor,
      subscriptionId,
      "claim-c",
      new Date("2026-08-24T10:12:00.000Z"),
    ),
    "next claim acquired",
  );
  await sql`update crm.workspace_members set role='member' where id=${actor.memberId}::uuid`;
  assert(
    !await davRepository.recordOutcome({
      ...actor,
      claimToken: "claim-c",
      subscriptionId,
    }, {
      occurredAt: new Date("2026-08-24T10:12:01.000Z"),
      status: "success",
    }),
    "role revocation fences an active claimant",
  );
  await sql`update crm.workspace_members set role='owner' where id=${actor.memberId}::uuid`;
  await sql`update crm.dav_address_book_subscriptions set
    capabilities=capabilities-'syncClaimToken'-'syncClaimedAt'
    where id=${subscriptionId}::uuid`;
  assert(await davRepository.authorize(actor), "restored owner is authorized");
  const directClaim = await davRepository.claim(
    actor,
    subscriptionId,
    "claim-direct",
    new Date(),
  );
  const [claimState] = await sql<
    { capabilities: Record<string, unknown>; is_active: boolean }[]
  >`
    select capabilities,is_active from crm.dav_address_book_subscriptions where id=${subscriptionId}::uuid
  `;
  assert(
    directClaim?.claimToken === "claim-direct",
    `restored owner can claim (${JSON.stringify(claimState)})`,
  );
  const directOutcome = await davRepository.recordOutcome({
    ...actor,
    claimToken: "claim-direct",
    subscriptionId,
  }, {
    error: "dav_sync_failed",
    occurredAt: new Date(),
    status: "partial",
  });
  assert(
    directOutcome,
    `restored owner can finish (${JSON.stringify(claimState)})`,
  );
  const raceId = crypto.randomUUID();
  assert(
    await davRepository.create({
      ...actor,
      encryptedPassword: "encrypted",
      id: raceId,
      name: "DAV locking",
      occurredAt: new Date("2026-08-24T11:00:00.000Z"),
      remoteUrl: "https://dav.example.test/locking",
    }),
    "locking fixture configured",
  );
  const lifecycleEntered = deferred();
  const lifecycleRelease = deferred();
  const lifecycle = boundary.db.transaction().execute(async (transaction) => {
    await kyselySql`select id from crm.workspace_members
      where id=${actor.memberId}::uuid for update`.execute(transaction);
    lifecycleEntered.resolve();
    await lifecycleRelease.promise;
    await kyselySql`update crm.dav_address_book_subscriptions set is_active=false
      where id=${raceId}::uuid`.execute(transaction);
  });
  await lifecycleEntered.promise;
  const lifecycleClaim = davRepository.claim(
    actor,
    raceId,
    "lifecycle-claim",
    new Date("2026-08-24T10:59:00.000Z"),
  );
  await assertPending(
    lifecycleClaim,
    "DAV waits on lifecycle actor lock before touching subscription",
  );
  lifecycleRelease.resolve();
  await lifecycle;
  assert(
    await lifecycleClaim === undefined,
    "lifecycle mutation commits without DAV lock inversion or deadlock",
  );
  await sql`update crm.dav_address_book_subscriptions set is_active=true
    where id=${raceId}::uuid`;
  const raceA = await davRepository.claim(
    actor,
    raceId,
    "race-a",
    new Date("2026-08-24T11:00:00.000Z"),
  );
  assert(raceA, "locking fixture claimed");
  const reclaimEntered = deferred();
  const reclaimRelease = deferred();
  const heldForReclaim = davRepository.withClaimedObject(
    {
      ...actor,
      claimToken: "race-a",
      subscriptionId: raceId,
    },
    "/race.vcf",
    async () => {
      reclaimEntered.resolve();
      await reclaimRelease.promise;
      return undefined;
    },
  );
  await reclaimEntered.promise;
  const reclaim = davRepository.claim(
    actor,
    raceId,
    "race-b",
    new Date("2026-08-24T11:06:00.000Z"),
  );
  await assertPending(reclaim, "reclaim waits for claimed-object transaction");
  reclaimRelease.resolve();
  assert(
    await heldForReclaim === "skipped" &&
      (await reclaim)?.claimToken === "race-b",
    "reclaim follows committed claimed-object transaction",
  );
  let staleEffects = 0;
  assert(
    await davRepository.withClaimedObject(
          {
            ...actor,
            claimToken: "race-a",
            subscriptionId: raceId,
          },
          "/race.vcf",
          () => {
            staleEffects++;
            return Promise.resolve(undefined);
          },
        ) === "claim-lost" && staleEffects === 0,
    "reclaimed callback is fenced before any core effect",
  );

  const revokeEntered = deferred();
  const revokeRelease = deferred();
  const heldForRevoke = davRepository.withClaimedObject(
    {
      ...actor,
      claimToken: "race-b",
      subscriptionId: raceId,
    },
    "/race.vcf",
    async () => {
      revokeEntered.resolve();
      await revokeRelease.promise;
      return undefined;
    },
  );
  await revokeEntered.promise;
  const revoke =
    sql`update crm.workspace_members set role='member' where id=${actor.memberId}::uuid`;
  await assertPending(
    revoke,
    "role revoke waits for claimed-object transaction",
  );
  revokeRelease.resolve();
  assert(await heldForRevoke === "skipped", "active callback commits first");
  await revoke;
  let revokedEffects = 0;
  assert(
    await davRepository.withClaimedObject(
          {
            ...actor,
            claimToken: "race-b",
            subscriptionId: raceId,
          },
          "/race.vcf",
          () => {
            revokedEffects++;
            return Promise.resolve(undefined);
          },
        ) === "claim-lost" && revokedEffects === 0,
    "revoked member callback is fenced before any core effect",
  );
  await sql`update crm.workspace_members set role='owner' where id=${actor.memberId}::uuid`;

  const raceC = await davRepository.claim(
    actor,
    raceId,
    "race-c",
    new Date("2026-08-24T11:12:00.000Z"),
  );
  assert(raceC, "restored owner reclaims locking fixture");
  const disableEntered = deferred();
  const disableRelease = deferred();
  const heldForDisable = davRepository.withClaimedObject(
    {
      ...actor,
      claimToken: "race-c",
      subscriptionId: raceId,
    },
    "/race.vcf",
    async () => {
      disableEntered.resolve();
      await disableRelease.promise;
      return undefined;
    },
  );
  await disableEntered.promise;
  const disable = davRepository.disable(actor, raceId, new Date());
  await assertPending(disable, "disable waits for claimed-object transaction");
  disableRelease.resolve();
  assert(
    await heldForDisable === "skipped" && (await disable)?.isActive === false,
    "disable follows committed claimed-object transaction",
  );
  const [stored] = await sql<{ encrypted_password: string }[]>`
    select encrypted_password from crm.dav_address_book_subscriptions
    where id=${subscriptionId}::uuid
  `;
  assert(
    stored && !stored.encrypted_password.includes("remote-secret"),
    "credential encrypted at rest",
  );
  assert(
    !(
      await (await request(foreign, "/api/v1/settings/integrations/dav")).text()
    ).includes("Personal DAV"),
    "foreign workspace cannot list subscription",
  );

  remote.mode = "partial";
  const partial = await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  const partialBody = await partial.text();
  assert(
    partial.status === 200 &&
      partialBody.includes('"status":"partial"'),
    `partial result visible (${partial.status}: ${partialBody})`,
  );
  const [beforeRetry] = await sql<{ remote_sync_token: string | null }[]>`
    select remote_sync_token from crm.dav_address_book_subscriptions where id=${subscriptionId}::uuid
  `;
  assert(
    beforeRetry?.remote_sync_token === null,
    "partial pass does not advance token",
  );

  await sql`update crm.dav_address_book_subscriptions
    set capabilities=capabilities || jsonb_build_object(
      'syncClaimedAt', (now()-interval '6 minutes')::text)
    where id=${subscriptionId}::uuid`;
  await configured.close();
  configured = createConfiguredApiApp(
    databaseUrl,
    mail,
    browserSecurityPolicy("test", "http://localhost"),
    undefined,
    undefined,
    undefined,
    undefined,
    remote,
    keyset,
  );
  remote.mode = "good";
  const retried = await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  assert(
    retried.status === 200 &&
      (await retried.text()).includes('"status":"success"'),
    "restart reclaims stale sync and succeeds",
  );

  const [linkedBeforeCrash] = await sql<{ person_id: string }[]>`
    select person_id::text from crm.dav_objects where subscription_id=${subscriptionId}::uuid
      and object_kind='person' and href='/ada.vcf'
  `;
  assert(linkedBeforeCrash, "DAV person checkpoint exists");
  const atomicClaim = await davRepository.claim(
    actor,
    subscriptionId,
    "atomic-claim",
    new Date(),
  );
  assert(atomicClaim, "atomic rollback fixture claimed");
  let checkpointFailed = false;
  try {
    await davRepository.withClaimedObject(
      {
        ...actor,
        claimToken: "atomic-claim",
        subscriptionId,
      },
      "/atomic-fail.vcf",
      async (_existing, transaction) => {
        await kyselySql`update crm.people set family_name='MUST ROLLBACK'
        where id=${linkedBeforeCrash.person_id}::uuid`.execute(
          databaseFromSession(transaction),
        );
        return {
          coreId: crypto.randomUUID(),
          etag: '"atomic-fail"',
          href: "/atomic-fail.vcf",
          kind: "person",
          payload: "",
          status: "synced",
          uid: "atomic-fail",
        };
      },
    );
  } catch {
    checkpointFailed = true;
  }
  const [atomicRollback] = await sql<
    { family_name: string; objects: number }[]
  >`
    select family_name,
      (select count(*)::int from crm.dav_objects where subscription_id=${subscriptionId}::uuid
        and href='/atomic-fail.vcf') objects
    from crm.people where id=${linkedBeforeCrash.person_id}::uuid
  `;
  assert(
    checkpointFailed && atomicRollback?.family_name === "Lovelace" &&
      atomicRollback.objects === 0,
    "checkpoint failure rolls back the core mutation in the same transaction",
  );
  assert(
    await davRepository.recordOutcome({
      ...actor,
      claimToken: "atomic-claim",
      subscriptionId,
    }, {
      error: "dav_sync_failed",
      occurredAt: new Date(),
      status: "partial",
    }),
    "atomic rollback claim released",
  );
  await sql`delete from crm.dav_objects where subscription_id=${subscriptionId}::uuid and object_kind='person'`;
  await sql`update crm.dav_address_book_subscriptions set remote_sync_token=null where id=${subscriptionId}::uuid`;
  const recovered = await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  assert(
    recovered.status === 200 &&
      (await recovered.text()).includes('"status":"success"'),
    "retry after core-create/checkpoint gap succeeds",
  );
  const [linkedAfterCrash] = await sql<{ person_id: string; people: number }[]>`
    select object.person_id::text person_id,
      (select count(*)::int from crm.people where workspace_id=${primary.workspaceId}::uuid and deleted_at is null) people
    from crm.dav_objects object where object.subscription_id=${subscriptionId}::uuid and object.object_kind='person'
  `;
  assert(
    linkedAfterCrash?.person_id === linkedBeforeCrash.person_id &&
      linkedAfterCrash.people === 1,
    "recovery relinks the exact deterministic person without duplicate guessing",
  );

  remote.mode = "updated";
  await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  const [updated] = await sql<{ family_name: string; title: string }[]>`
    select person.family_name,
      (select task.title from crm.tasks task join crm.dav_objects object on object.task_id=task.id
        where object.subscription_id=${subscriptionId}::uuid and object.object_kind='task') title
    from crm.people person where person.id=${linkedBeforeCrash.person_id}::uuid
  `;
  assert(
    updated?.family_name === "Byron" && updated.title === "Write updated notes",
    "changed ETags update owning core records",
  );

  remote.mode = "conflict";
  const conflicted = await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  const conflictText = await conflicted.text();
  assert(
    conflictText.includes('"status":"conflict"') &&
      !conflictText.includes("raw provider detail"),
    "conflict exposes stable public state only",
  );
  const [cleared] = await sql<
    { remote_sync_token: string | null }[]
  >`select remote_sync_token from crm.dav_address_book_subscriptions where id=${subscriptionId}::uuid`;
  assert(
    cleared?.remote_sync_token === null,
    "409/412 invalidates remote token for full retry",
  );

  remote.mode = "good";
  await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  assert(
    remote.pulls.at(-1) === undefined,
    "conflict retry performs full resync",
  );

  remote.mode = "delete";
  await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  const [deleted] = await sql<
    { archived: boolean; completed: boolean; tombstones: number }[]
  >`
    select person.archived_at is not null archived,
      (select task.status='completed' from crm.tasks task join crm.dav_objects object on object.task_id=task.id
        where object.subscription_id=${subscriptionId}::uuid and object.object_kind='task') completed,
      (select count(*)::int from crm.dav_objects where subscription_id=${subscriptionId}::uuid and sync_status='deleted') tombstones
    from crm.people person where person.id=${linkedBeforeCrash.person_id}::uuid
  `;
  assert(
    deleted?.archived && deleted.completed && deleted.tombstones === 2,
    "tombstones conservatively archive person and complete task",
  );
  remote.mode = "updated";
  await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  const [reappeared] = await sql<
    { active: boolean; open: boolean; title: string }[]
  >`
    select person.archived_at is null active,
      (select task.status='open' from crm.tasks task join crm.dav_objects object on object.task_id=task.id
        where object.subscription_id=${subscriptionId}::uuid and object.object_kind='task') open,
      (select task.title from crm.tasks task join crm.dav_objects object on object.task_id=task.id
        where object.subscription_id=${subscriptionId}::uuid and object.object_kind='task') title
    from crm.people person where person.id=${linkedBeforeCrash.person_id}::uuid
  `;
  assert(
    reappeared?.active && reappeared.open &&
      reappeared.title === "Write updated notes",
    "a DAV object reappearing after tombstone restores core before update",
  );
  const [durable] = await sql<
    { objects: number; people: number; tasks: number; token: string }[]
  >`
    select
      (select count(*)::int from crm.dav_objects where subscription_id=${subscriptionId}::uuid) objects,
      (select count(*)::int from crm.people where workspace_id=${primary.workspaceId}::uuid and deleted_at is null) people,
      (select count(*)::int from crm.tasks where workspace_id=${primary.workspaceId}::uuid and deleted_at is null) tasks,
      remote_sync_token token
    from crm.dav_address_book_subscriptions where id=${subscriptionId}::uuid
  `;
  assert(
    durable?.objects === 2 && durable.people === 1 && durable.tasks === 1 &&
      durable.token === "token-2",
    "core facades and DAV checkpoints committed",
  );

  remote.mode = "auth";
  const auth = await request(
    primary,
    `/api/v1/settings/integrations/dav/${subscriptionId}/sync`,
    "POST",
  );
  assert(
    auth.status === 200 &&
      (await auth.text()).includes('"status":"auth-failure"'),
    "auth failure visible and retryable",
  );
  assert(
    (await request(
      primary,
      `/api/v1/settings/integrations/dav/${subscriptionId}`,
      "DELETE",
    )).status === 200,
    "integration disabled",
  );
  const [audits] = await sql<
    {
      configure: number;
      conflict: number;
      disable: number;
      partial: number;
      success: number;
    }[]
  >`
    select
      count(*) filter(where action='integrations.dav-configure' and payload->>'outcome'='success')::int configure,
      count(*) filter(where action='integrations.dav-sync' and payload->>'outcome'='conflict')::int conflict,
      count(*) filter(where action='integrations.dav-disable' and payload->>'outcome'='success')::int disable,
      count(*) filter(where action='integrations.dav-sync' and payload->>'outcome'='partial')::int partial,
      count(*) filter(where action='integrations.dav-sync' and payload->>'outcome'='success')::int success
    from crm.audit_events where workspace_id=${primary.workspaceId}::uuid and subject_id=${subscriptionId}::uuid
  `;
  assert(
    audits && audits.configure >= 1 && audits.conflict >= 1 &&
      audits.disable >= 1 &&
      audits.partial >= 1 && audits.success >= 1,
    "configure/sync/conflict/partial/disable audits are durable",
  );
  const [core] = await sql<{ people: number; tasks: number }[]>`
    select
      (select count(*)::int from crm.people where workspace_id=${primary.workspaceId}::uuid and deleted_at is null) people,
      (select count(*)::int from crm.tasks where workspace_id=${primary.workspaceId}::uuid and deleted_at is null) tasks
  `;
  assert(
    core?.people === 1 && core.tasks === 1,
    "disable preserves core CRM data",
  );

  const disabledModule = createConfiguredApiApp(
    databaseUrl,
    mail,
    browserSecurityPolicy("test", "http://localhost"),
    undefined,
    undefined,
    undefined,
    undefined,
    remote,
    keyset,
    false,
  );
  assert(
    (await disabledModule.app.request("http://localhost/api/v1/people", {
      headers: {
        cookie: primary.cookie,
        "X-Workspace-Id": primary.workspaceId,
      },
    })).status === 200,
    "core people operate when DAV module is absent",
  );
  assert(
    (await disabledModule.app.request(
      "http://localhost/api/v1/settings/integrations/dav",
      {
        headers: {
          cookie: primary.cookie,
          "X-Workspace-Id": primary.workspaceId,
        },
      },
    )).status === 404,
    "disabled DAV module exposes no management route",
  );
  await disabledModule.close();
  await boundary.destroy();
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
    "[INTEGRATION-001] GAP-009 a revoked member cannot configure a DAV subscription",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        `dav-revocation-${crypto.randomUUID()}`,
      );
      const repository = new PostgresDavRepository(
        connection.db,
        davAuditFrom(new PostgresAuditEventRecorder()),
        new PostgresActorRevalidation(),
      );
      assert(
        await repository.authorize(actor),
        "an active owner is authorized for DAV",
      );

      await revokeMembership(actor.memberId);

      assert(
        !await repository.authorize(actor),
        "a revoked member kept DAV authority",
      );
      const created = await repository.create({
        ...actor,
        encryptedPassword: "encrypted",
        id: crypto.randomUUID(),
        name: "Refused book",
        occurredAt: new Date(),
        remoteUrl: "https://dav.example.test/books/refused",
        username: "revoked",
      });
      assert(created === undefined, "a revoked member created a subscription");
      const [remaining] = await sql<[{ readonly count: number }]>`
        select count(*)::int as count
        from crm.dav_address_book_subscriptions
        where workspace_id = ${actor.workspaceId}
      `;
      assert(remaining?.count === 0, "a revoked member wrote a DAV row");
    } finally {
      await connection.destroy();
    }
  },
});
Deno.test({
  name: "close DAV PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await configured.close();
    await sql.end();
  },
});
