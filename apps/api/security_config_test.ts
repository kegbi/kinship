import { browserSecurityPolicy } from "./security_config.ts";
import { createApiRuntime } from "./composition.ts";
import {
  createAuthenticationResponseEqualizer,
  resolveAuthenticationResponseFloor,
} from "./authentication_response.ts";
import { assert, assertThrows } from "../../packages/backend/testing/assert.ts";

Deno.test("browser handoff policy is strict outside explicit loopback HTTP", () => {
  assert(
    !browserSecurityPolicy("development", "http://127.0.0.1:4321").secureCookie,
    "loopback development may use an insecure cookie",
  );
  assert(
    browserSecurityPolicy("production", "https://kinship.example").secureCookie,
    "production HTTPS requires Secure",
  );
  for (
    const [environment, origin] of [
      ["production", "http://127.0.0.1:4321"],
      ["development", "http://kinship.example"],
      ["test", "https://kinship.example/path"],
    ] as const
  ) {
    assertThrows(() => {
      browserSecurityPolicy(environment, origin);
    }, `${environment} ${origin} must fail closed`);
  }
});

Deno.test("authentication response floor is explicit, bounded, and monotonic", async () => {
  assert(
    resolveAuthenticationResponseFloor(undefined) === 250 &&
      resolveAuthenticationResponseFloor("100") === 100 &&
      resolveAuthenticationResponseFloor("2000") === 2_000,
    "the response floor has a documented safe default and inclusive bounds",
  );
  for (const invalid of ["99", "2001", "8.5", "not-a-duration"]) {
    assertThrows(() => {
      resolveAuthenticationResponseFloor(invalid);
    }, `${invalid} must fail before composition`);
  }

  let monotonicMilliseconds = 1_000;
  const waits: number[] = [];
  const equalizer = createAuthenticationResponseEqualizer(250, {
    nowMilliseconds: () => monotonicMilliseconds,
    wait(milliseconds) {
      waits.push(milliseconds);
      monotonicMilliseconds += milliseconds;
      return Promise.resolve();
    },
  });
  const result = await equalizer.run(() => {
    monotonicMilliseconds += 75;
    return Promise.resolve("complete");
  });
  assert(
    result === "complete" && waits[0] === 175,
    "only the remaining floor uses an asynchronous wait",
  );
  let propagated = false;
  try {
    await equalizer.run(() => {
      monotonicMilliseconds += 250;
      return Promise.reject(new Error("private failure"));
    });
  } catch {
    propagated = true;
  }
  assert(
    propagated && waits.length === 1,
    "errors propagate after full-duration work without an unnecessary timer",
  );
});

