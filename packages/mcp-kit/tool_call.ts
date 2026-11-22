/**
 * A tool call is a request to the tool's route, and its result is what the
 * route answered (ADR 0009, MCP-C1).
 *
 * `toolRequest` rebuilds the request a REST client holding the same token
 * would have sent: the route's method and path with each path argument
 * URL-encoded, the query arguments, the JSON body with the tool's fixed
 * members and any retry key it minted, and the caller's bearer token, request
 * id, and client address. It never carries a cookie or an `Origin`, so the
 * route admits the token or refuses the call, and a browser credential cannot
 * be borrowed.
 *
 * `toolResult` reads the answer back for an agent. A JSON success is the
 * tool's structured content and the same JSON as text; an RFC 9457 problem is
 * an error result naming its code, prose, and field messages, so the agent
 * can correct the call; anything else is an error naming the status. Nothing
 * of the request is echoed, so the token's secret never reaches a result.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { isJsonMediaType } from "../contracts/registry.ts";
import type { AgentTool } from "../contracts/tools/define.ts";
import { CLIENT_ADDRESS_HEADER } from "../http-kit/client_address.ts";
import { REQUEST_ID_HEADER } from "../http-kit/request_id.ts";

/** Who a tool call is made for, and what the inner request carries for them. */
export interface ToolCaller {
  /** The origin the inner request is addressed to; the app ignores the host. */
  readonly base: string;
  /** The raw bearer token the caller presented. */
  readonly token: string;
  /** The scopes the token carries, which decide the tools it is shown. */
  readonly scopes: readonly string[];
  readonly requestId?: string;
  readonly clientAddress?: string;
}

const PATH_PARAMETER = /\{([^}]*)\}/g;

/** A query value as the route's query parser reads it back. */
function queryValue(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(",") : String(value);
}

/** The route request a tool call stands for. */
export function toolRequest(
  tool: AgentTool,
  args: Readonly<Record<string, unknown>>,
  caller: ToolCaller,
): Request {
  const values: Record<string, unknown> = { ...args };
  for (const field of Object.keys(tool.minted)) {
    values[field] ??= crypto.randomUUID();
  }
  const path = tool.route.path.replace(
    PATH_PARAMETER,
    (_match, name: string) => encodeURIComponent(String(values[name] ?? "")),
  );
  const query = new URLSearchParams();
  const body: Record<string, unknown> = { ...tool.fixed };
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue;
    for (const location of tool.locations[field] ?? []) {
      if (location === "query") query.set(field, queryValue(value));
      if (location === "body") body[field] = value;
    }
  }
  const search = query.toString();
  const url = new URL(`${path}${search ? `?${search}` : ""}`, caller.base);
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${caller.token}`,
  });
  if (caller.requestId) headers.set(REQUEST_ID_HEADER, caller.requestId);
  if (caller.clientAddress) {
    headers.set(CLIENT_ADDRESS_HEADER, caller.clientAddress);
  }
  const sendsBody = tool.route.request?.body !== undefined;
  if (sendsBody) headers.set("Content-Type", "application/json");
  return new Request(url, {
    method: tool.route.method.toUpperCase(),
    headers,
    ...(sendsBody ? { body: JSON.stringify(body) } : {}),
  });
}

/** What a refused call tells the agent. */
interface Problem {
  readonly code?: unknown;
  readonly detail?: unknown;
  readonly errors?: unknown;
  readonly status?: unknown;
  readonly title?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsed(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

function mediaEssence(type: string | null): string {
  return type?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function failure(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** A problem's members as an agent reads them, with only what it carries. */
function problemResult(problem: Problem, status: number): CallToolResult {
  const errors = isRecord(problem.errors)
    ? Object.fromEntries(
      Object.entries(problem.errors).map(([field, message]) => [
        field,
        String(message),
      ]),
    )
    : undefined;
  const structured = {
    code: String(problem.code ?? "unknown"),
    detail: String(problem.detail ?? ""),
    ...(errors ? { errors } : {}),
    status: typeof problem.status === "number" ? problem.status : status,
    title: String(problem.title ?? "Request refused"),
  };
  const fields = Object.entries(errors ?? {}).map(([field, message]) =>
    `${field}: ${message}`
  );
  const text = [
    `${structured.title} (${structured.code}, HTTP ${structured.status}). ${structured.detail}`
      .trim(),
    ...(fields.length > 0 ? [`Fields — ${fields.join("; ")}`] : []),
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    isError: true,
    structuredContent: structured,
  };
}

/** The tool result a route's answer stands for. */
export async function toolResult(response: Response): Promise<CallToolResult> {
  const { status } = response;
  const type = response.headers.get("Content-Type");
  const text = await response.text();
  if (response.ok) {
    if (text.trim() === "") {
      return { content: [{ type: "text", text: `Done (HTTP ${status}).` }] };
    }
    const json = isJsonMediaType(type ?? undefined) ? parsed(text) : undefined;
    if (json === undefined) {
      return failure(
        `The route answered HTTP ${status} with a body that is not JSON.`,
      );
    }
    return {
      content: [{ type: "text", text: JSON.stringify(json.value) }],
      structuredContent: isRecord(json.value)
        ? json.value
        : { value: json.value },
    };
  }
  const problem = mediaEssence(type) === "application/problem+json"
    ? parsed(text)
    : undefined;
  if (problem !== undefined && isRecord(problem.value)) {
    return problemResult(problem.value, status);
  }
  return failure(`The route refused the call with HTTP ${status}.`);
}
