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

Deno.test("[REL-117] SECA-02 a control character in an invitee's name answers alike for a fresh and a registered address", async () => {
  const registered = new Set(["owner@example.test"]);
  let reached = 0;
  const app = createInvitationRoutes(services({
    // A fresh address writes both names, which PostgreSQL refuses when one
    // holds a NUL; a registered one writes none.
    registerInvitee: (command) => {
      reached += 1;
      const written = !registered.has(command.email);
      return written &&
          `${command.firstName}${command.lastName}`.includes("\u0000")
        ? Promise.reject(new Error("invalid byte sequence: 0x00"))
        : Promise.resolve("verification-required");
    },
  }));
  async function register(email: string, field: string, control: string) {
    const response = await app.request(
      "https://kinship.test/api/v1/workspace-invitations/register",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://kinship.test",
        },
        body: JSON.stringify({
          email,
          firstName: "New",
          lastName: "Invitee",
          password: "correct horse battery staple",
          token: "a-valid-private-invitation-token-0000000000",
          [field]: `Ne${control}w`,
        }),
      },
    );
    return {
      status: response.status,
      body: await response.text(),
      cookies: response.headers.getSetCookie().length,
    };
  }
  for (const field of ["firstName", "lastName"]) {
    for (const control of ["\u0000", "\u0001", "\u000A", "\u001F", "\u007F"]) {
      const label = `${field} U+${
        control.charCodeAt(0).toString(16).padStart(4, "0")
      }`;
      const fresh = await register("fresh@example.test", field, control);
      const known = await register("owner@example.test", field, control);
      assert(
        fresh.status === 400 && fresh.status === known.status &&
          fresh.body === known.body && fresh.cookies === known.cookies,
        `${label}: fresh ${fresh.status} ${fresh.body} vs registered ${known.status} ${known.body}`,
      );
    }
  }
  assert(reached === 0, `no invitee registration is attempted: ${reached}`);
});
