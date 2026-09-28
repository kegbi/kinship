import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import type { ImportantDateRecord } from "./important_dates/rules.ts";
import {
  conflictsDigest,
  datePlan,
  type MergeCandidate,
  mergeDecision,
  mergedIdentity,
  partialDateText,
  peopleConflicts,
  reconcileReferences,
  unusedAvatarFile,
} from "./merge_rules.ts";

const primaryId = fixtures.uuid(101);
const duplicateId = fixtures.uuid(102);

function candidate(
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
    updatedAt: "2026-09-27T10:00:00.000000Z",
    ...overrides,
  };
}

function date(
  id: number,
  personId: string,
  kind: ImportantDateRecord["kind"],
): ImportantDateRecord {
  return {
    createdAt: "2026-09-27T10:00:00.000000Z",
    day: 10,
    id: fixtures.uuid(id),
    isAgeBased: false,
    isYearApproximate: false,
    kind,
    month: 12,
    personId,
    precision: "month_day",
    scheduling: "annual-reminder",
    updatedAt: "2026-09-27T10:00:00.000000Z",
  };
}

Deno.test("[PEOPLE-008] a merge needs two current, active people in the workspace", () => {
  const primary = candidate(primaryId);
  const duplicate = candidate(duplicateId);
  assertEquals(mergeDecision(primary, duplicate, {}), {
    status: "proceed",
  });
  assertEquals(mergeDecision(undefined, duplicate, {}), {
    status: "not-found",
  });
  assertEquals(mergeDecision(primary, undefined, {}), {
    status: "not-found",
  });
  assertEquals(
    mergeDecision(
      primary,
      candidate(duplicateId, { lifecycle: "deleted" }),
      {},
    ),
    { status: "not-found" },
  );
  assertEquals(
    mergeDecision(
      candidate(primaryId, { lifecycle: "archived" }),
      duplicate,
      {},
    ),
    { status: "archived-write-rejected" },
  );
  assertEquals(
    mergeDecision(
      primary,
      candidate(duplicateId, { lifecycle: "archived" }),
      {},
    ),
    { status: "archived-write-rejected" },
  );
});

Deno.test("[PEOPLE-008] a merge decided against an old revision of either person is stale", () => {
  const primary = candidate(primaryId);
  const duplicate = candidate(duplicateId);
  assertEquals(
    mergeDecision(primary, duplicate, {
      duplicateRevision: duplicate.updatedAt,
      primaryRevision: primary.updatedAt,
    }),
    { status: "proceed" },
  );
  assertEquals(
    mergeDecision(primary, duplicate, {
      primaryRevision: "2026-09-26T10:00:00.000000Z",
    }),
    { status: "stale" },
  );
  assertEquals(
    mergeDecision(primary, duplicate, {
      duplicateRevision: "2026-09-26T10:00:00.000000Z",
    }),
    { status: "stale" },
  );
});

Deno.test("[PEOPLE-008] the primary keeps every value it has and fills the empty ones", () => {
  const primary = candidate(primaryId, {
    description: "Mathematician",
    familyName: "Lovelace",
  });
  const duplicate = candidate(duplicateId, {
    description: "Poet's daughter",
    familyName: "King",
    foodPreferences: "Tea",
    genderOptionId: fixtures.uuid(7),
    isDeceased: true,
    isStarred: true,
    middleName: "Augusta",
    nickname: "Countess",
  });
  assertEquals(mergedIdentity(primary, duplicate), {
    description: "Mathematician",
    familyName: "Lovelace",
    foodPreferences: "Tea",
    genderOptionId: fixtures.uuid(7),
    givenName: "Ada",
    isDeceased: true,
    isPartial: false,
    isStarred: true,
    middleName: "Augusta",
    nickname: "Countess",
  });
});

Deno.test("[PEOPLE-008] an empty given name and a partial primary take the duplicate's", () => {
  const merged = mergedIdentity(
    candidate(primaryId, { givenName: "", isPartial: true }),
    candidate(duplicateId, { givenName: "Ada", isPartial: false }),
  );
  assertEquals(merged.givenName, "Ada");
  assertEquals(merged.isPartial, false);
  assertEquals(
    mergedIdentity(
      candidate(primaryId, { isPartial: true }),
      candidate(duplicateId, { isPartial: true }),
    ).isPartial,
    true,
  );
  assertEquals(
    mergedIdentity(
      candidate(primaryId, { givenName: " ", isPartial: true }),
      candidate(duplicateId, { givenName: "", isPartial: true }),
    ).givenName,
    "",
  );
});

