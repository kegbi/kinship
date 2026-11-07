/**
 * Default-deny, proven for every route (AUD-K5, SECA-10).
 *
 * Every protected handler asks for its actor itself — `requireActor`,
 * `requireSession`, `requireTokenOrSessionActor` — so a new route that forgets
 * the call would be public, and `routes_test.ts` would not notice: it proves
 * the app mounts the registry, not that the registry's routes authenticate.
 *
 * This suite is the net. Every route whose descriptor names a `security`
 * requirement is sent a valid request, built from its own schemas, by somebody
 * the session coordinator does not know, and it must answer 401. The only
 * exceptions are the routes that are not guarded by the session at all: the
 * handoff routes, each answering its own refusal when its one-purpose cookie
 * is missing, and sign-out, which is idempotent.
 */

import { Hono } from "hono";
import { z } from "zod";
import { createApiApp } from "./composition.ts";
import {
  SAMPLE_ORIGIN,
  sampleRequest,
  servicesWith,
} from "./route_probe.test-helper.ts";
import { API_ROUTES } from "../../packages/contracts/routes/mod.ts";
import {
  defineRoute,
  type RouteDescriptor,
} from "../../packages/contracts/registry.ts";
import { mount } from "../../packages/http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../packages/http-kit/session.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { personId } from "../../packages/backend/testing/fixtures.ts";

/**
 * The protected routes that are not the session's to refuse, and why.
 *
 * Each answers a refusal of its own without its handoff cookie (the 03 report
 * lists them: 409 `entry_handoff_invalid`, 410 `mfa_challenge_expired`, 404
 * `invitation_invalid`), and sign-out answers 200 whether or not anybody was
 * signed in. They are still swept: none may answer 2xx except sign-out.
 */
const NOT_SESSION_GUARDED: Readonly<Record<string, string>> = {
  acceptWorkspaceInvitation: "invitation handoff",
  completeMfa: "MFA challenge handoff",
  completeWorkspaceInvitationMfa: "invitation MFA handoff",
  consumeApplicationEntry: "verified-entry handoff",
  retryInvitedVerificationDelivery: "invitation handoff",
  signOut: "idempotent sign-out",
};

/** A coordinator that knows nobody, whatever the cookie says. */
const NOBODY = {
  resolve: () => Promise.resolve(undefined),
  signOut: () => Promise.resolve(),
};

/**
 * The app, over services that would answer anything: a route that reached
 * one without an actor would answer something other than 401. Tokens are
 * refused, so a bearer request has nobody behind it either.
 */
function anonymousApp(): Hono {
  return createApiApp(servicesWith({
    apiTokens: servicesWith({
      authenticate: () => Promise.resolve({ status: "invalid" }),
    }),
    browserSecurity: { origin: SAMPLE_ORIGIN, secureCookie: false },
    protectedSessions: NOBODY,
  })) as unknown as Hono;
}

/** The credentials somebody nobody knows may present to this route. */
function strangers(
  route: RouteDescriptor,
): Readonly<Record<string, Record<string, string>>> {
  const tokens = route.security?.some((requirement) =>
    "kinship_api_token" in requirement
  );
  return {
    none: {},
    "unknown cookie": { Cookie: "kinship_session=unknown" },
    ...(tokens
      ? { "unknown bearer": { Authorization: "Bearer unknown" } }
      : {}),
  };
}

/**
 * Every answer a protected route gave a stranger that was not the 401 it
 * owes, as `operationId (credential): status`.
 */
async function defaultDenyViolations(
  app: Hono,
  routes: readonly RouteDescriptor[],
): Promise<readonly string[]> {
  const violations: string[] = [];
  for (const route of routes) {
    if (route.security === undefined) continue;
    const { path, init } = sampleRequest(route);
    for (const [credential, headers] of Object.entries(strangers(route))) {
      const response = await app.request(path, {
        ...init,
        headers: { ...init.headers, ...headers },
      });
      await response.body?.cancel();
      const exempt = route.operationId in NOT_SESSION_GUARDED;
      const owed = exempt
        ? response.status < 500 &&
          (response.status >= 400 || route.operationId === "signOut")
        : response.status === 401;
      if (!owed) {
        violations.push(
          `${route.operationId} (${credential}): ${response.status}`,
        );
      }
    }
  }
  return violations;
}

Deno.test("[AUD-K5] every protected route refuses somebody nobody knows with 401", async () => {
  const violations = await defaultDenyViolations(anonymousApp(), API_ROUTES);
  assert(
    violations.length === 0,
    `protected routes that did not answer 401:\n${violations.join("\n")}`,
  );
});

Deno.test("[AUD-K5] the exceptions are protected routes the registry still has", () => {
  for (const operationId of Object.keys(NOT_SESSION_GUARDED)) {
    const route = API_ROUTES.find((each) => each.operationId === operationId);
    assert(route !== undefined, `${operationId} is not a registered route`);
    assert(
      route.security !== undefined,
      `${operationId} is public, so it needs no exception`,
    );
  }
});

/** A protected route whose handler forgot to ask who is calling. */
const unguarded = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/unguarded",
  operationId: "unguardedFixture",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({ personId: z.uuid() }),
    body: {
      required: true,
      content: { "application/json": z.object({ name: z.string().min(1) }) },
    },
  },
  responses: { 200: { description: "Answered without an actor" } },
});

/** The same route, guarded the way every real one is. */
const guarded = defineRoute({
  ...unguarded,
  path: "/api/v1/people/{personId}/guarded",
  operationId: "guardedFixture",
});

Deno.test("[AUD-K5] the sweep fails a protected route that answers without an actor", async () => {
  const app = anonymousApp();
  const fixtures = new Hono<ActorEnv>();
  mount(
    fixtures,
    unguarded,
    (context) => Promise.resolve(context.json({ personId: personId() })),
  );
  mount(fixtures, guarded, sessionActor(NOBODY), async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    return context.json({ personId: personId() });
  });
  app.route("/", fixtures as unknown as Hono);

  const violations = await defaultDenyViolations(app, [unguarded, guarded]);
  assert(
    JSON.stringify(violations) ===
      JSON.stringify([
        "unguardedFixture (none): 200",
        "unguardedFixture (unknown cookie): 200",
      ]),
    `the sweep must flag exactly the unguarded route: ${violations.join(", ")}`,
  );
});
