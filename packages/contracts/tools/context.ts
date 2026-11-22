/**
 * What the presented token is, which every token may ask.
 */

import { getTokenContext } from "../routes/api_tokens.ts";
import { type AgentTool, defineTool } from "./define.ts";

export const CONTEXT_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "get_context",
    title: "Get the token's context",
    description:
      "Reads what this connection acts as: the token's name, scopes, and expiry, and the workspace, member, and current role it uses. Call it first to learn which kinds of change the scopes allow; the member's role can still refuse a change the scopes allow.",
    route: getTokenContext,
  }),
];
