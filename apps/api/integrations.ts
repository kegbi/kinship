/**
 * CardDAV and CalDAV subscriptions over HTTP.
 *
 * Four routes over one settings page. The problem responder, the session
 * cookie, the origin comparison, and the kernel status map came from `http/`
 * (GAP-019, GAP-020).
 *
 * Every refusal here is titled "DAV unavailable", including the ones that are
 * not outages at all: the page shows one section, and a caller who is told
 * their URL is wrong has already been told which section is talking. The
 * origin refusal keeps its own shorter sentence rather than the kit's, because
 * it is the sentence this page's tests and its readers already have.
 */

import { type Context, Hono } from "hono";
import type { DavSyncManagement } from "../../packages/backend/modules/integrations/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import {
  createDavSubscription,
  disableDavSubscription,
  getDavSubscriptions,
  synchronizeDavSubscription,
} from "../../packages/contracts/routes/integrations.ts";
import { davSubscriptionInput } from "../../packages/contracts/schemas/integrations.ts";
import { uuid } from "../../packages/contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { matchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import { mount } from "./http/route.ts";
import { type ActorEnv, requireActor, sessionActor } from "./http/session.ts";
import { parseJsonBody, parseValue } from "./http/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface IntegrationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly dav: DavSyncManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const INTEGRATIONS_NOT_LOADED: ProblemDefinition = {
  code: "integrations_unavailable",
  detail: "Integrations could not be loaded.",
  status: 503,
  title: "DAV unavailable",
};

/** What a refused DAV read or write says. */
export const INTEGRATION_FAILURES: FailureTable = {
  fallback: INTEGRATIONS_NOT_LOADED,
  statuses: {
    busy: {
      code: "integration_busy",
      detail: "Synchronization is already running. Retry after it finishes.",
      status: 409,
      title: "DAV unavailable",
    },
    forbidden: {
      code: "integrations_forbidden",
      detail:
        "Only an active workspace owner or administrator may manage integrations.",
      title: "DAV unavailable",
    },
    invalid: {
      code: "integration_invalid",
      detail: "Use a public HTTPS DAV URL and valid credentials.",
      status: 400,
      title: "DAV unavailable",
    },
    "not-found": {
      code: "integration_not_found",
      detail: "That integration does not exist in this workspace.",
      title: "DAV unavailable",
    },
  },
};

const failure = failureResponder(INTEGRATION_FAILURES);

const DAV_ORIGIN_INVALID: ProblemDefinition = {
  code: "origin_invalid",
  detail: "Request origin is not allowed.",
  status: 403,
  title: "DAV unavailable",
};
const INTEGRATION_ID_INVALID: ProblemDefinition = {
  code: "integration_not_found",
  detail: "That integration does not exist.",
  status: 404,
  title: "DAV unavailable",
};
const INTEGRATION_REQUEST_INVALID: ProblemDefinition = {
  code: "integration_invalid",
  detail: "Enter a name, public HTTPS URL, username, and secret.",
  status: 400,
  title: "DAV unavailable",
};
const INTEGRATION_NOT_CONFIGURED: ProblemDefinition = {
  code: "integrations_unavailable",
  detail: "The integration could not be configured.",
  status: 503,
  title: "DAV unavailable",
};
const SYNCHRONIZATION_UNFINISHED: ProblemDefinition = {
  code: "integrations_unavailable",
  detail: "Synchronization could not finish.",
  status: 503,
  title: "DAV unavailable",
};
const INTEGRATION_NOT_DISABLED: ProblemDefinition = {
  code: "integrations_unavailable",
  detail: "The integration could not be disabled.",
  status: 503,
  title: "DAV unavailable",
};

/** The 403 a foreign-origin write answers with, in this page's words. */
function rejectDavOrigin(
  context: Context,
  policy: BrowserSecurityPolicy,
): Response | undefined {
  return matchingOrigin(context, policy)
    ? undefined
    : definedProblem(context, DAV_ORIGIN_INVALID);
}

/** Every problem this file answers on its own, for the pinning suite. */
export const INTEGRATION_PROBLEMS: readonly ProblemDefinition[] = [
  DAV_ORIGIN_INVALID,
  INTEGRATION_ID_INVALID,
  INTEGRATION_NOT_CONFIGURED,
  INTEGRATION_NOT_DISABLED,
  INTEGRATION_REQUEST_INVALID,
  INTEGRATIONS_NOT_LOADED,
  SYNCHRONIZATION_UNFINISHED,
];

export function createIntegrationRoutes(
  services: IntegrationHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);

  mount(routes, getDavSubscriptions, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.dav.list(actor).catch(() => undefined);
    if (!result) return definedProblem(context, INTEGRATIONS_NOT_LOADED);
    if (result.status !== "ready") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(routes, createDavSubscription, session, async (context) => {
    const refused = rejectDavOrigin(context, services.browserSecurity);
    if (refused) return refused;
    const body = await parseJsonBody(context, davSubscriptionInput);
    if ("errors" in body) {
      return definedProblem(context, INTEGRATION_REQUEST_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.dav.configure(actor, {
      name: body.data.name,
      password: body.data.password,
      remoteUrl: body.data.remoteUrl,
      ...(body.data.username ? { username: body.data.username } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, INTEGRATION_NOT_CONFIGURED);
    if (result.status !== "configured") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  mount(
    routes,
    synchronizeDavSubscription,
    session,
    async (context) => {
      const refused = rejectDavOrigin(context, services.browserSecurity);
      if (refused) return refused;
      const id = parseValue(uuid, context.req.param("subscriptionId"));
      if ("errors" in id) {
        return definedProblem(context, INTEGRATION_ID_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.dav.synchronize(actor, id.data).catch(() =>
        undefined
      );
      if (!result) return definedProblem(context, SYNCHRONIZATION_UNFINISHED);
      // A run that reached the remote reports how it went in its body, at 200:
      // an authentication failure, a token conflict, and a partial pass are
      // states of the subscription, not refusals of this request.
      if (
        result.status === "busy" || result.status === "forbidden" ||
        result.status === "not-found"
      ) return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(
    routes,
    disableDavSubscription,
    session,
    async (context) => {
      const refused = rejectDavOrigin(context, services.browserSecurity);
      if (refused) return refused;
      const id = parseValue(uuid, context.req.param("subscriptionId"));
      if ("errors" in id) {
        return definedProblem(context, INTEGRATION_ID_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.dav.disable(actor, id.data).catch(() =>
        undefined
      );
      if (!result) return definedProblem(context, INTEGRATION_NOT_DISABLED);
      if (result.status !== "disabled") return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );
  return routes;
}
