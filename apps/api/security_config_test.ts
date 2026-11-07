import { browserSecurityPolicy } from "./security_config.ts";
import { resolveApplicationEnvironment } from "../../packages/backend/platform/application_environment.ts";
import { createApiRuntime } from "./composition.ts";
import {
  createAuthenticationResponseEqualizer,
  resolveAuthenticationResponseFloor,
} from "./authentication_response.ts";
import { assert, assertThrows } from "../../packages/backend/testing/assert.ts";

/** A private key: production refuses the repository's published keys. */
const PRIVATE_KEY = "q7Lm2Xc9Vb4Nz8Kp1Rt6Wy3Hd5Gf0Js2Ae7Uo9Ii4Pk";

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
    keys: { test: PRIVATE_KEY },
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
  const validMfa = JSON.stringify({
    activeKeyId: "test",
    keys: { test: PRIVATE_KEY },
  });
  const validSubject = JSON.stringify({
    activeVersion: 1,
    keys: { v1: PRIVATE_KEY },
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

/**
 * Runs the API runtime over `values` with a composition stand-in that records
 * whether startup got past configuration, and returns what startup threw.
 */
function startupFailure(
  values: Readonly<Record<string, string | undefined>>,
): { readonly composed: boolean; readonly error: unknown } {
  let composed = false;
  try {
    createApiRuntime({ get: (requested) => values[requested] }, () => {
      composed = true;
      throw new Error("database composition must not be reached");
    });
  } catch (caught) {
    return { composed, error: caught };
  }
  return { composed, error: undefined };
}

/** The keysets `compose.test.yaml` publishes, by variable name. */
async function publishedTestKeysets(): Promise<Map<string, string>> {
  const overlay = await Deno.readTextFile(
    new URL("../../compose.test.yaml", import.meta.url),
  );
  const keysets = new Map<string, string>();
  for (const match of overlay.matchAll(/^\s+(\w+_KEYSET): '(.+)'$/gm)) {
    keysets.set(match[1]!, match[2]!);
  }
  return keysets;
}

/** A complete production start whose keysets are all private values. */
function productionStart(): Record<string, string> {
  return {
    APP_ENV: "production",
    AUTH_MFA_ENCRYPTION_KEYSET: JSON.stringify({
      activeKeyId: "current",
      keys: { current: PRIVATE_KEY },
    }),
    AUTH_THROTTLE_SUBJECT_KEYSET: JSON.stringify({
      activeVersion: 1,
      keys: { v1: PRIVATE_KEY },
    }),
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    INTEGRATIONS_ENCRYPTION_KEYSET: JSON.stringify({
      activeKeyId: "current",
      keys: { current: PRIVATE_KEY },
    }),
    PUBLIC_WEB_ORIGIN: "https://kinship.example",
    SMTP_FROM: "hello@kinship.example",
    SMTP_HOST: "smtp.kinship.example",
    SMTP_PASSWORD: "smtp-private-value",
    SMTP_PORT: "465",
    SMTP_SECURITY: "tls",
    SMTP_USERNAME: "smtp-private-user",
  };
}

Deno.test("[AUD-K6] a process started without APP_ENV is production, never development", () => {
  for (const unset of [undefined, ""]) {
    const { composed, error } = startupFailure({
      APP_ENV: unset,
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    });
    assert(
      error instanceof Error &&
        error.message.includes("required in production"),
      `APP_ENV=${JSON.stringify(unset)} must take no development default`,
    );
    assert(!composed, "an unset APP_ENV fails before database composition");
  }
  const unknown = startupFailure({
    APP_ENV: "staging",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
  });
  assert(
    unknown.error instanceof Error &&
      unknown.error.message.includes("APP_ENV must be"),
    "an unknown APP_ENV refuses to start",
  );
  assert(!unknown.composed, "an unknown APP_ENV fails before composition");
});

Deno.test("[AUD-K6] production refuses every keyset the repository publishes", async () => {
  const accepted = startupFailure(productionStart());
  assert(
    accepted.composed,
    `a private production start reaches composition, got ${accepted.error}`,
  );
  const published = await publishedTestKeysets();
  assert(published.size >= 3, "compose.test.yaml publishes its keysets");
  for (const [name, keyset] of published) {
    const { composed, error } = startupFailure({
      ...productionStart(),
      [name]: keyset,
    });
    assert(
      error instanceof Error && error.message.includes(name) &&
        error.message.includes("repository"),
      `production must refuse the published ${name}, got ${error}`,
    );
    assert(!composed, `the published ${name} fails before composition`);
  }
  // The development fallbacks are repository constants too, and a retired key
  // kept for decryption is refused like an active one.
  for (
    const [name, keyset] of [
      [
        "AUTH_MFA_ENCRYPTION_KEYSET",
        JSON.stringify({
          activeKeyId: "current",
          keys: {
            current: PRIVATE_KEY,
            previous: "S0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0s",
          },
        }),
      ],
      [
        "AUTH_THROTTLE_SUBJECT_KEYSET",
        JSON.stringify({
          activeVersion: 2,
          keys: {
            v1: "UlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlI",
            v2: PRIVATE_KEY,
          },
        }),
      ],
    ] as const
  ) {
    const { composed, error } = startupFailure({
      ...productionStart(),
      [name]: keyset,
    });
    assert(
      error instanceof Error && error.message.includes(name),
      `production must refuse a repository key retained in ${name}`,
    );
    assert(!composed, `a retained repository key in ${name} fails early`);
  }
  // Development and test keep using the published keysets.
  const local = startupFailure({
    ...Object.fromEntries(published),
    APP_ENV: "test",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    PUBLIC_WEB_ORIGIN: "http://127.0.0.1:4321",
  });
  assert(
    local.composed,
    `test may use the published keysets, got ${local.error}`,
  );
});

Deno.test("[AUD-K6] APP_ENV is production unless development or test is named", () => {
  const reader = (value: string | undefined) => ({
    get: (name: string) => name === "APP_ENV" ? value : undefined,
  });
  assert(
    resolveApplicationEnvironment(reader(undefined)) === "production" &&
      resolveApplicationEnvironment(reader("")) === "production",
    "an unset or empty APP_ENV is production",
  );
  for (const named of ["development", "test", "production"] as const) {
    assert(
      resolveApplicationEnvironment(reader(named)) === named,
      `${named} is taken as named`,
    );
  }
  for (const unknown of ["staging", "Production", " development"]) {
    assertThrows(() => {
      resolveApplicationEnvironment(reader(unknown));
    }, `${JSON.stringify(unknown)} refuses to start`);
  }
});
