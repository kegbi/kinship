/**
 * The seven profile sections, read and written on one strict transport.
 *
 * One suite because the sections share four routes: what proves the
 * transport keeps create and update apart in one section proves it in all
 * seven.
 */

import type { ProfileFactManagement } from "../../public.ts";
import { createPeopleRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { actor, headers, services } from "./people.test-helper.ts";

Deno.test("PEOPLE-006 HTTP refreshes one strict profile-fact section", async () => {
  const personId = fixtures.personId();
  const factId = "00000000-0000-4000-8000-000000000200";
  const record = {
    id: factId,
    section: "contact-methods" as const,
    updatedAt: "2026-08-16T12:00:00.000000Z",
    value: {
      isPrimary: true,
      labelIds: [] as readonly string[],
      typeId: "00000000-0000-4000-8000-000000000300",
      value: "ada@example.test",
    },
  };
  let savedPersonId = "";
  const listInputs: unknown[] = [];
  const save: ProfileFactManagement["create"] = (
    _actor,
    receivedPersonId,
    section,
    input,
  ) => {
    savedPersonId = receivedPersonId;
    if (section === "work" && "endOn" in input) {
      return Promise.resolve({
        errors: {
          endOn: "End date must be on or after the start date.",
        },
        status: "validation-error" as const,
      });
    }
    return Promise.resolve({
      personUpdatedAt: "2026-08-16T12:00:00.000001Z",
      record,
      status: "saved",
    });
  };
  const profileFacts: ProfileFactManagement = {
    create: save,
    delete: () =>
      Promise.resolve({
        factId,
        personUpdatedAt: "2026-08-16T12:00:00.000001Z",
        status: "deleted",
      }),
    list: (_actor, _personId, _section, input) => {
      const receivedInput = input ?? {};
      listInputs.push(receivedInput);
      if (
        receivedInput.cursor === "forged-fact" ||
        receivedInput.optionCursor === "forged-option"
      ) {
        return Promise.resolve({ status: "stale-cursor" as const });
      }
      return Promise.resolve({
        options: [],
        personUpdatedAt: "2026-08-16T12:00:00.000000Z",
        records: [record],
        status: "ready",
      });
    },
    update: save,
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create person")) },
    undefined,
    undefined,
    undefined,
    undefined,
    profileFacts,
  ));
  const listed = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    { headers },
  );
  const listedBody = await listed.clone().json() as {
    readonly records?: readonly {
      readonly value?: { readonly section?: string };
    }[];
  };
  assert(
    listed.status === 200 &&
      listedBody.records?.[0]?.value?.section === "contact-methods",
    "section read is available with a discriminated value",
  );
  const falseOptions = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods?includeOptions=false`,
    { headers },
  );
  assertStatus(
    falseOptions,
    400,
    "includeOptions rejects every value except the literal true semantic",
  );
  const beforeMissingInclude = listInputs.length;
  for (const cursor of ["valid-looking", "stale", "forged-option"]) {
    const missingInclude = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/contact-methods?optionCursor=${cursor}`,
      { headers },
    );
    assertStatus(
      missingInclude,
      400,
      "option cursors require the explicit options continuation mode",
    );
  }
  assert(
    listInputs.length === beforeMissingInclude,
    "invalid option cursor combinations stop before the people facade",
  );
  const forgedFactCursor = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods?cursor=forged-fact`,
    { headers },
  );
  const forgedOptionCursor = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods?includeOptions=true&optionSearch=Email&optionCursor=forged-option`,
    { headers },
  );
  assert(
    forgedFactCursor.status === 409 && forgedOptionCursor.status === 409 &&
      JSON.stringify(listInputs.at(-1)) === JSON.stringify({
          includeOptions: true,
          optionCursor: "forged-option",
          optionSearch: "Email",
        }),
    "opaque fact and option cursors are passed through and stale cursors map to 409",
  );
  const saved = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "contact-methods",
      }),
      headers,
      method: "POST",
    },
  );
  assert(
    saved.status === 200 && savedPersonId === personId,
    "strict local save reaches the resolved person",
  );
  const createWithId = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        id: factId,
        section: "contact-methods",
      }),
      headers,
      method: "POST",
    },
  );
  const incompleteUpdate = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods/${factId}`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "contact-methods",
      }),
      headers,
      method: "PUT",
    },
  );
  const updated = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods/${factId}`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        expectedUpdatedAt: record.updatedAt,
        id: factId,
        section: "contact-methods",
      }),
      headers,
      method: "PUT",
    },
  );
  assert(
    createWithId.status === 400 && incompleteUpdate.status === 400 &&
      updated.status === 200,
    "create forbids IDs while item update requires matching ID and revision",
  );
  for (
    const [section, value] of [
      ["addresses", { city: "London", isPrimary: false, labelIds: [] }],
      ["first-meeting", { notes: "Met at a salon" }],
      ["food-preferences", { foodPreferences: "Tea" }],
      ["pets", { name: "Byron" }],
      ["tags", { tagIds: [] }],
      ["work", { isCurrent: true, title: "Engineer" }],
    ] as const
  ) {
    const body = {
      ...value,
      expectedPersonUpdatedAt: record.updatedAt,
      expectedUpdatedAt: record.updatedAt,
      id: factId,
      section,
    };
    const createRejected = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/${section}`,
      { body: JSON.stringify(body), headers, method: "POST" },
    );
    const updateAccepted = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/${section}/${factId}`,
      { body: JSON.stringify(body), headers, method: "PUT" },
    );
    assert(
      createRejected.status === 400 && updateAccepted.status === 200,
      `${section} keeps create and update transport identities separate`,
    );
  }
  const extra = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "contact-methods",
        workspaceId: actor.workspaceId,
      }),
      headers,
      method: "POST",
    },
  );
  assertStatus(extra, 400, "route rejects undeclared workspace evidence");
  for (
    const [section, value] of [
      ["addresses", { isPrimary: false, labelIds: [] }],
      ["first-meeting", {}],
      ["food-preferences", {}],
      ["pets", { notes: "Notes alone are not a pet identity" }],
    ] as const
  ) {
    const rejected = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/${section}`,
      {
        body: JSON.stringify({
          ...value,
          expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
          section,
        }),
        headers,
        method: "POST",
      },
    );
    assertStatus(rejected, 400, `${section} rejects an empty fact`);
  }
  for (
    const invalid of [
      {},
      {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        foodPreferences: "Tea",
        isPrimary: true,
        labelIds: [],
        typeId: "00000000-0000-4000-8000-000000000300",
        value: "ada@example.test",
      },
      {
        city: "London",
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        isPrimary: false,
        labelIds: [],
        section: "addresses",
      },
    ]
  ) {
    const rejected = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
      { body: JSON.stringify(invalid), headers, method: "POST" },
    );
    assertStatus(rejected, 400, "empty and cross-section inputs fail");
  }
  const invalidRange = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/work`,
    {
      body: JSON.stringify({
        endOn: "2025-12-31",
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        isCurrent: false,
        section: "work",
        startOn: "2026-01-01",
        title: "Engineer",
      }),
      headers,
      method: "POST",
    },
  );
  const rangeProblem = await invalidRange.json() as {
    readonly errors?: Readonly<Record<string, string>>;
  };
  assert(
    invalidRange.status === 400 && rangeProblem.errors?.endOn,
    "work range failures remain field-level 400 responses",
  );
  const clearedFood = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/food-preferences/${personId}`,
    {
      body: JSON.stringify({
        expectedPersonUpdatedAt: record.updatedAt,
        expectedUpdatedAt: record.updatedAt,
        section: "food-preferences",
      }),
      headers,
      method: "DELETE",
    },
  );
  assertStatus(
    clearedFood,
    200,
    "food preferences expose an explicit clear command",
  );
});
