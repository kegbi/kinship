import { assert, assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import type { ImportantDateRecord } from "../domain/important_dates/rules.ts";
import {
  conflictsDigest,
  type MergeCandidate,
  type PersonMergeFacts,
  type ReferenceCounts,
} from "../domain/merge_rules.ts";
import type { PersonMergeAuditCommand } from "../ports/audit.ts";
import type { PeopleTransaction } from "../ports/context.ts";
import type { ImportantDatePublisher } from "../ports/important_date_repository.ts";
import type {
  PersonMergeParticipant,
  PersonMergeRepository,
} from "../ports/person_merge.ts";
import { createPersonMerge } from "./merge_people.ts";

const actor = fixtures.actor();
const primaryId = fixtures.uuid(101);
const duplicateId = fixtures.uuid(102);
const REVISION = "2026-09-27T09:00:00.000000Z";
/** The cadence conflict the relationships fake reports for every pair. */
const STAY_IN_TOUCH = {
  discarded: "every 30 days",
  fact: "stay-in-touch" as const,
  kept: "every 7 days",
  keptSnapshot: { intervalCount: 7 },
  snapshot: { intervalCount: 30 },
};
/** What a confirmation of a pair with no dates in conflict carries. */
const REVISIONS = {
  conflictsDigest: await conflictsDigest([STAY_IN_TOUCH]),
  duplicateRevision: REVISION,
  primaryRevision: REVISION,
};

function person(
  id: string,
  overrides: Partial<MergeCandidate> = {},
): MergeCandidate {
  return {
    givenName: "Ada",
    id,
    isDeceased: false,
    isPartial: false,
    isStarred: false,
    lifecycle: "active",
    updatedAt: REVISION,
    ...overrides,
  };
}

function date(
  id: number,
  personId: string,
  kind: ImportantDateRecord["kind"],
): ImportantDateRecord {
  return {
    createdAt: REVISION,
    day: 10,
    id: fixtures.uuid(id),
    isAgeBased: false,
    isYearApproximate: false,
    kind,
    month: 12,
    personId,
    precision: "month_day",
    scheduling: "annual-reminder",
    updatedAt: REVISION,
  };
}

/**
 * A workspace in memory: each reference is a list of person ids, one per row
 * that names them. Relinking rewrites the duplicate's rows; the transaction
 * restores every list when the work throws.
 */
function context(
  options: {
    /** Each person's avatar, as `listFacts` reads it. */
    readonly avatars?: {
      readonly duplicate?: PersonMergeFacts["avatar"];
      readonly primary?: PersonMergeFacts["avatar"];
    };
    /** The files module fails to discard an image. */
    readonly discardFails?: boolean;
    readonly duplicate?: MergeCandidate | undefined;
    readonly duplicateDates?: readonly ImportantDateRecord[];
    readonly blocked?: boolean;
    readonly leaveBehind?: boolean;
    readonly miscount?: boolean;
    readonly primary?: MergeCandidate | undefined;
    readonly primaryDates?: readonly ImportantDateRecord[];
    readonly revalidation?: "active" | "revoked";
  } = {},
) {
  const rows = new Map<string, string[]>([
    ["crm.notes.person_id", [duplicateId, duplicateId, primaryId]],
    ["crm.relationships.to_person_id", [duplicateId]],
    ["crm.person_tags.person_id", [duplicateId, primaryId]],
  ]);
  const events: string[] = [];
  const audits: PersonMergeAuditCommand[] = [];
  let removed = false;
  const count = (
    references: readonly string[],
    personId: string,
  ): ReferenceCounts =>
    Object.fromEntries(
      references.map((reference) => [
        reference,
        (rows.get(reference) ?? []).filter((id) => id === personId).length,
      ]),
    );
  const relink = (reference: string, drop: number) => {
    const list = rows.get(reference) ?? [];
    const moved = list.filter((id) => id === duplicateId).length;
    const kept = list.filter((id) => id !== duplicateId);
    rows.set(reference, [
      ...kept,
      ...Array.from({ length: moved - drop }, () => primaryId),
    ]);
    return { moved: moved - drop, dropped: drop };
  };
  const participant = (
    module: string,
    reference: string,
  ): PersonMergeParticipant => ({
    countReferences: (command) =>
      Promise.resolve(count([reference], command.personId)),
    module,
    references: [reference],
    relinkPerson: () => {
      events.push(`relink:${module}`);
      if (options.leaveBehind && module === "relationships") {
        return Promise.resolve({ relinked: {}, removed: {} });
      }
      const { dropped, moved } = relink(reference, 0);
      return Promise.resolve({
        relinked: { [reference]: moved + (options.miscount ? 1 : 0) },
        removed: { [reference]: dropped },
      });
    },
  });
  const tags = "crm.person_tags.person_id";
  const repository: PersonMergeRepository = {
    applyIdentity: (command) => {
      events.push(`identity:${command.identity.familyName ?? ""}`);
      return Promise.resolve({
        ...(options.primary ?? person(primaryId)),
        ...command.identity,
        updatedAt: "2026-09-27T10:00:00.000000Z",
      });
    },
    listFacts: (command) => {
      const avatar = command.personId === primaryId
        ? options.avatars?.primary
        : options.avatars?.duplicate;
      return Promise.resolve({
        ...(avatar ? { avatar } : {}),
        dates: command.personId === primaryId
          ? options.primaryDates ?? []
          : options.duplicateDates ?? [],
      });
    },
    lockPair: (command) => {
      events.push(command.forUpdate ? "lock" : "read");
      return Promise.resolve({
        ...("duplicate" in options
          ? options.duplicate ? { duplicate: options.duplicate } : {}
          : { duplicate: person(duplicateId, { familyName: "King" }) }),
        ...("primary" in options
          ? options.primary ? { primary: options.primary } : {}
          : { primary: person(primaryId) }),
      });
    },
    ownTables: {
      countReferences: (command) =>
        Promise.resolve(count([tags], command.personId)),
      module: "people",
      references: [tags],
      relinkPerson: (command) => {
        events.push(`relink:people:${command.removedDateIds.join(",")}`);
        // The primary already has the tag, so the duplicate's link is dropped.
        const { dropped, moved } = relink(tags, 1);
        return Promise.resolve({
          relinked: { [tags]: moved },
          removed: { [tags]: dropped },
        });
      },
    },
    removeDuplicate: () => {
      events.push("remove");
      removed = true;
      return Promise.resolve(true);
    },
  };
  const publisher: ImportantDatePublisher = {
    regenerate: (command) => {
      events.push(
        `regenerate:${command.before?.id ?? ""}->${
          command.after?.personId ?? "gone"
        }${command.keepActive ? ":kept-active" : ""}`,
      );
      return Promise.resolve();
    },
  };
  const merge = createPersonMerge({
    actors: {
      revalidate: () => Promise.resolve(options.revalidation ?? "active"),
    },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: (command) => {
        audits.push(command);
        return Promise.resolve(fixtures.uuid(900));
      },
    },
    clock: fixedClock("2026-09-27T10:00:00.000Z"),
    images: {
      discard: (command) => {
        events.push(
          `discard:${command.fileId}@${command.personId}:${command.actor.memberId}`,
        );
        return options.discardFails
          ? Promise.reject(new Error("object store down"))
          : Promise.resolve();
      },
    },
    participants: [
      participant("interactions", "crm.notes.person_id"),
      {
        ...participant("relationships", "crm.relationships.to_person_id"),
        inspect: () =>
          Promise.resolve({
            ...(options.blocked ? { blocked: "both-members" as const } : {}),
            conflicts: [STAY_IN_TOUCH],
          }),
      },
    ],
    publisher,
    repository,
    transaction: {
      run: async <T>(work: (transaction: PeopleTransaction) => Promise<T>) => {
        const saved = new Map(
          [...rows].map(([name, list]) => [name, [...list]]),
        );
        try {
          return await work({ opaque: "transaction" });
        } catch (error) {
          rows.clear();
          for (const [name, list] of saved) rows.set(name, list);
          removed = false;
          throw error;
        }
      },
    },
  });
  return {
    audits,
    events,
    merge,
    removed: () => removed,
    rows,
  };
}

