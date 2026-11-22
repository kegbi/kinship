/**
 * The other half of the contract check: what the app actually mounted.
 *
 * `deno task contracts:check` proves the registry and the published document
 * describe the same surface. It cannot prove the app mounted that surface
 * without building the app, and building the app is this module's job — it
 * assembles every route factory over a stand-in for the services, reads what
 * Hono ended up holding, and compares it with `API_ROUTES`. No adapter is
 * reached and no database is opened: a factory only stores what it is handed.
 *
 * A route mounted around `mount` — a literal path written straight onto Hono —
 * fails here, and so does a descriptor nothing mounts. That pair is what the
 * hand-written generator could never check, and it is why three routes had
 * been matching on one parameter name while the document published another.
 */

import { type ApiServices, createApiApp } from "./composition.ts";
import { everything, servicesWith } from "./route_probe.test-helper.ts";
import { mountedRoutes } from "../../packages/http-kit/route.ts";
import {
  API_ROUTES,
  DOCUMENTED_ROUTES,
} from "../../packages/contracts/routes/mod.ts";
import {
  admissionStatuses,
  routeKey,
  takesJsonBody,
} from "../../packages/contracts/registry.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  personId,
  sessionActor,
  uuid,
} from "../../packages/backend/testing/fixtures.ts";

Deno.test("interaction composition uses its configured token authority and fails closed without one", async () => {
  const actor = sessionActor();
  for (const enabled of [false, true]) {
    const base = everything() as ApiServices;
    const overrides = {
      apiTokens: enabled
        ? {
          authenticate: (token: string, scope: string) => {
            assert(
              token === "capture" && scope === "interactions:create",
              "composition forwards capture authority",
            );
            return Promise.resolve({
              actor,
              status: "authenticated",
              tokenId: "00000000-0000-4000-8000-0000000000aa",
            });
          },
        }
        : undefined,
      browserSecurity: { origin: "http://localhost", secureCookie: false },
      interactions: {
        record: () =>
          Promise.resolve({
            status: "created",
            record: {
              id: uuid(800),
              kind: "note",
              body: "Reference",
              createdAt: "2026-10-25T10:00:00Z",
              isFavorited: false,
            },
          }),
      },
      legal: undefined,
    };
    const services = new Proxy(base, {
      get: (target, property) =>
        property in overrides
          ? Reflect.get(overrides, property)
          : Reflect.get(target, property),
    });
    const response = await createApiApp(services).request(
      "/api/v1/interactions",
      {
        method: "POST",
        headers: {
          authorization: "Bearer capture",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "note",
          personId: personId(),
          requestId: uuid(801),
          body: "Reference",
        }),
      },
    );
    assert(
      response.status === (enabled ? 201 : 401),
      "capture authority is optional and never borrowed",
    );
  }
});

Deno.test("[GAP-022] every mounted route is one the registry describes", () => {
  const app = createApiApp(everything() as Parameters<typeof createApiApp>[0]);
  const mounted = new Set(mountedRoutes(app));
  const registered = new Set(API_ROUTES.map(routeKey));

  const unregistered = [...mounted].filter((route) => !registered.has(route));
  assert(
    unregistered.length === 0,
    `these routes are mounted and in no registry: ${unregistered.join(", ")}`,
  );

  const unmounted = [...registered].filter((route) => !mounted.has(route));
  assert(
    unmounted.length === 0,
    `these routes are registered and never mounted: ${unmounted.join(", ")}`,
  );
});

Deno.test("[GAP-022] only the container probes stay out of the document", () => {
  const undocumented = API_ROUTES.filter(
    (route) => route.undocumented !== undefined,
  );
  assert(
    undocumented.length === API_ROUTES.length - DOCUMENTED_ROUTES.length,
    "the documented split must be the excused routes",
  );
  assert(
    JSON.stringify(undocumented.map((route) => routeKey(route))) ===
      JSON.stringify([
        "GET /api/v1/health",
        "GET /livez",
        "GET /readyz",
      ]),
    "only the three probes may leave the published document",
  );
});

/** A coordinator that counts, and that fails the way the uuid cast does. */
function countingSessions(calls: unknown[]) {
  return {
    resolve: (command: { readonly requestedWorkspaceId?: string }) => {
      calls.push(command);
      if (
        command.requestedWorkspaceId !== undefined &&
        !/^[0-9a-f-]{36}$/i.test(command.requestedWorkspaceId)
      ) {
        return Promise.reject(new Error("invalid input syntax for type uuid"));
      }
      return Promise.resolve(sessionActor());
    },
  };
}

/** Legal requirements with the given number of outstanding documents. */
function legalWith(outstanding: number) {
  return {
    requirements: () =>
      Promise.resolve({
        status: "ready",
        documents: Array.from({ length: outstanding }, (_, index) => ({
          id: uuid(900 + index),
          type: "terms",
        })),
      }),
  };
}

