import {
  loadPrivateProductionProfile,
  type PrivateProductionProfile,
} from "./private_production_probe.ts";
import {
  runPrivateProductionPreflight,
} from "./private_production_preflight.ts";

const PROFILE_PATH = "docs/planning/private-production-profile.json";
// A private value: the repository's published keys are refused (AUD-K6).
const KEY = "q7Lm2Xc9Vb4Nz8Kp1Rt6Wy3Hd5Gf0Js2Ae7Uo9Ii4Pk";
/** The device keyset's own key: boot refuses one that repeats a subject key. */
const DEVICE_KEY = "QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validEnvironment(): Map<string, string> {
  return new Map([
    ["APP_ENV", "production"],
    ["POSTGRES_DB", "kinship"],
    ["POSTGRES_PASSWORD", "database-private-value"],
    ["POSTGRES_APP_PASSWORD", "database-private-app-role"],
    ["POSTGRES_MIGRATOR_PASSWORD", "database-private-migrator-role"],
    ["POSTGRES_WORKER_PASSWORD", "database-private-worker-role"],
    ["POSTGRES_USER", "kinship"],
    ["PUBLIC_WEB_ORIGIN", "https://crm.example"],
    ["GATEWAY_TLS_CERTIFICATE_PATH", "/run/secrets/tls-certificate"],
    ["GATEWAY_TLS_PRIVATE_KEY_PATH", "/run/secrets/tls-private-key"],
    ["OBJECT_STORAGE_ACCESS_KEY", "object-private-access"],
    ["OBJECT_STORAGE_BUCKET", "attachments"],
    ["OBJECT_STORAGE_HOST", "objects.example"],
    ["OBJECT_STORAGE_PORT", "443"],
    ["OBJECT_STORAGE_REQUEST_TIMEOUT_MS", "30000"],
    ["OBJECT_STORAGE_SECRET_KEY", "object-private-secret"],
    ["OBJECT_STORAGE_USE_SSL", "true"],
    ["SMTP_FROM", "hello@example.test"],
    ["SMTP_HOST", "smtp.example.test"],
    ["SMTP_PASSWORD", "smtp-private-value"],
    ["SMTP_PORT", "465"],
    ["SMTP_SECURITY", "tls"],
    ["SMTP_USERNAME", "smtp-private-user"],
    [
      "AUTH_MFA_ENCRYPTION_KEYSET",
      JSON.stringify({
        activeKeyId: "current",
        keys: { current: KEY },
      }),
    ],
    [
      "AUTH_SIGN_IN_DEVICE_KEYSET",
      JSON.stringify({
        activeVersion: 1,
        keys: { v1: DEVICE_KEY },
      }),
    ],
    [
      "AUTH_THROTTLE_SUBJECT_KEYSET",
      JSON.stringify({
        activeVersion: 1,
        keys: { v1: KEY },
      }),
    ],
    ["INTEGRATIONS_DAV_ENABLED", "true"],
    [
      "INTEGRATIONS_ENCRYPTION_KEYSET",
      JSON.stringify({
        activeKeyId: "current",
        keys: { current: KEY },
      }),
    ],
    ["PRIVATE_PRODUCTION_ARCHIVE_ENCRYPTED_AT_REST", "true"],
    ["PRIVATE_PRODUCTION_ARCHIVE_KEY_RECOVERY_VERIFIED", "true"],
    ["PRIVATE_PRODUCTION_SECRET_STORE_READY", "true"],
  ]);
}

async function loadProfile(): Promise<PrivateProductionProfile> {
  return await loadPrivateProductionProfile(PROFILE_PATH);
}

Deno.test("OPS-001D preflight accepts only a complete private-production boundary", async () => {
  const environment = validEnvironment();
  const result = runPrivateProductionPreflight(
    await loadProfile(),
    { get: (name) => environment.get(name) },
  );

  assert(result.state === "ready", "complete configuration is ready");
  assert(result.issues.length === 0, "ready output has no issues");
  assert(result.checks.length === 8, "every consumed boundary is checked");
  const rendered = JSON.stringify(result);
  for (
    const secret of [
      "database-private-value",
      "object-private-secret",
      "smtp-private-value",
      KEY,
      DEVICE_KEY,
    ]
  ) {
    assert(
      !rendered.includes(secret),
      "preflight output never reflects secrets",
    );
  }
});