Deno.test("[PEOPLE-008] a merge relinks every module's rows to the primary and deletes the duplicate", async () => {
  const subject = context();
  const result = await subject.merge.merge(actor, primaryId, {
    duplicateId,
    ...REVISIONS,
  });
  assertEquals(result.status, "merged");
  if (result.status !== "merged") return;
  assertEquals(result.person.familyName, "King");
  assertEquals(result.duplicateId, duplicateId);
  assertEquals(result.moved, 3);
  assertEquals(subject.events, [
    "lock",
    "relink:interactions",
    "relink:relationships",
    "relink:people:",
    "identity:King",
    "remove",
  ]);
  for (const list of subject.rows.values()) {
    assertEquals(list.includes(duplicateId), false);
  }
  assertEquals(subject.rows.get("crm.person_tags.person_id"), [primaryId]);
  assertEquals(subject.removed(), true);
  assertEquals(subject.audits.length, 1);
  assertEquals(subject.audits[0]?.primaryId, primaryId);
  assertEquals(subject.audits[0]?.duplicateId, duplicateId);
  assertEquals(subject.audits[0]?.discarded, [{
    fact: "stay-in-touch",
    intervalCount: 30,
  }]);
  assertEquals(subject.audits[0]?.tables, {
    "crm.notes.person_id": { relinked: 2, removed: 0 },
    "crm.person_tags.person_id": { relinked: 0, removed: 1 },
    "crm.relationships.to_person_id": { relinked: 1, removed: 0 },
  });
});

