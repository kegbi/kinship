import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import {
  BULK_PEOPLE_LIMIT,
  bulkFailureCode,
  bulkInputErrors,
  bulkSummary,
  tagChange,
  transitionPlan,
} from "./bulk_rules.ts";

const tagId = fixtures.uuid(901);
const otherTag = fixtures.uuid(902);
const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => fixtures.uuid(100 + index));

Deno.test("[PEOPLE-009] a bulk request names 1 to 100 distinct people and a tag only for tagging", () => {
  assertEquals(BULK_PEOPLE_LIMIT, 100, "the selection cap");
  assertEquals(
    bulkInputErrors({ action: "archive", personIds: ids(100) }),
    {},
    "one hundred people are accepted",
  );
  assertEquals(
    bulkInputErrors({ action: "tag", personIds: ids(1), tagId }),
    {},
    "tagging names its tag",
  );
  assertEquals(
    Object.keys(bulkInputErrors({ action: "archive", personIds: [] })),
    ["personIds"],
    "nobody selected is refused",
  );
  assertEquals(
    Object.keys(bulkInputErrors({ action: "restore", personIds: ids(101) })),
    ["personIds"],
    "more than the cap is refused",
  );
  const [first] = ids(1);
  assertEquals(
    Object.keys(
      bulkInputErrors({ action: "archive", personIds: [first!, first!] }),
    ),
    ["personIds"],
    "a person named twice is refused",
  );
  for (const action of ["tag", "untag"] as const) {
    assertEquals(
      Object.keys(bulkInputErrors({ action, personIds: ids(2) })),
      ["tagId"],
      `${action} without a tag is refused`,
    );
  }
  for (const action of ["archive", "restore"] as const) {
    assertEquals(
      Object.keys(bulkInputErrors({ action, personIds: ids(2), tagId })),
      ["tagId"],
      `${action} with a tag is refused`,
    );
  }
});

Deno.test("[PEOPLE-009] archiving or restoring asks for the state a person is not already in", () => {
  assertEquals(transitionPlan("archive", "active"), "proceed", "archive");
  assertEquals(transitionPlan("restore", "archived"), "proceed", "restore");
  assertEquals(
    transitionPlan("archive", "archived"),
    "unchanged",
    "already archived",
  );
  assertEquals(
    transitionPlan("restore", "active"),
    "unchanged",
    "already active",
  );
  for (const action of ["archive", "restore"] as const) {
    assertEquals(
      transitionPlan(action, "deleted"),
      "not-found",
      `${action} of a deleted person`,
    );
  }
});

Deno.test("[PEOPLE-009] tagging adds or removes one tag and leaves the rest", () => {
  assertEquals(
    tagChange("tag", [otherTag], tagId),
    { status: "change", tagIds: [otherTag, tagId] },
    "adds after the existing tags",
  );
  assertEquals(
    tagChange("tag", [tagId, otherTag], tagId),
    { status: "unchanged" },
    "already tagged",
  );
  assertEquals(
    tagChange("untag", [tagId, otherTag], tagId),
    { status: "change", tagIds: [otherTag] },
    "removes only that tag",
  );
  assertEquals(
    tagChange("untag", [otherTag], tagId),
    { status: "unchanged" },
    "never tagged",
  );
});

Deno.test("[PEOPLE-009] every refused item has one stable code", () => {
  assertEquals(
    [
      "archived-write-rejected",
      "forbidden",
      "hidden",
      "invalid-reference",
      "not-found",
      "stale",
      "validation-error",
      "unavailable",
    ].map((status) => bulkFailureCode(status)),
    [
      "archived_write_rejected",
      "forbidden",
      "section_hidden",
      "tag_unavailable",
      "not_found",
      "stale",
      "invalid",
      "unavailable",
    ],
    "codes",
  );
  assertEquals(
    bulkFailureCode("something-new"),
    "unavailable",
    "an unknown status",
  );
});

Deno.test("[PEOPLE-009] the summary counts each outcome", () => {
  const [a, b, c, d, e] = ids(5);
  assertEquals(
    bulkSummary([
      { outcome: "done", personId: a! },
      { outcome: "done", personId: b! },
      { outcome: "unchanged", personId: c! },
      { code: "not_found", outcome: "failed", personId: d! },
      { outcome: "skipped", personId: e! },
    ]),
    { done: 2, failed: 1, skipped: 1, unchanged: 1 },
    "summary",
  );
});
