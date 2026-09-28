import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import type { PersonDuplicateDismissalAudit } from "../ports/audit.ts";
import type { PeopleTransaction } from "../ports/context.ts";
import type { PersonDuplicateDismissalRepository } from "../ports/duplicate_dismissal.ts";
import { createPersonDuplicateDismissals } from "./duplicate_dismissal.ts";

const actor = fixtures.actor();
const low = fixtures.uuid(101);
const high = fixtures.uuid(102);

/** The workspace's stored pairs, with the transaction rolling back a throw. */
function context(
  options: {
    /** How many of the pair exist, undeleted, in the actor's workspace. */
    readonly found?: number;
    readonly revalidation?: "active" | "revoked";
    readonly stored?: readonly string[];
    readonly throwOnAudit?: boolean;
  } = {},
) {
  let stored = new Set(options.stored ?? []);
  const audited: string[] = [];
  const locks: string[] = [];
  const writes: string[] = [];
  const repository: PersonDuplicateDismissalRepository = {
    lockPair: (command) => {
      locks.push(
        `${command.workspaceId}:${command.personLowId}:${command.personHighId}`,
      );
      return Promise.resolve(options.found ?? 2);
    },
    dismiss: (command) => {
      const key = `${command.personLowId}:${command.personHighId}`;
      writes.push(`${command.workspaceId}:${key}:${command.memberId}`);
      if (stored.has(key)) return Promise.resolve(false);
      stored.add(key);
      return Promise.resolve(true);
    },
  };
  const audit: PersonDuplicateDismissalAudit = {
    record: (command) => {
      if (options.throwOnAudit) throw new Error("audit failed");
      audited.push(
        `${command.actor.memberId}:${command.personLowId}:${command.personHighId}`,
      );
      return Promise.resolve(fixtures.uuid(900));
    },
  };
  const dismissals = createPersonDuplicateDismissals({
    actors: {
      revalidate: () => Promise.resolve(options.revalidation ?? "active"),
    },
    audit,
    clock: fixedClock("2026-09-28T10:00:00.000Z"),
    repository,
    transaction: {
      run: async <T>(work: (transaction: PeopleTransaction) => Promise<T>) => {
        const before = new Set(stored);
        try {
          return await work({ opaque: "transaction" });
        } catch (error) {
          stored = before;
          throw error;
        }
      },
    },
  });
  return {
    audited,
    dismissals,
    locks,
    stored: () => [...stored],
    writes,
  };
}

Deno.test("[PEOPLE-008] dismissing a pair stores it lower id first, as the actor, and audits it", async () => {
  const subject = context();
  assertEquals(await subject.dismissals.dismiss(actor, [high, low]), {
    personIds: [low, high],
    status: "dismissed",
  });
  assertEquals(subject.stored(), [`${low}:${high}`]);
  assertEquals(
    subject.locks,
    [`${actor.workspaceId}:${low}:${high}`],
    "both people are locked inside the actor's workspace",
  );
  assertEquals(subject.writes, [
    `${actor.workspaceId}:${low}:${high}:${actor.memberId}`,
  ]);
  assertEquals(subject.audited, [`${actor.memberId}:${low}:${high}`]);
});

Deno.test("[PEOPLE-008] identifiers are compared as canonical lower-case UUIDs", async () => {
  const subject = context();
  assertEquals(
    await subject.dismissals.dismiss(actor, [low.toUpperCase(), high]),
    { personIds: [low, high], status: "dismissed" },
  );
  const same = context();
  assertEquals(
    await same.dismissals.dismiss(actor, [low.toUpperCase(), low]),
    { status: "same-person" },
  );
  assertEquals(same.locks, [], "a person paired with themselves is not read");
});

Deno.test("[PEOPLE-008] dismissing a dismissed pair succeeds and writes no second audit", async () => {
  const subject = context({ stored: [`${low}:${high}`] });
  assertEquals(await subject.dismissals.dismiss(actor, [low, high]), {
    personIds: [low, high],
    status: "dismissed",
  });
  assertEquals(subject.stored(), [`${low}:${high}`]);
  assertEquals(subject.audited, [], "nothing new is audited");
});

Deno.test("[PEOPLE-008] a pair outside the workspace, or with a deleted person, is not found", async () => {
  for (const found of [0, 1]) {
    const subject = context({ found });
    assertEquals(
      await subject.dismissals.dismiss(actor, [low, high]),
      { status: "not-found" },
    );
    assertEquals(subject.writes, [], "nothing is written");
    assertEquals(subject.audited, []);
  }
});

Deno.test("[PEOPLE-008] a revoked member dismisses nothing", async () => {
  const subject = context({ revalidation: "revoked" });
  assertEquals(
    await subject.dismissals.dismiss(actor, [low, high]),
    { status: "forbidden" },
  );
  assertEquals(subject.locks, []);
  assertEquals(subject.writes, []);
});

Deno.test("[PEOPLE-008] a failed audit rolls the dismissal back", async () => {
  const subject = context({ throwOnAudit: true });
  assertEquals(
    await subject.dismissals.dismiss(actor, [low, high]),
    { status: "unavailable" },
  );
  assertEquals(subject.stored(), []);
});