/** The capture route's services: a token authority and a recording store. */
function captureServices(
  overrides: Record<string, unknown> = {},
): ApiServices {
  const actor = sessionActor();
  return servicesWith({
    apiTokens: {
      authenticate: () =>
        Promise.resolve({
          actor,
          status: "authenticated",
          tokenId: "00000000-0000-4000-8000-0000000000aa",
        }),
    },
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    interactions: {
      record: () =>
        Promise.resolve({
          status: "created",
          record: {
            id: uuid(800),
            kind: "note",
            body: "Reference",
            createdAt: "2026-10-25T10:00:00Z",
            isFavorited: false,
          },
        }),
    },
    legal: legalWith(0),
    protectedSessions: countingSessions([]),
    ...overrides,
  });
}

function capture(
  services: ApiServices,
  init: { readonly headers?: Record<string, string>; readonly body?: string },
): Promise<Response> {
  return Promise.resolve(
    createApiApp(services).request(
      "/api/v1/interactions",
      {
        method: "POST",
        headers: {
          authorization: "Bearer capture",
          "content-type": "application/json",
          ...init.headers,
        },
        body: init.body ?? JSON.stringify({
          kind: "note",
          personId: personId(),
          requestId: uuid(801),
          body: "Reference",
        }),
      },
    ),
  );
}

async function problemCode(response: Response): Promise<string> {
  return (await response.json() as { readonly code: string }).code;
}

Deno.test("[AUD-K1] one protected request resolves its session once", async () => {
  const calls: unknown[] = [];
  await createApiApp(servicesWith({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    legal: legalWith(0),
    protectedSessions: countingSessions(calls),
  })).request("/api/v1/member/ui-state", {
    headers: { Cookie: "kinship_session=token" },
  });

  assert(
    calls.length === 1,
    `the guard and the route share one resolution, not ${calls.length}`,
  );
});

Deno.test("[AUD-K1] a bearer request is refused while a legal document is outstanding", async () => {
  const refused = await capture(captureServices({ legal: legalWith(1) }), {});
  assert(refused.status === 403, `expected 403, got ${refused.status}`);
  assert(
    await problemCode(refused) === "legal_acceptance_required",
    "the bearer refusal names the outstanding document",
  );

  const admitted = await capture(captureServices(), {});
  assert(admitted.status === 201, `expected 201, got ${admitted.status}`);
});

Deno.test("[MCP-A1] GET /api/v1/me owes the legal guard what any token route owes", async () => {
  const actor = sessionActor();
  const introspecting = (outstanding: number) =>
    createApiApp(captureServices({
      apiTokens: {
        introspect: () =>
          Promise.resolve({
            actor,
            status: "authenticated",
            token: { id: uuid(802), name: "Agent", scopes: ["people:read"] },
          }),
      },
      legal: legalWith(outstanding),
    })).request("/api/v1/me", {
      headers: { authorization: "Bearer agent" },
    });

  const refused = await introspecting(1);
  assert(refused.status === 403, `expected 403, got ${refused.status}`);
  assert(
    await problemCode(refused) === "legal_acceptance_required",
    "the token's member owes the outstanding document",
  );
  const admitted = await introspecting(0);
  assert(admitted.status === 200, `expected 200, got ${admitted.status}`);
  assert(
    (await admitted.json() as { token: { id: string } }).token.id ===
      uuid(802),
    "the token is described",
  );
});

Deno.test("[AUD-K1] a malformed X-Workspace-Id answers 400 and asks nobody", async () => {
  const calls: unknown[] = [];
  const response = await createApiApp(servicesWith({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    legal: legalWith(0),
    protectedSessions: countingSessions(calls),
  })).request("/api/v1/member/ui-state", {
    headers: {
      Cookie: "kinship_session=token",
      "X-Workspace-Id": "not-a-uuid",
    },
  });

  assert(response.status === 400, `expected 400, got ${response.status}`);
  assert(
    await problemCode(response) === "workspace_header_invalid",
    "the refusal names the header",
  );
  assert(calls.length === 0, "a malformed header reaches no session read");

  const bearer = await capture(captureServices(), {
    headers: { "X-Workspace-Id": "not-a-uuid" },
  });
  assert(bearer.status === 400, `bearer: expected 400, got ${bearer.status}`);
});

