/**
 * The tool catalog's contract (ADR 0009 point 5, MCP-C2).
 *
 * Every route a personal token may call is an agent tool, or is listed in
 * `TOOL_EXCLUSIONS` with the reason it is not. The rule is derived from the
 * registry, so a lane that token-enables a route without declaring its tool
 * fails here with the operation ids it left uncovered. A small sample of names
 * is pinned so a rename is noticed; the whole list is not.
 */

import { z } from "zod";
import { acceptsToken } from "../registry.ts";
import { ANY_TOKEN_OPERATIONS, API_ROUTES } from "../routes/mod.ts";
import {
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  TOOL_EXCLUSIONS,
  uncoveredTokenRoutes,
} from "./mod.ts";
import { assert, assertEquals } from "../../backend/testing/assert.ts";

const tokenRoutes = API_ROUTES.filter((route) =>
  route.tokenScope !== undefined ||
  ANY_TOKEN_OPERATIONS.includes(route.operationId)
);

Deno.test("[MCP-C2] every token route is a tool or is excluded with a reason", () => {
  const uncovered = uncoveredTokenRoutes(AGENT_TOOLS, TOOL_EXCLUSIONS);
  assert(
    uncovered.length === 0,
    `token routes with no tool and no exclusion: ${uncovered.join(", ")}`,
  );
  assert(tokenRoutes.length > 0, "the registry has token routes");
});

Deno.test("[MCP-C2] the completeness rule names each uncovered operation", () => {
  const withoutTasks = AGENT_TOOLS.filter((tool) =>
    tool.route.operationId !== "listTasks" &&
    tool.route.operationId !== "getTask"
  );
  assertEquals(uncoveredTokenRoutes(withoutTasks, TOOL_EXCLUSIONS), [
    "getTask",
    "listTasks",
  ]);
});

Deno.test("[MCP-C2] every exclusion has a reason and names a token route no tool calls", () => {
  const called = new Set(AGENT_TOOLS.map((tool) => tool.route.operationId));
  for (const [operationId, reason] of Object.entries(TOOL_EXCLUSIONS)) {
    const route = API_ROUTES.find((each) => each.operationId === operationId);
    assert(
      route !== undefined && acceptsToken(route),
      `${operationId} is a registered token route`,
    );
    assert(reason.trim().length > 0, `${operationId} says why it is excluded`);
    assert(!called.has(operationId), `${operationId} is excluded and a tool`);
  }
});

Deno.test("[MCP-C2] every tool name is unique and a snake_case verb_noun", () => {
  const names = AGENT_TOOLS.map((tool) => tool.name);
  assertEquals(new Set(names).size, names.length, "names are unique");
  const verbs = new Set([
    "add",
    "archive",
    "create",
    "delete",
    "get",
    "list",
    "merge",
    "record",
    "remove",
    "restore",
    "search",
    "set",
    "update",
  ]);
  for (const name of names) {
    assert(/^[a-z]+(?:_[a-z]+)+$/.test(name), `${name} is snake_case`);
    assert(
      verbs.has(name.split("_")[0] ?? ""),
      `${name} starts with a catalog verb`,
    );
  }
});

Deno.test("[MCP-C2] every tool's arguments are one plain object that converts to JSON Schema", () => {
  for (const tool of AGENT_TOOLS) {
    const json = z.toJSONSchema(tool.input, {
      io: "input",
      unrepresentable: "throw",
    }) as Record<string, unknown>;
    assert(json.type === "object", `${tool.name} has an object root`);
    for (const key of ["anyOf", "oneOf", "allOf", "not"]) {
      assert(!(key in json), `${tool.name} has no ${key} at its root`);
    }
    assert(
      tool.scope === tool.route.tokenScope,
      `${tool.name} requires its route's scope`,
    );
    assert(
      tool.description.length >= 80 && tool.description.length <= 1200,
      `${tool.name} has an agent-sized description`,
    );
  }
});

Deno.test("[MCP-C2] reads are read-only and destructive tools say so", () => {
  for (const tool of AGENT_TOOLS) {
    const reads = tool.route.method === "get";
    assertEquals(tool.annotations.readOnlyHint, reads, `${tool.name} reads`);
    if (reads) {
      assert(!tool.annotations.destructiveHint, `${tool.name} destroys none`);
    }
    if (tool.name.startsWith("delete_") || tool.name.startsWith("merge_")) {
      assert(tool.annotations.destructiveHint, `${tool.name} is destructive`);
    }
    if (Object.keys(tool.minted).length > 0) {
      assert(
        !tool.annotations.idempotentHint,
        `${tool.name} mints a key, so a repeat without one is not a no-op`,
      );
    }
  }
});

Deno.test("[MCP-C2] every create that takes a retry key mints it", () => {
  for (const tool of AGENT_TOOLS) {
    if (tool.route.method !== "post") continue;
    if (!("requestId" in (tool.locations ?? {}))) continue;
    assertEquals(tool.minted, { requestId: "uuid" }, tool.name);
  }
});

Deno.test("[MCP-C2] a sample of names stays put", () => {
  const byName = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));
  for (
    const [name, operationId] of [
      ["get_context", "getTokenContext"],
      ["list_people", "listPeople"],
      ["create_person", "createPerson"],
      ["delete_person", "deletePerson"],
      ["add_contact_method", "createProfileFact"],
      ["record_note", "recordInteraction"],
      ["create_task", "createTask"],
      ["create_relationship", "createRelationship"],
      ["create_journal_post", "createJournalPost"],
      ["create_gift", "createGift"],
      ["search_workspace", "searchWorkspace"],
      ["create_tag", "createPersonalizationEntry"],
    ] as const
  ) {
    assertEquals(byName.get(name)?.route.operationId, operationId, name);
  }
});

Deno.test("[MCP-C2] the server instructions are short and name the first calls", () => {
  const words = AGENT_INSTRUCTIONS.split(/\s+/).length;
  assert(words <= 150, `at most 150 words, not ${words}`);
  for (const tool of ["get_context", "list_people"]) {
    assert(AGENT_INSTRUCTIONS.includes(tool), `the instructions name ${tool}`);
    assert(
      AGENT_TOOLS.some((each) => each.name === tool),
      `${tool} is a tool`,
    );
  }
  assert(AGENT_INSTRUCTIONS.includes("requestId"), "they advise a retry key");
});
