/**
 * A workspace reset or delete running beside other work in the same
 * workspace (MCP-F3).
 *
 * A reset or delete holds the workspace for its whole transaction and then
 * deletes every row of it. Anything that holds a row of the workspace and then
 * waits for one the reset holds would deadlock against it. Each test forces
 * the losing interleaving: a third session holds a row the reset is about to
 * lock or erase, so the reset stops there with its earlier locks taken; the
 * other side is started only once the reset is provably waiting, and is itself
 * let in only once it is provably waiting behind the reset. Then the third
 * session lets go, and both must answer.
 *
 * A deadlock aborts one of the two waiting sides, so both answers are checked
 * first. PostgreSQL's deadlock count is the second witness. A backend keeps
 * the deadlock it detected in its own pending statistics for up to ten
 * seconds, and flushes them as it exits, before it leaves `pg_stat_activity`.
 * The count is therefore read only once every API and worker backend has
 * exited: the third session and this file's own connections never wait for a
 * lock, so they can be in no cycle, and every deadlock is counted by then.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { createConfiguredReminderWorker } from "../../apps/worker/composition.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { recordingLogger } from "../../packages/backend/testing/fakes.ts";
import {
  addMembership,
  openSql,
  requireDatabaseUrl,
  requireWorkerDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import {
  apiSupport,
  originHeaders,
  PASSWORD,
  sessionCookie,
  type SignedInFixture,
} from "../support/api.ts";
import { createPerson, submitPerson } from "../support/fixtures.ts";
import {
  AesGcmMfaSecretBox,
  generateTotp,
} from "../../packages/backend/modules/identity/adapters/crypto/totp.ts";
import { WebCryptoRandomSource } from "../../packages/backend/modules/identity/adapters/crypto/secure_tokens.ts";
import type postgres from "postgres";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 4, prepare: false });
const mail = new CapturedVerificationMail();
const mfaKeyset = {
  activeKeyId: "test",
  keys: new Map([["test", new Uint8Array(32).fill(0x4b)]]),
};
const MFA_SECRET = "JBSWY3DPEHPK3PXP";
const configure = () =>
  createConfiguredApiApp(
    databaseUrl,
    mail,
    browserSecurityPolicy("test", "http://localhost"),
    mfaKeyset,
  );
let configured = configure();
let api = apiSupport(configured.app, mail, sql);

type Action = "delete" | "reset";

/**
 * PostgreSQL's deadlock count once every backend the API and the worker
 * opened has exited, so each has flushed what it counted. The API is closed
 * for that and composed again before this returns.
 */
async function settledDeadlocks(): Promise<number> {
  await configured.close();
  for (let attempt = 0;; attempt++) {
    const [open] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from pg_stat_activity
      where datname = current_database() and backend_type = 'client backend'
        and usename <> current_user
    `;
    if (open!.count === 0) break;
    if (attempt === 500) {
      throw new Error(`${open!.count} API or worker backend(s) did not exit`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  configured = configure();
  api = apiSupport(configured.app, mail, sql);
  const [row] = await sql<{ readonly count: number }[]>`
    select deadlocks::int as count from pg_stat_database
    where datname = current_database()
  `;
  return row!.count;
}

/** The backend that waits behind `blocker`, once one does. */
async function waitingBehind(
  blocker: number,
  except: readonly number[] = [],
): Promise<number> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const [row] = await sql<{ readonly pid: number }[]>`
      select pid from pg_stat_activity
      where ${blocker}::int = any(pg_blocking_pids(pid))
        and not (pid = any(${[...except]}::int[]))
      order by pid limit 1
    `;
    if (row) return row.pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no session waited behind backend ${blocker}`);
}

/** A row a third session holds, which the reset or delete must wait for. */
type Holding = (transaction: postgres.TransactionSql) => Promise<unknown>;

/** A person, which stops a reset or delete where it erases the people. */
const person = (personId: string): Holding => (transaction) =>
  transaction`
    select id from crm.people where id = ${personId}::uuid for key share
  `;