Deno.test("invalid SMTP configuration fails before database composition or serving", () => {
  for (
    const [name, value] of [
      ["SMTP_PORT", "NaN"],
      ["SMTP_PORT", "8.5"],
      ["SMTP_PORT", "0"],
      ["SMTP_PORT", "65536"],
      ["SMTP_FROM", "hello@example.test\r\nBcc: attacker@example.test"],
      ["SMTP_FROM", "not-a-mailbox"],
    ] as const
  ) {
    let composed = false;
    let error: unknown;
    try {
      createApiRuntime(
        {
          get: (requested) =>
            ({
              APP_ENV: "test",
              DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
              PUBLIC_WEB_ORIGIN: "http://127.0.0.1:4321",
              SMTP_FROM: "hello@kinship.local",
              SMTP_HOST: "127.0.0.1",
              SMTP_PORT: "1025",
              [name]: value,
            })[requested],
        },
        () => {
          composed = true;
          throw new Error("database composition must not be reached");
        },
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error, `${name}=${value} must fail startup`);
    assert(
      !composed,
      `${name}=${value} must fail before database composition and Deno.serve`,
    );
  }
});

Deno.test("MFA encryption keyset is validated at the API composition boundary", () => {
  for (
    const [environment, key, expected] of [
      ["production", undefined, "required in production"],
      ["test", "not-json-key-material", "valid JSON"],
    ] as const
  ) {
    let composed = false;
    let error: unknown;
    try {
      createApiRuntime(
        {
          get: (requested) =>
            ({
              APP_ENV: environment,
              AUTH_MFA_ENCRYPTION_KEYSET: key,
              DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
              PUBLIC_WEB_ORIGIN: environment === "production"
                ? "https://kinship.example"
                : "http://127.0.0.1:4321",
            })[requested],
        },
        () => {
          composed = true;
          throw new Error("database composition must not be reached");
        },
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error, "unsafe MFA key must fail startup");
    assert(
      error.message.includes(expected),
      `startup error must identify ${expected}`,
    );
    assert(!composed, "unsafe MFA key must fail before database composition");
  }
});

Deno.test("authentication subject keyset is validated at the API composition boundary", () => {
  const validMfaKeyset = JSON.stringify({
    activeKeyId: "test",
    keys: { test: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
  });
  const subjectKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  for (
    const [environment, key, expected] of [
      ["production", undefined, "required in production"],
      ["test", "not-json-key-material", "valid JSON"],
      [
        "test",
        JSON.stringify({
          activeVersion: Number.MAX_SAFE_INTEGER + 1,
          keys: { [`v${Number.MAX_SAFE_INTEGER + 1}`]: subjectKey },
        }),
        "invalid shape",
      ],
      [
        "test",
        JSON.stringify({
          activeVersion: 1,
          keys: { v1: subjectKey, v1e21: subjectKey },
        }),
        "v1 or newer",
      ],
      [
        "test",
        JSON.stringify({
          activeVersion: 1,
          keys: { v1: subjectKey, v01: subjectKey },
        }),
        "v1 or newer",
      ],
    ] as const
  ) {
    let composed = false;
    let error: unknown;
    try {
      createApiRuntime(
        {
          get: (requested) =>
            ({
              APP_ENV: environment,
              AUTH_MFA_ENCRYPTION_KEYSET: validMfaKeyset,
              AUTH_THROTTLE_SUBJECT_KEYSET: key,
              DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
              PUBLIC_WEB_ORIGIN: environment === "production"
                ? "https://kinship.example"
                : "http://127.0.0.1:4321",
            })[requested],
        },
        () => {
          composed = true;
          throw new Error("database composition must not be reached");
        },
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error, "unsafe subject key must fail startup");
    assert(
      error.message.includes(expected),
      `startup error must identify ${expected}`,
    );
    assert(
      !composed,
      "unsafe subject key must fail before database composition",
    );
  }
});

Deno.test("DAV encryption keyset is required and validated only when the optional module is enabled", () => {
  const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const validMfa = JSON.stringify({
    activeKeyId: "test",
    keys: { test: key },
  });
  const validSubject = JSON.stringify({
    activeVersion: 1,
    keys: { v1: key },
  });
  for (
    const [environment, integrationsKey, expected] of [
      ["production", undefined, "required in production"],
      ["test", "not-json-key-material", "valid JSON"],
    ] as const
  ) {
    let composed = false;
    let error: unknown;
    try {
      createApiRuntime(
        {
          get: (requested) =>
            ({
              APP_ENV: environment,
              AUTH_MFA_ENCRYPTION_KEYSET: validMfa,
              AUTH_THROTTLE_SUBJECT_KEYSET: validSubject,
              DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
              INTEGRATIONS_ENCRYPTION_KEYSET: integrationsKey,
              PUBLIC_WEB_ORIGIN: environment === "production"
                ? "https://kinship.example"
                : "http://127.0.0.1:4321",
            })[requested],
        },
        () => {
          composed = true;
          throw new Error("database composition must not be reached");
        },
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error, "unsafe DAV key must fail startup");
    assert(error.message.includes(expected), `startup identifies ${expected}`);
    assert(!composed, "unsafe DAV key fails before composition");
  }
});
