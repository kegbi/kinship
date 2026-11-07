/**
 * An owner inviting somebody, and the list of who has been invited.
 *
 * Neither route may return the invitation token, and neither may act on a
 * workspace the session did not resolve.
 */

import { createInvitationRoutes } from "../invitations.ts";
import { assert, assertStatus } from "../../../../../testing/assert.ts";
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

const FOREIGN_WORKSPACE = "00000000-0000-4000-8000-00000000f0f0";

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
        "X-Workspace-Id": FOREIGN_WORKSPACE,
      },
    },
  );
  assert(
    response.status === 401 && requested === FOREIGN_WORKSPACE,
    "cross-workspace header is not authorization evidence",
  );
});

const INVITATION_ID = "00000000-0000-4000-8000-0000000000a1";

Deno.test("[SECT-04] revoking an invitation is origin/session protected and answers each outcome", async () => {
  const calls: unknown[] = [];
  let outcome: "forbidden" | "not-found" | "revoked" | "throw" = "revoked";
  const app = createInvitationRoutes(services({
    revoke: (actor, invitationId) => {
      calls.push({ actor, invitationId });
      return outcome === "throw"
        ? Promise.reject(new Error("database detail"))
        : Promise.resolve(outcome);
    },
  }));
  const revoke = (id = INVITATION_ID, headers = secureHeaders) =>
    app.request(`https://kinship.test/api/v1/workspace-invitations/${id}`, {
      method: "DELETE",
      headers,
    });

  const revoked = await revoke();
  assert(
    revoked.status === 200 &&
      await revoked.text() === '{"status":"revoked"}' &&
      revoked.headers.get("cache-control") === "private, no-store",
    "revocation answers a narrow uncached result",
  );
  assert(
    JSON.stringify(calls[0]) === JSON.stringify({
      actor: {
        memberId: "member",
        role: "owner",
        userId: "user",
        workspaceId: "workspace",
      },
      invitationId: INVITATION_ID,
    }),
    `the resolved actor and the path id reach the use case: ${
      JSON.stringify(calls[0])
    }`,
  );

  const expected = {
    forbidden: [403, "invitation_forbidden"],
    "not-found": [404, "invitation_not_found"],
    throw: [503, "invitation_unavailable"],
  } as const;
  for (const [result, [status, code]] of Object.entries(expected)) {
    outcome = result as keyof typeof expected;
    const response = await revoke();
    const body = await response.json() as { readonly code: string };
    assert(
      response.status === status && body.code === code,
      `${result} answers ${status} ${code}: ${response.status} ${body.code}`,
    );
  }

  const before = calls.length;
  assertStatus(await revoke("not-a-uuid"), 404, "a malformed id is not found");
  assertStatus(
    await revoke(INVITATION_ID, {
      ...secureHeaders,
      origin: "https://attacker.invalid",
    }),
    403,
    "wrong origin is denied before mutation",
  );
  assert(calls.length === before, "neither refusal reaches the use case");
});
