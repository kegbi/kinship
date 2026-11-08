/**
 * Authentication attempt budgets, reservations, and audits (split from
 * `authentication_postgres_test.ts`, GAP-035).
 *
 * Its final test closes the app and pools it loaded from
 * `authentication.test-helper.ts`.
 */

import postgres from "postgres";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { createAuthenticationRoutes } from "../../packages/backend/modules/workspaces/transport/http/authentication.ts";
import {
  AuthenticationSubjectDigester,
  type AuthenticationSubjectKeyset,
  SignInDeviceTokens,
} from "../../packages/backend/modules/api-access/public.ts";
import { authenticationAuditFrom } from "../../packages/backend/modules/workspaces/public.ts";
import {
  createProtectedSessionCoordinator,
  type ProtectedSessionTransaction,
} from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { PostgresAuthenticationAttemptBudget } from "../../packages/backend/modules/api-access/adapters/postgres/authentication_attempt_budget.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { AesGcmMfaSecretBox } from "../../packages/backend/modules/identity/adapters/crypto/totp.ts";
import { Argon2idPasswordHasher } from "../../packages/backend/modules/identity/adapters/crypto/argon2id.ts";
import { PostgresIdentityAuthentication } from "../../packages/backend/modules/identity/adapters/postgres/authentication.ts";
import {
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/adapters/crypto/secure_tokens.ts";
import { PostgresActiveWorkspaceResolver } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresRegistrationTransaction } from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  database,
  databaseUrl,
  extractCookie,
  failedAuditCount,
  immediateResponseEqualizer,
  latestAuthenticationRequestLog,
  mfaKeyset,
  registerAndVerify,
  signIn,
} from "./authentication.test-helper.ts";
import { closeResources } from "./authentication.test-helper.ts";
import { resetDatabase } from "../support/database.ts";
import {
  describePlan,
  explainedPlan,
  planNodes,
  scansOf,
  withScratchCrm,
} from "../support/query_plan.ts";
import { PostgresOutboundMailBudget } from "../../packages/backend/modules/api-access/adapters/postgres/outbound_mail_budget.ts";
import type { PasswordHasher } from "../../packages/backend/modules/identity/public.ts";

const CURRENT_ARGON2ID = {
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
  saltLength: 16,
  hashLength: 32,
} as const;

/**
 * The real sign-in route over the real PostgreSQL budget and identity adapter,
 * with the clock and password hasher in the test's hands.
 */
function throttledSignIn(options: {
  readonly clock: { now(): Date };
  readonly deviceKeyset?: AuthenticationSubjectKeyset;
  readonly hasher?: PasswordHasher;
}): {
  readonly attempt: (
    clientAddress: string,
    password: string,
    request?: { readonly cookie?: string; readonly subject?: string },
  ) => Promise<Response>;
  readonly connection: ReturnType<typeof connectDatabase>;
} {
  const connection = connectDatabase(databaseUrl);
  const random = new WebCryptoRandomSource();
  const digester = new AuthenticationSubjectDigester({
    activeVersion: 1,
    keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
  });
  const devices = options.deviceKeyset
    ? new SignInDeviceTokens(options.deviceKeyset, digester)
    : undefined;
  const coordinator = createProtectedSessionCoordinator({
    attemptBudget: new PostgresAuthenticationAttemptBudget(
      connection.db,
      digester,
      devices,
    ),
    ...(devices ? { signInDevices: devices } : {}),
    audit: authenticationAuditFrom(new PostgresAuditEventRecorder()),
    clock: options.clock,
    identity: new PostgresIdentityAuthentication(
      connection.db,
      options.hasher ?? new Argon2idPasswordHasher(random, CURRENT_ARGON2ID),
      new SecureTokenService(random),
      new AesGcmMfaSecretBox(mfaKeyset, random),
      options.clock,
      { create: () => crypto.randomUUID() },
    ),
    responseEqualizer: immediateResponseEqualizer,
    transaction: new PostgresRegistrationTransaction(connection.db),
    workspace: new PostgresActiveWorkspaceResolver(),
  });
  const app = createAuthenticationRoutes({
    browserSecurity: browserSecurityPolicy("test", "http://localhost"),
    passwordRecovery: {
      request: () => Promise.resolve({ delivery: "not-applicable" }),
      reset: () => Promise.resolve("invalid"),
    },
    protectedSessions: coordinator,
  });
  return {
    attempt: async (clientAddress, password, request = {}) =>
      await app.request("http://localhost/api/v1/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "X-Kinship-Client-Address": clientAddress,
          ...(request.cookie ? { cookie: request.cookie } : {}),
        },
        body: JSON.stringify({
          email: request.subject ?? "unset@example.test",
          password,
        }),
      }),
    connection,
  };
}