Deno.test("[PEOPLE-008] a single-valued date the primary already has is not moved", () => {
  const plan = datePlan(
    [date(1, primaryId, "birthday"), date(2, primaryId, "custom")],
    [
      date(3, duplicateId, "birthday"),
      date(4, duplicateId, "deceased"),
      date(5, duplicateId, "custom"),
    ],
  );
  assertEquals(plan.remove.map((entry) => entry.id), [fixtures.uuid(3)]);
  assertEquals(plan.relink.map((entry) => entry.id), [
    fixtures.uuid(4),
    fixtures.uuid(5),
  ]);
});

Deno.test("[PEOPLE-008] every reference moved or removed reconciles, and none remain", () => {
  assertEquals(
    reconcileReferences(
      { "crm.notes.person_id": 2, "crm.tasks.person_id": 0 },
      {
        relinked: { "crm.notes.person_id": 1 },
        removed: { "crm.notes.person_id": 1 },
      },
      { "crm.notes.person_id": 0, "crm.tasks.person_id": 0 },
    ),
    [],
  );
  assertEquals(
    reconcileReferences(
      { "crm.notes.person_id": 2 },
      { relinked: { "crm.notes.person_id": 1 }, removed: {} },
      { "crm.notes.person_id": 1 },
    ),
    [
      "crm.notes.person_id: 2 before, 1 relinked, 0 removed",
      "crm.notes.person_id: 1 still reference the duplicate",
    ],
  );
  assertEquals(
    reconcileReferences(
      {},
      { relinked: { "crm.calls.person_id": 1 }, removed: {} },
      {},
    ),
    ["crm.calls.person_id: 0 before, 1 relinked, 0 removed"],
  );
});

Deno.test("[PEOPLE-008] a partial date reads with exactly the parts it has", () => {
  const value = (parts: Partial<ImportantDateRecord>) =>
    partialDateText({
      isYearApproximate: false,
      precision: "unknown",
      ...parts,
    } as ImportantDateRecord);
  assertEquals(
    value({ day: 10, month: 12, precision: "full", year: 1815 }),
    "10 December 1815",
  );
  assertEquals(
    value({ day: 10, month: 12, precision: "month_day" }),
    "10 December",
  );
  assertEquals(
    value({ month: 12, precision: "year_month", year: 1815 }),
    "December 1815",
  );
  assertEquals(value({ precision: "year", year: 1815 }), "1815");
  assertEquals(
    value({ isYearApproximate: true, precision: "year", year: 1815 }),
    "about 1815",
  );
  assertEquals(value({ month: 3, precision: "month" }), "March");
  assertEquals(value({ day: 4, precision: "day" }), "day 4");
  assertEquals(value({}), "an unknown date");
});

Deno.test("[PEOPLE-008] every single-valued fact both people hold is listed as kept and discarded", () => {
  const primaryBirthday = { ...date(1, primaryId, "birthday"), notes: "Mine" };
  const duplicateBirthday = {
    ...date(2, duplicateId, "birthday"),
    day: 12,
    month: 3,
    notes: "Theirs",
  };
  const conflicts = peopleConflicts(
    {
      avatar: { fileId: fixtures.uuid(40), source: "file" },
      dates: [primaryBirthday, date(3, primaryId, "custom")],
      firstMeeting: { placeText: "Harvard" },
    },
    {
      avatar: { fileId: fixtures.uuid(41), source: "file" },
      dates: [duplicateBirthday, date(4, duplicateId, "deceased")],
      firstMeeting: {
        introducedBy: { id: fixtures.uuid(50), name: "Mary Somerville" },
        location: { id: fixtures.uuid(51), text: "Poughkeepsie, New York" },
        notes: "Met at the lab",
        placeText: "Vassar",
      },
    },
  );
  assertEquals(conflicts, [
    {
      discarded: "12 March",
      fact: "birthday",
      kept: "10 December",
      keptSnapshot: {
        day: 10,
        id: fixtures.uuid(1),
        kind: "birthday",
        month: 12,
        notes: "Mine",
        precision: "month_day",
      },
      snapshot: {
        day: 12,
        id: fixtures.uuid(2),
        kind: "birthday",
        month: 3,
        notes: "Theirs",
        precision: "month_day",
      },
    },
    {
      discarded:
        "Vassar — Poughkeepsie, New York — introduced by Mary Somerville — Met at the lab",
      fact: "first-meeting",
      kept: "Harvard",
      keptSnapshot: { placeText: "Harvard" },
      snapshot: {
        introducedByName: "Mary Somerville",
        introducedByPersonId: fixtures.uuid(50),
        location: "Poughkeepsie, New York",
        locationId: fixtures.uuid(51),
        notes: "Met at the lab",
        placeText: "Vassar",
      },
    },
    {
      discarded: "The duplicate's photo will not be used",
      fact: "avatar",
      kept: "The primary's photo",
      keptSnapshot: { fileId: fixtures.uuid(40), source: "file" },
      snapshot: { fileId: fixtures.uuid(41), source: "file" },
    },
  ]);
});