/**
 * The workspace row, which stops a reset or delete after it has locked every
 * member row and before it holds the workspace row.
 */
const workspace = (workspaceId: string): Holding => (transaction) =>
  transaction`
    select id from crm.workspaces where id = ${workspaceId}::uuid
    for key share
  `;

/**
 * The workspace's settings, which stop a reset after it has revoked its sole
 * members' sessions and before it re-inserts the member rows.
 */
const settings = (workspaceId: string): Holding => (transaction) =>
  transaction`
    select workspace_id from crm.workspace_settings
    where workspace_id = ${workspaceId}::uuid for key share
  `;

/** A third session holding a row until it is released. */
async function hold(lock: Holding): Promise<{
  readonly done: Promise<void>;
  readonly pid: number;
  readonly release: () => void;
  readonly end: () => Promise<void>;
}> {
  const holder = openSql(databaseUrl, { max: 1 });
  let release!: () => void;
  const released = new Promise<void>((resolve) => release = resolve);
  let holding!: (pid: number) => void;
  const held = new Promise<number>((resolve) => holding = resolve);
  const done = holder.begin(async (transaction) => {
    const [backend] = await transaction<{ readonly pid: number }[]>`
      select pg_backend_pid() as pid
    `;
    await lock(transaction);
    holding(backend!.pid);
    await released;
  }).then(() => undefined);
  const pid = await Promise.race([
    held,
    done.then((): never => {
      throw new Error("the holding session ended before it held the row");
    }),
  ]);
  return {
    done,
    end: async () => {
      release();
      await done.catch(() => undefined);
      await holder.end();
    },
    pid,
    release,
  };
}

async function lifecycle(
  owner: SignedInFixture,
  action: Action,
): Promise<Response> {
  const preview = await api.request(
    owner,
    "/api/v1/settings/workspace-lifecycle",
  );
  assert(preview.status === 200, `preview answered ${preview.status}`);
  const shown = await preview.json() as {
    readonly confirmations: {
      readonly deleteWorkspace: string;
      readonly resetWorkspace: string;
    };
    readonly impactToken: string;
  };
  return action === "reset"
    ? api.request(
      owner,
      "/api/v1/settings/workspace-lifecycle/reset",
      "POST",
      {
        confirmation: shown.confirmations.resetWorkspace,
        impactToken: shown.impactToken,
        password: PASSWORD,
      },
    )
    : api.request(owner, "/api/v1/settings/workspace-lifecycle", "DELETE", {
      confirmation: shown.confirmations.deleteWorkspace,
      impactToken: shown.impactToken,
      password: PASSWORD,
    });
}

/** Signs `email` in to `workspaceId`, a workspace it was added to. */
async function signInTo(
  email: string,
  userId: string,
  workspaceId: string,
): Promise<SignedInFixture> {
  const signed = await api.signIn(email, { workspaceId });
  const cookie = sessionCookie(signed);
  assert(signed.status === 200 && cookie, `${email} signs in`);
  const body = await signed.json() as {
    readonly member: {
      readonly id: string;
      readonly role: SignedInFixture["role"];
    };
  };
  return {
    cookie,
    memberId: body.member.id,
    role: body.member.role,
    userId,
    workspaceId,
  };
}

/**
 * A second member of `owner`'s workspace, signed in there. With `homeless`,
 * the workspace they registered is gone, so theirs is the only membership.
 */
async function colleague(
  owner: SignedInFixture,
  name: string,
  role: "admin" | "member" | "owner",
  options: { readonly homeless?: boolean } = {},
): Promise<SignedInFixture & { readonly email: string }> {
  const email = `${name}-${crypto.randomUUID()}@example.test`;
  const own = await api.register(email, `${name} home`);
  await addMembership(sql, own.userId, owner.workspaceId, role);
  if (options.homeless) {
    await sql`delete from crm.workspaces where id = ${own.workspaceId}::uuid`;
  }
  return {
    ...await signInTo(email, own.userId, owner.workspaceId),
    email,
  };
}

