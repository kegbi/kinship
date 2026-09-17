import { assertEquals } from "../../../testing/assert.ts";
import { displayName, UNNAMED_PERSON } from "./person_name.ts";

Deno.test("[GAP-015] the formal name wins whenever there is one", () => {
  assertEquals(
    displayName({ familyName: "Lovelace", givenName: "Ada" }),
    "Ada Lovelace",
  );
  assertEquals(displayName({ givenName: "Ada" }), "Ada");
  assertEquals(displayName({ familyName: "Lovelace" }), "Lovelace");
  assertEquals(
    displayName({ familyName: "Lovelace", givenName: "Ada", nickname: "Addy" }),
    "Ada Lovelace",
    "a nickname never overrides a formal name",
  );
});

Deno.test("[GAP-015] a blank-only part counts as no part at all", () => {
  assertEquals(displayName({ givenName: "", nickname: "Addy" }), "Addy");
  assertEquals(displayName({ givenName: "   ", nickname: "Addy" }), "Addy");
  assertEquals(
    displayName({ familyName: null, givenName: null, nickname: "Addy" }),
    "Addy",
  );
});

Deno.test("[GAP-015] a person with no usable name falls back to one phrase", () => {
  assertEquals(displayName({}), UNNAMED_PERSON);
  assertEquals(
    displayName({ familyName: null, givenName: "  ", nickname: null }),
    UNNAMED_PERSON,
  );
  assertEquals(UNNAMED_PERSON, "Unnamed person");
});
