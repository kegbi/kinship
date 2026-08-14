import { createApiApp } from "./composition.ts";
import type { RegistrationHttpServices } from "./registration.ts";
import { RegistrationError } from "../../packages/backend/modules/workspaces/public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "bad", password: "short" }),
  });
  assert(invalid.status === 400, "invalid input must be 400");
  assert(
    invalid.headers.get("content-type")?.startsWith("application/problem+json"),
    "validation must use RFC 9457",
  );
  const valid = await app.request("http://localhost/api/v1/registrations", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

Deno.test("registration conflict and verification failures use stable safe problems", async () => {
  const app = createApiApp(services({
    register: () => Promise.reject(new RegistrationError("duplicate_email")),
    verification: {
      verify: () => resolved({ status: "expired" }),
      consumeApplicationEntry: () => resolved(undefined),
    },
  }));
  const duplicate = await app.request("http://localhost/api/v1/registrations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.test",
      firstName: "Ada",
      lastName: "",
      password: "a sufficiently long password",
      workspaceName: "Circle",
    }),
  });
  assert(
    duplicate.status === 409 &&
      (await duplicate.text()).includes("duplicate_email"),
    "duplicate must be a stable conflict",
  );
  const expired = await app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "a-valid-length-token-for-verification-00000",
      }),
    },
  );
  const body = await verified.text();
  assert(verified.status === 200, "verification succeeds");
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
  assert(missing.status === 403, "missing origin must be forbidden safely");
  const wrong = await app.request("http://localhost/api/v1/application-entry", {
    method: "POST",
    headers: {
      cookie: "kinship_entry=entry-secret",
      origin: "https://attacker.example",
    },
  });
  assert(wrong.status === 403, "wrong origin must be forbidden safely");
  assert(consumed === 0, "invalid origins must not consume or revoke entry");
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "a-valid-length-token-for-verification-00000",
      }),
    },
  );
  assert(verification.status === 503, "verification dependency failure is 503");
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
  assert(entry.status === 503, "entry dependency failure is 503");
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.test",
      firstName: "Ada",
      lastName: "",
      password: "a sufficiently long password",
      workspaceName: "Circle",
    }),
  });
  const body = await response.text();
  assert(response.status === 503, "mail failure is retryable service failure");
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
      headers: { "content-type": "application/json" },
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