/** What a request or worker tick answered, read before it is let go. */
async function answered(
  settled: PromiseSettledResult<unknown>,
): Promise<string> {
  if (settled.status === "rejected") return `rejected: ${settled.reason}`;
  return settled.value instanceof Response
    ? `${settled.value.status} ${await settled.value.text()}`
    : "fulfilled";
}

/**
 * Runs `action` against the losing interleaving with `other`: the reset or
 * delete is stopped at `holding` with its earlier locks taken, `other` starts
 * and is seen waiting behind it, and only then is the reset let go. Both
 * settle before it returns.
 */
async function interleave(
  owner: SignedInFixture,
  holding: Holding,
  action: Action,
  other: () => Promise<unknown>,
): Promise<{
  readonly deadlocks: number;
  readonly lifecycle: { readonly body: string; readonly status: number };
  readonly other: string;
}> {
  const before = await settledDeadlocks();
  const holder = await hold(holding);
  const started: Promise<unknown>[] = [];
  try {
    const destroying = lifecycle(owner, action);
    started.push(destroying);
    const destroyerPid = await waitingBehind(holder.pid);
    const running = other();
    started.push(running);
    await waitingBehind(destroyerPid, [holder.pid]);
    holder.release();
    await holder.done;
    const [destroyed, settled] = await Promise.allSettled([
      destroying,
      running,
    ]);
    const outcome = {
      lifecycle: destroyed.status === "fulfilled"
        ? {
          body: await destroyed.value.text(),
          status: destroyed.value.status,
        }
        : { body: `rejected: ${destroyed.reason}`, status: 0 },
      other: await answered(settled),
    };
    return { ...outcome, deadlocks: await settledDeadlocks() - before };
  } finally {
    await holder.end();
    for (const settled of await Promise.allSettled(started)) {
      if (
        settled.status === "fulfilled" && settled.value instanceof Response &&
        !settled.value.bodyUsed
      ) {
        await settled.value.body?.cancel();
      }
    }
  }
}

/** Neither side failed and PostgreSQL counted no deadlock. */
function assertNoDeadlock(
  description: string,
  result: Awaited<ReturnType<typeof interleave>>,
  lifecycleStatus = 200,
): void {
  assert(
    result.deadlocks === 0 && result.lifecycle.status === lifecycleStatus &&
      !/^(5|rejected)/.test(result.other),
    `${description}: ${result.deadlocks} deadlock(s), lifecycle ${result.lifecycle.status} ${result.lifecycle.body}, other ${result.other}`,
  );
}

/**
 * An owner with a daily reminder whose rolling window has fallen short, so a
 * worker's first tick tops it up in the owner's workspace.
 */
async function ownerWithShortWindow(
  name: string,
): Promise<{ readonly owner: SignedInFixture; readonly personId: string }> {
  await resetDatabase(sql);
  const owner = await api.register(
    `${name}-${crypto.randomUUID()}@example.test`,
    `${name} circle`,
  );
  const personId = await createPerson(api, owner, "Reminded daily");
  const anchor = Temporal.Now.instant().toZonedDateTimeISO("UTC")
    .toPlainDate().add({ days: 2 }).toString();
  const created = await api.request(owner, "/api/v1/reminders", "POST", {
    anchorOn: anchor,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Daily check-in",
  });
  assert(created.status === 201, `reminder created: ${created.status}`);
  const removed = await sql`
    delete from crm.reminder_occurrences
    where member_id = ${owner.memberId}::uuid and occurs_on > ${anchor}::date
  `;
  assert(removed.count > 0, "the window is left short");
  return { owner, personId };
}

/**
 * One tick of a freshly configured worker, whose first tick replenishes. A
 * top-up runs inside `replenish`, which catches nothing, and the tick awaits
 * it, so a top-up that fails rejects the tick.
 */
async function workerTick(): Promise<void> {
  const worker = createConfiguredReminderWorker(
    requireWorkerDatabaseUrl(),
    recordingLogger(),
    { get: (name) => name === "APP_ENV" ? "test" : undefined },
  );
  try {
    await worker.worker.tick({ owner: "mcp-f3" });
  } finally {
    await worker.close();
  }
}

