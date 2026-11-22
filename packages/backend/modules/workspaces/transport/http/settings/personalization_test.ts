/**
 * The vocabularies a workspace configures for itself.
 *
 * Sections are a path parameter the use case validates, so an uncataloged one
 * is a missing link rather than an invalid field, and every section refuses
 * the fields it does not have.
 */

import { createSettingsRoutes } from "../settings.ts";
import { assert, assertStatus } from "../../../../../testing/assert.ts";
import { actor, headers, services } from "./settings.test-helper.ts";
import { CONTACT_METHOD_KINDS } from "../../../public.ts";
import { CONTACT_METHOD_KINDS as CONTRACT_CONTACT_METHOD_KINDS } from "../../../../../../contracts/schemas/settings.ts";
import { SETTINGS_ROUTES } from "../../../../../../contracts/routes/settings.ts";

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

Deno.test("[GAP-050] a contact method type's kind reaches the use case, and only for that section", async () => {
  const received: unknown[] = [];
  const base = services();
  const app = createSettingsRoutes({
    ...base,
    personalization: {
      isSection: (value): value is "contact-method-types" | "tags" =>
        value === "contact-method-types" || value === "tags",
      list: () => Promise.resolve({ status: "forbidden" }),
      mutate: (_actor, _section, input) => {
        received.push(input);
        return Promise.resolve({ status: "conflict" });
      },
    },
  });
  const id = "00000000-0000-4000-8000-000000000021";
  const expectedUpdatedAt = "2026-08-16T10:00:00.000Z";
  const send = (path: string, method: string, body: unknown) =>
    app.request(`http://localhost/api/v1/settings/personalization/${path}`, {
      body: JSON.stringify(body),
      headers,
      method,
    });
  assertStatus(
    await send("contact-method-types", "POST", {
      contactKind: "email",
      name: "Email",
    }),
    409,
    "a kind is accepted on create",
  );
  assertStatus(
    await send(`contact-method-types/${id}`, "PATCH", {
      contactKind: "phone",
      expectedUpdatedAt,
    }),
    409,
    "a kind alone is a change",
  );
  assertStatus(
    await send("contact-method-types", "POST", {
      contactKind: "fax",
      name: "Fax",
    }),
    400,
    "an unknown kind is refused",
  );
  assertStatus(
    await send("tags", "POST", { contactKind: "email", name: "Tag" }),
    400,
    "no other section has a kind",
  );
  assert(
    JSON.stringify(received) === JSON.stringify([
      { action: "create", contactKind: "email", name: "Email", sortOrder: 0 },
      { action: "update", expectedUpdatedAt, id, contactKind: "phone" },
    ]),
    JSON.stringify(received),
  );
  assert(
    JSON.stringify(CONTACT_METHOD_KINDS) ===
      JSON.stringify(CONTRACT_CONTACT_METHOD_KINDS),
    "the domain's kinds are the ones the contract publishes",
  );
});

const ENTRY = {
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
  referenceCount: 0,
  sortOrder: 0,
  updatedAt: "2026-08-16T10:00:00.000Z",
} as const;

