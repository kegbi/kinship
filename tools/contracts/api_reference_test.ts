import { buildArtefacts } from "./build.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  assertEquals,
  assertThrows,
} from "../../packages/backend/testing/assert.ts";
import { buildExternalOpenApiDocument } from "./external.ts";
import { buildOpenApiDocument } from "./document.ts";
import { DOCUMENTED_ROUTES } from "../../packages/contracts/routes/mod.ts";

Deno.test("public API reference is a generated fourth contract artefact", async () => {
  const artefacts = await buildArtefacts();
  assert(
    artefacts.some((artefact) => artefact.path === "openapi/external.json"),
    "missing bearer-only external OpenAPI artefact",
  );
});

Deno.test("external operations are exactly the registry's bearer surface with complete schemas", () => {
  const internal = buildOpenApiDocument();
  const before = JSON.stringify(internal);
  const external = buildExternalOpenApiDocument(internal);
  const paths = external.paths as Record<
    string,
    Record<string, {
      security: unknown;
      parameters?: { name: string; in: string; required: boolean }[];
    }>
  >;
  const actual: string[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      actual.push(`${method} ${path}`);
      assertEquals(operation.security, [{ kinship_api_token: [] }]);
      assert(
        !operation.parameters?.some((p) => p.name === "Origin"),
        "Origin leaked into bearer parameters",
      );
      assert(
        operation.parameters?.some((p) =>
          p.name === "X-Workspace-Id" && !p.required
        ),
        "optional workspace header missing",
      );
    }
  }
  const expected = DOCUMENTED_ROUTES.filter((route) =>
    route.security?.some((entry) => "kinship_api_token" in entry)
  ).map((route) => `${route.method} ${route.path}`);
  assertEquals(actual.sort(), expected.sort());
  assert(actual.length > 0, "the registry publishes a bearer surface");
  const components = external.components as {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
  const original = internal.components as { schemas: Record<string, unknown> };
  const reached = new Set<string>();
  function walk(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref") {
        assert(
          typeof child === "string" &&
            child.startsWith("#/components/schemas/"),
          "nonlocal schema ref",
        );
        const name = child.slice("#/components/schemas/".length);
        assert(name in components.schemas, `unresolved ${name}`);
        if (!reached.has(name)) {
          reached.add(name);
          walk(components.schemas[name]);
        }
      } else walk(child);
    }
  }
  walk(paths);
  assertEquals([...reached].sort(), Object.keys(components.schemas).sort());
  for (const [name, schema] of Object.entries(components.schemas)) {
    assertEquals(
      schema,
      original.schemas[name],
      `lost schema composition for ${name}`,
    );
  }
  for (
    const name of [
      "AddressFact",
      "RelationshipType",
      "ProfileFactValue",
      "InteractionInput",
    ]
  ) {
    assert(name in components.schemas, `missing ${name}`);
  }
  assertEquals(Object.keys(components.securitySchemes), ["kinship_api_token"]);
  assertEquals(
    JSON.stringify(internal),
    before,
    "projection mutated internal contract",
  );
});

const fixture = (schema: unknown) => ({
  openapi: "3.1.0",
  info: { title: "Internal", version: "1" },
  paths: {
    "/public": {
      get: { security: [{ kinship_api_token: [] }], responses: schema },
    },
    "/private": {
      get: { responses: {} },
      post: { security: [{ kinship_session: [] }] },
    },
  },
  components: {
    securitySchemes: { kinship_api_token: { type: "http", scheme: "bearer" } },
    schemas: {
      Cycle: {
        properties: { self: { $ref: "#/components/schemas/Cycle" } },
        dependentRequired: { label: ["reverseLabel"] },
      },
    },
  },
});

Deno.test("reference closure preserves cycles, dependent fields and unparameterized operations", () => {
  const source = fixture({ $ref: "#/components/schemas/Cycle" });
  const external = buildExternalOpenApiDocument(source);
  assertEquals(external.components, source.components);
  assertEquals(Object.keys(external.paths as object), ["/public"]);
});

Deno.test("external contract refuses dangling and nonlocal references", () => {
  assertThrows(
    () =>
      buildExternalOpenApiDocument(
        fixture({ $ref: "#/components/schemas/Missing" }),
      ),
    "dangling ref refused",
  );
  assertThrows(
    () =>
      buildExternalOpenApiDocument(
        fixture({ $ref: "https://other.test/schema" }),
      ),
    "nonlocal ref refused",
  );
});