/** An owner, with a person a reset or delete erases. */
async function ownerWithPerson(
  name: string,
): Promise<{ readonly owner: SignedInFixture; readonly personId: string }> {
  await resetDatabase(sql);
  const owner = await api.register(
    `${name}-${crypto.randomUUID()}@example.test`,
    `${name} circle`,
  );
  return {
    owner,
    personId: await createPerson(api, owner, "Erased by the reset"),
  };
}

for (const action of ["reset", "delete"] as const) {
  Deno.test({
    name:
      `[MCP-F3] a workspace ${action} and the worker's reminder top-up cannot deadlock`,
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const { owner, personId } = await ownerWithShortWindow(
        `${action}-top-up`,
      );
      const result = await interleave(
        owner,
        person(personId),
        action,
        workerTick,
      );
      assertNoDeadlock(`${action} beside a top-up`, result);
      assert(result.other === "fulfilled", `tick ${result.other}`);
    },
  });

  Deno.test({
    name:
      `[MCP-F3] a workspace ${action} and an invitation acceptance in it cannot deadlock`,
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const { owner } = await ownerWithPerson(`${action}-invitation`);
      // Only an address verified for a day may invite (SECA-03).
      await sql`
        update crm.users set email_verified_at = now() - interval '25 hours'
        where id = ${owner.userId}::uuid
      `;
      const inviteeEmail =
        `${action}-invitee-${crypto.randomUUID()}@example.test`;
      const invitee = await api.register(inviteeEmail, "Invitee home");
      const invited = await api.request(
        owner,
        "/api/v1/workspace-invitations",
        "POST",
        { email: inviteeEmail, role: "member" },
      );
      assert(invited.status === 201, `invitation sent: ${invited.status}`);
      const token = mail.latestInvitationToken(inviteeEmail);
      assert(token, "the invitation token is delivered");
      const result = await interleave(
        owner,
        workspace(owner.workspaceId),
        action,
        async () =>
          await configured.app.request(
            "http://localhost/api/v1/workspace-invitations/accept",
            {
              method: "POST",
              headers: { ...originHeaders, cookie: invitee.cookie },
              body: JSON.stringify({ token }),
            },
          ),
      );
      assertNoDeadlock(`${action} beside an invitation acceptance`, result);
    },
  });
}

Deno.test({
  name:
    "[MCP-F3] a workspace reset and another member's write in it cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner, personId } = await ownerWithPerson("reset-owner");
    const admin = await colleague(owner, "reset-colleague", "admin");
    const result = await interleave(
      owner,
      person(personId),
      "reset",
      () => submitPerson(api, admin, "Added meanwhile"),
    );
    assertNoDeadlock("reset beside a colleague's write", result);
  },
});

Deno.test({
  name:
    "[MCP-F3] a workspace reset and an admin's member change in it cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner, personId } = await ownerWithPerson("reset-roles");
    const admin = await colleague(owner, "reset-admin", "admin");
    const member = await colleague(owner, "reset-member", "member");
    const result = await interleave(
      owner,
      person(personId),
      "reset",
      () =>
        api.request(
          admin,
          `/api/v1/settings/members/${member.memberId}`,
          "PATCH",
          { role: "admin", status: "active" },
        ),
    );
    assertNoDeadlock("reset beside a member change", result);
  },
});

Deno.test({
  name:
    "[MCP-F3] a workspace reset and the same owner's write in a second request cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner, personId } = await ownerWithPerson("reset-twice");
    const result = await interleave(
      owner,
      person(personId),
      "reset",
      () => submitPerson(api, owner, "Added meanwhile"),
    );
    assertNoDeadlock("reset beside its owner's write", result);
  },
});

Deno.test({
  name: "[MCP-F3] two owners resetting one workspace at once cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner, personId } = await ownerWithPerson("reset-first-owner");
    const second = await colleague(owner, "reset-second-owner", "owner");
    const result = await interleave(
      owner,
      person(personId),
      "reset",
      () => lifecycle(second, "reset"),
    );
    assertNoDeadlock("two owners resetting", result);
    assert(
      result.other.startsWith("409 "),
      `the second reset finds the workspace changed: ${result.other}`,
    );
  },
});

