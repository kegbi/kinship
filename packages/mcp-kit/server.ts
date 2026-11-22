/**
 * The MCP server one request is answered by (ADR 0009, MCP-C1).
 *
 * A fresh server is built for every request, for one caller, with only the
 * tools the caller's token scopes allow; nothing outlives the request. A tool
 * whose scope the token lacks is not registered at all, so it is neither
 * listed nor callable by name. A registered tool's handler only translates:
 * the call becomes its route's request, the injected `dispatch` answers it,
 * and the answer becomes the result. Role, workspace, legal, validation,
 * retry, and audit rules are the route's, on the route's one path.
 *
 * The protocol library validates a call's arguments before the handler runs.
 * It is handed the tool's contract schema through a Standard Schema adapter
 * that validates without transforming, so the route receives exactly what the
 * agent sent and parses it with its own schema, defaults and trimming
 * included, as it would for a REST client.
 */

import {
  type CallToolResult,
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AgentTool } from "../contracts/tools/define.ts";
import { API_VERSION } from "../contracts/version.ts";
import { type ToolCaller, toolRequest, toolResult } from "./tool_call.ts";

/** Answers one route request in process; the API's own `fetch`. */
export type Dispatch = (request: Request) => Response | Promise<Response>;

/** What the server tells an agent about using it. */
export const SERVER_INSTRUCTIONS =
  "Kinship is a personal relationship manager. Call get_context first: it names the workspace, role, and scopes this connection acts with, and only the tools those scopes allow are listed. Find a person's id with list_people before reading or writing about them. Each tool calls the same API route a REST client would; a refused call returns isError with the route's problem code and field messages, so correct the arguments rather than retrying unchanged.";

type Arguments = Record<string, unknown>;

/**
 * The tool's argument schema as the protocol library takes it: its JSON
 * Schema for `tools/list`, and a check that leaves the arguments as sent.
 */
export function argumentSchema(
  input: z.ZodObject,
): StandardSchemaWithJSON<Arguments, Arguments> {
  const json = z.toJSONSchema(input, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return {
    "~standard": {
      version: 1,
      vendor: "kinship",
      validate: (value: unknown) => {
        const sent = value ?? {};
        const checked = input.safeParse(sent);
        return checked.success ? { value: sent as Arguments } : {
          issues: checked.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        };
      },
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

/** Whether a token with these scopes may be shown this tool. */
export function allows(tool: AgentTool, scopes: readonly string[]): boolean {
  return tool.scope === undefined || scopes.includes(tool.scope);
}

/** One call, start to finish; an unreachable route is an error result. */
async function call(
  tool: AgentTool,
  args: Arguments,
  caller: ToolCaller,
  dispatch: Dispatch,
): Promise<CallToolResult> {
  const response = await Promise.resolve()
    .then(() => dispatch(toolRequest(tool, args, caller)))
    .catch(() => undefined);
  return response === undefined
    ? {
      content: [{
        type: "text",
        text:
          "The call could not be completed. Check whether it took effect before retrying.",
      }],
      isError: true,
    }
    : await toolResult(response);
}

/** A server for one caller, holding the tools the caller's scopes allow. */
export function agentServer(
  tools: readonly AgentTool[],
  caller: ToolCaller,
  dispatch: Dispatch,
): McpServer {
  const server = new McpServer(
    { name: "kinship", version: API_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  for (const tool of tools) {
    if (!allows(tool, caller.scopes)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: argumentSchema(tool.input),
        annotations: { title: tool.title, ...tool.annotations },
      },
      (args: Arguments) => call(tool, args, caller, dispatch),
    );
  }
  return server;
}
