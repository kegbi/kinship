/**
 * Opening an invitation link, signing in against it, and accepting.
 *
 * One sitting, so one suite: inspection, the sign-in that needs no
 * membership, the second factor that needs both scoped cookies, and the
 * acceptance that rotates a one-use entry into a session.
 */

import { createInvitationRoutes } from "../invitations.ts";
import { assert, assertStatus } from "../../../../../testing/assert.ts";
import { secureHeaders, services } from "./invitations.test-helper.ts";

Deno.test("invitation inspection is POST-only, origin checked, and non-reflecting", async () => {
  const app = createInvitationRoutes(services());
  const get = await app.request(
    "https://kinship.test/api/v1/workspace-invitations/inspect",
  );
  assertStatus(get, 404, "GET cannot inspect bearer material");
  const response = await app.request(
    "https://kinship.test/api/v1/workspace-invitations/inspect",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kinship.test",
      },
      body: JSON.stringify({
        token: "a-valid-private-invitation-token-0000000000",
      }),
    },
  );
  const body = await response.text();
  assert(
    response.status === 200 && body.includes("invitee@example.test"),
    "pending invitation is inspectable",
  );
  assert(!body.includes("a-valid-private"), "inspection never returns token");
});

Deno.test("accepted invitation returns the role-accessible workspace entry", async () => {
  const app = createInvitationRoutes(services());
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
  const body = await response.json() as {
    readonly next: string;
    readonly workspace: { readonly id: string };
  };
  assert(
    response.status === 200 && body.next === "/app" &&
      body.workspace.id === "workspace",
    "members and admins enter the accepted workspace through Today",
  );
});

Deno.test("replacement invitation can authenticate a verified identity without membership", async () => {
  const token = "a-valid-private-invitation-token-0000000000";
  const commands: unknown[] = [];
  const app = createInvitationRoutes(services({
    resolve: () => Promise.resolve(undefined),
    signIn: (command) => {
      commands.push(command);
      return Promise.resolve({
        expiresAt: new Date("2026-08-15T12:10:00.000Z"),
        entryToken: "one-use-entry",
        status: "identity-authenticated" as const,
      });
    },
  }));
  const response = await app.request(
    "https://kinship.test/api/v1/workspace-invitations/authenticate",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kinship.test",
      },
      body: JSON.stringify({
        email: "INVITEE@example.test",
        password: "correct horse battery staple",
        token,
      }),
    },
  );
  const body = await response.text();
  const cookies = response.headers.get("set-cookie") ?? "";
  assertStatus(response, 200, "verified identity receives invitation entry");
  assert(
    JSON.stringify(commands).includes('"identityOnly":true') &&
      JSON.stringify(commands).includes(
        '"expectedEmail":"invitee@example.test"',
      ),
    "identity-only authentication is bound to the inspected invitation email",
  );
  assert(
    cookies.includes("kinship_entry=one-use-entry") &&
      cookies.includes("Path=/api/v1/workspace-invitations"),
    "one-use authority is held in a scoped HttpOnly cookie",
  );
  assert(
    !body.includes(token) && !body.includes("one-use-entry"),
    "no bearer enters response body",
  );
});

Deno.test("invitation MFA requires both scoped cookies and rejects a body invitation token", async () => {
  const invitationToken = "a-valid-private-invitation-token-0000000000";
  const commands: unknown[] = [];
  const app = createInvitationRoutes(services({
    resolve: () => Promise.resolve(undefined),
    completeMfa: (command) => {
      commands.push(command);
      return Promise.resolve({
        expiresAt: new Date("2026-08-15T12:10:00.000Z"),
        entryToken: "one-use-entry",
        status: "identity-authenticated" as const,
      });
    },
  }));
  const bodyBearer = await app.request(
    "https://kinship.test/api/v1/workspace-invitations/mfa",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "kinship_mfa=mfa-challenge",
        origin: "https://kinship.test",
      },
      body: JSON.stringify({ factor: "123456", token: invitationToken }),
    },
  );
  assert(
    bodyBearer.status === 410 && commands.length === 0,
    "a JSON bearer cannot substitute for the scoped invitation cookie",
  );

  const cookieBound = await app.request(
    "https://kinship.test/api/v1/workspace-invitations/mfa",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie:
          `kinship_mfa=mfa-challenge; kinship_invitation=${invitationToken}`,
        origin: "https://kinship.test",
      },
      body: JSON.stringify({ factor: "123456" }),
    },
  );
  assert(
    cookieBound.status === 200 && Number(commands.length) === 1,
    "the MFA path remains available when both scoped cookies are present",
  );
});

Deno.test("verified entry accepts invitation and rotates into an authenticated session", async () => {
  let command: Record<string, unknown> | undefined;
  const app = createInvitationRoutes(services({
    acceptVerifiedEntry: (received) => {
      command = received as unknown as Record<string, unknown>;
      return Promise.resolve({
        expiresAt: new Date("2026-08-16T00:00:00.000Z"),
        invitationId: "invitation",
        invitedByMemberId: "member",
        memberId: "member-2",
        role: "member" as const,
        sessionToken: "new-session",
        status: "accepted" as const,
        userId: "user-2",
        workspaceId: "workspace",
        workspaceName: "Circle",
      });
    },
    resolve: () => Promise.resolve(undefined),
  }));
  const response = await app.request(
    "https://kinship.test/api/v1/workspace-invitations/accept",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie:
          "kinship_entry=one-use-entry; kinship_invitation=private-invite",
        origin: "https://kinship.test",
        "X-Kinship-Client-Address": "2001:db8::42",
      },
      body: "{}",
    },
  );
  const cookies = response.headers.get("set-cookie") ?? "";
  assertStatus(response, 200, "verified invitee is accepted");
  assert(
    command?.ipAddress === "2001:db8::42",
    "session rotation receives the gateway-provided client address",
  );
  assert(
    cookies.includes("kinship_session=new-session") &&
      cookies.includes("kinship_entry=;") &&
      cookies.includes("Path=/api/v1/workspace-invitations"),
    "one-use authority is cleared and authenticated session is HttpOnly",
  );
});
