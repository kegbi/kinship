import { describe, expect, it } from "vitest";
import external from "../../../../../packages/contracts/openapi/external.json";
import { apiTokenScope } from "../../../../../packages/contracts/schemas/api_tokens.ts";
import {
  referencedSchemas,
  referenceOperations,
  referenceSchemas,
} from "./reference.ts";
import { GET, prerender } from "../../pages/docs/api/openapi.json.ts";

describe("public API contract presentation", () => {
  it("prerenders the exact generated external contract as a downloadable JSON response", async () => {
    expect(prerender).toBe(true);
    const response = GET();
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="kinship-openapi.json"',
    );
    expect(await response.json()).toEqual(external);
  });
  it("renders every generated operation and schema, without browser endpoints", () => {
    const published = Object.values(external.paths).flatMap(Object.keys);
    expect(published.length).toBeGreaterThan(0);
    expect(referenceOperations).toHaveLength(published.length);
    expect(referenceOperations.map(({ path, method }) => `${method} ${path}`))
      .toEqual(
        Object.entries(external.paths).flatMap(([path, methods]) =>
          Object.keys(methods).map((method) =>
            `${method.toUpperCase()} ${path}`
          )
        ),
      );
    expect(referenceSchemas).toEqual(
      Object.entries(external.components.schemas),
    );
    expect(
      referenceOperations.some(({ operation }) =>
        operation.operationId === "getPerson"
      ),
    ).toBe(false);
  });

  it("links nested references without flattening parent properties or refinements", () => {
    const value = {
      properties: { address: { $ref: "#/components/schemas/AddressFact" } },
      oneOf: [{ $ref: "#/components/schemas/RelationshipType" }],
      anyOf: [{ $ref: "#/components/schemas/AddressFact" }],
      dependentRequired: { label: ["reverseLabel"] },
    };
    expect(referencedSchemas(value)).toEqual([
      "AddressFact",
      "RelationshipType",
    ]);
    expect(value.properties.address).toEqual({
      $ref: "#/components/schemas/AddressFact",
    });
    expect(value.dependentRequired).toEqual({ label: ["reverseLabel"] });
    expect(referencedSchemas({ type: "boolean" })).toEqual([]);
  });
});

describe("MCP-W1 required grant per operation", () => {
  it("names each operation's grant from the generated contract, and every grant is a known scope", () => {
    const declared = Object.values(external.paths).flatMap((methods) =>
      Object.values(methods).map((operation) =>
        (operation as Record<string, unknown>)["x-kinship-token-scope"]
      )
    );
    expect(referenceOperations.map(({ tokenScope }) => tokenScope)).toEqual(
      declared,
    );
    expect(declared.some((scope) => scope !== undefined)).toBe(true);
    for (const { tokenScope } of referenceOperations) {
      if (tokenScope === undefined) continue;
      expect(apiTokenScope.options).toContain(tokenScope);
    }
    expect(
      referenceOperations.find(({ operation }) =>
        operation.operationId === "getTokenContext"
      )?.tokenScope,
    ).toBeUndefined();
  });
});
