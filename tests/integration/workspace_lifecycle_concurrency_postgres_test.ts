/**
 * A workspace reset or delete running beside other work in the same
 * workspace (MCP-F3).
 *
 * A reset or delete holds the workspace for its whole transaction and then
 * deletes every row of it. Anything that holds a row of the workspace and then
 * waits for one the reset holds would deadlock against it. Each test forces
 * the losing interleaving: a third session holds the person the reset is about
 * to erase, so the reset stops there with its locks taken; the other side is
 * started only once the reset is provably waiting, and is itself let in only
 * once it is provably waiting behind the reset. Then the third session lets
 * go, and both must answer without PostgreSQL reporting a deadlock.
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
  PASSWORD,
  sessionCookie,
  type SignedInFixture,
} from "../support/api.ts";
import { createPerson, submitPerson } from "../support/fixtures.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 4, prepare: false });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);

type Action = "delete" | "reset";

async function deadlocks(): Promise<number> {
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

/**
 * A third session holding `personId` the way a reader would, which stops a
 * reset or delete at the statement that erases the workspace's people.
 */
async function holdPerson(personId: string): Promise<{
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
    await transaction`
      select id from crm.people where id = ${personId}::uuid for key share
    `;
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

/** A second member of `owner`'s workspace, signed in there. */
async function colleague(
  owner: SignedInFixture,
  name: string,
  role: "admin" | "member",
): Promise<SignedInFixture> {
  const email = `${name}-${crypto.randomUUID()}@example.test`;
  const own = await api.register(email, `${name} home`);
  await addMembership(sql, own.userId, owner.workspaceId, role);
  return await signInTo(email, own.userId, owner.workspaceId);
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
 * delete is stopped with its locks taken, `other` starts and is seen waiting
 * behind it, and only then is the reset let go. Both settle before it returns.
 */
async function interleave(
  owner: SignedInFixture,
  personId: string,
  action: Action,
  other: () => Promise<unknown>,
): Promise<{
  readonly deadlocks: number;
  readonly lifecycle: { readonly body: string; readonly status: number };
  readonly other: string;
}> {
  const before = await deadlocks();
  const holder = await holdPerson(personId);
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
    assert(destroyed.status === "fulfilled", `${action} request failed`);
    return {
      deadlocks: await deadlocks() - before,
      lifecycle: {
        body: await destroyed.value.text(),
        status: destroyed.value.status,
      },
      other: await answered(settled),
    };
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

/** One tick of a freshly configured worker, whose first tick replenishes. */
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
      const result = await interleave(owner, personId, action, workerTick);
      assert(
        result.deadlocks === 0 && result.lifecycle.status === 200 &&
          result.other === "fulfilled",
        `${action} beside a top-up: ${result.deadlocks} deadlock(s), ${action} ${result.lifecycle.status} ${result.lifecycle.body}, tick ${result.other}`,
      );
    },
  });
}

Deno.test({
  name:
    "[MCP-F3] a workspace reset and another member's write in it cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await api.register(
      `reset-owner-${crypto.randomUUID()}@example.test`,
      "Reset beside a colleague",
    );
    const personId = await createPerson(api, owner, "Erased by the reset");
    const admin = await colleague(owner, "reset-colleague", "admin");
    const result = await interleave(
      owner,
      personId,
      "reset",
      () => submitPerson(api, admin, "Added meanwhile"),
    );
    const other = result.other;
    assert(
      result.deadlocks === 0 && result.lifecycle.status === 200 &&
        !/^5/.test(other),
      `reset beside a colleague's write: ${result.deadlocks} deadlock(s), reset ${result.lifecycle.status} ${result.lifecycle.body}, write ${other}`,
    );
  },
});

Deno.test({
  name:
    "[MCP-F3] a workspace reset and an admin's member change in it cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await api.register(
      `reset-roles-${crypto.randomUUID()}@example.test`,
      "Reset beside a role change",
    );
    const personId = await createPerson(api, owner, "Erased by the reset");
    const admin = await colleague(owner, "reset-admin", "admin");
    const member = await colleague(owner, "reset-member", "member");
    const result = await interleave(
      owner,
      personId,
      "reset",
      () =>
        api.request(
          admin,
          `/api/v1/settings/members/${member.memberId}`,
          "PATCH",
          { role: "admin", status: "active" },
        ),
    );
    const other = result.other;
    assert(
      result.deadlocks === 0 && result.lifecycle.status === 200 &&
        !/^5/.test(other),
      `reset beside a member change: ${result.deadlocks} deadlock(s), reset ${result.lifecycle.status} ${result.lifecycle.body}, change ${other}`,
    );
  },
});

Deno.test({
  name:
    "[MCP-F3] a workspace reset and the same owner's write in a second request cannot deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await api.register(
      `reset-twice-${crypto.randomUUID()}@example.test`,
      "Reset beside its owner",
    );
    const personId = await createPerson(api, owner, "Erased by the reset");
    const result = await interleave(
      owner,
      personId,
      "reset",
      () => submitPerson(api, owner, "Added meanwhile"),
    );
    const other = result.other;
    assert(
      result.deadlocks === 0 && result.lifecycle.status === 200 &&
        !/^5/.test(other),
      `reset beside its owner's write: ${result.deadlocks} deadlock(s), reset ${result.lifecycle.status} ${result.lifecycle.body}, write ${other}`,
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
