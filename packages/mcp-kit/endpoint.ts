/**
 * `POST /api/v1/mcp`: the Model Context Protocol endpoint (ADR 0009, MCP-C1).
 *
 * The endpoint is a delivery adapter and holds no authorization of its own
 * beyond knowing whose token it was handed. In order, it:
 *
 * 1. refuses a request whose `Origin` is present and is not the configured
 *    web origin (403). MCP clients are not browsers and send none; a page
 *    elsewhere must not drive an agent's token through a visitor's browser.
 * 2. authenticates the bearer token by introspection, exactly as
 *    `GET /api/v1/me` does, legal guard included — and never reads a cookie.
 *    No token, or a refused one, is a 401 with a `WWW-Authenticate: Bearer`
 *    challenge.
 * 3. parses one JSON-RPC message, refusing anything else with a JSON-RPC
 *    error, and refuses `subscriptions/listen`, the one method that would
 *    hold a stream open.
 * 4. answers it with a server built for this request and this token: the
 *    tools whose scope the token holds, each answering by dispatching an
 *    in-process request to its own route (`server.ts`).
 *
 * Both protocol eras are served statelessly with one JSON body. A 2025-era
 * message (an `initialize` handshake and what follows it) goes to the
 * library's Streamable HTTP transport without session ids and with JSON
 * responses enabled; a 2026-07-28 message, which carries its own protocol
 * envelope, goes to the library's per-request handler, whose answer is JSON
 * whenever the handler emits nothing before its result — and no tool here
 * does. Nothing is kept between requests: no session, no registry, no stream.
 * `GET`, `DELETE`, and every other method on the path answer 405.
 */

import {
  createMcpHandler,
  isLegacyRequest,
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { type Context, Hono } from "hono";
import { mcp, MCP_PATH } from "../contracts/routes/mcp.ts";
import { mcpMessage } from "../contracts/schemas/mcp.ts";
import { AGENT_TOOLS } from "../contracts/tools/mod.ts";
import type { AgentTool } from "../contracts/tools/define.ts";
import { trustedClientAddress } from "../http-kit/client_address.ts";
import { ORIGIN_INVALID } from "../http-kit/origin.ts";
import { definedProblem } from "../http-kit/problem.ts";
import { requestIdOf } from "../http-kit/request_id.ts";
import { mount } from "../http-kit/route.ts";
import type { BrowserSecurityPolicy } from "../http-kit/security_policy.ts";
import {
  type ActorEnv,
  bearerToken,
  requireTokenActor,
  type SessionActor,
} from "../http-kit/session.ts";
import { agentServer, type Dispatch } from "./server.ts";
import type { ToolCaller } from "./tool_call.ts";

/**
 * What the endpoint needs of token introspection: any current personal
 * token, whatever it grants, and the membership it acts as. The api-access
 * module's `ApiTokenManagement.introspect` is one.
 */
export interface McpTokenIntrospection {
  introspect(rawToken: string, requestedWorkspaceId?: string): Promise<
    | {
      readonly actor: SessionActor;
      readonly status: "authenticated";
      readonly token: {
        readonly id: string;
        readonly scopes: readonly string[];
      };
    }
    | { readonly status: "invalid" }
  >;
}

export interface McpEndpointServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly tokens: McpTokenIntrospection;
  /** Answers a tool's route request; the composition root binds the app's. */
  readonly dispatch: Dispatch;
  /** The catalog; the contract's `AGENT_TOOLS` unless a suite narrows it. */
  readonly tools?: readonly AgentTool[];
}

/** The challenge a 401 from this endpoint carries (RFC 6750). */
export const BEARER_CHALLENGE = 'Bearer realm="kinship"';

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
/** The SDK's own code for a transport-level refusal such as 405. */
const JSON_RPC_SERVER_ERROR = -32000;

/** A JSON-RPC error, the shape every MCP client reads a refusal in. */
function jsonRpcError(
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }),
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        ...headers,
      },
    },
  );
}

