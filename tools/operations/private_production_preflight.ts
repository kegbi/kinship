import { assertNoRepositoryKeys } from "../../apps/api/configured_keysets.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { resolveObjectStorageConfiguration } from "../../apps/api/file_storage_config.ts";
import { resolveAuthenticationResponseFloor } from "../../apps/api/authentication_response.ts";
import {
  assertDistinctSignInDeviceKeys,
  decodeAuthenticationSubjectKeyset,
} from "../../packages/backend/modules/api-access/public.ts";
import { decodeMfaEncryptionKeyset } from "../../packages/backend/modules/identity/composition.ts";
import { decodeDavEncryptionKeyset } from "../../packages/backend/modules/integrations/composition.ts";
import {
  composeVerificationMail,
  resolveSmtpVerificationMailOptions,
} from "../../packages/backend/modules/workspaces/composition.ts";
import { buildPostgresUrl } from "../../packages/backend/platform/postgres/config.ts";
import {
  loadPrivateProductionProfile,
  type PrivateProductionProfile,
} from "./private_production_probe.ts";

interface EnvironmentReader {
  get(name: string): string | undefined;
}

export interface PrivateProductionPreflightIssue {
  readonly action: string;
  readonly code: string;
}

export interface PrivateProductionPreflightResult {
  readonly checks: readonly string[];
  readonly environment: "private-production";
  readonly event: "operator.configuration_preflight";
  readonly issues: readonly PrivateProductionPreflightIssue[];
  readonly state: "blocked" | "ready";
}

type Check = {
  readonly name: string;
  readonly validate: () => void;
  readonly issue: PrivateProductionPreflightIssue;
};

const SECRET_NAMES = [
  "AUTH_MFA_ENCRYPTION_KEYSET",
  "AUTH_SIGN_IN_DEVICE_KEYSET",
  "AUTH_THROTTLE_SUBJECT_KEYSET",
  "GATEWAY_TLS_PRIVATE_KEY_PATH",
  "INTEGRATIONS_ENCRYPTION_KEYSET",
  "OBJECT_STORAGE_ACCESS_KEY+OBJECT_STORAGE_SECRET_KEY",
  "POSTGRES_APP_PASSWORD+POSTGRES_MIGRATOR_PASSWORD+POSTGRES_WORKER_PASSWORD",
  "POSTGRES_PASSWORD",
  "PRIVATE_PRODUCTION_ARCHIVE_KEY",
  "SMTP_USERNAME+SMTP_PASSWORD",
] as const;

/** Each service role's password and the placeholder `.env.example` publishes. */
const DATABASE_ROLE_PASSWORDS = [
  ["POSTGRES_APP_PASSWORD", "replace-with-a-local-app-role-password"],
  ["POSTGRES_MIGRATOR_PASSWORD", "replace-with-a-local-migrator-role-password"],
  ["POSTGRES_WORKER_PASSWORD", "replace-with-a-local-worker-role-password"],
] as const;

function required(environment: EnvironmentReader, name: string): string {
  const value = environment.get(name);
  if (!value) throw new Error("missing");
  return value;
}

function exactBoolean(
  environment: EnvironmentReader,
  name: string,
): boolean {
  const value = required(environment, name);
  if (value !== "true" && value !== "false") throw new Error("boolean");
  return value === "true";
}

function canonicalProviderHost(host: string): string | undefined {
  const trimmed = host.trim();
  if (!trimmed || trimmed !== host) return undefined;
  const withoutRootDot = trimmed.replace(/\.+$/, "");
  const authority = withoutRootDot.includes(":") &&
      !(withoutRootDot.startsWith("[") && withoutRootDot.endsWith("]"))
    ? `[${withoutRootDot}]`
    : withoutRootDot;
  try {
    const parsed = new URL(`http://${authority}`);
    if (
      parsed.username || parsed.password || parsed.port ||
      parsed.pathname !== "/" || parsed.search || parsed.hash
    ) return undefined;
    const hostname = parsed.hostname.toLowerCase();
    return hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  } catch {
    return undefined;
  }
}

function isLocalProviderHost(host: string): boolean {
  const canonical = canonicalProviderHost(host);
  if (!canonical) return true;
  if (
    canonical === "mailpit" || canonical === "object-store" ||
    canonical === "localhost" || canonical.endsWith(".localhost")
  ) return true;
  if (canonical === "0.0.0.0" || /^127(?:\.|$)/.test(canonical)) return true;
  if (
    canonical === "::" || canonical === "::1" ||
    /^::ffff:7f[0-9a-f]{2}:/.test(canonical)
  ) return true;
  return false;
}