Deno.test("[PEOPLE-008] a single-valued date the primary has is retired through planning before its row goes", async () => {
  const subject = context({
    duplicateDates: [
      date(11, duplicateId, "birthday"),
      date(12, duplicateId, "custom"),
    ],
    primaryDates: [date(10, primaryId, "birthday")],
  });
  const preview = await subject.merge.preview(actor, primaryId, duplicateId);
  assert(preview.status === "ready", preview.status);
  const result = await subject.merge.merge(actor, primaryId, {
    duplicateId,
    ...REVISIONS,
    conflictsDigest: preview.conflictsDigest,
  });
  assertEquals(result.status, "merged");
  assertEquals(subject.events.slice(4, 7), [
    `regenerate:${fixtures.uuid(11)}->gone`,
    `relink:people:${fixtures.uuid(11)}`,
    `regenerate:${fixtures.uuid(12)}->${primaryId}:kept-active`,
  ]);
});

Deno.test("[PEOPLE-008] a person cannot be merged into themselves", async () => {
  const subject = context();
  assertEquals(
    await subject.merge.merge(actor, primaryId, {
      duplicateId: primaryId,
      ...REVISIONS,
    }),
    { status: "self-merge" },
  );
  assertEquals(subject.events, []);
});

Deno.test("[PEOPLE-008] a revoked member, a missing, archived, or stale person changes nothing", async () => {
  const cases = [
    [{ revalidation: "revoked" as const }, "forbidden", []],
    [{ duplicate: undefined }, "not-found", ["lock"]],
    [
      { primary: person(primaryId, { lifecycle: "archived" }) },
      "archived-write-rejected",
      ["lock"],
    ],
  ] as const;
  for (const [options, status, events] of cases) {
    const subject = context(options);
    const result = await subject.merge.merge(actor, primaryId, {
      duplicateId,
      ...REVISIONS,
    });
    assertEquals(result.status, status);
    assertEquals(subject.events, [...events]);
    assertEquals(subject.removed(), false);
  }
  const stale = context();
  assertEquals(
    (await stale.merge.merge(actor, primaryId, {
      duplicateId,
      ...REVISIONS,
      primaryRevision: "2026-09-26T09:00:00.000000Z",
    })).status,
    "stale",
  );
  assertEquals(stale.events, ["lock"]);
});

Deno.test("[PEOPLE-008] a participant that leaves a reference behind rolls the whole merge back", async () => {
  const subject = context({ leaveBehind: true });
  let failure: unknown;
  try {
    await subject.merge.merge(actor, primaryId, { duplicateId, ...REVISIONS });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, "the merge throws");
  assert(
    failure.message.includes("crm.relationships.to_person_id"),
    failure.message,
  );
  assertEquals(
    subject.rows.get("crm.notes.person_id"),
    [duplicateId, duplicateId, primaryId],
  );
  assertEquals(subject.removed(), false);
  assertEquals(subject.audits, []);
});

Deno.test("[PEOPLE-008] a participant whose counts do not reconcile rolls the merge back", async () => {
  const subject = context({ miscount: true });
  let failure: unknown;
  try {
    await subject.merge.merge(actor, primaryId, { duplicateId, ...REVISIONS });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error, "the merge throws");
  assert(failure.message.includes("before"), failure.message);
  assertEquals(subject.removed(), false);
});

Deno.test("[PEOPLE-008] a preview reads what the merge would keep, discard, and move, and changes nothing", async () => {
  const subject = context({
    duplicateDates: [date(11, duplicateId, "birthday")],
    primaryDates: [date(10, primaryId, "birthday")],
  });
  const preview = await subject.merge.preview(actor, primaryId, duplicateId);
  assertEquals(preview.status, "ready");
  if (preview.status !== "ready") return;
  assertEquals(preview.moves, 4);
  assertEquals(
    preview.conflictsDigest,
    await conflictsDigest(preview.conflicts),
  );
  assertEquals(preview.primary.id, primaryId);
  assertEquals(preview.duplicate.familyName, "King");
  assertEquals(
    preview.conflicts.map((conflict) => [conflict.fact, conflict.discarded]),
    [["birthday", "10 December"], ["stay-in-touch", "every 30 days"]],
  );
  assertEquals(subject.events, ["read"]);
  assertEquals(subject.removed(), false);
  assertEquals(
    await subject.merge.preview(actor, primaryId, primaryId),
    { status: "self-merge" },
  );
  assertEquals(
    (await context({ duplicate: undefined }).merge.preview(
      actor,
      primaryId,
      duplicateId,
    )).status,
    "not-found",
  );
});