for (const step of ["leave", "delete"] as const) {
  Deno.test({
    name: `[MCP-F3] a workspace reset and a member's ${
      step === "leave" ? "leaving" : "account deletion"
    } cannot deadlock`,
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const { owner, personId } = await ownerWithPerson(`reset-${step}`);
      const member = await colleague(owner, `reset-${step}-member`, "member", {
        homeless: true,
      });
      const result = await interleave(
        owner,
        person(personId),
        "reset",
        () =>
          step === "leave"
            ? api.request(
              member,
              "/api/v1/settings/personal-lifecycle/leave",
              "POST",
              {
                confirmation: "LEAVE reset-leave circle",
                password: PASSWORD,
              },
            )
            : api.request(
              member,
              "/api/v1/settings/personal-lifecycle",
              "DELETE",
              { confirmation: `DELETE ${member.email}`, password: PASSWORD },
            ),
      );
      assertNoDeadlock(`reset beside a member's ${step}`, result);
      assert(
        result.other.startsWith("200 "),
        `the member's ${step} completes after the reset: ${result.other}`,
      );
    },
  });
}

Deno.test({
  name:
    "[MCP-F3] a workspace reset and a member's password reset cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner } = await ownerWithPerson("reset-recovery");
    const member = await colleague(owner, "reset-recovery-member", "member", {
      homeless: true,
    });
    const requested = await api.request(
      member,
      "/api/v1/password-reset-requests",
      "POST",
      { email: member.email },
    );
    assert(requested.status === 202, `reset requested: ${requested.status}`);
    const token = mail.latestPasswordResetToken(member.email);
    assert(token, "the password reset token is delivered");
    const result = await interleave(
      owner,
      settings(owner.workspaceId),
      "reset",
      async () =>
        await configured.app.request(
          "http://localhost/api/v1/password-resets",
          {
            method: "POST",
            headers: originHeaders,
            body: JSON.stringify({
              password: "another correct horse battery staple",
              token,
            }),
          },
        ),
    );
    assertNoDeadlock("reset beside a password reset", result);
    assert(
      result.other.startsWith("200 "),
      `the password reset completes after the workspace reset: ${result.other}`,
    );
  },
});

Deno.test({
  name:
    "[MCP-F3] a workspace reset and a member's second sign-in factor cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner } = await ownerWithPerson("reset-factor");
    const member = await colleague(owner, "reset-factor-member", "member", {
      homeless: true,
    });
    const box = new AesGcmMfaSecretBox(mfaKeyset, new WebCryptoRandomSource());
    await sql`
      insert into crm.user_mfa_totp (
        user_id, encrypted_secret, confirmed_at, created_at, updated_at
      ) values (
        ${member.userId}::uuid, ${await box.encrypt(
      MFA_SECRET,
      member.userId,
    )},
        now(), now(), now()
      )
    `;
    const signed = await api.signIn(member.email);
    const challenge = signed.headers.get("set-cookie")?.match(
      /kinship_mfa=([^;,]+)/,
    )?.[1];
    assert(signed.status === 202 && challenge, "the password step challenges");
    const code = await generateTotp(MFA_SECRET, new Date());
    assert(code, "a current code");
    const result = await interleave(
      owner,
      settings(owner.workspaceId),
      "reset",
      async () =>
        await configured.app.request(
          "http://localhost/api/v1/mfa-challenges",
          {
            method: "POST",
            headers: { ...originHeaders, cookie: `kinship_mfa=${challenge}` },
            body: JSON.stringify({ factor: code }),
          },
        ),
    );
    assertNoDeadlock("reset beside a second factor", result);
    assert(
      result.other.startsWith("410 "),
      `the reset revoked the challenge it waited for: ${result.other}`,
    );
  },
});

Deno.test({
  name: "[MCP-F3] workspace lifecycle concurrency resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    await Promise.all([sql.end(), configured.close()]);
  },
});
