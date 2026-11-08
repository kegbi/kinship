import { createApiApp } from "./composition.ts";
import type { RegistrationHttpServices } from "../../packages/backend/modules/workspaces/transport/http/routes.ts";
import { assert, assertStatus } from "../../packages/backend/testing/assert.ts";

/** A same-origin JSON write, as the browser sends it. */
const jsonFromOrigin = {
  "content-type": "application/json",
  origin: "http://localhost",
} as const;

function resolved<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function services(
  overrides: Partial<RegistrationHttpServices> = {},
): RegistrationHttpServices {
  return {
    hasher: {
      hash: () => resolved("$kinship$argon2id$v=1$encoded"),
      verify: () => resolved(true),
      needsUpgrade: () => false,
    },
    register: () => resolved({ status: "verification-required" }),
    verification: {
      verify: () =>
        resolved({ status: "verified", entryToken: "entry-secret" }),
      consumeApplicationEntry: () =>
        resolved({
          userId: "user",
          memberId: "member",
          workspaceId: "workspace",
          workspaceName: "Circle",
          firstName: "Ada",
        }),
    },
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    ...overrides,
  };
}

Deno.test("registration transport validates input and never returns password/token material", async () => {
  const app = createApiApp(services());
  const invalid = await app.request("http://localhost/api/v1/registrations", {
    method: "POST",
    headers: jsonFromOrigin,
    body: JSON.stringify({ email: "bad", password: "short" }),
  });
  assertStatus(invalid, 400, "invalid input must be 400");
  assert(
    invalid.headers.get("content-type")?.startsWith("application/problem+json"),
    "validation must use RFC 9457",
  );
  const valid = await app.request("http://localhost/api/v1/registrations", {
    method: "POST",
    headers: jsonFromOrigin,
    body: JSON.stringify({
      email: "OWNER@example.test",
      firstName: "Ada",
      lastName: "",
      password: "a sufficiently long password",
      workspaceName: "Circle",
    }),
  });
  const body = await valid.text();
  assert(
    valid.status === 202 && body === '{"status":"verification-required"}',
    "valid registration must be accepted narrowly",
  );
  assert(
    !body.includes("password") && !body.includes("token"),
    "success must not leak secrets",
  );
});

Deno.test("AUD-A1 registration binds the verifier cookie and never reports an existing address", async () => {
  const verifiers: string[] = [];
  const presented: (string | undefined)[] = [];
  const app = createApiApp(services({
    register: (command) => {
      verifiers.push(command.registrantVerifier);
      return resolved({ status: "verification-required" });
    },
    verification: {
      verify: (_token, registrantVerifier) => {
        presented.push(registrantVerifier);
        return resolved({ status: "verified", entryToken: "entry-secret" });
      },
      consumeApplicationEntry: () => resolved(undefined),
    },
  }));
  const registered = await app.request(
    "http://localhost/api/v1/registrations",
    {
      method: "POST",
      headers: jsonFromOrigin,
      body: JSON.stringify({
        email: "owner@example.test",
        firstName: "Ada",
        lastName: "",
        password: "a sufficiently long password",
        workspaceName: "Circle",
      }),
    },
  );
  const cookie = registered.headers.getSetCookie().find((value) =>
    value.startsWith("kinship_registrant=")
  );
  assert(
    registered.status === 202 && verifiers.length === 1 &&
      verifiers[0]!.length >= 43 &&
      cookie?.startsWith(`kinship_registrant=${verifiers[0]};`) &&
      cookie.includes("HttpOnly") && cookie.includes("SameSite=Strict") &&
      cookie.includes("Path=/api/v1/email-verifications") &&
      cookie.includes("Max-Age=86400"),
    `registration stores a fresh verifier in a narrow cookie: ${cookie}`,
  );
  const verified = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: {
        ...jsonFromOrigin,
        cookie: `kinship_registrant=${verifiers[0]}`,
      },
      body: JSON.stringify({
        token: "a-valid-length-token-for-verification-00000",
      }),
    },
  );
  assert(
    verified.status === 200 && presented[0] === verifiers[0] &&
      verified.headers.getSetCookie().some((value) =>
        value.startsWith("kinship_registrant=;") && value.includes("Max-Age=0")
      ),
    "the verifier reaches identity and is cleared once spent",
  );
  await verified.body?.cancel();
  const anonymous = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: jsonFromOrigin,
      body: JSON.stringify({
        token: "a-valid-length-token-for-verification-00000",
      }),
    },
  );
  assert(
    anonymous.status === 200 && presented[1] === undefined,
    "a browser without the cookie presents no verifier",
  );
  await anonymous.body?.cancel();
});

