import { describe, expect, it } from "vitest";
import catalog from "../../../../../packages/contracts/mcp/tools.json";
import { API_TOKEN_SCOPE_CHOICES } from "../settings/api-access/api-access.ts";
import {
  grantSections,
  guideAreas,
  guideTools,
  type McpCatalog,
  type McpTool,
  operationLink,
  retryKeyTools,
  schemaFields,
  toolTraits,
} from "./guide.ts";

const generated = catalog as unknown as McpCatalog;

const annotations = (
  overrides: Partial<McpTool["annotations"]> = {},
): McpTool["annotations"] => ({
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
  ...overrides,
});

function tool(name: string, overrides: Partial<McpTool> = {}): McpTool {
  return {
    annotations: annotations(),
    area: "people",
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
    name,
    route: { method: "GET", operationId: "listPeople", path: "/api/v1/people" },
    scope: "people:read",
    title: `${name} title`,
    ...overrides,
  };
}

function fixture(tools: readonly McpTool[]): McpCatalog {
  return {
    areas: [
      { id: "context", title: "Connection", tools: [] },
      { id: "people", title: "People", tools: [] },
      { id: "profile", title: "Profile", tools: [] },
    ],
    endpoint: { method: "POST", path: "/api/v1/mcp" },
    instructions: "Call get_context first.",
    tools,
  };
}

describe("MCP-C3 the guide's tool reference", () => {
  it("renders every catalog tool exactly once, in its area's order", () => {
    const rendered = guideTools(generated);
    expect(generated.tools.length).toBeGreaterThan(0);
    expect(rendered).toHaveLength(generated.tools.length);
    expect(new Set(rendered.map(({ tool }) => tool.name)).size).toBe(
      generated.tools.length,
    );
    const areaOrder = generated.areas.map(({ id }) => id);
    const positions = rendered.map(({ tool }) => areaOrder.indexOf(tool.area));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(guideAreas(generated).flatMap(({ tools }) => tools)).toEqual(
      rendered,
    );
  });

  it("keeps a tool whose area the catalog does not list, under its own id", () => {
    const areas = guideAreas(fixture([
      tool("get_context", { area: "context", scope: null }),
      tool("mystery", { area: "later" }),
    ]));
    expect(areas.map(({ id, title }) => [id, title])).toEqual([
      ["context", "Connection"],
      ["later", "later"],
    ]);
    expect(areas[1]!.tools.map(({ tool }) => tool.name)).toEqual(["mystery"]);
  });

  it("links each tool to its documented REST operation, and to nothing otherwise", () => {
    expect(
      operationLink({
        method: "GET",
        operationId: "getTokenContext",
        path: "/api/v1/me",
      }),
    ).toBe("/docs/api#getTokenContext");
    expect(
      operationLink({
        method: "GET",
        operationId: "notDocumented",
        path: "/api/v1/nowhere",
      }),
    ).toBeUndefined();
    for (const { tool, operationHref } of guideTools(generated)) {
      if (operationHref === undefined) continue;
      expect(operationHref).toBe(`/docs/api#${tool.route.operationId}`);
    }
  });
});

describe("MCP-C3 retry keys", () => {
  it("names exactly the tools whose input takes a requestId", () => {
    expect(retryKeyTools(fixture([
      tool("create_person", {
        inputSchema: {
          type: "object",
          properties: { requestId: { type: "string", format: "uuid" } },
        },
      }),
      tool("create_gift"),
    ]))).toEqual(["create_person"]);
    expect(retryKeyTools(generated)).toEqual(
      generated.tools.filter(({ inputSchema }) =>
        "requestId" in (inputSchema.properties ?? {})
      ).map(({ name }) => name),
    );
  });
});