Deno.test({
  name: "real PostgreSQL budget admits only five expensive concurrent attempts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    const budget = new PostgresAuthenticationAttemptBudget(
      connection.db,
      new AuthenticationSubjectDigester({
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
      }),
    );
    const occurredAt = new Date();
    const subject = `burst-${crypto.randomUUID()}@example.test`;
    let callbacks = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const admission = await budget.reserve({
          clientAddress: "127.0.2.1",
          occurredAt,
          scope: "password",
          subject,
        });
        if (admission.status === "rate-limited") {
          await budget.finalize({
            reservationId: admission.reservationId,
            statusCode: 429,
          });
          return admission;
        }
        callbacks += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        await budget.finalize({
          reservationId: admission.reservationId,
          statusCode: 401,
        });
        return {
          reservationId: admission.reservationId,
          status: "completed" as const,
        };
      }),
    );
    try {
      assert(
        callbacks === 5,
        `only five callbacks may enter, got ${callbacks}`,
      );
      assert(
        results.filter((result) => result.status === "completed").length ===
            5 &&
          results.filter((result) => result.status === "rate-limited")
              .length ===
            3,
        "three burst attempts are rejected before expensive work",
      );
      const reservationIds = results.flatMap((result) =>
        result.status === "completed" ? [result.reservationId] : []
      );
      assert(
        new Set(reservationIds).size === 5,
        "every admitted callback owns one exact reservation id",
      );
      const [logged] = await database<{
        completed: number;
        identified: number;
        limited: number;
        pending: number;
        total: number;
      }[]>`
        select count(*)::int total,
          count(*) filter (where status_code = 401)::int completed,
          count(*) filter (where status_code = 429)::int limited,
          count(*) filter (where status_code is null)::int pending,
          count(user_id)::int identified
        from crm.api_request_logs
        where path = '/api/v1/sessions'
          and client_ip = '127.0.2.1'::inet
      `;
      assert(
        logged?.total === 8 && logged.completed === 5 &&
          logged.limited === 3 && logged.pending === 0 &&
          logged.identified === 0,
        "five exact reservations finalize 401 and three rejections log 429",
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "real PostgreSQL reservations survive restart and define rotation and outcome semantics",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const { userId } = await registerAndVerify(
      "budget-semantics@example.test",
    );
    const oldConnection = connectDatabase(databaseUrl);
    const v1Key = new Uint8Array(32).fill(0x51);
    const v2Key = new Uint8Array(32).fill(0x52);
    const oldBudget = new PostgresAuthenticationAttemptBudget(
      oldConnection.db,
      new AuthenticationSubjectDigester({
        activeVersion: 1,
        keys: new Map([[1, v1Key]]),
      }),
    );
    const base = new Date("2026-08-14T12:00:00.000Z");
    const pendingIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const admission = await oldBudget.reserve({
        clientAddress: "127.0.2.2",
        occurredAt: new Date(base.getTime() + index),
        scope: "password",
        subject: "rotating-subject@example.test",
      });
      assert(admission.status === "admitted", "pending request is reserved");
      pendingIds.push(admission.reservationId);
    }
    await oldConnection.destroy();

    const restartedConnection = connectDatabase(databaseUrl);
    const restartedBudget = new PostgresAuthenticationAttemptBudget(
      restartedConnection.db,
      new AuthenticationSubjectDigester({
        activeVersion: 2,
        keys: new Map([[1, v1Key], [2, v2Key]]),
      }),
    );
    try {
      const rejected = await restartedBudget.reserve({
        clientAddress: "127.0.2.2",
        occurredAt: new Date(base.getTime() + 10),
        scope: "password",
        subject: "rotating-subject@example.test",
      });
      assert(
        rejected.status === "rate-limited",
        "pending reservations fail closed across restart and key rotation",
      );
      await restartedBudget.finalize({
        reservationId: rejected.reservationId,
        statusCode: 429,
      });
      const [pending] = await database<{
        exact_ids: number;
        pending: number;
      }[]>`
        select count(*) filter (where id = any(${pendingIds}::uuid[]))::int
            exact_ids,
          count(*) filter (where status_code is null)::int pending
        from crm.api_request_logs
        where path = '/api/v1/sessions'
          and client_ip = '127.0.2.2'::inet
      `;
      assert(
        pending?.exact_ids === 5 && pending.pending === 5,
        "restart observes the five exact abandoned reservation ids",
      );

      const afterWindow = await restartedBudget.reserve({
        clientAddress: "127.0.2.2",
        occurredAt: new Date(base.getTime() + 5 * 60_000 + 11),
        scope: "password",
        subject: "rotating-subject@example.test",
      });
      assert(
        afterWindow.status === "admitted",
        "abandoned reservations fail closed only for the bounded window",
      );
      await restartedBudget.finalize({
        reservationId: afterWindow.reservationId,
        statusCode: 503,
      });

      let instant = base.getTime() + 1_000;
      const reserve = async (
        subject: string,
        clientAddress: string,
      ): Promise<string> => {
        const admission = await restartedBudget.reserve({
          clientAddress,
          occurredAt: new Date(instant++),
          scope: "password",
          subject,
        });
        assert(admission.status === "admitted", `${subject} is admitted`);
        return admission.reservationId;
      };
      const finish = async (
        subject: string,
        clientAddress: string,
        statusCode: 200 | 202 | 401 | 403 | 410 | 503,
      ): Promise<void> => {
        await restartedBudget.finalize({
          reservationId: await reserve(subject, clientAddress),
          statusCode,
          ...(statusCode === 200 ? { userId } : {}),
        });
      };

      const neutralSubject = "neutral-outcomes@example.test";
      const neutralAddress = "127.0.2.3";
      for (let index = 0; index < 4; index += 1) {
        await finish(neutralSubject, neutralAddress, 401);
      }
      for (const status of [202, 403, 410, 503] as const) {
        await finish(neutralSubject, neutralAddress, status);
      }
      await finish(neutralSubject, neutralAddress, 401);
      const neutralLimit = await restartedBudget.reserve({
        clientAddress: neutralAddress,
        occurredAt: new Date(instant++),
        scope: "password",
        subject: neutralSubject,
      });
      assert(
        neutralLimit.status === "rate-limited",
        "202, 403, 410, and 503 neither consume nor reset the 401 window",
      );
      await restartedBudget.finalize({
        reservationId: neutralLimit.reservationId,
        statusCode: 429,
      });

      const resetSubject = "successful-reset@example.test";
      const resetAddress = "127.0.2.4";
      for (let index = 0; index < 4; index += 1) {
        await finish(resetSubject, resetAddress, 401);
      }
      await finish(resetSubject, resetAddress, 200);
      for (let index = 0; index < 5; index += 1) {
        await finish(resetSubject, resetAddress, 401);
      }
      const resetLimit = await restartedBudget.reserve({
        clientAddress: resetAddress,
        occurredAt: new Date(instant++),
        scope: "password",
        subject: resetSubject,
      });
      assert(
        resetLimit.status === "rate-limited",
        "only completed 200 authentication resets prior failures",
      );
      await restartedBudget.finalize({
        reservationId: resetLimit.reservationId,
        statusCode: 429,
      });

      const overlapSubject = "overlapping-success@example.test";
      const overlapAddress = "127.0.2.6";
      const overlaps: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        overlaps.push(await reserve(overlapSubject, overlapAddress));
      }
      await restartedBudget.finalize({
        reservationId: overlaps[0]!,
        statusCode: 200,
        userId,
      });
      const replacement = await reserve(overlapSubject, overlapAddress);
      const overlappingLimit = await restartedBudget.reserve({
        clientAddress: overlapAddress,
        occurredAt: new Date(instant++),
        scope: "password",
        subject: overlapSubject,
      });
      assert(
        overlappingLimit.status === "rate-limited",
        "success resets prior failures but never hides outstanding work",
      );
      await restartedBudget.finalize({
        reservationId: overlappingLimit.reservationId,
        statusCode: 429,
      });
      for (const reservationId of [...overlaps.slice(1), replacement]) {
        await restartedBudget.finalize({ reservationId, statusCode: 503 });
      }
      const [attribution] = await database<{
        attributed_200: number;
        preauth_attributed: number;
      }[]>`
        select count(*) filter (
            where status_code = 200 and user_id = ${userId}::uuid
          )::int attributed_200,
          count(*) filter (
            where status_code <> 200 and user_id is not null
          )::int preauth_attributed
        from crm.api_request_logs
        where client_ip in ('127.0.2.3'::inet, '127.0.2.4'::inet)
      `;
      assert(
        attribution?.attributed_200 === 1 &&
          attribution.preauth_attributed === 0,
        "only the exact completed authentication row identifies its user",
      );
    } finally {
      await restartedConnection.destroy();
    }
  },
});

