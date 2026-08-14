import { createConfiguredApiApp } from "./composition.ts";
import { app as publicOnlyApp } from "./app.ts";
import { browserSecurityPolicy } from "./security_config.ts";
import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";
import { SmtpVerificationMail } from "../../packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail.ts";
import type { EnvironmentReader } from "../../packages/backend/platform/postgres/config.ts";

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
  return configure(databaseUrl, mail, policy);
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