describe("MCP-C3 annotations in words", () => {
  it("marks a destructive tool in text, never by colour alone", () => {
    expect(
      toolTraits(annotations({ destructiveHint: true, readOnlyHint: false })),
    ).toEqual({ destructive: true, words: ["Destructive", "Idempotent"] });
    expect(toolTraits(annotations())).toEqual({
      destructive: false,
      words: ["Read-only", "Idempotent"],
    });
    expect(
      toolTraits(annotations({ idempotentHint: false, readOnlyHint: false })),
    ).toEqual({ destructive: false, words: ["Changes data"] });
    expect(toolTraits(annotations({ openWorldHint: true })).words).toContain(
      "Reaches beyond Kinship",
    );
  });

  it("follows the generated annotations for every tool", () => {
    for (const { tool, traits } of guideTools(generated)) {
      expect(traits.destructive).toBe(tool.annotations.destructiveHint);
    }
  });
});

describe("MCP-C3 grants and the tools they unlock", () => {
  it("lists every grant the token form offers, and each catalog tool under its grant", () => {
    const sections = grantSections(generated);
    const rows = sections.flatMap(({ grants }) => grants);
    for (const { scope } of API_TOKEN_SCOPE_CHOICES) {
      expect(rows.filter((row) => row.scope === scope)).toHaveLength(1);
    }
    const listed = rows.flatMap(({ scope, areas }) =>
      areas.flatMap(({ tools }) =>
        tools.map(({ name }) => [name, scope] as const)
      )
    );
    expect(listed).toHaveLength(generated.tools.length);
    expect(new Map(listed)).toEqual(
      new Map(generated.tools.map(({ name, scope }) => [name, scope])),
    );
  });

  it("groups a grant's tools by catalog area and marks the destructive ones", () => {
    const sections = grantSections(fixture([
      tool("get_context", { area: "context", scope: null }),
      tool("list_dates", { area: "profile", scope: "people:write" }),
      tool("create_person", { area: "people", scope: "people:write" }),
      tool("delete_date", {
        annotations: annotations({
          destructiveHint: true,
          readOnlyHint: false,
        }),
        area: "profile",
        scope: "people:write",
      }),
      tool("future", { area: "people", scope: "future:read" }),
    ]));
    expect(sections[0]).toMatchObject({
      id: "any",
      grants: [{ scope: null, label: "Any valid token" }],
    });
    const write = sections.flatMap(({ grants }) => grants).find((row) =>
      row.scope === "people:write"
    )!;
    expect(write.areas).toEqual([
      {
        id: "people",
        title: "People",
        tools: [{ destructive: false, name: "create_person" }],
      },
      {
        id: "profile",
        title: "Profile",
        tools: [
          { destructive: false, name: "list_dates" },
          { destructive: true, name: "delete_date" },
        ],
      },
    ]);
    expect(write.caution).toBeUndefined();
    const deletion = sections.flatMap(({ grants }) => grants).find((row) =>
      row.scope === "people:delete"
    )!;
    expect(deletion).toMatchObject({ areas: [], caution: "destructive" });
    expect(sections.at(-1)).toMatchObject({
      id: "other",
      grants: [{ scope: "future:read", label: "future:read" }],
    });
  });

  it("leaves out the any-token and unknown-grant groups when nothing needs them", () => {
    const ids = grantSections(fixture([tool("list_people")])).map(({ id }) =>
      id
    );
    expect(ids).not.toContain("any");
    expect(ids).not.toContain("other");
  });
});

