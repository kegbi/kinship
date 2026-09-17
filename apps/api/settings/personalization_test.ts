/**
 * The vocabularies a workspace configures for itself.
 *
 * Sections are a path parameter the use case validates, so an uncataloged one
 * is a missing link rather than an invalid field, and every section refuses
 * the fields it does not have.
 */

import { createSettingsRoutes } from "../settings.ts";
import {
  assert,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { headers, services } from "./settings.test-helper.ts";

Deno.test("WORKSPACE-003 HTTP keeps personalization private and maps lifecycle outcomes", async () => {
  const base = services();
  const app = createSettingsRoutes({
    ...base,
    personalization: {
      isSection: (value): value is "tags" => value === "tags",
      list: () =>
        Promise.resolve({
          capabilities: { create: true, editValue: false },
          entries: [{
            capabilities: {
              delete: true,
              disable: false,
              editValue: false,
              rename: true,
              reorder: false,
              replace: true,
              setDefault: false,
            },
            canDelete: true,
            id: "00000000-0000-4000-8000-000000000020",
            isActive: true,
            isDefault: false,
            kind: "named",
            name: "Friends",
            readOnly: false,
            referenceCount: 2,
            sortOrder: 0,
            updatedAt: "2026-08-16T10:00:00.000Z",
          }],
          readOnly: false,
          status: "ready",
        }),
      mutate: () => Promise.resolve({ status: "conflict" }),
    },
  });
  const listed = await app.request(
    "http://localhost/api/v1/settings/personalization/tags",
    { headers },
  );
  assertStatus(listed, 200, "accepted section loads");
  assert(
    listed.headers.get("cache-control") === "private, no-store",
    "workspace vocabulary is never shared-cached",
  );
  const listedBody = await listed.json() as {
    readonly capabilities: {
      readonly create: boolean;
      readonly editValue: boolean;
    };
    readonly entries: readonly {
      readonly capabilities: { readonly editValue: boolean };
      readonly readOnly: boolean;
    }[];
    readonly readOnly: boolean;
  };
  assert(
    listedBody.capabilities.create && !listedBody.readOnly &&
      listedBody.entries.every((entry) =>
        !entry.readOnly && entry.capabilities.editValue === false
      ),
    "HTTP contract declares section and item capabilities",
  );
  const duplicate = await app.request(
    "http://localhost/api/v1/settings/personalization/tags",
    {
      body: JSON.stringify({ name: "Friends" }),
      headers,
      method: "POST",
    },
  );
  assertStatus(duplicate, 409, "duplicate name remains distinct");
  assert(
    (await duplicate.json()).code === "personalization_duplicate",
    "safe problem code is stable",
  );
  const collisionApp = createSettingsRoutes({
    ...base,
    personalization: {
      ...base.personalization,
      isSection: (value): value is "relationship-types" =>
        value === "relationship-types",
      list: () => Promise.resolve({ status: "forbidden" }),
      mutate: () => Promise.resolve({ status: "replacement-conflict" }),
    },
  });
  const collision = await collisionApp.request(
    "http://localhost/api/v1/settings/personalization/relationship-types/00000000-0000-4000-8000-000000000020?expectedUpdatedAt=2026-08-16T10%3A00%3A00.000Z&replacementId=00000000-0000-4000-8000-000000000021",
    { headers, method: "DELETE" },
  );
  assertStatus(collision, 409, "relationship replacement collision is stable");
  const collisionBody = await collision.json() as {
    readonly code: string;
    readonly detail: string;
  };
  assert(
    collisionBody.code === "personalization_replacement_conflict" &&
      collisionBody.detail.includes("both the source and replacement"),
    "collision response is actionable",
  );
  const unknown = await app.request(
    "http://localhost/api/v1/settings/personalization/not-a-section",
    { headers },
  );
  assertStatus(unknown, 404, "uncataloged section is not a route surface");
});

Deno.test("WORKSPACE-003 HTTP rejects fields unsupported by the selected section", async () => {
  let mutations = 0;
  const base = services();
  const app = createSettingsRoutes({
    ...base,
    personalization: {
      isSection: (value): value is
        | "gender-options"
        | "reminder-rules"
        | "relationship-types" =>
        value === "gender-options" || value === "reminder-rules" ||
        value === "relationship-types",
      list: () => Promise.resolve({ status: "forbidden" }),
      mutate: () => {
        mutations += 1;
        return Promise.resolve({ status: "conflict" });
      },
    },
  });
  const id = "00000000-0000-4000-8000-000000000020";
  const expectedUpdatedAt = "2026-08-16T10:00:00.000Z";
  const attempts = [
    {
      body: { expectedUpdatedAt, name: "Ignored", sortOrder: 4 },
      section: "reminder-rules",
    },
    {
      body: { expectedUpdatedAt, isDefault: true },
      section: "reminder-rules",
    },
    {
      body: { expectedUpdatedAt, name: "Generic relationship" },
      section: "relationship-types",
    },
    {
      body: { expectedUpdatedAt, isDefault: false },
      section: "gender-options",
    },
  ];
  for (const attempt of attempts) {
    const response = await app.request(
      `http://localhost/api/v1/settings/personalization/${attempt.section}/${id}`,
      {
        body: JSON.stringify(attempt.body),
        headers,
        method: "PATCH",
      },
    );
    assertStatus(response, 400, `${attempt.section} input is strict`);
  }
  assert(mutations === 0, "invalid section fields never enter the application");
});