Deno.test({
  name:
    "real PostgreSQL request reservation records post-factor establishment failure as 503",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "failed-establishment@example.test";
    const { userId } = await registerAndVerify(email);
    const [row] = await database<{
      member_id: string;
      workspace_id: string;
      workspace_name: string;
    }[]>`
      select wm.id::text member_id, w.id::text workspace_id,
        w.name workspace_name
      from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.user_id = ${userId}::uuid
    `;
    assert(row, "failed-establishment fixture has an active workspace");
    const context = {
      memberId: row.member_id,
      role: "owner" as const,
      userId,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
    };
    const connection = connectDatabase(databaseUrl);
    const coordinator = createProtectedSessionCoordinator({
      attemptBudget: new PostgresAuthenticationAttemptBudget(
        connection.db,
        new AuthenticationSubjectDigester({
          activeVersion: 1,
          keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
        }),
      ),
      audit: {
        record: () => Promise.resolve("unused"),
        assertPostcondition: () => Promise.resolve(),
        recordFailure: () => Promise.resolve(undefined),
        assertFailurePostcondition: () => Promise.resolve(),
      },
      clock: { now: () => new Date("2026-08-14T13:00:00.000Z") },
      identity: {
        authenticationSubjectForMfa: () => Promise.resolve(`user:${userId}`),
        resolveAuthenticationAuditUser: () => Promise.resolve(userId),
        authenticatePassword: () =>
          Promise.resolve({ status: "invalid" as const }),
        completeMfa: () =>
          Promise.resolve({
            credentialVersion: null,
            entryCredentialVersion: "none",
            status: "verified" as const,
            userId,
          }),
        issueSession: () =>
          Promise.reject(new Error("session establishment unavailable")),
        assertSessionPostcondition: () => Promise.resolve(),
        resolveSession: () => Promise.resolve(undefined),
        revokeSession: () => Promise.resolve(true),
      },
      responseEqualizer: immediateResponseEqualizer,
      transaction: {
        run: (work) => work({ opaque: "failed-establishment" }),
      },
      workspace: {
        listActiveContexts: () => Promise.resolve([context]),
        resolveAuditContext: () => Promise.resolve(context),
        resolveActiveContext: () => Promise.resolve(context),
        assertActiveContextPostcondition: () => Promise.resolve(),
      },
    });
    let rejected = false;
    try {
      await coordinator.completeMfa({
        challengeToken: "failed-establishment-challenge",
        factor: "123456",
        ipAddress: "127.0.2.5",
      });
    } catch {
      rejected = true;
    }
    try {
      assert(rejected, "post-factor establishment failure propagates");
      const requestLog = await latestAuthenticationRequestLog(
        "/api/v1/mfa-challenges",
        "127.0.2.5",
      );
      assert(
        /^[0-9a-f-]{36}$/i.test(requestLog.id) &&
          requestLog.status_code === 503 && requestLog.user_id === null,
        "the exact failed reservation finalizes 503 without user attribution",
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "real PostgreSQL budget releases all eight pool connections before querying callbacks",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    const budget = new PostgresAuthenticationAttemptBudget(
      connection.db,
      new AuthenticationSubjectDigester({
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
      }),
    );
    let entered = 0;
    let signalEntered!: () => void;
    const allEntered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (async () => {
          const admission = await budget.reserve({
            clientAddress: `127.0.1.${index + 1}`,
            occurredAt: new Date(),
            scope: "password",
            subject: `pool-budget-${index}@example.test`,
          });
          assert(admission.status === "admitted", "distinct subject admitted");
          entered += 1;
          if (entered === 8) signalEntered();
          await released;
          await sql`select 1`.execute(connection.db);
          await budget.finalize({
            reservationId: admission.reservationId,
            statusCode: 401,
          });
          return { status: "completed" as const };
        })()),
    );
    try {
      assert(
        await Promise.race([
          allEntered.then(() => true),
          new Promise<false>((resolve) =>
            setTimeout(() => resolve(false), 5_000)
          ),
        ]),
        "all callbacks enter while the eight-connection pool remains available",
      );
      release();
      const completed = await Promise.race([
        work,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 10_000)
        ),
      ]);
      assert(
        completed !== "timeout" &&
          completed.every((result) => result.status === "completed"),
        "callback root queries complete without waiting on budget transactions",
      );
    } finally {
      release();
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "rate-limit lookup and audit failures finalize their exact pending reservations as unavailable",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const connection = connectDatabase(databaseUrl);
    const budget = new PostgresAuthenticationAttemptBudget(
      connection.db,
      new AuthenticationSubjectDigester({
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
      }),
    );
    const occurredAt = new Date("2026-08-14T14:00:00.000Z");
    let verifications = 0;
    const transaction = new PostgresRegistrationTransaction(connection.db);
    try {
      for (const failure of ["lookup", "audit"] as const) {
        const clientAddress = failure === "lookup" ? "127.0.3.1" : "127.0.3.2";
        const subject = `${failure}-failure@example.test`;
        for (let index = 0; index < 5; index += 1) {
          const admission = await budget.reserve({
            clientAddress,
            occurredAt: new Date(occurredAt.getTime() + index),
            scope: "password",
            subject,
          });
          assert(admission.status === "admitted", "failure budget is seeded");
          await budget.finalize({
            reservationId: admission.reservationId,
            statusCode: 401,
          });
        }
        const coordinator = createProtectedSessionCoordinator({
          attemptBudget: budget,
          audit: {
            record: () => Promise.resolve("unused"),
            assertPostcondition: () => Promise.resolve(),
            recordFailure: () =>
              failure === "audit"
                ? Promise.reject(new Error("governance unavailable"))
                : Promise.resolve(undefined),
            assertFailurePostcondition: () => Promise.resolve(),
          },
          clock: {
            now: () => new Date(occurredAt.getTime() + 10),
          },
          identity: {
            authenticationSubjectForMfa: () => Promise.resolve("unused"),
            resolveAuthenticationAuditUser: () =>
              failure === "lookup"
                ? Promise.reject(new Error("identity unavailable"))
                : Promise.resolve(undefined),
            authenticatePassword: () => {
              verifications += 1;
              return Promise.resolve({ status: "invalid" as const });
            },
            completeMfa: () => Promise.resolve({ status: "invalid" as const }),
            issueSession: () => Promise.reject(new Error("unused")),
            assertSessionPostcondition: () => Promise.resolve(),
            resolveSession: () => Promise.resolve(undefined),
            revokeSession: () => Promise.resolve(true),
          },
          responseEqualizer: immediateResponseEqualizer,
          transaction,
          workspace: {
            listActiveContexts: () => Promise.resolve([]),
            resolveAuditContext: () => Promise.resolve(undefined),
            resolveActiveContext: () => Promise.resolve(undefined),
            assertActiveContextPostcondition: () => Promise.resolve(),
          },
        });
        let rejected = false;
        try {
          await coordinator.signIn({
            email: subject,
            ipAddress: clientAddress,
            password: "must-not-be-verified",
          });
        } catch {
          rejected = true;
        }
        assert(rejected, `${failure} failure propagates as unavailable`);
        const exact = await latestAuthenticationRequestLog(
          "/api/v1/sessions",
          clientAddress,
        );
        assert(
          exact.status_code === 503 && exact.user_id === null,
          `${failure} failure changes its pending row to anonymous 503`,
        );
        let duplicateRejected = false;
        try {
          await budget.finalize({
            reservationId: exact.id,
            statusCode: 429,
          });
        } catch {
          duplicateRejected = true;
        }
        assert(
          duplicateRejected,
          `${failure} reservation cannot be finalized twice`,
        );
      }
      assert(
        verifications === 0,
        "rate-limited lookup and audit failures never invoke the verifier",
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "authenticated session, rotation, audit, and exact request row commit atomically",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "atomic-authentication@example.test";
    const { userId } = await registerAndVerify(email);
    const initial = await signIn(email, undefined, {
      clientAddress: "127.0.3.10",
    });
    assert(initial.status === 200, "fixture session is established");
    const previousToken = extractCookie(initial, "kinship_session");
    const connection = connectDatabase(databaseUrl);
    const random = new WebCryptoRandomSource();
    const tokens = new SecureTokenService(random);
    const hasher = new Argon2idPasswordHasher(random, {
      memoryKiB: 19_456,
      iterations: 2,
      parallelism: 1,
      saltLength: 16,
      hashLength: 32,
    });
    const actualBudget = new PostgresAuthenticationAttemptBudget(
      connection.db,
      new AuthenticationSubjectDigester({
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
      }),
    );
    let failTransactionalFinalization = true;
    const attemptBudget = {
      reserve: (
        command: Parameters<typeof actualBudget.reserve>[0],
      ) => actualBudget.reserve(command),
      async finalize(
        command: Parameters<typeof actualBudget.finalize>[0],
      ): Promise<void> {
        await actualBudget.finalize(command);
        if (
          failTransactionalFinalization && command.statusCode === 200 &&
          command.transaction
        ) {
          throw new Error("injected request-log postcondition failure");
        }
      },
    };
    const coordinator = createProtectedSessionCoordinator({
      attemptBudget,
      audit: authenticationAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => new Date() },
      identity: new PostgresIdentityAuthentication(
        connection.db,
        hasher,
        tokens,
        new AesGcmMfaSecretBox(mfaKeyset, random),
        { now: () => new Date() },
        { create: () => crypto.randomUUID() },
      ),
      responseEqualizer: immediateResponseEqualizer,
      transaction: new PostgresRegistrationTransaction(connection.db),
      workspace: new PostgresActiveWorkspaceResolver(),
    });
    const app = createAuthenticationRoutes({
      browserSecurity: browserSecurityPolicy("test", "http://localhost"),
      passwordRecovery: {
        request: () => Promise.resolve({ delivery: "not-applicable" }),
        reset: () => Promise.resolve("invalid"),
      },
      protectedSessions: coordinator,
    });
    const previousHash = await tokens.hash(
      `authenticated-session:${previousToken}`,
    );
    const auditCount = async (): Promise<number> => {
      const [row] = await database<{ readonly count: number }[]>`
        select count(*)::int count from crm.audit_events
        where subject_id = ${userId}::uuid
          and action = 'authentication.succeeded'
      `;
      return row?.count ?? 0;
    };
    const request = async (clientAddress: string): Promise<Response> =>
      await app.request("http://localhost/api/v1/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `kinship_session=${previousToken}`,
          origin: "http://localhost",
          "X-Kinship-Client-Address": clientAddress,
        },
        body: JSON.stringify({
          email,
          password: "correct horse battery staple",
        }),
      });
    const auditsBefore = await auditCount();
    const [sessionsBefore] = await database<{
      readonly active: number;
      readonly previous_active: boolean;
    }[]>`
      select count(*) filter (
          where user_id = ${userId}::uuid and revoked_at is null
        )::int active,
        count(*) filter (
          where session_hash = ${previousHash} and revoked_at is null
        ) = 1 previous_active
      from crm.user_sessions
    `;
    assert(
      sessionsBefore?.previous_active,
      "fixture rotation token is an active persisted session",
    );
    try {
      const failed = await request("127.0.3.11");
      assert(
        failed.status === 503 && failed.headers.get("set-cookie") === null,
        "request-log failure is publicly unavailable without a new cookie",
      );
      const [afterFailure] = await database<{
        readonly active: number;
        readonly previous_active: boolean;
      }[]>`
        select count(*) filter (
            where user_id = ${userId}::uuid and revoked_at is null
          )::int active,
          count(*) filter (
            where session_hash = ${previousHash} and revoked_at is null
          ) = 1 previous_active
        from crm.user_sessions
      `;
      assert(
        afterFailure?.active === sessionsBefore.active &&
          afterFailure.previous_active,
        `failed 200 finalization rolls back the new session and prior revocation: ${
          JSON.stringify(afterFailure)
        }`,
      );
      assert(
        await auditCount() === auditsBefore,
        "failed 200 finalization rolls back its success audit",
      );
      const unavailable = await latestAuthenticationRequestLog(
        "/api/v1/sessions",
        "127.0.3.11",
      );
      assert(
        unavailable.status_code === 503 && unavailable.user_id === null,
        "rolled-back pending request recovers as exact anonymous 503",
      );

      failTransactionalFinalization = false;
      const succeeded = await request("127.0.3.12");
      assert(succeeded.status === 200, "atomic retry authenticates");
      const nextToken = extractCookie(succeeded, "kinship_session");
      assert(
        nextToken !== previousToken,
        "successful rotation issues a new token",
      );
      const [afterSuccess] = await database<{
        readonly active: number;
        readonly previous_revoked: boolean;
      }[]>`
        select count(*) filter (
            where user_id = ${userId}::uuid and revoked_at is null
          )::int active,
          count(*) filter (
            where session_hash = ${previousHash} and revoked_at is not null
          ) = 1 previous_revoked
        from crm.user_sessions
      `;
      assert(
        afterSuccess?.active === sessionsBefore.active &&
          afterSuccess.previous_revoked,
        "successful request row commits with new session and prior revocation",
      );
      assert(
        await auditCount() === auditsBefore + 1,
        "successful request row commits with its exact success audit",
      );
      const completed = await latestAuthenticationRequestLog(
        "/api/v1/sessions",
        "127.0.3.12",
      );
      assert(
        completed.status_code === 200 && completed.user_id === userId,
        "successful exact request row commits authenticated attribution",
      );
      let duplicateRejected = false;
      try {
        await actualBudget.finalize({
          reservationId: completed.id,
          statusCode: 200,
          userId,
        });
      } catch {
        duplicateRejected = true;
      }
      assert(duplicateRejected, "completed 200 reservation rejects retry");
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "known and unknown failures execute identical governance SQL shapes while preserving anonymous effects",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "audit-shape@example.test";
    const { userId } = await registerAndVerify(email);
    const [membership] = await database<{
      member_id: string;
      workspace_id: string;
      workspace_name: string;
    }[]>`
      select wm.id::text member_id, wm.workspace_id::text,
        w.name workspace_name
      from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.user_id = ${userId}::uuid
    `;
    assert(membership, "known failure has a durable workspace context");
    const context = {
      memberId: membership.member_id,
      role: "owner" as const,
      userId,
      workspaceId: membership.workspace_id,
      workspaceName: membership.workspace_name,
    };
    const occurredAt = new Date("2026-08-14T18:00:00.000Z");
    const exercise = async (
      knownContext: typeof context | undefined,
    ): Promise<
      { readonly id?: string; readonly statements: readonly string[] }
    > => {
      const statements: string[] = [];
      const client = postgres(databaseUrl, {
        max: 1,
        onnotice: () => undefined,
        prepare: false,
      });
      const tracked = new Kysely<Record<string, never>>({
        dialect: new PostgresJSDialect({ postgres: client }),
        log(event) {
          const statement = event.query.sql.trim();
          if (
            event.level === "query" && statement !== "begin" &&
            statement !== "commit"
          ) {
            statements.push(event.query.sql.replaceAll(/\$\d+/g, "$"));
          }
        },
      });
      const transaction = new PostgresRegistrationTransaction(tracked);
      const audit = authenticationAuditFrom(new PostgresAuditEventRecorder());
      try {
        return await transaction.run(async (session) => {
          const id = await audit.recordFailure({
            actorMemberId: null,
            ...(knownContext ? { context: knownContext } : {}),
            occurredAt,
            transaction: session,
          });
          await audit.assertFailurePostcondition({
            actorMemberId: null,
            ...(id ? { auditEventId: id } : {}),
            ...(knownContext ? { context: knownContext } : {}),
            occurredAt,
            transaction: session,
          });
          return { ...(id ? { id } : {}), statements };
        });
      } finally {
        await tracked.destroy();
      }
    };

    const before = await failedAuditCount();
    const known = await exercise(context);
    const anonymous = await exercise(undefined);
    assert(known.id !== undefined, "known failure returns its exact audit id");
    assert(
      anonymous.id === undefined,
      "unknown failure does not acquire a governance id",
    );
    assert(
      known.statements.length === 2 &&
        JSON.stringify(known.statements) ===
          JSON.stringify(anonymous.statements),
      `governance SQL sequence diverged: ${
        JSON.stringify(known.statements)
      } / ${JSON.stringify(anonymous.statements)}`,
    );
    assert(
      known.statements[0]?.includes("insert into crm.audit_events") &&
        known.statements[1]?.includes("select count"),
      "both paths execute one conditional insert and one exact postcondition",
    );
    assert(
      await failedAuditCount() === before + 1,
      "only the known context creates a durable governance row",
    );

    const beforeHttp = await failedAuditCount(userId);
    const knownResponse = await signIn(email, "wrong password", {
      clientAddress: "127.0.3.10",
    });
    const unknownResponse = await signIn(
      "unknown-audit-shape@example.test",
      "wrong password",
      { clientAddress: "127.0.3.11" },
    );
    assert(
      knownResponse.status === 401 && unknownResponse.status === 401 &&
        JSON.stringify(await knownResponse.json()) ===
          JSON.stringify(await unknownResponse.json()),
      "known and unknown HTTP failures remain exactly generic",
    );
    assert(
      await failedAuditCount(userId) === beforeHttp + 1,
      "known HTTP failure is durable while unknown HTTP failure fabricates nothing",
    );
  },
});