describe("MCP-C3 input fields from JSON Schema", () => {
  it("reads names, types, required, descriptions, enum values, and constraints", () => {
    const fields = schemaFields({
      type: "object",
      $defs: {
        Section: { type: "string", enum: ["addresses", "pets"] },
      },
      properties: {
        section: { $ref: "#/$defs/Section" },
        givenName: {
          type: "string",
          description: "First name.",
          minLength: 1,
          maxLength: 200,
        },
        nickname: { type: "string", maxLength: 200 },
        code: { type: "string", minLength: 2 },
        id: {
          type: "string",
          format: "uuid",
          pattern: "^[0-9a-f-]+$",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        page: { type: "integer", minimum: 1 },
        top: { type: "integer", maximum: 9 },
        status: { type: "string", enum: ["active", "archived"] },
        confirmed: { type: "boolean", const: true },
        body: { type: "string", pattern: "\\S" },
        dueAt: {
          anyOf: [
            { type: "string", format: "date-time", maxLength: 40 },
            { type: "null" },
          ],
        },
        genderId: {
          anyOf: [{ type: "string", format: "uuid" }, {
            type: "string",
            const: "",
          }],
        },
        ids: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: { type: "string", format: "uuid" },
        },
        few: { type: "array", maxItems: 3, items: { $ref: "#/$defs/Section" } },
        some: { type: "array", minItems: 2, items: {} },
        loose: {},
      },
      required: ["givenName", "section"],
    });
    const byName = new Map(fields.map((field) => [field.name, field]));
    expect(fields.map(({ name }) => name)).toEqual([
      "section",
      "givenName",
      "nickname",
      "code",
      "id",
      "limit",
      "page",
      "top",
      "status",
      "confirmed",
      "body",
      "dueAt",
      "genderId",
      "ids",
      "few",
      "some",
      "loose",
    ]);
    expect(byName.get("section")).toEqual({
      constraints: [],
      name: "section",
      required: true,
      type: "string",
      values: ["addresses", "pets"],
    });
    expect(byName.get("givenName")).toEqual({
      constraints: ["1–200 characters"],
      description: "First name.",
      name: "givenName",
      required: true,
      type: "string",
    });
    expect(byName.get("nickname")?.constraints).toEqual([
      "at most 200 characters",
    ]);
    expect(byName.get("code")?.constraints).toEqual(["at least 2 characters"]);
    expect(byName.get("id")).toMatchObject({
      constraints: [],
      required: false,
      type: "string (uuid)",
    });
    expect(byName.get("limit")?.constraints).toEqual([
      "from 1 to 50",
      "default 20",
    ]);
    expect(byName.get("page")?.constraints).toEqual(["at least 1"]);
    expect(byName.get("top")?.constraints).toEqual(["at most 9"]);
    expect(byName.get("status")?.values).toEqual(["active", "archived"]);
    expect(byName.get("confirmed")?.type).toBe("true");
    expect(byName.get("body")?.constraints).toEqual(["matches \\S"]);
    expect(byName.get("dueAt")).toMatchObject({
      constraints: ["at most 40 characters"],
      type: "string (date-time) or null",
    });
    expect(byName.get("genderId")?.type).toBe('string (uuid) or ""');
    expect(byName.get("ids")).toMatchObject({
      constraints: ["1–50 items"],
      type: "array of string (uuid)",
    });
    expect(byName.get("few")).toMatchObject({
      constraints: ["at most 3 items"],
      type: "array of string",
      values: ["addresses", "pets"],
    });
    expect(byName.get("some")).toMatchObject({
      constraints: ["at least 2 items"],
      type: "array of any",
    });
    expect(byName.get("loose")?.type).toBe("any");
  });

  it("expands an array of objects into its members", () => {
    const fields = schemaFields({
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string", maxLength: 10 },
              direction: { type: "string", enum: ["inbound", "outbound"] },
            },
            required: ["content"],
          },
        },
      },
    });
    expect(fields.map(({ name, type, required }) => [name, type, required]))
      .toEqual([
        ["messages", "array of object", false],
        ["messages[].content", "string", true],
        ["messages[].direction", "string", false],
      ]);
  });

  it("reads an object with no properties as no input", () => {
    expect(schemaFields({ type: "object" })).toEqual([]);
    expect(schemaFields({ type: "object", properties: {} })).toEqual([]);
  });

  it("describes a field of every catalog tool", () => {
    for (const { tool, fields } of guideTools(generated)) {
      expect(fields.map(({ name }) => name)).toEqual(
        expect.arrayContaining(Object.keys(tool.inputSchema.properties ?? {})),
      );
      for (const field of fields) expect(field.type).not.toBe("");
    }
  });
});
