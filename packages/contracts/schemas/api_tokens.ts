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

export const apiTokenScope = z.enum([
  "people:read",
  "people:profile:read",
  "relationships:read",
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

export const apiTokenCreated = z.strictObject({
  record: apiTokenRecord,
  secret: z.string().min(64),
  status: z.literal("created"),
}).meta({ id: "ApiTokenCreated" });

export const apiTokenList = z.strictObject({
  records: z.array(apiTokenRecord),
  scopes: z.array(apiTokenScope),
  status: z.literal("ready"),
}).meta({ id: "ApiTokenList" });

export const apiTokenRevoked = z.strictObject({
  record: apiTokenRecord,
  status: z.literal("revoked"),
}).meta({ id: "ApiTokenRevoked" });
