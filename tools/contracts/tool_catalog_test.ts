/**
 * The generated tool catalog is the catalog, whole and in order (MCP-C2).
 */

import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  TOOL_AREAS,
} from "../../packages/contracts/tools/mod.ts";
import { buildToolCatalog, renderToolCatalog } from "./tool_catalog.ts";

interface CatalogTool {
  readonly name: string;
  readonly area: string;
  readonly scope: string | null;
  readonly annotations: Record<string, boolean>;
  readonly route: { operationId: string; method: string; path: string };
  readonly inputSchema: { type?: string };
}

Deno.test("[MCP-C2] the generated catalog lists every tool in catalog order with its route and scope", () => {
  const catalog = buildToolCatalog() as {
    instructions: string;
    areas: { id: string; tools: string[] }[];
    tools: CatalogTool[];
  };
  assertEquals(catalog.instructions, AGENT_INSTRUCTIONS);
  assertEquals(
    catalog.tools.map((tool) => tool.name),
    AGENT_TOOLS.map((tool) => tool.name),
  );
  assertEquals(
    catalog.areas.map((area) => area.id),
    TOOL_AREAS.map((area) => area.id),
  );
  for (const [index, entry] of catalog.tools.entries()) {
    const tool = AGENT_TOOLS[index]!;
    assertEquals(entry.scope, tool.scope ?? null, tool.name);
    assertEquals(entry.route, {
      operationId: tool.route.operationId,
      method: tool.route.method.toUpperCase(),
      path: tool.route.path,
    });
    assertEquals(entry.annotations, { ...tool.annotations });
    assertEquals(entry.inputSchema.type, "object", tool.name);
    assert(
      catalog.areas.find((area) => area.id === entry.area)?.tools.includes(
        tool.name,
      ) === true,
      `${tool.name} is listed under its area`,
    );
  }
  assertEquals(
    catalog.tools.find((tool) => tool.name === "get_context")?.scope,
    null,
    "a tool any token may call has no scope",
  );
});

Deno.test("[MCP-C2] the generated catalog is the same text on every build", () => {
  const first = renderToolCatalog();
  assertEquals(renderToolCatalog(), first);
  assert(first.endsWith("}\n"), "one trailing newline");
});
