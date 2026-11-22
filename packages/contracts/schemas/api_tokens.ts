/**
 * Personal API tokens: the shapes this surface accepts and answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/api_tokens` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";

/**
 * Every grant a personal token may carry, in the order the token API's areas
 * are listed. No grant implies another; several are minted before any route
 * consumes them, so a token can be issued once for an agent's whole job.
 */
export const apiTokenScope = z.enum([
  "people:read",
  "people:profile:read",
  "relationships:read",
  "tasks:read",
  "tasks:create",
  "tasks:write",
  "interactions:create",
  "people:write",
  "people:delete",
  "people:merge",
  "relationships:write",
  "interactions:read",
  "interactions:write",
  "reminders:read",
  "reminders:write",
  "journal:read",
  "journal:write",
  "gifts:read",
  "gifts:write",
  "files:read",
  "files:write",
  "search:read",
  "today:read",
  "vocabularies:read",
  "vocabularies:write",
]);

export const apiTokenCreateInput = z.strictObject({
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  name: z.string().trim().min(1).max(100),
  scopes: z.array(apiTokenScope).min(1).max(apiTokenScope.options.length)
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: "Select each scope only once.",
    }).meta({ uniqueItems: true }),
}).meta({ id: "ApiTokenCreateInput" });

export const apiTokenRecord = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  id: z.uuid(),
  lastUsedAt: z.iso.datetime({ offset: true }).optional(),
  name: z.string().min(1).max(100),
  revokedAt: z.iso.datetime({ offset: true }).optional(),
  scopes: z.array(apiTokenScope).min(1),
}).meta({ id: "ApiTokenRecord" });

/**
 * One token of the workspace in the owner's and administrators' overview
 * (SECT-07): the record and the member who minted it.
 */
export const apiTokenListEntry = apiTokenRecord.extend({
  issuer: z.strictObject({
    email: z.string().min(1),
    name: z.string(),
  }),
}).meta({ id: "ApiTokenListEntry" });

export const apiTokenCreated = z.strictObject({
  record: apiTokenRecord,
  secret: z.string().min(64),
  status: z.literal("created"),
}).meta({ id: "ApiTokenCreated" });

export const apiTokenList = z.strictObject({
  records: z.array(apiTokenListEntry),
  scopes: z.array(apiTokenScope),
  status: z.literal("ready"),
}).meta({ id: "ApiTokenList" });

export const apiTokenRevoked = z.strictObject({
  record: apiTokenRecord,
  status: z.literal("revoked"),
}).meta({ id: "ApiTokenRevoked" });

/**
 * What `GET /api/v1/me` answers a personal token with (MCP-A1): the token's
 * own record, and the workspace, membership, and role it currently acts as.
 */
export const apiTokenContext = z.strictObject({
  memberId: z.uuid(),
  role: z.enum(["owner", "admin", "member"]),
  token: z.strictObject({
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    id: z.uuid(),
    name: z.string().min(1).max(100),
    scopes: z.array(apiTokenScope).min(1),
  }),
  workspaceId: z.uuid(),
}).meta({ id: "ApiTokenContext" });
