import { assertEquals } from "../../../../testing/assert.ts";
import { validateProfileFact } from "./validate.ts";

const personId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";

Deno.test("[GAP-015] nobody introduced themselves", () => {
  assertEquals(
    validateProfileFact(
      "first-meeting",
      { introducedByPersonId: personId },
      personId,
    ),
    { introducedByPersonId: "Choose another person." },
  );
  assertEquals(
    validateProfileFact(
      "first-meeting",
      { introducedByPersonId: otherId, placeText: "London" },
      personId,
    ),
    {},
  );
  assertEquals(validateProfileFact("first-meeting", {}, personId), {});
});

Deno.test("[GAP-015] a contact method and a food preference each need a value", () => {
  assertEquals(
    validateProfileFact(
      "contact-methods",
      { isPrimary: false, labelIds: [], typeId: "email", value: "" },
      personId,
    ),
    { value: "Enter a contact value." },
  );
  assertEquals(
    validateProfileFact(
      "contact-methods",
      {
        isPrimary: false,
        labelIds: [],
        typeId: "email",
        value: "ada@example.com",
      },
      personId,
    ),
    {},
  );
  assertEquals(
    validateProfileFact(
      "food-preferences",
      { foodPreferences: "" },
      personId,
    ),
    { foodPreferences: "Enter a food preference or use Clear." },
  );
  assertEquals(
    validateProfileFact(
      "food-preferences",
      { foodPreferences: "no shellfish" },
      personId,
    ),
    {},
  );
});

Deno.test("[GAP-015] an occupation needs a title and a range that runs forwards", () => {
  assertEquals(
    validateProfileFact(
      "work",
      {
        endOn: "1842-01-01",
        isCurrent: false,
        startOn: "1843-01-01",
        title: "",
      },
      personId,
    ),
    {
      title: "Enter a role or title.",
      endOn: "End date must be on or after the start date.",
    },
  );
  assertEquals(
    validateProfileFact(
      "work",
      {
        endOn: "1843-01-01",
        isCurrent: false,
        startOn: "1842-01-01",
        title: "Mathematician",
      },
      personId,
    ),
    {},
  );
  assertEquals(
    validateProfileFact(
      "work",
      { isCurrent: true, startOn: "1842-01-01", title: "Mathematician" },
      personId,
    ),
    {},
    "an open-ended role has no range to check",
  );
});

Deno.test("[GAP-015] an address needs at least one line", () => {
  assertEquals(
    validateProfileFact(
      "addresses",
      { isPrimary: false, labelIds: [] },
      personId,
    ),
    { address: "Enter an address name or location detail." },
  );
  for (
    const line of [
      { displayName: "Home" },
      { street: "12 Marylebone" },
      { city: "London" },
      { region: "Greater London" },
      { postalCode: "W1" },
      { country: "England" },
    ]
  ) {
    assertEquals(
      validateProfileFact(
        "addresses",
        { isPrimary: false, labelIds: [], ...line },
        personId,
      ),
      {},
      `one line is enough: ${JSON.stringify(line)}`,
    );
  }
});

Deno.test("[GAP-015] a pet needs a name or a category, and a tag set needs neither", () => {
  assertEquals(
    validateProfileFact("pets", {}, personId),
    { pet: "Enter a pet name or select a category." },
  );
  assertEquals(
    validateProfileFact("pets", { name: "Mrs Chippy" }, personId),
    {},
  );
  assertEquals(
    validateProfileFact("pets", { categoryId: otherId }, personId),
    {},
  );
  assertEquals(validateProfileFact("tags", { tagIds: [] }, personId), {});
});
