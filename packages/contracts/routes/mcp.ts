/**
 * The Model Context Protocol endpoint (ADR 0009, MCP-C1), once.
 *
 * An agent holding a personal API token posts one JSON-RPC message here. The
 * endpoint lists the tools the token's scopes allow and answers a tool call by
 * sending the tool's route an in-process request that carries the same token,
 * so every rule a REST client meets is met on the one existing path. It
 * accepts any valid token and names no scope (`ANY_TOKEN_OPERATIONS`), and it
 * never reads a session cookie. `GET` and `DELETE` on the same path answer
 * 405: the endpoint keeps no session and offers no server-initiated stream.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  problemResponse,
  problemResponses,
  workspaceHeaders,
} from "./common.ts";
import { mcpMessage } from "../schemas/mcp.ts";

/** Where the endpoint answers. */
export const MCP_PATH = "/api/v1/mcp";

/** What an MCP request may carry besides the protocol's own headers. */
export const mcpHeaders = workspaceHeaders.extend({
  Origin: z.url().optional().meta({
    description:
      "Optional. MCP clients send none; a request that carries one other than the configured public web origin is refused with 403.",
  }),
});

const jsonRpcAnswer = {
  "application/json": mcpMessage,
};

export const mcp = defineRoute({
  method: "post",
  path: MCP_PATH,
  operationId: "mcp",
  description:
    "Model Context Protocol over Streamable HTTP, stateless, for 2025-era (initialize) and 2026-07-28 clients. Accepts any valid personal token in Authorization: Bearer and never reads a session cookie; a missing or refused token answers 401 with WWW-Authenticate: Bearer. tools/list returns only the tools the token's scopes allow, and tools/call sends the tool's own route an in-process request with the same token, so that route's scope, role, workspace, legal, validation, retry, and audit rules apply unchanged. Every answer is one JSON body; there is no session and no server-initiated stream, and GET and DELETE answer 405.",
  security: [{ kinship_api_token: [] }],
  request: {
    headers: mcpHeaders,
    body: {
      required: true,
      content: { "application/json": mcpMessage },
    },
  },
  responses: {
    200: {
      description:
        "The JSON-RPC response to a request, a tool's result included; a refused or failed tool call is a result with isError set",
      content: jsonRpcAnswer,
    },
    202: {
      description: "A JSON-RPC notification or response, accepted",
    },
    400: {
      description:
        "A malformed X-Workspace-Id (RFC 9457 problem), or a message the protocol refuses (a JSON-RPC error)",
      content: {
        ...jsonRpcAnswer,
        ...problemResponse.content,
      },
    },
    ...problemResponses(401, 403),
  },
});

/** Every MCP route, in the order the surface mounts them. */
export const MCP_ROUTES: readonly RouteDescriptor[] = [mcp];
