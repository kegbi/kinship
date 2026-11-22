/**
 * The agent tool catalog the MCP endpoint serves (ADR 0009, MCP-C1).
 *
 * Each area file declares its tools beside the routes they call, and
 * `collectTools` gathers them, refusing two tools under one name and a tool
 * whose route the API does not register, so the catalog cannot name a call
 * the app would not answer.
 *
 * Every token-enabled JSON route is a tool (MCP-C2): `uncoveredTokenRoutes`
 * is the rule the contract test holds the catalog to, and `TOOL_EXCLUSIONS`
 * is the one place a route may say in writing why it is not a tool.
 */

import type { RouteDescriptor } from "../registry.ts";
import { ANY_TOKEN_OPERATIONS, API_ROUTES } from "../routes/mod.ts";
import type { AgentTool } from "./define.ts";
import { CONTEXT_TOOLS } from "./context.ts";
import { GIFT_TOOLS } from "./gifts.ts";
import { INTERACTION_TOOLS } from "./interactions.ts";
import { JOURNAL_TOOLS } from "./journal.ts";
import { OVERVIEW_TOOLS } from "./overview.ts";
import { PEOPLE_TOOLS } from "./people.ts";
import { PLANNING_TOOLS } from "./planning.ts";
import { PROFILE_TOOLS } from "./profile.ts";
import { RELATIONSHIP_TOOLS } from "./relationships.ts";
import { VOCABULARY_TOOLS } from "./vocabularies.ts";

export { AGENT_INSTRUCTIONS } from "./instructions.ts";

/**
 * Token-enabled routes that are deliberately not tools, by operation id, each
 * with its reason. A route whose request or success answer is not JSON (a
 * binary upload or download) belongs here too: a tool carries JSON only.
 */
export const TOOL_EXCLUSIONS: Readonly<Record<string, string>> = {
  mcp: "The MCP endpoint itself; a tool cannot call the endpoint serving it.",
};

/**
 * The token routes no tool calls and no exclusion names, by operation id,
 * sorted, so a failure lists exactly what still needs a tool.
 */
export function uncoveredTokenRoutes(
  tools: readonly AgentTool[],
  exclusions: Readonly<Record<string, string>>,
  registered: readonly RouteDescriptor[] = API_ROUTES,
): readonly string[] {
  const called = new Set(tools.map((tool) => tool.route.operationId));
  return registered
    .filter((route) =>
      route.tokenScope !== undefined ||
      ANY_TOKEN_OPERATIONS.includes(route.operationId)
    )
    .map((route) => route.operationId)
    .filter((operationId) =>
      !called.has(operationId) && !(exclusions[operationId]?.trim())
    )
    .sort();
}

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

/** One area of the catalog, as the guide groups it. */
export interface ToolArea {
  readonly id: string;
  readonly title: string;
  readonly tools: readonly AgentTool[];
}

/** The catalog's areas, in the order an agent meets them. */
export const TOOL_AREAS: readonly ToolArea[] = [
  { id: "context", title: "Connection", tools: CONTEXT_TOOLS },
  { id: "overview", title: "Search and Today", tools: OVERVIEW_TOOLS },
  { id: "people", title: "People", tools: PEOPLE_TOOLS },
  { id: "profile", title: "Profile", tools: PROFILE_TOOLS },
  { id: "relationships", title: "Relationships", tools: RELATIONSHIP_TOOLS },
  { id: "interactions", title: "Interactions", tools: INTERACTION_TOOLS },
  { id: "planning", title: "Tasks and reminders", tools: PLANNING_TOOLS },
  { id: "journal", title: "Journal", tools: JOURNAL_TOOLS },
  { id: "gifts", title: "Gifts and debts", tools: GIFT_TOOLS },
  { id: "vocabularies", title: "Vocabularies", tools: VOCABULARY_TOOLS },
];

/** Every tool, in catalog order. */
export const AGENT_TOOLS: readonly AgentTool[] = collectTools(
  TOOL_AREAS.map((area) => area.tools),
  API_ROUTES,
);
