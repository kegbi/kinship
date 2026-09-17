import {
  createInvitationRoutes,
  type InvitationHttpServices,
} from "./invitations.ts";
import { assert, assertStatus } from "../../packages/backend/testing/assert.ts";

function services(overrides: {
  readonly accept?: InvitationHttpServices["invitations"]["accept"];
  readonly acceptVerifiedEntry?:
    InvitationHttpServices["invitations"]["acceptVerifiedEntry"];
  readonly create?: InvitationHttpServices["invitations"]["create"];
  readonly list?: InvitationHttpServices["invitations"]["list"];
  readonly resolve?: InvitationHttpServices["protectedSessions"]["resolve"];
  readonly inspect?: InvitationHttpServices["invitations"]["inspect"];
  readonly registerInvitee?:
    InvitationHttpServices["invitations"]["registerInvitee"];
  readonly retryInviteeVerification?:
    InvitationHttpServices["invitations"]["retryInviteeVerification"];
  readonly signIn?: InvitationHttpServices["protectedSessions"]["signIn"];
  readonly completeMfa?:
    InvitationHttpServices["protectedSessions"]["completeMfa"];
} = {}): InvitationHttpServices {
  const unresolved = Promise.resolve(undefined);
  return {
    browserSecurity: { origin: "https://kinship.test", secureCookie: true },
    hasher: {
      hash: (value) => Promise.resolve(`hash:${value}`),
      needsUpgrade: () => false,
      verify: () => Promise.resolve(true),
    },
    invitations: {
      accept: overrides.accept ??
        (() =>
          Promise.resolve({
            invitationId: "invitation",
            invitedByMemberId: "member",
            memberId: "member-2",
            role: "member" as const,
            status: "accepted" as const,
            workspaceId: "workspace",
            workspaceName: "Circle",
          })),
      create: overrides.create ?? (() => Promise.resolve("created" as const)),
      inspect: overrides.inspect ??
        (() =>
          Promise.resolve({
            email: "invitee@example.test",
            role: "member" as const,
            status: "pending" as const,
            workspaceName: "Circle",
          })),
      list: overrides.list ??
        (() =>
          Promise.resolve({
            invitations: [],
            members: [],
            status: "ready" as const,
          })),
      registerInvitee: overrides.registerInvitee ??
        (() => Promise.resolve("verification-required" as const)),
      retryInviteeVerification: overrides.retryInviteeVerification ??
        (() => Promise.resolve("sent" as const)),
      acceptVerifiedEntry: overrides.acceptVerifiedEntry ??
        (() =>
          Promise.resolve({
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
          })),
    },
    protectedSessions: {
      completeMfa: overrides.completeMfa ?? (() => unresolved),
      establishVerifiedEntry: () => unresolved,
      resolve: overrides.resolve ?? (() =>
        Promise.resolve({
          accessibleWorkspaces: [],
          memberId: "member",
          role: "owner" as const,
          userId: "user",
          workspaceId: "workspace",
          workspaceName: "Circle",
        })),
      signIn: overrides.signIn ?? (() => unresolved),
      signOut: () => Promise.resolve(),
    } as unknown as InvitationHttpServices["protectedSessions"],
  };
}

const secureHeaders = {
  "content-type": "application/json",
  cookie: "kinship_session=session-secret",
  origin: "https://kinship.test",
};

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

Deno.test("new invitee registration preserves invitation in scoped HttpOnly state", async () => {
  const app = createInvitationRoutes(services());
  const response = await app.request(
    "https://kinship.test/api/v1/workspace-invitations/register",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kinship.test",
      },
      body: JSON.stringify({
        email: "INVITEE@example.test",
        firstName: "New",
        lastName: "Invitee",
        password: "correct horse battery staple",
        token: "a-valid-private-invitation-token-0000000000",
      }),
    },
  );
  const body = await response.text();
  const cookie = response.headers.get("set-cookie") ?? "";
  assertStatus(response, 202, "pending invited identity is accepted");
  assert(
    cookie.includes("kinship_invitation=") && cookie.includes("HttpOnly") &&
      cookie.includes("Path=/api/v1/workspace-invitations"),
    "invitation bearer is held only in a scoped HttpOnly cookie",
  );
  assert(!body.includes("a-valid-private"), "response never exposes bearer");
});

Deno.test("invited registration reports post-commit mail failure and scoped retry truthfully", async () => {
  const token = "a-valid-private-invitation-token-0000000000";
  const failed = createInvitationRoutes(services({
    registerInvitee: () => Promise.resolve("delivery-failed"),
    retryInviteeVerification: () => Promise.resolve("delivery-failed"),
  }));
  const registration = await failed.request(
    "https://kinship.test/api/v1/workspace-invitations/register",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://kinship.test",
      },
      body: JSON.stringify({
        email: "invitee@example.test",
        firstName: "New",
        lastName: "Invitee",
        password: "correct horse battery staple",
        token,
      }),
    },
  );
  assertStatus(registration, 503, "mail failure is not reported as success");
  const registrationBody = await registration.text();
  const cookies = registration.headers.get("set-cookie") ?? "";
  assert(
    cookies.includes("kinship_invitation=") &&
      cookies.includes("Path=/api/v1/workspace-invitations"),
    "failed delivery preserves only the scoped invitation continuation",
  );
  assert(
    !registrationBody.includes(token),
    "raw invitation is never reflected",
  );

  const retry = await failed.request(
    "https://kinship.test/api/v1/workspace-invitations/verification-delivery",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `kinship_invitation=${token}`,
        origin: "https://kinship.test",
      },
      body: "{}",
    },
  );
  assertStatus(retry, 503, "repeated provider failure remains truthful");
  assert(
    !(await retry.text()).includes(token),
    "retry never returns bearer material",
  );

  const recovered = createInvitationRoutes(services({
    retryInviteeVerification: () => Promise.resolve("sent"),
  }));
  const success = await recovered.request(
    "https://kinship.test/api/v1/workspace-invitations/verification-delivery",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `kinship_invitation=${token}`,
        origin: "https://kinship.test",
      },
      body: "{}",
    },
  );
  assertStatus(success, 202, "a later bounded retry can succeed");
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
