import { createConfiguredApiApp } from "./composition.ts";
import { app as publicOnlyApp } from "./app.ts";
import { browserSecurityPolicy } from "./security_config.ts";
import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";
import { SmtpVerificationMail } from "../../packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail.ts";
import type { EnvironmentReader } from "../../packages/backend/platform/postgres/config.ts";
import { decodeMfaEncryptionKeyset } from "../../packages/backend/modules/identity/public.ts";
import { decodeAuthenticationSubjectKeyset } from "../../packages/backend/modules/api-access/public.ts";
import { decodeDavEncryptionKeyset } from "../../packages/backend/modules/integrations/public.ts";
import {
  createAuthenticationResponseEqualizer,
  resolveAuthenticationResponseFloor,
} from "./authentication_response.ts";

const DEFAULT_PORT = 8000;

export function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function createApiRuntime(
  environment: EnvironmentReader,
  configure: typeof createConfiguredApiApp = createConfiguredApiApp,
):
  | ReturnType<typeof createConfiguredApiApp>
  | { readonly app: typeof publicOnlyApp } {
  const databaseUrl = resolveDatabaseUrl(environment);
  if (!databaseUrl) return { app: publicOnlyApp };

  const applicationEnvironment = environment.get("APP_ENV") ?? "development";
  const mfaKeysetValue = environment.get("AUTH_MFA_ENCRYPTION_KEYSET");
  const subjectKeysetValue = environment.get("AUTH_THROTTLE_SUBJECT_KEYSET");
  const davKeysetValue = environment.get("INTEGRATIONS_ENCRYPTION_KEYSET");
  const davEnabled = environment.get("INTEGRATIONS_DAV_ENABLED") !== "false";
  if (applicationEnvironment === "production" && !mfaKeysetValue) {
    throw new Error("AUTH_MFA_ENCRYPTION_KEYSET is required in production.");
  }
  if (applicationEnvironment === "production" && !subjectKeysetValue) {
    throw new Error("AUTH_THROTTLE_SUBJECT_KEYSET is required in production.");
  }
  if (
    applicationEnvironment === "production" && davEnabled && !davKeysetValue
  ) {
    throw new Error(
      "INTEGRATIONS_ENCRYPTION_KEYSET is required in production.",
    );
  }
  const mfaKeyset = mfaKeysetValue
    ? decodeMfaEncryptionKeyset(mfaKeysetValue)
    : undefined;
  const subjectKeyset = subjectKeysetValue
    ? decodeAuthenticationSubjectKeyset(subjectKeysetValue)
    : undefined;
  const davKeyset = davKeysetValue
    ? decodeDavEncryptionKeyset(davKeysetValue)
    : undefined;
  const authenticationResponseFloor = resolveAuthenticationResponseFloor(
    environment.get("AUTH_MINIMUM_RESPONSE_MS"),
  );
  const policy = browserSecurityPolicy(
    applicationEnvironment,
    environment.get("PUBLIC_WEB_ORIGIN"),
  );
  const mail = new SmtpVerificationMail({
    environment: applicationEnvironment,
    from: environment.get("SMTP_FROM") ?? "hello@kinship.local",
    host: environment.get("SMTP_HOST") ?? "127.0.0.1",
    port: Number(environment.get("SMTP_PORT") ?? "1025"),
    webOrigin: environment.get("PUBLIC_WEB_ORIGIN") ??
      "http://127.0.0.1:4321",
  });
  return configure(
    databaseUrl,
    mail,
    policy,
    mfaKeyset,
    subjectKeyset,
    createAuthenticationResponseEqualizer(authenticationResponseFloor),
    undefined,
    undefined,
    davKeyset,
    davEnabled,
  );
}

if (import.meta.main) {
  const configured = createApiRuntime(Deno.env);
  Deno.serve(
    {
      hostname: Deno.env.get("HOST") ?? "127.0.0.1",
      port: resolvePort(Deno.env.get("PORT")),
      onListen: () => undefined,
    },
    configured.app.fetch,
  );
}
