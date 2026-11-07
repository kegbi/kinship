/**
 * An invitee with no account, registering against their invitation.
 *
 * The cookies the registration leaves behind are scoped to the routes that
 * need them, and a registration whose email could not be sent says so.
 */

import { createInvitationRoutes } from "../invitations.ts";
import { assert, assertStatus } from "../../../../../testing/assert.ts";
import { services } from "./invitations.test-helper.ts";

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

Deno.test("[AUD-M3] SECA-03 an invitee past the address's registration-mail ceiling is told so on both routes", async () => {
  const token = "a-valid-private-invitation-token-0000000000";
  const app = createInvitationRoutes(services({
    registerInvitee: () => Promise.resolve("mail-limit-reached"),
    retryInviteeVerification: () => Promise.resolve("mail-limit-reached"),
  }));
  const registration = await app.request(
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
  const retry = await app.request(
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
  for (
    const [label, response] of [["register", registration], [
      "retry",
      retry,
    ]] as const
  ) {
    const body = await response.json() as { readonly code?: string };
    assert(
      response.status === 429 &&
        body.code === "verification_mail_limit_reached",
      `${label} answers the documented ceiling, got ${response.status} ${
        JSON.stringify(body)
      }`,
    );
  }
  assert(
    !(registration.headers.get("set-cookie") ?? "").includes(
      "kinship_invitation=",
    ),
    "a refused registration leaves no continuation behind",
  );
});