Deno.test("[PEOPLE-008] two people who both represent a member are never merged", async () => {
  const subject = context({ blocked: true });
  assertEquals(
    await subject.merge.merge(actor, primaryId, { duplicateId, ...REVISIONS }),
    { status: "both-members" },
  );
  assertEquals(
    await subject.merge.preview(actor, primaryId, duplicateId),
    { status: "both-members" },
  );
  assertEquals(subject.events, ["lock", "read"]);
  assertEquals(subject.removed(), false);
});

Deno.test("[PEOPLE-008] a merge whose conflicts changed since its preview changes nothing", async () => {
  // A date carries no person revision, so only the digest can tell.
  const options = {
    duplicateDates: [date(11, duplicateId, "birthday")],
    primaryDates: [] as ImportantDateRecord[],
  };
  const subject = context(options);
  const preview = await subject.merge.preview(actor, primaryId, duplicateId);
  assert(preview.status === "ready", preview.status);
  options.primaryDates.push(date(10, primaryId, "birthday"));
  const confirmed = {
    duplicateId,
    ...REVISIONS,
    conflictsDigest: preview.conflictsDigest,
  };
  assertEquals(await subject.merge.merge(actor, primaryId, confirmed), {
    status: "conflicts-changed",
  });
  assertEquals(subject.events, ["read", "lock"]);
  assertEquals(subject.removed(), false);
  assertEquals(subject.audits, []);
  const again = await subject.merge.preview(actor, primaryId, duplicateId);
  assert(again.status === "ready", again.status);
  assertEquals(again.conflictsDigest === preview.conflictsDigest, false);
  assertEquals(
    (await subject.merge.merge(actor, primaryId, {
      ...confirmed,
      conflictsDigest: again.conflictsDigest,
    })).status,
    "merged",
  );
});

/** The conflicts a pair whose people both have a photo confirms against. */
async function pictured(
  primary: PersonMergeFacts["avatar"],
  duplicate: PersonMergeFacts["avatar"],
) {
  const subject = context({ avatars: { duplicate, primary } });
  const preview = await subject.merge.preview(actor, primaryId, duplicateId);
  assert(preview.status === "ready", preview.status);
  return { digest: preview.conflictsDigest, subject };
}

Deno.test("[REL-063] the duplicate's image the primary does not use is discarded once the merge commits", async () => {
  const { digest, subject } = await pictured(
    { fileId: fixtures.uuid(301), source: "file" },
    { fileId: fixtures.uuid(302), source: "file" },
  );
  const result = await subject.merge.merge(actor, primaryId, {
    duplicateId,
    ...REVISIONS,
    conflictsDigest: digest,
  });
  assertEquals(result.status, "merged");
  assertEquals(
    subject.events.slice(-2),
    ["remove", `discard:${fixtures.uuid(302)}@${primaryId}:${actor.memberId}`],
    "after the merge, from the primary the image now belongs to",
  );
});

Deno.test("[REL-063] a merge stands when its unused image cannot be discarded", async () => {
  const subject = context({
    avatars: {
      duplicate: { fileId: fixtures.uuid(302), source: "file" },
      primary: { fileId: fixtures.uuid(301), source: "file" },
    },
    discardFails: true,
  });
  const preview = await subject.merge.preview(actor, primaryId, duplicateId);
  assert(preview.status === "ready", preview.status);
  const result = await subject.merge.merge(actor, primaryId, {
    duplicateId,
    ...REVISIONS,
    conflictsDigest: preview.conflictsDigest,
  });
  assertEquals(result.status, "merged", "the discard is best effort");
  assertEquals(subject.removed(), true);
});

Deno.test("[REL-063] nothing is discarded when the duplicate's image is used or the merge fails", async () => {
  const taken = context({
    avatars: {
      duplicate: { fileId: fixtures.uuid(302), source: "file" },
      primary: { source: "default" },
    },
  });
  assertEquals(
    (await taken.merge.merge(actor, primaryId, { duplicateId, ...REVISIONS }))
      .status,
    "merged",
  );
  assertEquals(
    taken.events.some((event) => event.startsWith("discard:")),
    false,
    "the duplicate's image becomes the primary's",
  );

  const { subject } = await pictured(
    { fileId: fixtures.uuid(301), source: "file" },
    { fileId: fixtures.uuid(302), source: "file" },
  );
  assertEquals(
    (await subject.merge.merge(actor, primaryId, {
      duplicateId,
      ...REVISIONS,
    })).status,
    "conflicts-changed",
  );
  assertEquals(
    subject.events.some((event) => event.startsWith("discard:")),
    false,
    "a merge that did not happen discards nothing",
  );
});
