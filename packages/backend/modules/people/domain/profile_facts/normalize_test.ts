import { assertEquals } from "../../../../testing/assert.ts";
import { normalizeProfileFact } from "./normalize.ts";

Deno.test("[GAP-015] a food preference is trimmed and never dropped", () => {
  assertEquals(
    normalizeProfileFact("food-preferences", {
      foodPreferences: "  no shellfish  ",
    }),
    { foodPreferences: "no shellfish" },
  );
  assertEquals(
    normalizeProfileFact("food-preferences", { foodPreferences: "   " }),
    { foodPreferences: "" },
    "an empty preference survives normalization so validation can refuse it",
  );
});

Deno.test("[GAP-015] a first meeting keeps only the parts it was told", () => {
  assertEquals(
    normalizeProfileFact("first-meeting", {
      introducedByPersonId: "00000000-0000-4000-8000-000000000001",
      notes: "  at a lecture  ",
      placeText: "  London  ",
    }),
    {
      introducedByPersonId: "00000000-0000-4000-8000-000000000001",
      notes: "at a lecture",
      placeText: "London",
    },
  );
  assertEquals(
    normalizeProfileFact("first-meeting", { notes: "  ", placeText: "" }),
    {},
  );
});

Deno.test("[GAP-015] tags and labels keep only their distinct entries", () => {
  assertEquals(
    normalizeProfileFact("tags", { tagIds: ["a", "b", "a"] }),
    { tagIds: ["a", "b"] },
  );
  assertEquals(
    normalizeProfileFact("contact-methods", {
      isPrimary: true,
      labelIds: ["home", "home", "work"],
      notes: "  ask first  ",
      typeId: "email",
      value: "  ada@example.com  ",
    }),
    {
      isPrimary: true,
      labelIds: ["home", "work"],
      notes: "ask first",
      typeId: "email",
      value: "ada@example.com",
    },
  );
  assertEquals(
    normalizeProfileFact("contact-methods", {
      isPrimary: false,
      labelIds: [],
      notes: "   ",
      typeId: "email",
      value: "   ",
    }),
    { isPrimary: false, labelIds: [], typeId: "email", value: "" },
  );
});

Deno.test("[GAP-015] an address keeps every line it actually has", () => {
  assertEquals(
    normalizeProfileFact("addresses", {
      city: "  London ",
      country: " England ",
      displayName: " Home ",
      isPrimary: true,
      labelIds: ["home", "home"],
      postalCode: " W1 ",
      region: " Greater London ",
      street: " 12 Marylebone ",
    }),
    {
      city: "London",
      country: "England",
      displayName: "Home",
      isPrimary: true,
      labelIds: ["home"],
      postalCode: "W1",
      region: "Greater London",
      street: "12 Marylebone",
    },
  );
  assertEquals(
    normalizeProfileFact("addresses", {
      city: "  ",
      country: "",
      displayName: "   ",
      isPrimary: false,
      labelIds: [],
      postalCode: " ",
      region: "",
      street: "  ",
    }),
    { isPrimary: false, labelIds: [] },
  );
});

Deno.test("[GAP-015] an occupation keeps its dates verbatim and trims its text", () => {
  assertEquals(
    normalizeProfileFact("work", {
      description: "  analytical engines  ",
      endOn: "1843-12-31",
      isCurrent: false,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationName: "  Analytical Society  ",
      startOn: "1842-01-01",
      title: "  Mathematician  ",
    }),
    {
      description: "analytical engines",
      endOn: "1843-12-31",
      isCurrent: false,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationName: "Analytical Society",
      startOn: "1842-01-01",
      title: "Mathematician",
    },
  );
  assertEquals(
    normalizeProfileFact("work", {
      description: "   ",
      isCurrent: true,
      organizationName: "  ",
      title: "  ",
    }),
    { isCurrent: true, title: "" },
  );
});

Deno.test("[GAP-015] a pet keeps whichever of its three parts it has", () => {
  assertEquals(
    normalizeProfileFact("pets", {
      categoryId: "00000000-0000-4000-8000-000000000003",
      name: "  Mrs Chippy  ",
      notes: "  a cat  ",
    }),
    {
      categoryId: "00000000-0000-4000-8000-000000000003",
      name: "Mrs Chippy",
      notes: "a cat",
    },
  );
  assertEquals(normalizeProfileFact("pets", { name: " ", notes: "" }), {});
});
