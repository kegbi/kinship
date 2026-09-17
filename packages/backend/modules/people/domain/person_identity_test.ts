import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  type CreatePersonInput,
  derivePersonId,
  normalizeCreatePersonInput,
  PERSON_ID_NAMESPACE,
  type PersonIdentity,
  personIdentityFrom,
  sameIdentity,
  validateCreatePersonInput,
} from "./person_identity.ts";

const ada: CreatePersonInput = {
  familyName: "Lovelace",
  givenName: "Ada",
  isPartial: false,
  middleName: "Augusta",
  nickname: "Addy",
};

Deno.test("[GAP-015] normalization trims every part and drops the blank ones", () => {
  assertEquals(
    normalizeCreatePersonInput({
      familyName: "  Lovelace ",
      givenName: "  Ada  ",
      isPartial: false,
      middleName: "   ",
      nickname: " Addy ",
    }),
    {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
      nickname: "Addy",
    },
  );
  assertEquals(
    normalizeCreatePersonInput({
      familyName: "   ",
      givenName: "Ada",
      isPartial: true,
      middleName: " Augusta ",
      nickname: "   ",
    }),
    { givenName: "Ada", isPartial: true, middleName: "Augusta" },
  );
});

Deno.test("[GAP-015] normalization keeps a duplicate override and nothing else", () => {
  assertEquals(
    normalizeCreatePersonInput({
      duplicateOverride: true,
      givenName: "Ada",
      isPartial: true,
    }),
    { duplicateOverride: true, givenName: "Ada", isPartial: true },
  );
  assertEquals(
    normalizeCreatePersonInput({
      duplicateOverride: false,
      givenName: "Ada",
      isPartial: false,
    }),
    { givenName: "Ada", isPartial: false },
    "a declined override is absent, not false",
  );
});

Deno.test("[GAP-015] a person needs one usable name part", () => {
  assertEquals(
    validateCreatePersonInput({ givenName: "", isPartial: true }),
    { givenName: "Enter a given name, family name, or nickname." },
  );
  assertEquals(
    validateCreatePersonInput({ givenName: "", isPartial: false }),
    { givenName: "Enter a given name, family name, or nickname." },
    "the missing-name message comes first",
  );
  assertEquals(validateCreatePersonInput(ada), {});
});

Deno.test("[GAP-015] a nameless person has to admit they are partial", () => {
  assertEquals(
    validateCreatePersonInput({
      familyName: "Lovelace",
      givenName: "",
      isPartial: false,
    }),
    {
      isPartial: "Mark the person as partial when their given name is unknown.",
    },
  );
  assertEquals(
    validateCreatePersonInput({
      familyName: "Lovelace",
      givenName: "",
      isPartial: true,
    }),
    {},
  );
});

Deno.test("[GAP-015] a replayed identity matches only when every part does", () => {
  const stored: PersonIdentity = {
    familyName: "Lovelace",
    givenName: "Ada",
    id: "00000000-0000-4000-8000-000000000001",
    isPartial: false,
    middleName: "Augusta",
    nickname: "Addy",
  };
  assert(sameIdentity(stored, ada), "the same parts are the same identity");
  for (
    const different of [
      { ...ada, givenName: "Adaline" },
      { ...ada, familyName: "Byron" },
      { ...ada, middleName: "August" },
      { ...ada, nickname: "Ada" },
      { ...ada, isPartial: true },
    ]
  ) {
    assert(
      !sameIdentity(stored, different),
      `a changed part is a different identity: ${JSON.stringify(different)}`,
    );
  }
});

Deno.test("[GAP-015] an identity carries only the parts the input had", () => {
  assertEquals(
    personIdentityFrom("00000000-0000-4000-8000-000000000002", ada),
    {
      familyName: "Lovelace",
      givenName: "Ada",
      id: "00000000-0000-4000-8000-000000000002",
      isPartial: false,
      middleName: "Augusta",
      nickname: "Addy",
    },
  );
  assertEquals(
    personIdentityFrom("00000000-0000-4000-8000-000000000003", {
      duplicateOverride: true,
      givenName: "Ada",
      isPartial: true,
    }),
    {
      givenName: "Ada",
      id: "00000000-0000-4000-8000-000000000003",
      isPartial: true,
    },
    "an override is a creation decision, never part of the identity",
  );
  assertEquals(
    personIdentityFrom("00000000-0000-4000-8000-000000000004", {
      givenName: "Ada",
      isPartial: false,
      middleName: "Augusta",
    }),
    {
      givenName: "Ada",
      id: "00000000-0000-4000-8000-000000000004",
      isPartial: false,
      middleName: "Augusta",
    },
  );
});

Deno.test("[GAP-015] the derived person id is pinned to the rows already stored", async () => {
  assertEquals(PERSON_ID_NAMESPACE, "kinship.people.external-id.v1");
  assertEquals(
    await derivePersonId("0F5B9C2A-1111-4222-8333-444455556666", "Req-ABC"),
    "cadade8f-3984-8b3d-9f7f-4d0a4e08bd91",
  );
  assertEquals(
    await derivePersonId("0f5b9c2a-1111-4222-8333-444455556666", "req-abc"),
    "cadade8f-3984-8b3d-9f7f-4d0a4e08bd91",
    "a retry in a different case lands on the same person",
  );
  assert(
    await derivePersonId("0F5B9C2A-1111-4222-8333-444455556666", "Req-ABD") !==
      "cadade8f-3984-8b3d-9f7f-4d0a4e08bd91",
    "a different request is a different person",
  );
});
