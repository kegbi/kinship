import { assertEquals } from "../../../testing/assert.ts";
import {
  canonicalPersonId,
  mergedUiState,
  projection,
  RECENT_PEOPLE_LIMIT,
  recentPersonIds,
  storedUiState,
  validMemberUiState,
  withRecentPerson,
} from "./ui_state_rules.ts";

const PERSON = (index: number) => `1111111${index}-1111-4111-8111-111111111111`;

Deno.test("[GAP-018] the column may hold text, a record, or nonsense", () => {
  assertEquals(storedUiState({ theme: "dark" }), { theme: "dark" });
  assertEquals(storedUiState('{"theme":"dark"}'), { theme: "dark" });
  assertEquals(storedUiState("not json"), {});
  assertEquals(storedUiState("[1,2]"), {}, "a list is not a record");
  assertEquals(storedUiState(null), {});
  assertEquals(storedUiState(undefined), {});
  assertEquals(storedUiState(7), {});
});

Deno.test("[GAP-018] a read is projected to the two fields this module knows", () => {
  assertEquals(
    projection({ personWorkspaceView: "timeline", theme: "dark" }),
    { personWorkspaceView: "timeline", theme: "dark" },
  );
  assertEquals(
    projection('{"personWorkspaceView":"admin","theme":"light","other":1}'),
    { personWorkspaceView: "admin", theme: "light" },
    "whatever else the column holds never reaches a page",
  );
  assertEquals(projection({ personWorkspaceView: "nope", theme: "neon" }), {});
  assertEquals(projection({}), {});
  assertEquals(projection("not json"), {});
  for (const view of ["all", "timeline", "planning", "things", "admin"]) {
    assertEquals(projection({ personWorkspaceView: view }), {
      personWorkspaceView: view,
    });
  }
  for (const theme of ["system", "light", "dark"]) {
    assertEquals(projection({ theme }), { theme });
  }
});

Deno.test("[GAP-018] a save has to name a known field and nothing else", () => {
  assertEquals(validMemberUiState({ theme: "dark" }), true);
  assertEquals(validMemberUiState({ personWorkspaceView: "all" }), true);
  assertEquals(
    validMemberUiState({ personWorkspaceView: "all", theme: "system" }),
    true,
  );
  assertEquals(validMemberUiState({}), false, "an empty save did nothing");
  assertEquals(validMemberUiState({ theme: "dark", other: 1 }), false);
  assertEquals(validMemberUiState({ theme: "neon" }), false);
  assertEquals(validMemberUiState({ personWorkspaceView: "nope" }), false);
  assertEquals(
    validMemberUiState({ theme: undefined }),
    false,
    "a key that is present but unusable is unusable",
  );
  assertEquals(validMemberUiState(null), false);
  assertEquals(validMemberUiState("theme"), false);
  assertEquals(validMemberUiState(["theme"]), false);
});

Deno.test("[GAP-018] a save merges rather than replaces", () => {
  assertEquals(
    mergedUiState(
      { recentPersonIds: [PERSON(1)], theme: "light" },
      { theme: "dark" },
    ),
    { recentPersonIds: [PERSON(1)], theme: "dark" },
  );
  assertEquals(
    mergedUiState({ theme: "light" }, { personWorkspaceView: "admin" }),
    { theme: "light", personWorkspaceView: "admin" },
  );
  assertEquals(mergedUiState("not json", { theme: "dark" }), { theme: "dark" });
});

Deno.test("[GAP-018] a person identifier is canonicalised, or refused", () => {
  assertEquals(canonicalPersonId(PERSON(1).toUpperCase()), PERSON(1));
  assertEquals(canonicalPersonId("not a uuid"), undefined);
  assertEquals(
    canonicalPersonId("11111111-1111-8111-8111-111111111111"),
    undefined,
    "a derived identifier is not a person somebody opened",
  );
});

Deno.test("[GAP-018] the stored list is cleaned before it is read", () => {
  assertEquals(recentPersonIds([PERSON(1), PERSON(2)]), [
    PERSON(1),
    PERSON(2),
  ]);
  assertEquals(
    recentPersonIds([PERSON(1).toUpperCase(), PERSON(1)]),
    [PERSON(1)],
    "the same person twice is the same person",
  );
  assertEquals(recentPersonIds([1, "nope", PERSON(3)]), [PERSON(3)]);
  assertEquals(recentPersonIds("not a list"), []);
  assertEquals(recentPersonIds(undefined), []);
  assertEquals(
    recentPersonIds(
      Array.from({ length: 12 }, (_, index) => PERSON(index % 10)),
    ).length,
    RECENT_PEOPLE_LIMIT,
  );
});

Deno.test("[GAP-018] recording a person moves them to the front and keeps eight", () => {
  assertEquals(
    withRecentPerson({ recentPersonIds: [PERSON(2), PERSON(3)] }, PERSON(1)),
    { recentPersonIds: [PERSON(1), PERSON(2), PERSON(3)] },
  );
  assertEquals(
    withRecentPerson({ recentPersonIds: [PERSON(2), PERSON(1)] }, PERSON(1)),
    { recentPersonIds: [PERSON(1), PERSON(2)] },
    "somebody looked at again moves rather than repeats",
  );
  assertEquals(
    withRecentPerson({ theme: "dark" }, PERSON(1)),
    { theme: "dark", recentPersonIds: [PERSON(1)] },
    "the column's other fields survive",
  );
  const full = withRecentPerson(
    {
      recentPersonIds: Array.from(
        { length: 8 },
        (_, index) => PERSON(index + 1),
      ),
    },
    PERSON(0),
  );
  assertEquals(
    (full.recentPersonIds as readonly string[]).length,
    RECENT_PEOPLE_LIMIT,
  );
  assertEquals((full.recentPersonIds as readonly string[])[0], PERSON(0));
});