Deno.test("OPS-001D preflight fails closed with redacted actionable issue codes", async () => {
  const environment = validEnvironment();
  environment.set(
    "POSTGRES_PASSWORD",
    "replace-with-a-local-development-password",
  );
  environment.set("OBJECT_STORAGE_HOST", "object-store");
  environment.set("SMTP_PASSWORD", "leak-this-smtp-secret");
  environment.set("SMTP_HOST", "mailpit");
  environment.set("INTEGRATIONS_DAV_ENABLED", "false");
  environment.set("PRIVATE_PRODUCTION_ARCHIVE_ENCRYPTED_AT_REST", "false");

  const result = runPrivateProductionPreflight(
    await loadProfile(),
    { get: (name) => environment.get(name) },
  );
  const codes = result.issues.map((issue) => issue.code);
  assert(result.state === "blocked", "unsafe configuration blocks release");
  for (
    const code of [
      "database-configuration",
      "object-storage-tls",
      "smtp-configuration",
      "dav-configuration",
      "archive-encryption",
    ]
  ) {
    assert(codes.includes(code), `${code} is actionable`);
  }
  const rendered = JSON.stringify(result);
  assert(
    !rendered.includes("leak-this-smtp-secret"),
    "issue output is redacted",
  );
  assert(!rendered.includes(KEY), "key material is redacted");
});

Deno.test("[AUD-V2] preflight refuses missing, published, or shared database role passwords", async () => {
  const profile = await loadProfile();
  const roles = [
    ["POSTGRES_APP_PASSWORD", "replace-with-a-local-app-role-password"],
    [
      "POSTGRES_MIGRATOR_PASSWORD",
      "replace-with-a-local-migrator-role-password",
    ],
    ["POSTGRES_WORKER_PASSWORD", "replace-with-a-local-worker-role-password"],
  ] as const;
  const blocked = (change: (environment: Map<string, string>) => void) => {
    const environment = validEnvironment();
    change(environment);
    const result = runPrivateProductionPreflight(profile, {
      get: (name) => environment.get(name),
    });
    return result.state === "blocked" &&
      result.issues.some((issue) => issue.code === "database-configuration") &&
      !JSON.stringify(result).includes("database-private");
  };
  for (const [name, placeholder] of roles) {
    assert(
      blocked((environment) => environment.set(name, placeholder)),
      `${name}'s published .env.example value is refused`,
    );
    assert(
      blocked((environment) => environment.delete(name)),
      `a missing ${name} is refused`,
    );
    assert(
      blocked((environment) => environment.set(name, "database-private-value")),
      `${name} equal to POSTGRES_PASSWORD is refused`,
    );
  }
  assert(
    blocked((environment) =>
      environment.set("POSTGRES_WORKER_PASSWORD", "database-private-app-role")
    ),
    "two roles sharing one password are refused",
  );
  assert(
    blocked((environment) =>
      environment.set("POSTGRES_APP_PASSWORD", "too-short-15-ch")
    ),
    "a role password the bootstrap step would refuse (under 16) is refused",
  );
});

Deno.test("OPS-001D preflight allows an explicitly disabled DAV module without its key", async () => {
  const environment = validEnvironment();
  environment.set("INTEGRATIONS_DAV_ENABLED", "false");
  environment.delete("INTEGRATIONS_ENCRYPTION_KEYSET");

  const result = runPrivateProductionPreflight(
    await loadProfile(),
    { get: (name) => environment.get(name) },
  );
  assert(result.state === "ready", "disabled optional provider needs no key");
});

