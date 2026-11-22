/**
 * The agent tool catalog the MCP endpoint serves (ADR 0009, MCP-C1).
 *
 * Each area file declares its tools beside the routes they call, and
 * `collectTools` gathers them, refusing two tools under one name and a tool
 * whose route the API does not register, so the catalog cannot name a call
 * the app would not answer.
 *
 * MCP-C2 adds a tool for every token-enabled JSON route, and the contract
 * test that each such route is a tool or is listed in `TOOL_EXCLUSIONS` with
 * a reason. The table is here so that test has one place to read.
 */

import type { RouteDescriptor } from "../registry.ts";
import { API_ROUTES } from "../routes/mod.ts";
import type { AgentTool } from "./define.ts";
import { CONTEXT_TOOLS } from "./context.ts";
import { INTERACTION_TOOLS } from "./interactions.ts";
import { PEOPLE_TOOLS } from "./people.ts";
import { PLANNING_TOOLS } from "./planning.ts";
import { RELATIONSHIP_TOOLS } from "./relationships.ts";

/**
 * Token-enabled routes that are deliberately not tools, by operation id, each
 * with its reason.
 */
export const TOOL_EXCLUSIONS: Readonly<Record<string, string>> = {
  mcp: "The MCP endpoint itself; a tool cannot call the endpoint serving it.",
};

/** Gathers tool groups into one catalog, refusing what it cannot serve. */
export function collectTools(
  groups: readonly (readonly AgentTool[])[],
  registered: readonly RouteDescriptor[],
): readonly AgentTool[] {
  const tools = groups.flat();
  const names = new Set<string>();
  const routes = new Set(registered);
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`two tools are named ${tool.name}`);
    }
    names.add(tool.name);
    if (!routes.has(tool.route)) {
      throw new Error(
        `tool ${tool.name} calls ${tool.route.operationId}, which the API does not register`,
      );
    }
  }
  return tools;
}

/** Every tool, in catalog order. */
export const AGENT_TOOLS: readonly AgentTool[] = collectTools([
  CONTEXT_TOOLS,
  PEOPLE_TOOLS,
  RELATIONSHIP_TOOLS,
  INTERACTION_TOOLS,
  PLANNING_TOOLS,
], API_ROUTES);
