/**
 * An owner inviting somebody, and the list of who has been invited.
 *
 * Neither route may return the invitation token, and neither may act on a
 * workspace the session did not resolve.
 */

import { createInvitationRoutes } from "../invitations.ts";
import {
  assert,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { secureHeaders, services } from "./invitations.test-helper.ts";

Deno.test("invitation HTTP creation is origin/session protected and never returns bearer material", async () => {
  let command: unknown;
  const app = createInvitationRoutes(services({
    create: (value) => {
      command = value;
      return Promise.resolve("created");
    },
  }));
  const response = await app.request(
    "https://kinship.test/api/v1/workspace-invitations",
    {
      method: "POST",
      headers: secureHeaders,
      body: JSON.stringify({ email: "INVITEE@example.test", role: "member" }),
    },
  );
  const body = await response.text();
  assert(
    response.status === 201 && body === '{"status":"invited"}',
    "creation returns a narrow result",
  );
  assert(
    !body.includes("token") &&
      JSON.stringify(command).includes("invitee@example.test"),
    "token never enters response and email is normalized",
  );
  const forged = await app.request(
    "https://kinship.test/api/v1/workspace-invitations",
    {
      method: "POST",
      headers: { ...secureHeaders, origin: "https://attacker.invalid" },
      body: JSON.stringify({ email: "invitee@example.test", role: "member" }),
    },
  );
  assertStatus(forged, 403, "wrong origin is denied before mutation");
});

Deno.test("invitation HTTP checks workspace selection through the authenticated resolver", async () => {
  let requested: string | undefined;
  const app = createInvitationRoutes(services({
    resolve: (command) => {
      requested = command.requestedWorkspaceId;
      return Promise.resolve(undefined);
    },
  }));
  const response = await app.request(
    "https://kinship.test/api/v1/workspace-members",
    {
      headers: {
        cookie: secureHeaders.cookie,
        "X-Workspace-Id": "foreign-workspace",
      },
    },
  );
  assert(
    response.status === 401 && requested === "foreign-workspace",
    "cross-workspace header is not authorization evidence",
  );
});