Deno.test("AUD-A1 a verification without the registrant is sent to choose a password", async () => {
  const app = createApiApp(services({
    verification: {
      verify: () =>
        resolved({ status: "password-required", resetToken: "reset_Token-1" }),
      consumeApplicationEntry: () => resolved(undefined),
    },
  }));
  const response = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: jsonFromOrigin,
      body: JSON.stringify({
        token: "a-valid-length-token-for-verification-00000",
      }),
    },
  );
  assert(
    response.status === 200 &&
      await response.text() ===
        '{"status":"password-required","next":"/auth/reset-password?token=reset_Token-1"}' &&
      response.headers.getSetCookie().length === 0 &&
      response.headers.get("cache-control") === "no-store",
    "the answer is the reset step and no entry handoff",
  );
});

Deno.test("AUD-A1 the three public registration writes refuse a foreign or missing origin", async () => {
  let reached = 0;
  const app = createApiApp(services({
    register: () => {
      reached += 1;
      return resolved({ status: "verification-required" });
    },
    retryVerificationDelivery: () => {
      reached += 1;
      return resolved(undefined);
    },
    verification: {
      verify: () => {
        reached += 1;
        return resolved({ status: "expired" });
      },
      consumeApplicationEntry: () => resolved(undefined),
    },
  }));
  for (
    const path of [
      "/api/v1/registrations",
      "/api/v1/email-verifications",
      "/api/v1/email-verification-deliveries",
    ]
  ) {
    for (
      const headers of [
        { "content-type": "application/json" },
        {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        { "content-type": "application/json", origin: "null" },
      ]
    ) {
      const response = await app.request(`http://localhost${path}`, {
        method: "POST",
        headers,
        body: "{}",
      });
      assertStatus(
        response,
        403,
        `${path} refuses ${headers.origin ?? "a missing"} origin`,
      );
      await response.body?.cancel();
    }
    const crossSiteForm = await app.request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        origin: "https://attacker.example",
      },
      body: "{}",
    });
    assertStatus(crossSiteForm, 415, `${path} refuses a cross-site text body`);
    await crossSiteForm.body?.cancel();
  }
  assert(reached === 0, "a refused write never reaches a use case");
});

Deno.test("verification failures use stable safe problems", async () => {
  const app = createApiApp(services({
    verification: {
      verify: () => resolved({ status: "expired" }),
      consumeApplicationEntry: () => resolved(undefined),
    },
  }));
  const expired = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: jsonFromOrigin,
      body: JSON.stringify({
        token: "a-valid-length-token-that-is-expired-000000",
      }),
    },
  );
  assert(
    expired.status === 410 &&
      (await expired.text()).includes("verification_expired"),
    "expired token must be observable safely",
  );
});

Deno.test("verified email returns only a one-time HttpOnly application handoff", async () => {
  const app = createApiApp(services());
  const verified = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: jsonFromOrigin,
      body: JSON.stringify({
        token: "a-valid-length-token-for-verification-00000",
      }),
    },
  );
  const body = await verified.text();
  assertStatus(verified, 200, "verification succeeds");
  assert(
    verified.headers.get("set-cookie")?.includes("HttpOnly") &&
      verified.headers.get("set-cookie")?.includes("SameSite=Strict"),
    "handoff must be HttpOnly and strict same-site",
  );
  assert(
    !body.includes("entry-secret"),
    "handoff secret must not enter response JSON",
  );
});

