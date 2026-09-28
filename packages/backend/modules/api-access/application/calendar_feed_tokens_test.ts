import {
  CALENDAR_FEED_SCOPE,
  type CalendarFeedRecord,
  type CalendarFeedTokenDependencies,
  createCalendarFeedTokens,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import { fixedClock, recordingAudit } from "../../../testing/fakes.ts";
import type { ApiTokenRecord } from "../domain/token_rules.ts";

const member = {
  memberId: "20000000-0000-4000-8000-000000000001",
  role: "member" as const,
  userId: "20000000-0000-4000-8000-000000000002",
  workspaceId: "20000000-0000-4000-8000-000000000003",
};

const FIRST = "20000000-0000-4000-8000-000000000010";
const SECOND = "20000000-0000-4000-8000-000000000011";

interface StoredFeed extends CalendarFeedRecord {
  readonly hash: string;
  readonly revokedAt?: string;
  readonly scopes: readonly string[];
}

function fixture(options: { readonly standing?: "active" | "revoked" } = {}) {
  const rows = new Map<string, StoredFeed>();
  const audit = recordingAudit<
    { readonly action: string; readonly record: ApiTokenRecord },
    void
  >();
  const ids = [FIRST, SECOND];
  let secrets = 0;
  let used = 0;
  let window: number | undefined;
  let described: typeof member | undefined = member;
  const dependencies: CalendarFeedTokenDependencies = {
    actorContext: { describe: () => Promise.resolve(described) },
    actors: {
      revalidate: () => Promise.resolve(options.standing ?? "active"),
    },
    audit,
    calendarFeeds: {
      active: () => {
        const row = [...rows.values()].find((row) => !row.revokedAt);
        return Promise.resolve(
          row ? { createdAt: row.createdAt, id: row.id } : undefined,
        );
      },
      create: ({ hash, id, occurredAt }) => {
        const row: StoredFeed = {
          createdAt: occurredAt.toISOString(),
          hash,
          id,
          scopes: [CALENDAR_FEED_SCOPE],
        };
        rows.set(id, row);
        return Promise.resolve({ createdAt: row.createdAt, id });
      },
      revokeActive: ({ occurredAt }) => {
        const revoked = [...rows.values()].filter((row) => !row.revokedAt);
        for (const row of revoked) {
          rows.set(row.id, { ...row, revokedAt: occurredAt.toISOString() });
        }
        return Promise.resolve(
          revoked.map((row) => ({ createdAt: row.createdAt, id: row.id })),
        );
      },
    },
    clock: fixedClock("2026-09-28T10:00:00.000Z"),
    ids: { next: () => ids.shift()! },
    repository: {
      create: () => Promise.reject(new Error("not a personal token")),
      findForAuthentication: ({ id }) => {
        const row = rows.get(id);
        return Promise.resolve(
          row
            ? {
              hash: row.hash,
              record: {
                createdAt: row.createdAt,
                id: row.id,
                name: "Calendar feed",
                ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
                scopes: row.scopes as ApiTokenRecord["scopes"],
              },
              status: "found" as const,
              userId: member.userId,
              workspaceId: member.workspaceId,
            }
            : { status: "not-found" as const },
        );
      },
      list: () => Promise.resolve([]),
      markUsed: ({ occurredAt, staleBefore }) => {
        used += 1;
        window = occurredAt.getTime() - staleBefore.getTime();
        return Promise.resolve();
      },
      revoke: () => Promise.resolve({ status: "not-found" as const }),
    },
    secrets: {
      create: () => {
        secrets += 1;
        const raw = `calendar-secret-number-${secrets}-with-entropy`;
        return Promise.resolve({ hash: `hash:${raw}`, raw });
      },
      matches: (raw, hash) => Promise.resolve(hash === `hash:${raw}`),
    },
    transaction: { run: (work) => work({} as never) },
  };
  return {
    audit,
    feeds: createCalendarFeedTokens(dependencies),
    leave: () => {
      described = undefined;
    },
    rows,
    used: () => used,
    window: () => window,
  };
}

Deno.test("[INTEGRATION-002] any member creates one calendar feed and sees its secret once", async () => {
  const state = fixture();
  assertEquals(await state.feeds.current(member), { status: "ready" });
  const created = await state.feeds.create(member);
  assertEquals(created, {
    feed: { createdAt: "2026-09-28T10:00:00.000Z", id: FIRST },
    secret: `kin_cal_${FIRST}.calendar-secret-number-1-with-entropy`,
    status: "created",
  });
  assertEquals(
    state.rows.get(FIRST)?.hash,
    "hash:calendar-secret-number-1-with-entropy",
  );
  assertEquals(state.rows.get(FIRST)?.scopes, ["calendar.read"]);
  assertEquals(await state.feeds.current(member), {
    feed: { createdAt: "2026-09-28T10:00:00.000Z", id: FIRST },
    status: "ready",
  });
  assertEquals(
    await state.feeds.create(member),
    { status: "conflict" },
    "a second feed while one is active is refused",
  );
  assertEquals(state.audit.actions, ["created"]);
  assertEquals(state.audit.commands[0]?.record.scopes, ["calendar.read"]);
});

Deno.test("[INTEGRATION-002] rotating revokes the old secret and shows a new one", async () => {
  const state = fixture();
  assertEquals(await state.feeds.rotate(member), { status: "not-found" });
  const created = await state.feeds.create(member);
  assert(created.status === "created", "created");
  const rotated = await state.feeds.rotate(member);
  assertEquals(rotated, {
    feed: { createdAt: "2026-09-28T10:00:00.000Z", id: SECOND },
    secret: `kin_cal_${SECOND}.calendar-secret-number-2-with-entropy`,
    status: "rotated",
  });
  assertEquals(
    await state.feeds.authenticate(created.secret),
    { status: "invalid" },
    "the old secret no longer opens the feed",
  );
  assert(rotated.status === "rotated", "rotated");
  assertEquals(
    (await state.feeds.authenticate(rotated.secret)).status,
    "authenticated",
  );
  assertEquals(state.audit.actions, ["created", "revoked", "created"]);
});

Deno.test("[INTEGRATION-002] revoking ends the feed; a second revoke finds nothing", async () => {
  const state = fixture();
  const created = await state.feeds.create(member);
  assert(created.status === "created", "created");
  assertEquals(await state.feeds.revoke(member), { status: "revoked" });
  assertEquals(await state.feeds.revoke(member), { status: "not-found" });
  assertEquals(await state.feeds.current(member), { status: "ready" });
  assertEquals(await state.feeds.authenticate(created.secret), {
    status: "invalid",
  });
  assertEquals(state.audit.actions, ["created", "revoked"]);
});

Deno.test("[INTEGRATION-002] a feed secret authenticates only as itself", async () => {
  const state = fixture();
  const created = await state.feeds.create(member);
  assert(created.status === "created", "created");
  const accepted = await state.feeds.authenticate(created.secret);
  assertEquals(accepted, { actor: member, status: "authenticated" });
  assertEquals(state.used(), 1, "the use is recorded");
  assertEquals(
    state.window(),
    15 * 60_000,
    "an earlier use within 15 minutes leaves the row alone",
  );
  for (
    const presented of [
      "",
      created.secret.replace("kin_cal_", "kin_pat_"),
      `${created.secret}x`.replace(/.$/, "!"),
      created.secret.slice(0, -1) + "Z",
      `kin_cal_${SECOND}.calendar-secret-number-1-with-entropy`,
    ]
  ) {
    assertEquals(
      await state.feeds.authenticate(presented),
      { status: "invalid" },
      `refused: ${presented}`,
    );
  }
  state.rows.set(FIRST, {
    ...state.rows.get(FIRST)!,
    scopes: ["people:read"],
  });
  assertEquals(
    await state.feeds.authenticate(created.secret),
    { status: "invalid" },
    "a token without the calendar scope is refused",
  );
  state.rows.set(FIRST, {
    ...state.rows.get(FIRST)!,
    scopes: [CALENDAR_FEED_SCOPE],
  });
  state.leave();
  assertEquals(
    await state.feeds.authenticate(created.secret),
    { status: "invalid" },
    "a member who left is nobody",
  );
});

Deno.test("[INTEGRATION-002] a revoked member manages no feed", async () => {
  const state = fixture({ standing: "revoked" });
  assertEquals(await state.feeds.current(member), { status: "forbidden" });
  assertEquals(await state.feeds.create(member), { status: "forbidden" });
  assertEquals(await state.feeds.rotate(member), { status: "forbidden" });
  assertEquals(await state.feeds.revoke(member), { status: "forbidden" });
  assertEquals(state.rows.size, 0);
});