Deno.test("[AUD-K1] a JSON route refuses any other media type with 415", async () => {
  const response = await capture(captureServices(), {
    headers: { "content-type": "text/plain" },
  });
  assert(response.status === 415, `expected 415, got ${response.status}`);
  assert(
    await problemCode(response) === "unsupported_media_type",
    "the refusal names the media type",
  );

  const suffixed = await capture(captureServices(), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  assert(suffixed.status === 201, `parameters are allowed: ${suffixed.status}`);
});

Deno.test("[AUD-K1] a NUL character in a string is refused as invalid input", async () => {
  const response = await capture(captureServices(), {
    body: JSON.stringify({
      kind: "note",
      personId: personId(),
      requestId: uuid(801),
      body: "Ref\u0000erence",
    }),
  });
  assert(response.status === 400, `expected 400, got ${response.status}`);
});

Deno.test("[AUD-K1] every admission refusal a route gives is one its document names", async () => {
  const app = createApiApp(servicesWith({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    legal: legalWith(0),
    protectedSessions: {
      resolve: () => Promise.resolve(sessionActor()),
      signOut: () => Promise.resolve(),
    },
  }));
  const undocumented: string[] = [];
  const outages: string[] = [];
  for (const route of DOCUMENTED_ROUTES) {
    const documented = new Set([
      ...Object.keys(route.responses),
      ...admissionStatuses(route).map(String),
    ]);
    const path = route.path.replace(/\{[^}]+\}/g, uuid(1));
    const method = route.method.toUpperCase();
    const body = route.method === "get" ? {} : { body: "{}" };
    for (
      const credential of [
        { Cookie: "kinship_session=token" },
        { Authorization: "Bearer token" },
      ]
    ) {
      const response = await app.request(path, {
        method,
        headers: {
          ...credential,
          "content-type": "application/json",
          Origin: "http://localhost",
          "X-Workspace-Id": "not-a-uuid",
        },
        ...body,
      });
      const text = await response.text();
      if (response.status >= 500) outages.push(`${method} ${route.path}`);
      if (
        text.includes("workspace_header_invalid") && !documented.has("400")
      ) undocumented.push(`${method} ${route.path} 400`);
    }
    if (route.method === "get") continue;
    const plain = await app.request(path, {
      method,
      headers: {
        Cookie: "kinship_session=token",
        "content-type": "text/plain",
        Origin: "http://localhost",
      },
      body: "{}",
    });
    const refused = (await plain.text()).includes("unsupported_media_type");
    if (refused !== takesJsonBody(route)) {
      undocumented.push(`${method} ${route.path} 415 (${refused})`);
    }
  }
  assert(
    undocumented.length === 0,
    `undocumented admission refusals: ${undocumented.join(", ")}`,
  );
  assert(
    outages.length === 0,
    `a malformed workspace header became an outage: ${outages.join(", ")}`,
  );
});

Deno.test("[AUD-K1] a link that names its workspace in the query is guarded in that workspace", async () => {
  const home = uuid(701);
  const owing = uuid(702);
  const calls: { readonly requestedWorkspaceId?: string }[] = [];
  const served: string[] = [];
  const file = (filename: string) =>
    Promise.resolve({
      bytes: new TextEncoder().encode("{}"),
      filename,
      mimeType: "application/json",
      status: "ready",
    });
  const app = createApiApp(servicesWith({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    exports: {
      download: (actor: { readonly workspaceId: string }) => {
        served.push(`download ${actor.workspaceId}`);
        return file("kinship.json");
      },
      exportVCard: (actor: { readonly workspaceId: string }) => {
        served.push(`vcard ${actor.workspaceId}`);
        return file("Ada.vcf");
      },
    },
    legal: {
      requirements: (actor: { readonly workspaceId: string }) =>
        Promise.resolve({
          status: "ready",
          documents: actor.workspaceId === owing
            ? [{ id: uuid(900), type: "terms" }]
            : [],
        }),
    },
    protectedSessions: {
      resolve: (command: { readonly requestedWorkspaceId?: string }) => {
        calls.push(command);
        return Promise.resolve(
          sessionActor({ workspaceId: command.requestedWorkspaceId ?? home }),
        );
      },
    },
  }));
  const links = (workspaceId: string) => [
    `/api/v1/people/${personId()}/vcard?workspaceId=${workspaceId}`,
    `/api/v1/exports/${
      uuid(703)
    }/download?workspaceId=${workspaceId}&token=secret`,
  ];

  for (const link of links(owing)) {
    calls.length = 0;
    const response = await app.request(link, {
      headers: { Cookie: "kinship_session=token" },
    });
    assert(
      response.status === 403,
      `${link}: expected 403, got ${response.status}`,
    );
    assert(
      await problemCode(response) === "legal_acceptance_required",
      `${link}: the refusal names the outstanding document`,
    );
    assert(
      calls.length === 1,
      `${link}: one resolution, not ${calls.length}`,
    );
  }
  assert(served.length === 0, `nothing is served: ${served.join(", ")}`);

  for (const link of links(home)) {
    calls.length = 0;
    const response = await app.request(link, {
      headers: { Cookie: "kinship_session=token" },
    });
    assert(
      response.status === 200,
      `${link}: expected 200, got ${response.status}`,
    );
    assert(calls.length === 1, `${link}: one resolution, not ${calls.length}`);
  }
  assert(
    served.join(",") === `vcard ${home},download ${home}`,
    `served in the named workspace: ${served.join(", ")}`,
  );
});