Deno.test("[MCP-B9] vocabulary grants admit bearer reads and writes independently and never borrow the cookie", async () => {
  const tokenId = "00000000-0000-4000-8000-0000000000aa";
  const asked: string[] = [];
  const acted: (string | undefined)[] = [];
  let sessionReads = 0;
  const base = services();
  const app = createSettingsRoutes({
    ...base,
    apiTokens: {
      authenticate: (token, scope) => {
        asked.push(scope);
        return Promise.resolve(
          token === scope
            ? { actor, status: "authenticated" as const, tokenId }
            : { status: "invalid" as const },
        );
      },
    },
    personalization: {
      isSection: (value): value is "tags" => value === "tags",
      list: (who) => {
        acted.push(who.apiTokenId);
        return Promise.resolve({
          capabilities: { create: true, editValue: false },
          entries: [ENTRY],
          readOnly: false,
          status: "ready",
        });
      },
      mutate: (who, _section, input) => {
        acted.push(who.apiTokenId);
        return Promise.resolve(
          input.action === "delete"
            ? { id: ENTRY.id, status: "deleted" }
            : { entry: ENTRY, status: "saved" },
        );
      },
    },
    protectedSessions: {
      ...base.protectedSessions,
      resolve: (command) => {
        sessionReads += 1;
        return base.protectedSessions.resolve(command);
      },
    },
  });
  const entry = `/api/v1/settings/personalization/tags/${ENTRY.id}`;
  const revision = `expectedUpdatedAt=${encodeURIComponent(ENTRY.updatedAt)}`;
  const routes = [
    ["GET", "/api/v1/settings/personalization/tags", "vocabularies:read"],
    ["POST", "/api/v1/settings/personalization/tags", "vocabularies:write", {
      name: "Neighbours",
    }],
    ["PATCH", entry, "vocabularies:write", {
      expectedUpdatedAt: ENTRY.updatedAt,
      name: "Close friends",
    }],
    ["DELETE", `${entry}?${revision}`, "vocabularies:write"],
  ] as const;
  for (const [method, path, grant, body] of routes) {
    const send = (
      headers: Record<string, string>,
      payload: unknown = body,
      target: string = path,
    ) =>
      app.request(`http://localhost${target}`, {
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        headers: { "content-type": "application/json", ...headers },
        method,
      });
    const label = `${method} ${path}`;
    acted.length = 0;
    sessionReads = 0;
    const admitted = await send({ authorization: `Bearer ${grant}` });
    assertStatus(admitted, 200, `${label} admits ${grant} without Origin`);
    assert(acted[0] === tokenId, `${label} acted as the token`);
    for (
      const wrong of [
        "vocabularies:read",
        "vocabularies:write",
        "people:read",
        "people:write",
      ].filter((scope) => scope !== grant)
    ) {
      assertStatus(
        await send({
          authorization: `Bearer ${wrong}`,
          cookie: "kinship_session=current-token",
          origin: "http://localhost",
        }),
        401,
        `${label} refuses ${wrong}`,
      );
    }
    assertStatus(
      await send({
        authorization: "Bearer revoked",
        cookie: "kinship_session=current-token",
        origin: "http://localhost",
      }),
      401,
      `${label} never borrows the cookie`,
    );
    assert(sessionReads === 0, `${label} bearer resolved the cookie session`);
    if (method === "GET") continue;
    assertStatus(
      method === "DELETE"
        ? await send(
          { authorization: "Bearer people:write" },
          undefined,
          `${entry}?expectedUpdatedAt=stale-and-unparsable`,
        )
        : await send({ authorization: "Bearer people:write" }, {
          unexpected: true,
        }),
      401,
      `${label} refuses a token before judging its input`,
    );
    for (const origin of [undefined, "http://attacker.test"]) {
      assertStatus(
        await send({
          cookie: "kinship_session=current-token",
          ...(origin ? { origin } : {}),
        }),
        403,
        `${label} cookie write still needs the exact Origin`,
      );
    }
    acted.length = 0;
    assertStatus(
      await send({
        cookie: "kinship_session=current-token",
        origin: "http://localhost",
      }),
      200,
      `${label} cookie write is still admitted`,
    );
    assert(acted[0] === undefined, `${label} cookie write names no token`);
  }
  assert(
    asked.includes("vocabularies:read") && asked.includes("vocabularies:write"),
    `each grant was checked: ${asked}`,
  );
});

Deno.test("[MCP-B9] cookie personalization requests keep their check order", async () => {
  const base = services();
  const app = createSettingsRoutes({
    ...base,
    protectedSessions: {
      ...base.protectedSessions,
      resolve: () => Promise.resolve(undefined),
    },
  });
  const write = (headers: Record<string, string>) =>
    app.request("http://localhost/api/v1/settings/personalization/tags", {
      body: JSON.stringify({ name: "" }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    });
  const writes = [
    (await write({ origin: "http://attacker.test" })).status,
    (await write({
      origin: "http://localhost",
      "x-workspace-id": "not-a-workspace",
    })).status,
    (await write({ origin: "http://localhost" })).status,
  ];
  assert(
    JSON.stringify(writes) === JSON.stringify([403, 400, 400]),
    `cookie write order changed: ${writes}`,
  );
  const read = (path: string, headers: Record<string, string> = {}) =>
    app.request(`http://localhost/api/v1/settings/personalization/${path}`, {
      headers,
    });
  const reads = [
    (await read("not-a-section", { "x-workspace-id": "not-a-workspace" }))
      .status,
    (await read("not-a-section")).status,
    (await read("tags")).status,
  ];
  assert(
    JSON.stringify(reads) === JSON.stringify([400, 404, 401]),
    `cookie read order changed: ${reads}`,
  );
});

Deno.test("[MCP-B9] the personalization routes are the settings surface's only token routes", () => {
  const vocabularies: Record<string, string> = {
    createPersonalizationEntry: "vocabularies:write",
    deletePersonalizationEntry: "vocabularies:write",
    listPersonalizationEntries: "vocabularies:read",
    updatePersonalizationEntry: "vocabularies:write",
  };
  for (const route of SETTINGS_ROUTES) {
    const scope = vocabularies[route.operationId];
    assert(
      route.tokenScope === scope,
      `${route.operationId} requires ${scope ?? "no token scope"}`,
    );
    assert(
      JSON.stringify(route.security) === JSON.stringify(
        scope
          ? [{ kinship_session: [] }, { kinship_api_token: [] }]
          : [{ kinship_session: [] }],
      ),
      `${route.operationId} is ${scope ? "session or token" : "session-only"}`,
    );
  }
});
