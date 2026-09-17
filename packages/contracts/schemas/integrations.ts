/**
 * CalDAV and CardDAV subscriptions: the shapes this surface accepts and answers
 * with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/integrations` and out of
 * the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";

export const davSubscription = z.strictObject({
  id: z.uuid(),
  isActive: z.boolean(),
  lastError: z.string().max(300).optional(),
  lastOutcome: z.enum([
    "auth-failure",
    "conflict",
    "never",
    "partial",
    "success",
  ]),
  lastSyncedAt: z.iso.datetime({ offset: true }).optional(),
  name: z.string().min(1).max(100),
  remoteSyncToken: z.string().optional(),
  remoteUrl: z.url().max(2048),
  username: z.string().max(255).optional(),
}).meta({ id: "DavSubscription" });

export const davSubscriptionConfigured = z.strictObject({
  status: z.literal("configured"),
  subscription: davSubscription,
}).meta({ id: "DavSubscriptionConfigured" });

export const davSubscriptionDisabled = z.strictObject({
  status: z.literal("disabled"),
  subscription: davSubscription,
}).meta({ id: "DavSubscriptionDisabled" });

/**
 * The remote URL ceiling, which the input counts twice.
 *
 * `max` counts characters and the document publishes that number; the refine
 * counts the UTF-8 bytes the same string encodes to, which is the limit the
 * DAV module stores against. A URL of 2048 astral characters passes the first
 * and fails the second, and that is the refusal `apps/api/integrations` has
 * always answered with.
 */
const REMOTE_URL_MAX_BYTES = 2048;

export const davSubscriptionInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(4096).meta({ writeOnly: true }),
  remoteUrl: z.url().max(REMOTE_URL_MAX_BYTES).refine(
    (value) => new TextEncoder().encode(value).length <= REMOTE_URL_MAX_BYTES,
  ),
  username: z.string().trim().max(255).optional(),
}).meta({ id: "DavSubscriptionInput" });

export const davSubscriptionList = z.strictObject({
  status: z.literal("ready"),
  subscriptions: z.array(davSubscription),
}).meta({ id: "DavSubscriptionList" });

export const davSyncResult = z.strictObject({
  processed: z.number().int().min(0).optional(),
  status: z.enum(["auth-failure", "conflict", "partial", "success"]),
  subscription: davSubscription,
}).meta({ id: "DavSyncResult" });
