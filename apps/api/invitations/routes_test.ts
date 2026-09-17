/**
 * The invitation flow as one mounted whole.
 *
 * The refusal-mapping test walks an invitation from a denied creation to a
 * spent acceptance, so it belongs to the mount rather than to either step.
 * The registration order is pinned beside it.
 */

import { createInvitationRoutes } from "../invitations.ts";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { secureHeaders, services } from "./invitations.test-helper.ts";

Deno.test("invitation HTTP maps role denial, replay, expiry, wrong-user, and already-member safely", async () => {
  for (
    const [result, expected] of [["forbidden", 403], ["already-member", 409], [
      "delivery-failed",
      503,
    ]] as const
  ) {
    const app = createInvitationRoutes(
      services({ create: () => Promise.resolve(result) }),
    );
    const response = await app.request(
      "https://kinship.test/api/v1/workspace-invitations",
      {
        method: "POST",
        headers: secureHeaders,
        body: JSON.stringify({ email: "invitee@example.test", role: "member" }),
      },
    );
    assert(response.status === expected, `${result} maps safely`);
  }
  for (
    const [result, expected] of [
      ["wrong-user", 403],
      ["already-member", 409],
      ["used", 410],
      ["expired", 410],
      ["revoked", 410],
      ["invalid", 404],
    ] as const
  ) {
    const app = createInvitationRoutes(
      services({ accept: () => Promise.resolve({ status: result }) }),
    );
    const response = await app.request(
      "https://kinship.test/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: secureHeaders,
        body: JSON.stringify({
          token: "a-valid-private-invitation-token-0000000000",
        }),
      },
    );
    assert(response.status === expected, `${result} maps safely`);
    assert(
      !(await response.text()).includes("a-valid-private"),
      "problem never reflects token",
    );
  }
});

/** Every route the mounted surface registers, in registration order. */
function mounted(
  app: {
    readonly routes: readonly {
      readonly method: string;
      readonly path: string;
    }[];
  },
): string[] {
  const registered = new Set<string>();
  for (const route of app.routes) {
    if (route.method !== "ALL") registered.add(`${route.method} ${route.path}`);
  }
  return [...registered];
}

Deno.test("[GAP-021] the mounted invitation concerns register every route in order", () => {
  assertEquals(
    mounted(createInvitationRoutes(services())).join("\n"),
    [
      "POST /api/v1/workspace-invitations",
      "GET /api/v1/workspace-members",
      "POST /api/v1/workspace-invitations/register",
      "POST /api/v1/workspace-invitations/verification-delivery",
      "POST /api/v1/workspace-invitations/authenticate",
      "POST /api/v1/workspace-invitations/mfa",
      "POST /api/v1/workspace-invitations/inspect",
      "POST /api/v1/workspace-invitations/accept",
    ].join("\n"),
    "three mounted concerns register what one file used to",
  );
});

Deno.test("[GAP-021] every mounted invitation path answers from its own concern", async () => {
  const app = createInvitationRoutes(services());
  const token = "a-valid-private-invitation-token-0000000000";
  for (
    const [path, body, expected] of [
      ["/api/v1/workspace-invitations", {
        email: "invitee@example.test",
        role: "member",
      }, 201],
      ["/api/v1/workspace-invitations/register", {
        email: "invitee@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
        password: "a-long-enough-password",
        token,
      }, 202],
      ["/api/v1/workspace-invitations/inspect", { token }, 200],
      ["/api/v1/workspace-invitations/accept", { token }, 200],
    ] as const
  ) {
    const response = await app.request(`https://kinship.test${path}`, {
      body: JSON.stringify(body),
      headers: secureHeaders,
      method: "POST",
    });
    assertStatus(response, expected, `${path} is served by the mounted whole`);
  }
  const members = await app.request(
    "https://kinship.test/api/v1/workspace-members",
    { headers: secureHeaders },
  );
  assertStatus(members, 200, "the member list is served by the mounted whole");
});