Deno.test("application entry requires POST and exact browser origin before consumption", async () => {
  let consumed = 0;
  const app = createApiApp(services({
    verification: {
      verify: () =>
        resolved({ status: "verified", entryToken: "entry-secret" }),
      consumeApplicationEntry: () => {
        consumed += 1;
        return resolved(undefined);
      },
    },
  }));
  const get = await app.request("http://localhost/api/v1/application-entry", {
    headers: { cookie: "kinship_entry=entry-secret" },
  });
  assert(
    get.status === 404 || get.status === 405,
    "GET must not consume entry",
  );
  const missing = await app.request(
    "http://localhost/api/v1/application-entry",
    {
      method: "POST",
      headers: { cookie: "kinship_entry=entry-secret" },
    },
  );
  assertStatus(missing, 403, "missing origin must be forbidden safely");
  const wrong = await app.request("http://localhost/api/v1/application-entry", {
    method: "POST",
    headers: {
      cookie: "kinship_entry=entry-secret",
      origin: "https://attacker.example",
    },
  });
  assertStatus(wrong, 403, "wrong origin must be forbidden safely");
  assert(consumed === 0, "invalid origins must not consume or revoke entry");
});

Deno.test("invited verification continues without returning invitation bearer material", async () => {
  const app = createApiApp(services());
  const response = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: {
        ...jsonFromOrigin,
        cookie: "kinship_invitation_pending=1; kinship_registrant=verifier",
      },
      body: JSON.stringify({
        token: "a-valid-private-verification-token-0000000000",
      }),
    },
  );
  const body = await response.text();
  assert(
    response.status === 200 && body.includes('"next":"/invite/continue"'),
    "invited verification returns the scrubbed continuation",
  );
  assert(
    !body.includes("a-valid-private"),
    "verification never reflects bearer material",
  );
  assert(
    response.headers.get("set-cookie")?.includes(
      "Path=/api/v1/workspace-invitations",
    ),
    "invited entry authority is scoped to invitation acceptance",
  );
});

Deno.test("verification and entry dependency failures map to safe 503 problems", async () => {
  const app = createApiApp(services({
    verification: {
      verify: () => Promise.reject(new Error("database details")),
      consumeApplicationEntry: () =>
        Promise.reject(new Error("database details")),
    },
  }));
  const verification = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: jsonFromOrigin,
      body: JSON.stringify({
        token: "a-valid-length-token-for-verification-00000",
      }),
    },
  );
  assertStatus(verification, 503, "verification dependency failure is 503");
  assert(
    !(await verification.text()).includes("database details"),
    "details stay redacted",
  );
  const entry = await app.request("http://localhost/api/v1/application-entry", {
    method: "POST",
    headers: {
      cookie: "kinship_entry=entry-secret",
      origin: "http://localhost",
    },
  });
  assertStatus(entry, 503, "entry dependency failure is 503");
  assert(
    !(await entry.text()).includes("database details"),
    "entry details stay redacted",
  );
});

Deno.test("a post-commit mail failure reports created state truthfully", async () => {
  const app = createApiApp(services({
    register: () =>
      Promise.reject(Object.assign(new Error("smtp details"), {
        code: "verification_delivery_failed",
      })),
  }));
  const response = await app.request("http://localhost/api/v1/registrations", {
    method: "POST",
    headers: jsonFromOrigin,
    body: JSON.stringify({
      email: "owner@example.test",
      firstName: "Ada",
      lastName: "",
      password: "a sufficiently long password",
      workspaceName: "Circle",
    }),
  });
  const body = await response.text();
  assertStatus(response, 503, "mail failure is retryable service failure");
  assert(
    body.includes("was created"),
    "response must not claim rollback after commit",
  );
  assert(!body.includes("smtp details"), "provider details remain redacted");
});

Deno.test("verification delivery retry is anonymous and non-enumerating", async () => {
  const app = createApiApp(services({
    retryVerificationDelivery: (email) =>
      email.startsWith("pending")
        ? Promise.reject(new Error("provider failure"))
        : resolved(undefined),
  }));
  const responses = await Promise.all([
    "pending@example.test",
    "absent@example.test",
  ].map((email) =>
    app.request("http://localhost/api/v1/email-verification-deliveries", {
      method: "POST",
      headers: jsonFromOrigin,
      body: JSON.stringify({ email }),
    })
  ));
  const bodies = await Promise.all(
    responses.map((response) => response.text()),
  );
  assert(
    responses.every((response) => response.status === 202) &&
      bodies[0] === bodies[1],
    "pending and absent identities must have the same observable response",
  );
});

