# ADR 0009: MCP Endpoint As A Delivery Adapter Over The Token API

- Status: accepted; user-directed on 2026-11-22
- Date: 2026-11-22
- Implemented by: the
  [MCP server plan](../../planning/mcp-server-plan-2026-11-22.md)

## Context

The product owner asked for a Model Context Protocol (MCP) server so an AI agent
can add, edit, and remove CRM records, limited to what the caller's credential
grants in its own workspace.

The repository already has the pieces an agent surface must not duplicate:

- 157 registered HTTP routes, each described once by a `RouteDescriptor` with
  the Zod schemas its handler validates with.
- Workspace-bound personal API tokens (`kin_pat_…`) with independent scopes. A
  token acts as its issuer's current membership and role, in one workspace, and
  a refused bearer never falls back to a cookie.
- An executed authorization matrix, a default-deny suite, the legal-requirement
  guard, and database-enforced workspace isolation (ADR 0008).

Only 14 routes accept a token today, and three properties of the token surface
are weaker than an agent surface needs: a route's required scope is written only
in its handler and in prose, a token-authenticated change is audited without
naming the token, and several tests pin the bearer surface by hand instead of
deriving it from the registry.

## Decision

1. **One endpoint in the API process.** The API serves MCP over Streamable HTTP
   at `POST /api/v1/mcp`. `GET` and `DELETE` answer 405. There is no new
   container, no new public entry point, and no gateway location: the endpoint
   is an ordinary registered route under `/api/v1/`.
2. **Stateless JSON responses.** Each request builds a fresh server. The
   endpoint answers one JSON body per request and offers no server-initiated
   stream, so it fits the gateway's existing buffering and timeouts.
3. **Personal API tokens are the only credential.** The endpoint reads
   `Authorization: Bearer kin_pat_…` and never reads a cookie. A missing or
   refused token answers 401 with a `WWW-Authenticate: Bearer` challenge. A
   request that carries an `Origin` other than the configured public web origin
   answers 403. OAuth is not implemented; adding it needs its own decision.
4. **A tool call is an in-process request to an existing route.** A tool names
   one route descriptor. Calling it builds the route's request (path, query,
   JSON body, the caller's bearer token, the request id, and the client address)
   and hands it to the same Hono application. Scope, role, membership
   revalidation, workspace isolation, the legal guard, validation, concurrency
   and retry rules, and audit all run on the one existing path. The MCP layer
   holds no authorization logic and calls no module facade.
5. **The tool catalog is contract data.** Tools are declared with `defineTool`
   under `packages/contracts/tools/`, beside the route descriptors they target.
   A tool may fix part of a route's input (one tool per interaction kind) and
   may let the server mint a `requestId` the agent left out. A contract test
   requires every token-enabled route to be a tool or to be excluded with a
   reason.
6. **A token sees only the tools its scopes allow.** `tools/list` is filtered by
   the presented token's scopes. Role and section rules are still decided by the
   route at call time.
7. **A route's token scope is machine-readable.** `RouteDescriptor.tokenScope`
   names the one scope a token-enabled route requires. The handler's admission
   reads it from the descriptor, so the document, the tool catalog, and the
   enforcement cannot disagree.
8. **A token-authenticated change names its token.** The token's id rides on the
   actor's correlation and is stored as `payload.apiTokenId` on every audit
   event the request writes. `audit_events.payload` is `jsonb`, so this needs no
   schema version.
9. **One new dependency.** The official `@modelcontextprotocol/server` package
   (the v2 SDK line; its only runtime dependencies are its own core package and
   Zod 4) implements the protocol. It is pinned exactly in `deno.json` and
   locked like every other dependency. The shared machinery lives in
   `packages/mcp-kit/`, a sibling of `packages/http-kit/` that domain and
   application code may not import and that `apps/web` may not import.

## What stays out

- Sign-in, MFA, sessions, password and identity flows, legal acceptance, member
  and invitation administration, workspace settings and the danger zone, API
  token management, calendar feeds, DAV, imports and exports, audit history,
  notifications, and storage administration keep session admission and are not
  tools.
- Binary bodies are not tools. File upload and download may accept a token over
  REST, but an MCP tool carries JSON only.
- Token issuance stays owner/admin-only (`api-tokens.manage`). Letting members
  mint tokens for their own agent is a separate product decision.
- Per-token rate limiting. The gateway's per-address limits still apply, and one
  MCP request performs at most one route call.

## Consequences

- The public REST API and the agent surface grow together: enabling a route for
  tokens publishes it in the external OpenAPI document and makes it available as
  a tool.
- Every tool call authenticates the token twice (once at the endpoint to list
  and filter tools, once at the route). That is one extra indexed read and hash
  comparison per call.
- A request log shows two lines for a tool call, the MCP request and the route
  it reached, under one request id.
- Clients that require OAuth for remote servers cannot connect until OAuth is
  decided. Clients that accept a static bearer header can.
- Replacing the SDK, or moving the endpoint into its own process, changes only
  `packages/mcp-kit/` and its mount in `apps/api/composition.ts`.