function assertProfile(profile: PrivateProductionProfile): void {
  const secretNames = profile.operations.secrets.map((secret) => secret.name)
    .sort();
  if (
    profile.environment !== "private-production" ||
    profile.operations.preflightCommand !==
      "deno task ops preflight" ||
    profile.operations.runbookPath !==
      "docs/operations/private-production.md" ||
    profile.operations.archiveProtection.encryptedAtRestRequired !== true ||
    profile.operations.archiveProtection.keyRecoveryVerificationRequired !==
      true ||
    JSON.stringify(secretNames) !== JSON.stringify(SECRET_NAMES) ||
    profile.operations.secrets.some((secret) =>
      secret.owner !== "private-production-owner" || !secret.rotation ||
      !secret.recovery
    )
  ) {
    throw new Error("Invalid private-production operations profile.");
  }
}

export function runPrivateProductionPreflight(
  profile: PrivateProductionProfile,
  environment: EnvironmentReader,
): PrivateProductionPreflightResult {
  assertProfile(profile);
  const davEnabled = environment.get("INTEGRATIONS_DAV_ENABLED");
  const checks: readonly Check[] = [
    {
      name: "application",
      validate: () => {
        if (required(environment, "APP_ENV") !== "production") {
          throw new Error("environment");
        }
        browserSecurityPolicy(
          "production",
          required(environment, "PUBLIC_WEB_ORIGIN"),
        );
      },
      issue: {
        code: "application-configuration",
        action:
          "Set APP_ENV=production and one credential-free HTTPS PUBLIC_WEB_ORIGIN.",
      },
    },
    {
      name: "database",
      validate: () => {
        if (environment.get("DATABASE_URL") !== undefined) {
          throw new Error("direct URL is not part of the deployment boundary");
        }
        const password = required(environment, "POSTGRES_PASSWORD");
        if (password === "replace-with-a-local-development-password") {
          throw new Error("local placeholder");
        }
        // ADR 0008: the migrate job, the API, and the worker each sign in
        // with their own role. Each password is set, is not the value
        // .env.example publishes, meets the bootstrap step's 16 characters,
        // and is shared with no other role, the superuser included.
        const rolePasswords = DATABASE_ROLE_PASSWORDS.map(
          ([name, placeholder]) => {
            const value = required(environment, name);
            if (value === placeholder || value.length < 16) {
              throw new Error("published or short role password");
            }
            return value;
          },
        );
        if (new Set([password, ...rolePasswords]).size !== 4) {
          throw new Error("shared database password");
        }
        buildPostgresUrl({
          database: required(environment, "POSTGRES_DB"),
          host: "postgres",
          password,
          port: 5432,
          user: required(environment, "POSTGRES_USER"),
        });
      },
      issue: {
        code: "database-configuration",
        action:
          "Provide POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, and four distinct passwords of at least 16 characters (POSTGRES_PASSWORD, POSTGRES_APP_PASSWORD, POSTGRES_MIGRATOR_PASSWORD, POSTGRES_WORKER_PASSWORD, none the .env.example value) only through the deployment secret boundary; remove DATABASE_URL from Compose input.",
      },
    },
    {
      name: "gateway-tls",
      validate: () => {
        const certificate = required(
          environment,
          "GATEWAY_TLS_CERTIFICATE_PATH",
        );
        const privateKey = required(
          environment,
          "GATEWAY_TLS_PRIVATE_KEY_PATH",
        );
        if (
          certificate === privateKey || certificate.startsWith("./.tls/") ||
          privateKey.startsWith("./.tls/")
        ) throw new Error("local or shared TLS material");
      },
      issue: {
        code: "gateway-tls",
        action:
          "Mount distinct deployment-managed certificate and private-key paths; do not use repo-local .tls material.",
      },
    },
    {
      name: "object-storage",
      validate: () => {
        const configuration = resolveObjectStorageConfiguration(environment);
        if (!configuration.useSsl || isLocalProviderHost(configuration.host)) {
          throw new Error("external TLS provider required");
        }
      },
      issue: {
        code: "object-storage-tls",
        action:
          "Provide a non-local S3-compatible endpoint and scoped credentials with OBJECT_STORAGE_USE_SSL=true.",
      },
    },
    {
      name: "smtp",
      validate: () => {
        const options = resolveSmtpVerificationMailOptions(environment);
        if (
          options.security !== "tls" || !options.username ||
          !options.password || isLocalProviderHost(options.host)
        ) throw new Error("authenticated TLS required");
        composeVerificationMail(environment);
      },
      issue: {
        code: "smtp-configuration",
        action:
          "Provide SMTP_FROM, SMTP_HOST, SMTP_PORT, SMTP_SECURITY=tls, SMTP_USERNAME, and SMTP_PASSWORD through the deployment boundary.",
      },
    },
    {
      name: "authentication-keys",
      validate: () => {
        assertNoRepositoryKeys(
          "AUTH_MFA_ENCRYPTION_KEYSET",
          decodeMfaEncryptionKeyset(
            required(environment, "AUTH_MFA_ENCRYPTION_KEYSET"),
          ),
        );
        const subjectKeyset = decodeAuthenticationSubjectKeyset(
          required(environment, "AUTH_THROTTLE_SUBJECT_KEYSET"),
        );
        assertNoRepositoryKeys("AUTH_THROTTLE_SUBJECT_KEYSET", subjectKeyset);
        const deviceKeyset = decodeAuthenticationSubjectKeyset(
          required(environment, "AUTH_SIGN_IN_DEVICE_KEYSET"),
          "AUTH_SIGN_IN_DEVICE_KEYSET",
        );
        assertNoRepositoryKeys("AUTH_SIGN_IN_DEVICE_KEYSET", deviceKeyset);
        assertDistinctSignInDeviceKeys(deviceKeyset, subjectKeyset);
        resolveAuthenticationResponseFloor(
          environment.get("AUTH_MINIMUM_RESPONSE_MS"),
        );
      },
      issue: {
        code: "authentication-keysets",
        action:
          "Provide valid, privately generated versioned MFA, throttle-subject, and sign-in device keysets (never a repository key, and no device key repeating a subject key); retain prior decrypt/verification keys during rotation.",
      },
    },
    {
      name: "dav",
      validate: () => {
        if (davEnabled !== "true" && davEnabled !== "false") {
          throw new Error("explicit flag required");
        }
        const keyset = environment.get("INTEGRATIONS_ENCRYPTION_KEYSET");
        if (davEnabled === "true") {
          assertNoRepositoryKeys(
            "INTEGRATIONS_ENCRYPTION_KEYSET",
            decodeDavEncryptionKeyset(required(
              environment,
              "INTEGRATIONS_ENCRYPTION_KEYSET",
            )),
          );
        } else if (keyset !== undefined && keyset !== "") {
          throw new Error("disabled provider retains active key");
        }
      },
      issue: {
        code: "dav-configuration",
        action:
          "Set INTEGRATIONS_DAV_ENABLED explicitly; provide a valid, privately generated encryption keyset only when DAV is enabled.",
      },
    },
    {
      name: "recovery-secrets",
      validate: () => {
        if (
          !exactBoolean(environment, "PRIVATE_PRODUCTION_SECRET_STORE_READY") ||
          !exactBoolean(
            environment,
            "PRIVATE_PRODUCTION_ARCHIVE_ENCRYPTED_AT_REST",
          ) ||
          !exactBoolean(
            environment,
            "PRIVATE_PRODUCTION_ARCHIVE_KEY_RECOVERY_VERIFIED",
          )
        ) throw new Error("recovery confirmation required");
      },
      issue: {
        code: "archive-encryption",
        action:
          "Confirm the external secret store, encrypted-at-rest recovery archive, and independently tested archive-key recovery boundary.",
      },
    },
  ];

  const issues: PrivateProductionPreflightIssue[] = [];
  for (const check of checks) {
    try {
      check.validate();
    } catch {
      issues.push(check.issue);
    }
  }
  return {
    checks: checks.map((check) => check.name),
    environment: "private-production",
    event: "operator.configuration_preflight",
    issues,
    state: issues.length === 0 ? "ready" : "blocked",
  };
}

async function main(): Promise<number> {
  const profile = await loadPrivateProductionProfile();
  const result = runPrivateProductionPreflight(profile, Deno.env);
  await Deno.stdout.write(
    new TextEncoder().encode(`${JSON.stringify(result)}\n`),
  );
  return result.state === "ready" ? 0 : 2;
}

if (import.meta.main) Deno.exit(await main());