/** A 401 with the bearer challenge, any other refusal as it was. */
function challenged(refusal: Response): Response {
  if (refusal.status === 401) {
    refusal.headers.set("WWW-Authenticate", BEARER_CHALLENGE);
  }
  return refusal;
}

type Message = Record<string, unknown> & {
  readonly id?: string | number | null;
  readonly method?: string;
};

/** The one JSON-RPC message this request carries, or the refusal instead. */
async function readMessage(context: Context): Promise<Message | Response> {
  const text = await context.req.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return jsonRpcError(
      400,
      JSON_RPC_PARSE_ERROR,
      "Parse error: the body is not JSON.",
    );
  }
  const parsed = mcpMessage.safeParse(value);
  if (!parsed.success) {
    return jsonRpcError(
      400,
      JSON_RPC_INVALID_REQUEST,
      "Invalid Request: send one JSON-RPC 2.0 message object.",
    );
  }
  return parsed.data as Message;
}

/**
 * The request the protocol library reads: the same message and protocol
 * headers, with no credential, and an `Accept` that names both media types,
 * which the 2025-era transport insists on although every answer here is JSON.
 */
function forwarded(context: Context, message: Message): Request {
  const headers = new Headers(context.req.raw.headers);
  headers.delete("Authorization");
  headers.delete("Cookie");
  headers.set("Accept", "application/json, text/event-stream");
  return new Request(context.req.url, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
}

/** Answers one message from a fresh server, in whichever era it speaks. */
async function answer(
  request: Request,
  message: Message,
  server: () => McpServer,
): Promise<Response> {
  if (await isLegacyRequest(request, message)) {
    const instance = server();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });
    await instance.connect(transport);
    try {
      return await transport.handleRequest(request, { parsedBody: message });
    } finally {
      await instance.close();
    }
  }
  return await createMcpHandler(server, { legacy: "reject" }).fetch(request, {
    parsedBody: message,
  });
}

/** The endpoint's routes: the descriptor's `POST`, and 405 for the rest. */
export function createMcpRoutes(services: McpEndpointServices): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const tools = services.tools ?? AGENT_TOOLS;

  mount(routes, mcp, async (context) => {
    const origin = context.req.header("Origin");
    if (origin !== undefined && origin !== services.browserSecurity.origin) {
      return definedProblem(context, ORIGIN_INVALID);
    }
    const admitted = await requireTokenActor(
      context,
      async (rawToken, requestedWorkspaceId) => {
        const result = await services.tokens.introspect(
          rawToken,
          requestedWorkspaceId,
        );
        return result.status === "authenticated"
          ? { ...result, tokenId: result.token.id }
          : result;
      },
    );
    if (admitted instanceof Response) return challenged(admitted);

    const message = await readMessage(context);
    if (message instanceof Response) return message;
    if (message.method === "subscriptions/listen") {
      return jsonRpcError(
        200,
        JSON_RPC_METHOD_NOT_FOUND,
        "Method not found: this endpoint offers no subscriptions.",
        message.id ?? null,
      );
    }

    const requestId = requestIdOf(context);
    const clientAddress = trustedClientAddress(context);
    const caller: ToolCaller = {
      base: new URL(context.req.url).origin,
      // Admission accepted this exact bearer, so it is present.
      token: bearerToken(context) ?? "",
      scopes: admitted.token.scopes,
      ...(requestId ? { requestId } : {}),
      ...(clientAddress ? { clientAddress } : {}),
    };
    const response = await answer(
      forwarded(context, message),
      message,
      () => agentServer(tools, caller, services.dispatch),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  });

  // Not a descriptor: no other method is an operation here, so the registry
  // and the published document name only the POST (`routes_test.ts` reads
  // mounted methods, not this fallback).
  routes.all(MCP_PATH, () =>
    jsonRpcError(
      405,
      JSON_RPC_SERVER_ERROR,
      "Method not allowed: this endpoint is stateless and answers POST only.",
      null,
      { Allow: "POST" },
    ));
  return routes;
}
