/**
 * The MCP endpoint's body (ADR 0009, MCP-C1): one JSON-RPC 2.0 message.
 *
 * The endpoint parses a request with this schema before the protocol library
 * reads it, so the document names exactly what is refused. The members the
 * Model Context Protocol defines inside `params`, `result`, and `error` are
 * the protocol's, not this contract's, so they are described and passed
 * through rather than restated.
 */

import { z } from "zod";

const jsonRpcId = z.union([z.string().max(200), z.number().int()]);

export const mcpMessage = z.looseObject({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcId.nullable().optional(),
  method: z.string().min(1).max(200).optional().meta({
    description:
      "The MCP method, such as initialize, tools/list, or tools/call. Absent on a response.",
  }),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.looseObject({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
}).meta({ id: "McpMessage" });
