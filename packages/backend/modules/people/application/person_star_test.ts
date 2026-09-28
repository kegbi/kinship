import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import type { PersonStarAudit } from "../ports/audit.ts";
import type { PeopleTransaction } from "../ports/context.ts";
import type { PersonStarRepository } from "../ports/star.ts";
import { createPersonStarManagement } from "./person_star.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();

/** One person's star, with the transaction rolling it back on a throw. */
function context(
  options: {
    readonly archived?: boolean;
    readonly exists?: boolean;
    readonly revalidation?: "active" | "revoked";
    readonly starred?: boolean;
    readonly throwOnAudit?: boolean;
    readonly throwOnLock?: boolean;
  } = {},
) {
  let starred = options.starred ?? false;
  const audited: string[] = [];
  const saved: boolean[] = [];
  const locks: string[] = [];
  const repository: PersonStarRepository = {
    lock: (command) => {
      locks.push(`${command.workspaceId}:${command.personId}`);
      if (options.throwOnLock) throw new Error("database down");
      return Promise.resolve(
        options.exists === false ? { status: "not-found" } : {
          archived: options.archived ?? false,
          starred,
          status: "ready",
        },
      );
    },
    save: (command) => {
      starred = command.starred;
      saved.push(command.starred);
      return Promise.resolve();
    },
  };
  const audit: PersonStarAudit = {
    record: (command) => {
      if (options.throwOnAudit) throw new Error("audit failed");
      audited.push(`${command.action}:${command.personId}`);
      return Promise.resolve(fixtures.uuid(900));
    },
  };
  const management = createPersonStarManagement({
    actors: {
      revalidate: () => Promise.resolve(options.revalidation ?? "active"),
    },
    audit,
    clock: fixedClock("2026-09-28T10:00:00.000Z"),
    repository,
    transaction: {
      run: async <T>(work: (transaction: PeopleTransaction) => Promise<T>) => {
        const before = starred;
        try {
          return await work({ opaque: "transaction" });
        } catch (error) {
          starred = before;
          throw error;
        }
      },
    },
  });
  return {
    audited,
    locks,
    management,
    saved,
    starred: () => starred,
  };
}

Deno.test("[PEOPLE-010] starring a person saves the flag and audits it", async () => {
  const subject = context();
  assertEquals(await subject.management.set(actor, personId, true), {
    isStarred: true,
    status: "ready",
  });
  assertEquals(subject.starred(), true);
  assertEquals(subject.audited, [`starred:${personId}`]);
  assertEquals(
    subject.locks,
    [`${actor.workspaceId}:${personId}`],
    "the person is locked inside the actor's workspace",
  );
});

Deno.test("[PEOPLE-010] unstarring clears the flag and audits it", async () => {
  const subject = context({ starred: true });
  assertEquals(await subject.management.set(actor, personId, false), {
    isStarred: false,
    status: "ready",
  });
  assertEquals(subject.audited, [`unstarred:${personId}`]);
});

Deno.test("[PEOPLE-010] repeating a star changes and audits nothing", async () => {
  const subject = context({ starred: true });
  assertEquals(await subject.management.set(actor, personId, true), {
    isStarred: true,
    status: "ready",
  });
  assertEquals(subject.saved, [], "nothing is written");
  assertEquals(subject.audited, [], "nothing is audited");
});

Deno.test("[PEOPLE-010] an archived person's star is read-only", async () => {
  for (const starred of [true, false]) {
    const subject = context({ archived: true, starred: !starred });
    assertEquals(
      await subject.management.set(actor, personId, starred),
      { status: "archived-write-rejected" },
    );
    assertEquals(subject.saved, []);
    assertEquals(subject.audited, []);
  }
});

Deno.test("[PEOPLE-010] a revoked member, a missing person, and an outage refuse", async () => {
  const revoked = context({ revalidation: "revoked" });
  assertEquals(await revoked.management.set(actor, personId, true), {
    status: "forbidden",
  });
  assertEquals(revoked.locks, [], "a revoked member locks nobody");

  const missing = context({ exists: false });
  assertEquals(await missing.management.set(actor, personId, true), {
    status: "not-found",
  });

  const down = context({ throwOnLock: true });
  assertEquals(await down.management.set(actor, personId, true), {
    status: "unavailable",
  });
});

Deno.test("[PEOPLE-010] a failed audit rolls the star back", async () => {
  const subject = context({ throwOnAudit: true });
  assertEquals(await subject.management.set(actor, personId, true), {
    status: "unavailable",
  });
  assertEquals(subject.starred(), false);
});