Deno.test({
  name:
    "same-instant concurrent authentication audits verify their exact inserted ids",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "same-instant-audit@example.test";
    const { userId } = await registerAndVerify(email);
    const [row] = await database<{
      member_id: string;
      workspace_id: string;
      workspace_name: string;
    }[]>`
      select wm.id::text member_id, w.id::text workspace_id,
        w.name workspace_name
      from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.user_id = ${userId}::uuid
    `;
    assert(row, "authentication audit fixture has an active workspace");
    const context = {
      memberId: row.member_id,
      role: "owner" as const,
      userId,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
    };
    const occurredAt = new Date("2026-08-14T12:00:00.123Z");
    const connection = connectDatabase(databaseUrl);
    const transaction = new PostgresRegistrationTransaction(connection.db);
    const audit = authenticationAuditFrom(new PostgresAuditEventRecorder());
    try {
      for (const outcome of ["succeeded", "failed"] as const) {
        let firstInserted!: () => void;
        const inserted = new Promise<void>((resolve) => {
          firstInserted = resolve;
        });
        let secondCommitted!: () => void;
        const committed = new Promise<void>((resolve) => {
          secondCommitted = resolve;
        });
        const record = async (
          session: ProtectedSessionTransaction,
        ): Promise<string> => {
          if (outcome === "succeeded") {
            return await audit.record({
              context,
              occurredAt,
              outcome,
              transaction: session,
            });
          }
          const id = await audit.recordFailure({
            actorMemberId: null,
            context,
            occurredAt,
            transaction: session,
          });
          assert(id, "known failure audit returns its inserted id");
          return id;
        };
        const verify = async (
          session: ProtectedSessionTransaction,
          auditEventId: string,
        ): Promise<void> => {
          if (outcome === "succeeded") {
            await audit.assertPostcondition({
              auditEventId,
              context,
              occurredAt,
              outcome,
              transaction: session,
            });
          } else {
            await audit.assertFailurePostcondition({
              actorMemberId: null,
              auditEventId,
              context,
              occurredAt,
              transaction: session,
            });
          }
        };
        const first = transaction.run(async (session) => {
          const id = await record(session);
          firstInserted();
          await committed;
          await verify(session, id);
          return id;
        });
        await inserted;
        const secondId = await transaction.run(async (session) => {
          const id = await record(session);
          await verify(session, id);
          return id;
        });
        secondCommitted();
        const firstId = await first;
        assert(firstId !== secondId, "concurrent audits have unique exact ids");
        const [count] = await database<{ count: number }[]>`
          select count(*)::int count from crm.audit_events
          where action = ${`authentication.${outcome}`}
            and subject_id = ${userId}::uuid
            and occurred_at = ${occurredAt}
        `;
        assert(
          count?.count === 2,
          `both same-instant ${outcome} audits commit without collision`,
        );
      }
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[AUD-A3] failures from three addresses reach the per-account ceiling, which delays every address until the correct password signs in",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "account-ceiling@example.test";
    await registerAndVerify(email);
    let instant = Date.now();
    const { attempt: signInAs, connection } = throttledSignIn({
      clock: { now: () => new Date(instant) },
    });
    const attempt = (
      clientAddress: string,
      password: string,
      subject = email,
    ): Promise<Response> => signInAs(clientAddress, password, { subject });
    const correct = "correct horse battery staple";
    const retryAfter = (response: Response): number =>
      Number(response.headers.get("retry-after"));
    try {
      // Four, four, and two failures: no single address reaches its own
      // five-failure budget, but the account reaches its ceiling of ten.
      for (
        const [clientAddress, failures] of [
          ["127.0.4.1", 4],
          ["127.0.4.2", 4],
          ["127.0.4.3", 2],
        ] as const
      ) {
        for (let index = 0; index < failures; index += 1) {
          instant += 1_000;
          const failed = await attempt(clientAddress, "wrong password");
          assert(
            failed.status === 401,
            `failure below every ceiling stays generic, got ${failed.status}`,
          );
        }
      }

      const delayed = await attempt("127.0.4.4", correct);
      assert(
        delayed.status === 429 && retryAfter(delayed) === 15 &&
          delayed.headers.get("set-cookie") === null,
        `the ceiling delays even a fresh address for 15 s, got ${delayed.status} retry ${
          retryAfter(delayed)
        }`,
      );
      instant += 5_000;
      const stillDelayed = await attempt("127.0.4.5", "wrong password");
      assert(
        stillDelayed.status === 429 && retryAfter(stillDelayed) === 10,
        "a refused attempt is neutral and never extends the delay",
      );

      instant += 10_000;
      const admittedGuess = await attempt("127.0.4.5", "wrong password");
      assert(
        admittedGuess.status === 401,
        "once the delay elapses the next attempt is evaluated",
      );
      const doubled = await attempt("127.0.4.4", correct);
      assert(
        doubled.status === 429 && retryAfter(doubled) === 30,
        `each failure past the ceiling doubles the delay, got retry ${
          retryAfter(doubled)
        }`,
      );

      instant += 30_000;
      const owner = await attempt("127.0.4.4", correct);
      assert(
        owner.status === 200 &&
          extractCookie(owner, "kinship_session").length > 0,
        `the correct password signs in once the delay elapses, got ${owner.status}`,
      );
      instant += 1_000;
      const afterSuccess = await attempt("127.0.4.6", "wrong password");
      assert(
        afterSuccess.status === 401,
        "a successful sign-in clears the account ceiling",
      );

      const unknown = "absent-account-ceiling@example.test";
      for (let index = 0; index < 10; index += 1) {
        instant += 1_000;
        const failed = await attempt(
          `127.0.5.${index % 3 + 1}`,
          "wrong password",
          unknown,
        );
        assert(failed.status === 401, "unknown account fails generically");
      }
      const unknownDelayed = await attempt("127.0.5.9", correct, unknown);
      assert(
        unknownDelayed.status === 429 && retryAfter(unknownDelayed) === 15,
        "an unknown address meets the identical ceiling, so it is no oracle",
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[AUD-A3] a browser that signed in before keeps signing in while an attacker holds the account behind its ceiling",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const owner = "device-owner@example.test";
    const other = "device-other@example.test";
    await registerAndVerify(owner);
    await registerAndVerify(other);
    const correct = "correct horse battery staple";
    // An hour off the wall clock: the cookie's lifetime must come from the
    // injected clock that dated the token, never from a second clock.
    let instant = Date.now() + 3_600_000;
    const { attempt, connection } = throttledSignIn({
      clock: { now: () => new Date(instant) },
      deviceKeyset: {
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x44)]]),
      },
    });
    const deviceCookie = (response: Response): string | undefined =>
      response.headers.getSetCookie().find((cookie) =>
        cookie.startsWith("kinship_signin_device=")
      );
    const deviceToken = (response: Response): string => {
      const cookie = deviceCookie(response);
      assert(cookie, "a device cookie was issued");
      return cookie.slice("kinship_signin_device=".length).split(";")[0]!;
    };
    const retryAfter = (response: Response): number =>
      Number(response.headers.get("retry-after"));
    try {
      instant += 1_000;
      const first = await attempt("127.0.14.1", correct, { subject: owner });
      assert(first.status === 200, "the owner signs in");
      const cookie = deviceCookie(first);
      assert(
        cookie !== undefined &&
          cookie.split("; ").includes("HttpOnly") &&
          cookie.split("; ").includes("SameSite=Strict") &&
          cookie.split("; ").includes("Path=/api/v1/sessions") &&
          cookie.split("; ").includes("Max-Age=2592000"),
        `a successful sign-in issues a thirty-day device cookie scoped to the sign-in route, got ${cookie}`,
      );
      const ownerDevice = deviceToken(first);
      const otherSignIn = await attempt("127.0.14.2", correct, {
        subject: other,
      });
      const otherDevice = deviceToken(otherSignIn);
      const [version, expiry, mac] = ownerDevice.split(".") as [
        string,
        string,
        string,
      ];
      const forgedDevice = `${version}.${expiry}.${
        mac.startsWith("A") ? "B" : "A"
      }${mac.slice(1)}`;

      // Ten failures from three attacker addresses reach the ceiling.
      for (
        const [clientAddress, failures] of [
          ["127.0.15.1", 4],
          ["127.0.15.2", 4],
          ["127.0.15.3", 2],
        ] as const
      ) {
        for (let index = 0; index < failures; index += 1) {
          instant += 1_000;
          const failed = await attempt(clientAddress, "wrong password", {
            subject: owner,
          });
          assert(failed.status === 401, "below the ceiling fails generically");
          assert(
            deviceCookie(failed) === undefined,
            "a failure issues no device cookie",
          );
        }
      }

      // The attacker takes every slot the moment it opens.
      for (let round = 0; round < 4; round += 1) {
        const probe = await attempt(`127.0.16.${round + 1}`, correct, {
          subject: owner,
        });
        assert(probe.status === 429, "the attacker waits for the slot");
        instant += retryAfter(probe) * 1_000;
        const taken = await attempt(`127.0.16.${round + 1}`, "wrong password", {
          subject: owner,
        });
        assert(taken.status === 401, "the attacker takes the slot");
        for (
          const [label, device] of [
            ["no", undefined],
            ["a forged", forgedDevice],
            ["another account's", otherDevice],
          ] as const
        ) {
          const refused = await attempt("127.0.14.3", correct, {
            subject: owner,
            ...(device ? { cookie: `kinship_signin_device=${device}` } : {}),
          });
          assert(
            refused.status === 429 && deviceCookie(refused) === undefined,
            `with ${label} device cookie the owner is still delayed, got ${refused.status}`,
          );
        }
      }

      // The device cookie never lifts the per-address limit.
      for (let index = 0; index < 5; index += 1) {
        const failed = await attempt("127.0.14.5", "wrong password", {
          subject: owner,
          cookie: `kinship_signin_device=${ownerDevice}`,
        });
        assert(
          failed.status === 401,
          `a recognized browser's failures are evaluated, got ${failed.status}`,
        );
      }
      const addressLimited = await attempt("127.0.14.5", correct, {
        subject: owner,
        cookie: `kinship_signin_device=${ownerDevice}`,
      });
      assert(
        addressLimited.status === 429 && retryAfter(addressLimited) > 0,
        "the per-address limit still applies to a recognized browser",
      );

      const recognized = await attempt("127.0.14.4", correct, {
        subject: owner,
        cookie: `kinship_signin_device=${ownerDevice}`,
      });
      assert(
        recognized.status === 200 &&
          extractCookie(recognized, "kinship_session").length > 0 &&
          deviceToken(recognized).length > 0,
        `the owner's recognized browser signs in at once, got ${recognized.status}`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[AUD-A3] a failed password-hash upgrade is best effort: the sign-in succeeds and the stored hash is unchanged",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "rehash-failure@example.test";
    const { userId } = await registerAndVerify(email);
    const random = new WebCryptoRandomSource();
    const current = new Argon2idPasswordHasher(random, CURRENT_ARGON2ID);
    const weaker = await new Argon2idPasswordHasher(random, {
      ...CURRENT_ARGON2ID,
      memoryKiB: 8_192,
      iterations: 1,
    }).hash("correct horse battery staple");
    await database`
      update crm.users set password_hash = ${weaker} where id = ${userId}::uuid
    `;
    let upgrading = false;
    let upgradeAttempts = 0;
    const failingUpgrade: PasswordHasher = {
      hash: (password) => {
        if (!upgrading) return current.hash(password);
        upgradeAttempts += 1;
        return Promise.reject(new Error("hashing unavailable"));
      },
      needsUpgrade: (encoded) => current.needsUpgrade(encoded),
      verify: (password, encoded) => current.verify(password, encoded),
    };
    const { attempt, connection } = throttledSignIn({
      clock: { now: () => new Date() },
      hasher: failingUpgrade,
    });
    try {
      upgrading = true;
      const response = await attempt(
        "127.0.13.1",
        "correct horse battery staple",
        { subject: email },
      );
      assert(
        response.status === 200 &&
          extractCookie(response, "kinship_session").length > 0,
        `a failed upgrade does not fail the sign-in, got ${response.status}`,
      );
      assert(upgradeAttempts === 1, "the upgrade was attempted once");
      const [stored] = await database<{ password_hash: string }[]>`
        select password_hash from crm.users where id = ${userId}::uuid
      `;
      assert(
        stored?.password_hash === weaker,
        "a failed upgrade leaves the verified hash in place",
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[AUD-A3] concurrent attempts from distinct addresses cannot overrun the per-account ceiling",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    const budget = new PostgresAuthenticationAttemptBudget(
      connection.db,
      new AuthenticationSubjectDigester({
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
      }),
    );
    const subject = `ceiling-race-${crypto.randomUUID()}@example.test`;
    let instant = Date.now();
    const reserve = (clientAddress: string) =>
      budget.reserve({
        clientAddress,
        occurredAt: new Date(instant),
        scope: "password" as const,
        subject,
      });
    const burst = async (octet: number): Promise<number> => {
      const admissions = await Promise.all(
        Array.from(
          { length: 6 },
          (_, index) => reserve(`127.0.${octet}.${index + 1}`),
        ),
      );
      for (const admission of admissions) {
        await budget.finalize({
          reservationId: admission.reservationId,
          statusCode: admission.status === "admitted" ? 401 : 429,
        });
      }
      return admissions.filter((admission) => admission.status === "admitted")
        .length;
    };
    try {
      // Nine failures, three from each of three addresses: one below the
      // ceiling, and no address near its own five-failure budget.
      for (let index = 0; index < 9; index += 1) {
        instant += 1_000;
        const admission = await reserve(`127.0.10.${index % 3 + 1}`);
        assert(admission.status === "admitted", "below the ceiling admits");
        await budget.finalize({
          reservationId: admission.reservationId,
          statusCode: 401,
        });
      }
      instant += 1_000;
      const atNine = await burst(11);
      assert(
        atNine === 1,
        `six addresses at once one failure below the ceiling admit exactly one, admitted ${atNine}`,
      );

      // That failure was the tenth: the next slot opens 15 s after it.
      instant += 15_000;
      const pastDelay = await burst(12);
      assert(
        pastDelay === 1,
        `six addresses at once after the delay admit exactly one, admitted ${pastDelay}`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[AUD-V1] the sign-in and registration-mail budgets count one subject through its path and subject index",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withScratchCrm(
      database,
      databaseUrl,
      async ({ sql: scratch, url }) => {
        const now = new Date("2026-11-08T12:00:00.000Z");
        // A busy quarter hour, every row inside both budgets' windows: sign-in,
        // registration-mail, and reset attempts across 4,000 subjects in every
        // outcome the budgets count or ignore, and the other requests.
        await scratch`
        insert into crm.api_request_logs (method, path, client_ip,
          authentication_subject_digest, status_code, occurred_at)
        select 'POST', paths.path, ('10.0.' || n % 250 || '.' || n % 200 + 1)::inet,
          'hmac-sha256:v1:' || encode(sha256(convert_to((n % 4000)::text, 'UTF8')), 'hex'),
          (array[null, 200, 401, 202])[1 + n % 4],
          ${now}::timestamptz - (n % 840) * interval '1 second'
        from generate_series(1, 40000) n
        cross join (values ('/api/v1/sessions'), ('mail-budget/registration'),
          ('/api/v1/password-resets')) paths(path)
      `;
        await scratch`
        insert into crm.api_request_logs (method, path, status_code, occurred_at)
        select 'GET', '/api/v1/people', 200,
          ${now}::timestamptz - (n % 840) * interval '1 second'
        from generate_series(1, 60000) n
      `;
        await scratch`analyze`;

        const digester = new AuthenticationSubjectDigester({
          activeVersion: 1,
          keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
        });
        const explaining = connectDatabase(url);
        try {
          const signIn = await explainedPlan(
            explaining.db,
            (statement) => statement.includes("with attempts as"),
            (db) =>
              new PostgresAuthenticationAttemptBudget(db, digester).reserve({
                clientAddress: "203.0.113.7",
                occurredAt: now,
                scope: "password",
                subject: "budget-plan@example.test",
              }),
          );
          const recipient = await explainedPlan(
            explaining.db,
            (statement) =>
              statement.includes(
                "select count(*)::int count from crm.api_request_logs",
              ),
            (db) =>
              new PostgresOutboundMailBudget(db, digester).reserve({
                occurredAt: now,
                recipient: "budget-plan@example.test",
                recipientCeiling: 10,
                scope: "registration",
                windowMilliseconds: 24 * 60 * 60_000,
              }),
          );
          for (
            const [budget, plan] of [["sign-in", signIn], [
              "mail",
              recipient,
            ]] as const
          ) {
            assert(
              planNodes(plan).some((node) =>
                node["Index Name"] === "api_request_logs_post_subject_idx"
              ) &&
                scansOf(plan, "api_request_logs").every((scan) =>
                  scan["Node Type"] !== "Seq Scan"
                ),
              `the ${budget} budget does not seek one subject: ${
                describePlan(plan)
              }`,
            );
          }
        } finally {
          await explaining.destroy();
        }
      },
    );
  },
});

Deno.test({
  name: "authentication PostgreSQL budget resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
