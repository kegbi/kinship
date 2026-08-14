import { Hono } from "hono";
import { sql } from "kysely";
import { HEALTH_RESPONSE } from "../../packages/contracts/health.ts";
import {
  Argon2idPasswordHasher,
  PostgresEmailVerification,
  PostgresIdentityRegistration,
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createVerificationDeliveryRetry,
  PostgresRegistrationTransaction,
  PostgresWorkspaceRegistration,
} from "../../packages/backend/modules/workspaces/public.ts";
import {
  createFirstWorkspaceRegistration,
  type VerificationMail,
} from "../../packages/backend/modules/workspaces/public.ts";
import { SmtpVerificationMail } from "../../packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail.ts";
import { PostgresRegistrationAudit } from "../../packages/backend/modules/governance/public.ts";
import {
  createRegistrationRoutes,
  type RegistrationHttpServices,
} from "./registration.ts";
import {
  type BrowserSecurityPolicy,
  browserSecurityPolicy,
} from "./security_config.ts";

export interface ApiServices extends RegistrationHttpServices {
  readonly readiness?: () => Promise<boolean>;
}

export class CapturedVerificationMail implements VerificationMail {
  readonly #messages = new Map<string, string[]>();

  sendVerification(
    message: { readonly email: string; readonly token: string },
  ): Promise<void> {
    const key = message.email.toLowerCase();
    this.#messages.set(key, [
      ...(this.#messages.get(key) ?? []),
      message.token,
    ]);
    return Promise.resolve();
  }

  latestToken(email: string): string | undefined {
    return this.#messages.get(email.toLowerCase())?.at(-1);
  }

  tokens(email: string): readonly string[] {
    return this.#messages.get(email.toLowerCase()) ?? [];
  }
}

export function createApiApp(services?: ApiServices): Hono {
  const api = new Hono();

  api.get("/api/v1/health", async (context) => {
    context.header("Cache-Control", "no-store");
    if (services?.readiness && !(await services.readiness())) {
      return context.json({ status: "healthy", readiness: "unavailable" }, 503);
    }
    return context.json(HEALTH_RESPONSE);
  });

  if (services) api.route("/", createRegistrationRoutes(services));

  return api;
}

export function createConfiguredApiApp(
  databaseUrl: string,
  mailAdapter?: VerificationMail,
  policy: BrowserSecurityPolicy = browserSecurityPolicy("test", undefined),
): { readonly app: Hono; readonly close: () => Promise<void> } {
  const random = new WebCryptoRandomSource();
  const tokens = new SecureTokenService(random);
  const clock = { now: () => new Date() };
  const ids = { create: () => crypto.randomUUID() };
  const mail = mailAdapter ?? new SmtpVerificationMail({
    environment: Deno.env.get("APP_ENV") ?? "development",
    from: Deno.env.get("SMTP_FROM") ?? "hello@kinship.local",
    host: Deno.env.get("SMTP_HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("SMTP_PORT") ?? "1025"),
    webOrigin: Deno.env.get("PUBLIC_WEB_ORIGIN") ?? "http://127.0.0.1:4321",
  });
  const connection = connectDatabase(databaseUrl);
  const registrationDependencies = {
    audit: new PostgresRegistrationAudit(),
    clock,
    identity: new PostgresIdentityRegistration(),
    ids,
    mail,
    tokens,
    transaction: new PostgresRegistrationTransaction(connection.db),
    workspace: new PostgresWorkspaceRegistration(),
  };
  const registration = createFirstWorkspaceRegistration(
    registrationDependencies,
  );
  const verification = new PostgresEmailVerification(
    connection.db,
    tokens,
    clock,
    ids,
  );
  const app = createApiApp({
    browserSecurity: policy,
    hasher: new Argon2idPasswordHasher(random, {
      memoryKiB: 19_456,
      iterations: 2,
      parallelism: 1,
      saltLength: 16,
      hashLength: 32,
    }),
    register: registration,
    retryVerificationDelivery: createVerificationDeliveryRetry(
      registrationDependencies,
    ),
    verification,
    readiness: async () => {
      try {
        const probe = await Promise.race([
          sql<{ ready: number }>`select 1 as ready`.execute(connection.db),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), 1_500)
          ),
        ]);
        return probe !== undefined;
      } catch {
        return false;
      }
    },
  });
  return { app, close: connection.destroy };
}