Deno.test("[PEOPLE-008] nothing is discarded where only one person has the fact", () => {
  assertEquals(
    peopleConflicts(
      { avatar: { source: "default" }, dates: [] },
      {
        avatar: { source: "external" },
        dates: [date(2, duplicateId, "birthday")],
        firstMeeting: { placeText: "" },
      },
    ),
    [],
  );
  assertEquals(
    peopleConflicts(
      { avatar: { source: "file" }, dates: [] },
      { avatar: { source: "default" }, dates: [] },
    ),
    [],
  );
  assertEquals(
    peopleConflicts(
      { dates: [], firstMeeting: { notes: "  " } },
      { dates: [], firstMeeting: {} },
    ),
    [
      {
        discarded: "no details",
        fact: "first-meeting",
        kept: "no details",
        keptSnapshot: { notes: "  " },
        snapshot: {},
      },
    ],
  );
});

Deno.test("[PEOPLE-008] the conflicts digest is stable, ignores order, and moves with either snapshot", async () => {
  const birthday = {
    discarded: "12 March",
    fact: "birthday" as const,
    kept: "10 December",
    keptSnapshot: { day: 10, kind: "birthday", month: 12 },
    snapshot: { day: 12, kind: "birthday", month: 3 },
  };
  const photo = {
    discarded: "The duplicate's photo will not be used",
    fact: "avatar" as const,
    kept: "The primary's photo",
    keptSnapshot: { source: "file" },
    snapshot: { source: "external" },
  };
  const digest = await conflictsDigest([birthday, photo]);
  assertEquals(/^[0-9a-f]{64}$/.test(digest), true);
  assertEquals(await conflictsDigest([photo, birthday]), digest);
  // The same values with their keys in another order are the same list.
  assertEquals(
    await conflictsDigest([
      { ...photo },
      {
        ...birthday,
        snapshot: { month: 3, kind: "birthday", day: 12 },
      },
    ]),
    digest,
  );
  // Only the facts and the snapshots count, never the wording.
  assertEquals(
    await conflictsDigest([{ ...birthday, kept: "December 10" }, photo]),
    digest,
  );
  const changed = [
    [{ ...birthday, keptSnapshot: { day: 11, kind: "birthday", month: 12 } }],
    [{ ...birthday, snapshot: { day: 13, kind: "birthday", month: 3 } }],
    [{ ...birthday, fact: "deceased" as const }],
  ];
  for (const conflicts of changed) {
    const other = await conflictsDigest([...conflicts, photo]);
    assertEquals(other === digest, false);
  }
  assertEquals((await conflictsDigest([birthday])) === digest, false);
  // Nested values are canonical too, and an absent field is no field.
  const nested = {
    ...photo,
    snapshot: { parts: [{ b: 2, a: 1 }], source: "external", url: undefined },
  };
  assertEquals(
    await conflictsDigest([nested]),
    await conflictsDigest([{
      ...photo,
      snapshot: { source: "external", parts: [{ a: 1, b: 2 }] },
    }]),
  );
  assertEquals(
    await conflictsDigest([]),
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  );
});

Deno.test("[REL-063] the duplicate's avatar image is unused only when the primary keeps its own", () => {
  const file = (fileId: string) => ({ fileId, source: "file" });
  const facts = (avatar?: { fileId?: string; source: string }) => ({
    ...(avatar ? { avatar } : {}),
    dates: [],
  });
  assertEquals(
    unusedAvatarFile(facts(file("p")), facts(file("d"))),
    "d",
    "the primary's own image is kept",
  );
  assertEquals(
    unusedAvatarFile(facts({ source: "generated" }), facts(file("d"))),
    "d",
    "a generated avatar is kept too",
  );
  assertEquals(
    unusedAvatarFile(facts({ source: "default" }), facts(file("d"))),
    undefined,
    "the duplicate's image replaces the initials",
  );
  assertEquals(
    unusedAvatarFile(facts(), facts(file("d"))),
    undefined,
    "and a primary with no avatar at all",
  );
  assertEquals(
    unusedAvatarFile(facts(file("p")), facts({ source: "external" })),
    undefined,
    "a duplicate without an image leaves nothing",
  );
  assertEquals(
    unusedAvatarFile(facts(file("same")), facts(file("same"))),
    undefined,
    "one image shared by both is still drawn",
  );
});
