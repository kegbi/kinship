/**
 * The tool catalog the endpoint serves (MCP-C1).
 *
 * MCP-C1 serves the routes that were token-enabled when the endpoint landed,
 * plus `get_context`. MCP-C2 replaces the fixed list below with the rule
 * that every token-enabled JSON route is a tool or is excluded with a reason.
 */

import { z } from "zod";
import { acceptsToken } from "../registry.ts";
import { API_ROUTES } from "../routes/mod.ts";
import { AGENT_TOOLS, TOOL_EXCLUSIONS } from "./mod.ts";
import { assert, assertEquals } from "../../backend/testing/assert.ts";

Deno.test("[MCP-C1] the catalog serves the token routes of MCP-A1 and the token's context", () => {
  assertEquals(
    AGENT_TOOLS.map((tool) => `${tool.name} ${tool.route.operationId}`),
    [
      "get_context getTokenContext",
      "list_people listPeople",
      "get_person_identity getPersonIdentity",
      "list_important_dates listImportantDates",
      "list_profile_facts listProfileFacts",
      "list_relationships listRelationships",
      "list_relationship_types listRelationshipTypes",
      "list_interaction_options listInteractionOptions",
      "list_communication_options listCommunicationOptions",
      "record_note recordInteraction",
      "record_activity recordInteraction",
      "record_call recordInteraction",
      "record_conversation recordInteraction",
      "list_tasks listTasks",
      "get_task getTask",
      "create_task createTask",
      "update_task changeTask",
      "set_task_completion setTaskCompletion",
    ],
  );
});

Deno.test("[MCP-C1] every tool's arguments are one plain object an MCP client can read", () => {
  for (const tool of AGENT_TOOLS) {
    const json = z.toJSONSchema(tool.input, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    assert(json.type === "object", `${tool.name} has an object root`);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      assert(!(key in json), `${tool.name} has no ${key} at its root`);
    }
    assert(
      tool.scope === tool.route.tokenScope,
      `${tool.name} requires its route's scope`,
    );
  }
});

Deno.test("[MCP-C1] each interaction kind is its own tool with a minted retry key", () => {
  for (const kind of ["note", "activity", "call", "conversation"]) {
    const tool = AGENT_TOOLS.find((each) => each.name === `record_${kind}`);
    assert(tool !== undefined, `record_${kind} exists`);
    assertEquals(tool.fixed, { kind });
    assertEquals(tool.minted, { requestId: "uuid" });
    assert(!("kind" in tool.input.shape), `record_${kind} takes no kind`);
  }
  const create = AGENT_TOOLS.find((tool) => tool.name === "create_task");
  assertEquals(create?.minted, { requestId: "uuid" });
});

Deno.test("[MCP-C1] every exclusion names a registered token route", () => {
  for (const operationId of Object.keys(TOOL_EXCLUSIONS)) {
    const route = API_ROUTES.find((each) => each.operationId === operationId);
    assert(
      route !== undefined && acceptsToken(route),
      `${operationId} is a registered token route`,
    );
  }
});
