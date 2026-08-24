import {
  loadPrivateProductionProfile,
  type PrivateProductionProfile,
} from "./private_production_probe.ts";
import {
  runPrivateProductionPreflight,
} from "./private_production_preflight.ts";

const PROFILE_PATH = "docs/planning/private-production-profile.json";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validEnvironment(): Map<string, string> {
  return new Map([
    ["APP_ENV", "production"],
    ["POSTGRES_DB", "kinship"],
    ["POSTGRES_PASSWORD", "database-private-value"],
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