Deno.test("[AUD-A3] preflight refuses a device keyset that reuses a throttle-subject key", async () => {
  const environment = validEnvironment();
  environment.set(
    "AUTH_SIGN_IN_DEVICE_KEYSET",
    JSON.stringify({ activeVersion: 2, keys: { v2: KEY } }),
  );

  const result = runPrivateProductionPreflight(
    await loadProfile(),
    { get: (name) => environment.get(name) },
  );
  assert(result.state === "blocked", "a reused key blocks release");
  assert(
    result.issues.map((issue) => issue.code).includes("authentication-keysets"),
    "the reused key is reported as an authentication keyset issue",
  );
  assert(!JSON.stringify(result).includes(KEY), "key material is redacted");
});

Deno.test("OPS-001D preflight rejects incomplete secret lifecycle metadata", async () => {
  const profile = await loadProfile();
  let error: unknown;
  try {
    runPrivateProductionPreflight({
      ...profile,
      operations: {
        ...profile.operations,
        secrets: profile.operations.secrets.map((secret, index) =>
          index === 0 ? { ...secret, rotation: "" } : secret
        ),
      },
    }, { get: () => undefined });
  } catch (caught) {
    error = caught;
  }
  assert(
    error instanceof Error && error.message.includes("operations profile"),
    "machine-consumed inventory requires owner, rotation, and recovery",
  );
});

Deno.test("OPS-001D preflight canonicalizes local provider host forms", async () => {
  const profile = await loadProfile();
  for (
    const host of [
      "LOCALHOST.",
      "service.LOCALHOST.",
      "MAILPIT.",
      "OBJECT-STORE.",
      "127.0.0.2",
      "127.255.255.255",
      "127.1",
      "0177.0.0.1",
      "2130706433",
      "0.0.0.0",
      "0",
      "::",
      "::1",
      "[::1]",
      "0:0:0:0:0:0:0:1",
      "::ffff:127.0.0.1",
    ]
  ) {
    const smtpEnvironment = validEnvironment();
    smtpEnvironment.set("SMTP_HOST", host);
    const smtp = runPrivateProductionPreflight(profile, {
      get: (name) => smtpEnvironment.get(name),
    });
    assert(
      smtp.issues.some((issue) => issue.code === "smtp-configuration"),
      `${host} cannot escape the external SMTP boundary`,
    );

    const objectEnvironment = validEnvironment();
    objectEnvironment.set("OBJECT_STORAGE_HOST", host);
    const object = runPrivateProductionPreflight(profile, {
      get: (name) => objectEnvironment.get(name),
    });
    assert(
      object.issues.some((issue) => issue.code === "object-storage-tls"),
      `${host} cannot escape the external object-storage boundary`,
    );
  }
});

Deno.test("[AUD-K6] preflight blocks key material published in the repository", async () => {
  const profile = await loadProfile();
  // `compose.test.yaml`'s keysets and the API's development fallbacks.
  const published = [
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "REREREREREREREREREREREREREREREREREREREREREQ",
    "S0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0s",
    "UlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlI",
    "aWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWk",
  ];
  for (const key of published) {
    for (
      const [name, keyset, code] of [
        [
          "AUTH_MFA_ENCRYPTION_KEYSET",
          { activeKeyId: "current", keys: { current: key } },
          "authentication-keysets",
        ],
        [
          "AUTH_THROTTLE_SUBJECT_KEYSET",
          { activeVersion: 2, keys: { v1: key, v2: KEY } },
          "authentication-keysets",
        ],
        [
          "AUTH_SIGN_IN_DEVICE_KEYSET",
          { activeVersion: 2, keys: { v1: key, v2: DEVICE_KEY } },
          "authentication-keysets",
        ],
        [
          "INTEGRATIONS_ENCRYPTION_KEYSET",
          { activeKeyId: "current", keys: { current: KEY, retired: key } },
          "dav-configuration",
        ],
      ] as const
    ) {
      const environment = validEnvironment();
      environment.set(name, JSON.stringify(keyset));
      const result = runPrivateProductionPreflight(
        profile,
        { get: (requested) => environment.get(requested) },
      );
      assert(result.state === "blocked", `${name} with ${key} is blocked`);
      assert(
        result.issues.length === 1 && result.issues[0]?.code === code,
        `${name} with a published key reports ${code}`,
      );
      assert(
        !JSON.stringify(result).includes(key),
        "the refused key is not echoed",
      );
    }
  }
});