Deno.test("[AUD-K4] the entry handoff sets __Host-kinship_session over HTTPS and rotates the previous one", async () => {
  const commands: { readonly previousSessionToken?: string }[] = [];
  const app = createApiApp(services({
    browserSecurity: { origin: "https://kinship.test", secureCookie: true },
    establishVerifiedEntry: (command) => {
      commands.push(command);
      return resolved({
        expiresAt: new Date(Date.now() + 3_600_000),
        member: { id: "member", role: "owner" },
        sessionToken: "fresh",
        status: "authenticated",
        workspace: { id: "workspace", name: "Circle" },
      } as Awaited<
        ReturnType<
          NonNullable<RegistrationHttpServices["establishVerifiedEntry"]>
        >
      >);
    },
  }));

  const response = await app.request(
    "http://localhost/api/v1/application-entry",
    {
      method: "POST",
      headers: {
        cookie:
          "kinship_entry=entry-secret; __Host-kinship_session=old; kinship_session=tossed",
        origin: "https://kinship.test",
      },
    },
  );

  assertStatus(response, 200);
  assert(
    commands[0]?.previousSessionToken === "old",
    "only the prefixed session is rotated",
  );
  assert(
    response.headers.getSetCookie().some((line) =>
      line.startsWith("__Host-kinship_session=fresh;") &&
      line.includes("; Secure") && line.includes("; Path=/")
    ),
    "the new session travels in the prefixed cookie",
  );
});

Deno.test("[REL-117] SECA-02 a control character in a registration name answers alike for a fresh and a registered address", async () => {
  const registered = new Set(["owner@example.test"]);
  const mail: string[] = [];
  let reached = 0;
  const app = createApiApp(services({
    // The use case as it behaves: a registered address writes no name and is
    // mailed; a fresh one writes every name, which PostgreSQL refuses when a
    // name holds a NUL, before any mail is sent.
    register: (command) => {
      reached += 1;
      if (!registered.has(command.email)) {
        const names = [
          command.firstName,
          command.lastName,
          command.workspaceName,
        ];
        if (names.some((name) => name.includes("\u0000"))) {
          return Promise.reject(
            new Error("invalid byte sequence for encoding UTF8: 0x00"),
          );
        }
      }
      mail.push(command.email);
      return resolved({ status: "verification-required" });
    },
  }));
  async function register(email: string, field: string, control: string) {
    const response = await app.request(
      "http://localhost/api/v1/registrations",
      {
        method: "POST",
        headers: jsonFromOrigin,
        body: JSON.stringify({
          email,
          firstName: "Ada",
          lastName: "Lovelace",
          password: "a sufficiently long password",
          workspaceName: "Circle",
          [field]: `Ad${control}a`,
        }),
      },
    );
    return {
      status: response.status,
      body: await response.text(),
      cookies: response.headers.getSetCookie().length,
    };
  }
  const controls = ["\u0000", "\u0001", "\u000A", "\u001F", "\u007F"];
  for (const field of ["firstName", "lastName", "workspaceName"]) {
    for (const control of controls) {
      const label = `${field} U+${
        control.charCodeAt(0).toString(16).padStart(4, "0")
      }`;
      const fresh = await register("fresh@example.test", field, control);
      const known = await register("owner@example.test", field, control);
      assert(
        fresh.status === known.status && fresh.body === known.body &&
          fresh.cookies === known.cookies,
        `${label}: fresh ${fresh.status} ${fresh.body} vs registered ${known.status} ${known.body}`,
      );
      assert(
        fresh.status === 400 && fresh.body.includes(`"${field}"`),
        `${label}: a control character is a validation failure on the field: ${fresh.status} ${fresh.body}`,
      );
    }
  }
  assert(
    reached === 0 && mail.length === 0,
    `no registration or provider call is made: ${reached} ${mail}`,
  );
});
