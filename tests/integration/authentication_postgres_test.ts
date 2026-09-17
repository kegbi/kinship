import postgres from "postgres";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { createAuthenticationRoutes } from "../../apps/api/authentication.ts";
import {
  AuthenticationSubjectDigester,
} from "../../packages/backend/modules/api-access/public.ts";
import { authenticationAuditFrom } from "../../packages/backend/modules/workspaces/public.ts";
import {
  type PasswordHasher,
} from "../../packages/backend/modules/identity/public.ts";
import {
  createProtectedSessionCoordinator,
  type ProtectedSessionTransaction,
} from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  PostgresAuthenticationAttemptBudget,
} from "../../packages/backend/modules/api-access/adapters/postgres/authentication_attempt_budget.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  AesGcmMfaSecretBox,
  generateTotp,
} from "../../packages/backend/modules/identity/adapters/crypto/totp.ts";
import {
  Argon2idPasswordHasher,
} from "../../packages/backend/modules/identity/adapters/crypto/argon2id.ts";
import {
  PostgresIdentityAuthentication,
} from "../../packages/backend/modules/identity/adapters/postgres/authentication.ts";
import {
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/adapters/crypto/secure_tokens.ts";
import {
  PostgresActiveWorkspaceResolver,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  PostgresRegistrationTransaction,
} from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const database = postgres(databaseUrl, {
  max: 2,
  onnotice: () => undefined,
  prepare: false,
});
const mail = new CapturedVerificationMail();
const mfaKey = new Uint8Array(32).fill(0x4b);
const mfaKeyset = {
  activeKeyId: "test",
  keys: new Map([["test", mfaKey]]),
};
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
  mfaKeyset,
);
const immediateResponseEqualizer = {
  run: <T>(work: () => Promise<T>): Promise<T> => work(),
};

async function resetDatabase(): Promise<void> {
  await database`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
}

async function registerAndVerify(
  email: string,
): Promise<{ readonly entryToken: string; readonly userId: string }> {
  const response = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        firstName: "Ada",
        lastName: "Lovelace",
        password: "correct horse battery staple",
        workspaceName: "Ada's circle",
      }),
    },
  );
  assert(
    response.status === 202,
    `registration failed with ${response.status}`,
  );
  const token = mail.latestToken(email);
  assert(token, "verification mail contains a token");
  const verified = await configured.app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
  assert(verified.status === 200, "fixture email verifies");
  const entryToken = extractCookie(verified, "kinship_entry");
  const [user] = await database<{ id: string }[]>`
    select id::text from crm.users where email = ${email}
  `;
  assert(user, "fixture user exists");
  return { entryToken, userId: user.id };
}

function extractCookie(response: Response, name: string): string {
  const value = response.headers.get("set-cookie")?.match(
    new RegExp(`${name}=([^;,]+)`),
  )?.[1];
  assert(value, `${name} cookie was not issued`);
  return value;
}

async function signIn(
  email: string,
  password = "correct horse battery staple",
  options: {
    readonly clientAddress?: string;
    readonly cookie?: string;
    readonly workspaceId?: string;
  } = {},
): Promise<Response> {
  return await configured.app.request("http://localhost/api/v1/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "X-Kinship-Client-Address": options.clientAddress ?? "127.0.0.10",
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: JSON.stringify({
      email,
      password,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    }),
  });
}

async function completeMfa(
  factor: string,
  challenge: string,
  clientAddress = "127.0.0.20",
): Promise<Response> {
  return await configured.app.request(
    "http://localhost/api/v1/mfa-challenges",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `kinship_mfa=${challenge}`,
        origin: "http://localhost",
        "X-Kinship-Client-Address": clientAddress,
      },
      body: JSON.stringify({ factor }),
    },
  );
}

async function failedAuditCount(userId?: string): Promise<number> {
  const [row] = userId
    ? await database<{ count: number }[]>`
      select count(*)::int count from crm.audit_events
      where action = 'authentication.failed'
        and subject_type = 'user'
        and subject_id = ${userId}::uuid
    `
    : await database<{ count: number }[]>`
      select count(*)::int count from crm.audit_events
      where action = 'authentication.failed'
    `;
  return row?.count ?? 0;
}

interface AuthenticationRequestLog {
  readonly id: string;
  readonly status_code: number | null;
  readonly user_id: string | null;
}

async function latestAuthenticationRequestLog(
  path: "/api/v1/mfa-challenges" | "/api/v1/sessions",
  clientAddress: string,
): Promise<AuthenticationRequestLog> {
  const [row] = await database<AuthenticationRequestLog[]>`
    select id::text, status_code, user_id::text
    from crm.api_request_logs
    where path = ${path} and client_ip = ${clientAddress}::inet
    order by created_at desc, id desc
    limit 1
  `;
  assert(row, `request log exists for ${path} from ${clientAddress}`);
  return row;
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
    await resetDatabase();
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
    await resetDatabase();
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
        revokeSession: () => Promise.resolve(),
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
    await resetDatabase();
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
            revokeSession: () => Promise.resolve(),
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
    await resetDatabase();
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
    await resetDatabase();
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
    await resetDatabase();
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
    "real PostgreSQL sign-in enforces credential provenance, MFA, recovery, rotation, reset, and workspace isolation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase();
    const email = "auth-003-owner@example.test";
    const { entryToken, userId } = await registerAndVerify(email);
    const observedRequestLogIds = new Set<string>();
    const assertRequestLog = async (
      path: "/api/v1/mfa-challenges" | "/api/v1/sessions",
      clientAddress: string,
      statusCode: number,
      attributedUserId?: string,
    ): Promise<void> => {
      const row = await latestAuthenticationRequestLog(path, clientAddress);
      assert(
        /^[0-9a-f-]{36}$/i.test(row.id) &&
          !observedRequestLogIds.has(row.id),
        "each completed endpoint request finalizes one exact new row id",
      );
      observedRequestLogIds.add(row.id);
      assert(
        row.status_code === statusCode &&
          row.user_id === (attributedUserId ?? null),
        `${path} must log ${statusCode} with authenticated-only attribution`,
      );
    };
    const [firstMembership] = await database<{
      member_id: string;
      workspace_id: string;
    }[]>`
      select id::text member_id, workspace_id::text
      from crm.workspace_members where user_id = ${userId}::uuid
    `;
    assert(firstMembership, "owner membership exists");

    const entryAsSession = await configured.app.request(
      "http://localhost/api/v1/session",
      { headers: { cookie: `kinship_session=${entryToken}` } },
    );
    assert(
      entryAsSession.status === 401,
      "single-use verification handoff cannot impersonate an authenticated session",
    );

    const firstSignIn = await signIn(email);
    assert(firstSignIn.status === 200, "valid password creates a session");
    await assertRequestLog("/api/v1/sessions", "127.0.0.10", 200, userId);
    const firstToken = extractCookie(firstSignIn, "kinship_session");
    const firstContext = await configured.app.request(
      "http://localhost/api/v1/session",
      { headers: { cookie: `kinship_session=${firstToken}` } },
    );
    assert(firstContext.status === 200, "persisted session resolves");

    const raceConnection = connectDatabase(databaseUrl);
    const raceRandom = new WebCryptoRandomSource();
    const raceHasher = new Argon2idPasswordHasher(raceRandom, {
      memoryKiB: 19_456,
      iterations: 2,
      parallelism: 1,
      saltLength: 16,
      hashLength: 32,
    });
    let releaseVerify = (): void => undefined;
    let markVerifyStarted = (): void => undefined;
    const verifyStarted = new Promise<void>((resolve) => {
      markVerifyStarted = resolve;
    });
    const verifyRelease = new Promise<void>((resolve) => {
      releaseVerify = resolve;
    });
    const gatedHasher: PasswordHasher = {
      hash: (password) => raceHasher.hash(password),
      needsUpgrade: (encoded) => raceHasher.needsUpgrade(encoded),
      async verify(password, encoded) {
        markVerifyStarted();
        await verifyRelease;
        return await raceHasher.verify(password, encoded);
      },
    };
    const raceTokens = new SecureTokenService(raceRandom);
    const raceAuthentication = new PostgresIdentityAuthentication(
      raceConnection.db,
      gatedHasher,
      raceTokens,
      new AesGcmMfaSecretBox(mfaKeyset, raceRandom),
      { now: () => new Date() },
      { create: () => crypto.randomUUID() },
    );
    const primaryPromise = raceAuthentication.authenticatePassword({
      email,
      ipAddress: "127.0.0.60",
      password: "correct horse battery staple",
    });
    await verifyStarted;
    const [originalCredential] = await database<{
      password_hash: string;
    }[]>`
      select password_hash from crm.users where id = ${userId}::uuid
    `;
    assert(originalCredential, "race fixture has an application credential");
    await database`
      update crm.users set
        password_hash = ${await raceHasher.hash("replacement password value")},
        password_changed_at = now(), updated_at = now()
      where id = ${userId}::uuid
    `;
    releaseVerify();
    const stalePrimary = await primaryPromise;
    assert(stalePrimary.status === "verified", "old password work completed");
    let staleIssued = false;
    try {
      await new PostgresRegistrationTransaction(raceConnection.db).run(
        (transaction) =>
          raceAuthentication.issueSession({
            credentialVersion: stalePrimary.credentialVersion,
            transaction,
            userId,
          }),
      );
      staleIssued = true;
    } catch {
      // Reset won the race; stale primary proof is rejected.
    }
    assert(
      !staleIssued,
      "password reset racing old verification cannot mint a new session",
    );
    await database`
      update crm.users set password_hash = ${originalCredential.password_hash},
        password_changed_at = now(), updated_at = now()
      where id = ${userId}::uuid
    `;
    await raceConnection.destroy();

    const rotated = await signIn(email, undefined, {
      cookie: `kinship_session=${firstToken}`,
    });
    assert(rotated.status === 200, "repeat sign-in rotates the session");
    const rotatedToken = extractCookie(rotated, "kinship_session");
    assert(rotatedToken !== firstToken, "rotation issues fresh randomness");
    const stale = await configured.app.request(
      "http://localhost/api/v1/session",
      {
        headers: { cookie: `kinship_session=${firstToken}` },
      },
    );
    assert(stale.status === 401, "rotated token is revoked");

    const secondWorkspaceId = crypto.randomUUID();
    const secondMemberId = crypto.randomUUID();
    const foreignWorkspaceId = crypto.randomUUID();
    await database`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values
        (${secondWorkspaceId}::uuid, 'Second circle', 'active', ${userId}::uuid),
        (${foreignWorkspaceId}::uuid, 'Foreign circle', 'active', ${userId}::uuid)
    `;
    await database`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (
        ${secondMemberId}::uuid, ${secondWorkspaceId}::uuid,
        ${userId}::uuid, 'member', 'active', now()
      )
    `;
    const switcherContext = await configured.app.request(
      "http://localhost/api/v1/session",
      { headers: { cookie: `kinship_session=${rotatedToken}` } },
    );
    const switcherBody = await switcherContext.json() as {
      readonly workspaces?: readonly { readonly id?: string }[];
    };
    assert(
      switcherBody.workspaces?.map((workspace) => workspace.id).join(",") ===
        `${firstMembership.workspace_id},${secondWorkspaceId}`,
      "session lists active memberships and excludes a workspace without membership",
    );
    const selected = await signIn(email, undefined, {
      workspaceId: secondWorkspaceId,
    });
    assert(selected.status === 200, "owned second workspace can be selected");
    const selectedBody = await selected.json() as {
      workspace?: { id?: string };
    };
    assert(
      selectedBody.workspace?.id === secondWorkspaceId,
      "server returns only the validated selected membership",
    );
    const auditBeforeCrossed = await failedAuditCount(userId);
    const crossed = await signIn(email, undefined, {
      workspaceId: foreignWorkspaceId,
    });
    assert(crossed.status === 403, "unowned body workspace id is rejected");
    await assertRequestLog("/api/v1/sessions", "127.0.0.10", 403);
    assert(
      await failedAuditCount(userId) === auditBeforeCrossed + 1,
      "unowned requested workspace records one failure against the owned audit context",
    );
    const crossedCookie = crossed.headers.get("set-cookie") ?? "";
    assert(
      !crossedCookie.includes("kinship_session="),
      "cross-workspace rejection issues no session",
    );
    const protectedCross = await configured.app.request(
      "http://localhost/api/v1/session",
      {
        headers: {
          cookie: `kinship_session=${rotatedToken}`,
          "X-Workspace-Id": foreignWorkspaceId,
        },
      },
    );
    assert(
      protectedCross.status === 401,
      "protected context rejects an unowned workspace header",
    );

    await database`
      update crm.workspace_members set status = 'suspended'
      where user_id = ${userId}::uuid
    `;
    const auditBeforeSuspended = await failedAuditCount(userId);
    const suspended = await signIn(email);
    assert(suspended.status === 403, "suspended membership blocks sign-in");
    await assertRequestLog("/api/v1/sessions", "127.0.0.10", 403);
    assert(
      await failedAuditCount(userId) === auditBeforeSuspended + 1,
      "inactive membership rejection records one governance audit effect",
    );
    await database`
      update crm.workspace_members set status = 'active'
      where id = ${firstMembership.member_id}::uuid
    `;

    const box = new AesGcmMfaSecretBox(
      mfaKeyset,
      new WebCryptoRandomSource(),
    );
    const secret = "JBSWY3DPEHPK3PXP";
    const recoveryCode = "recovery-code-auth-003";
    const tokenService = new SecureTokenService(new WebCryptoRandomSource());
    await database`
      insert into crm.user_mfa_totp (
        user_id, encrypted_secret, confirmed_at, created_at, updated_at
      ) values (
        ${userId}::uuid, ${await box.encrypt(
      secret,
      userId,
    )}, now(), now(), now()
      )
    `;
    await database`
      insert into crm.user_recovery_codes (user_id, code_hash)
      values (${userId}::uuid, ${await tokenService.hash(recoveryCode)})
    `;

    await database`
      update crm.users set
        password_changed_at = '2026-08-15 12:00:00.123001+00'::timestamptz,
        updated_at = now()
      where id = ${userId}::uuid
    `;
    const resetRaceChallengeResponse = await signIn(email);
    const resetRaceChallenge = extractCookie(
      resetRaceChallengeResponse,
      "kinship_mfa",
    );
    await database`
      update crm.users set
        password_changed_at = '2026-08-15 12:00:00.123999+00'::timestamptz,
        updated_at = now()
      where id = ${userId}::uuid
    `;
    const auditBeforeExpiredMfa = await failedAuditCount(userId);
    const resetRaceRejected = await completeMfa(
      "000000",
      resetRaceChallenge,
    );
    assert(
      resetRaceRejected.status === 410,
      "same-millisecond password reset invalidates an outstanding MFA challenge",
    );
    await assertRequestLog("/api/v1/mfa-challenges", "127.0.0.20", 410);
    assert(
      await failedAuditCount(userId) === auditBeforeExpiredMfa + 1,
      "expired MFA records one governance audit effect",
    );

    const challenged = await signIn(email);
    assert(challenged.status === 202, "configured MFA delays session creation");
    await assertRequestLog("/api/v1/sessions", "127.0.0.10", 202);
    const challenge = extractCookie(challenged, "kinship_mfa");
    const sessionCountBeforeMfa = await database<{ count: number }[]>`
      select count(*)::int count from crm.user_sessions
      where user_id = ${userId}::uuid and revoked_at is null
    `;
    const auditBeforeInvalidMfa = await failedAuditCount(userId);
    const invalidMfa = await completeMfa("000000", challenge);
    assert(invalidMfa.status === 401, "invalid MFA is rejected safely");
    await assertRequestLog("/api/v1/mfa-challenges", "127.0.0.20", 401);
    assert(
      await failedAuditCount(userId) === auditBeforeInvalidMfa + 1,
      "known invalid MFA records one governance audit effect",
    );
    const sessionCountAfterInvalidMfa = await database<{ count: number }[]>`
      select count(*)::int count from crm.user_sessions
      where user_id = ${userId}::uuid and revoked_at is null
    `;
    assert(
      sessionCountAfterInvalidMfa[0]?.count === sessionCountBeforeMfa[0]?.count,
      "invalid MFA creates no session",
    );
    const totp = await generateTotp(
      secret,
      new Date(Date.now() + 30_000),
    );
    assert(totp, "TOTP fixture generated");
    const acceptedMfa = await completeMfa(totp, challenge);
    assert(acceptedMfa.status === 200, "valid TOTP creates the session");
    await assertRequestLog(
      "/api/v1/mfa-challenges",
      "127.0.0.20",
      200,
      userId,
    );
    assert(
      acceptedMfa.headers.get("set-cookie")?.includes("kinship_mfa=;") ===
        true,
      "successful MFA clears its one-time challenge cookie",
    );
    const mfaSession = extractCookie(acceptedMfa, "kinship_session");
    const challengeReplay = await completeMfa(totp, challenge);
    assert(challengeReplay.status === 410, "MFA challenge cannot replay");
    await assertRequestLog("/api/v1/mfa-challenges", "127.0.0.20", 410);

    const futureReplayChallengeResponse = await signIn(email);
    const futureReplayChallenge = extractCookie(
      futureReplayChallengeResponse,
      "kinship_mfa",
    );
    const futureCounterReplay = await completeMfa(
      totp,
      futureReplayChallenge,
    );
    assert(
      futureCounterReplay.status === 401,
      "an accepted future-window TOTP counter cannot replay on a fresh challenge",
    );

    const recoveryChallengeResponse = await signIn(email);
    const recoveryChallenge = extractCookie(
      recoveryChallengeResponse,
      "kinship_mfa",
    );
    const recoveryAccepted = await completeMfa(recoveryCode, recoveryChallenge);
    assert(
      recoveryAccepted.status === 200,
      "unused recovery code authenticates",
    );
    const secondRecoveryChallengeResponse = await signIn(email);
    const secondRecoveryChallenge = extractCookie(
      secondRecoveryChallengeResponse,
      "kinship_mfa",
    );
    const recoveryReplay = await completeMfa(
      recoveryCode,
      secondRecoveryChallenge,
    );
    assert(recoveryReplay.status === 401, "recovery code is one-use");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const fresh = await signIn(email);
      const freshChallenge = extractCookie(fresh, "kinship_mfa");
      const failure = await completeMfa(
        "000000",
        freshChallenge,
        "127.0.0.42",
      );
      assert(failure.status === 401, "fresh challenge consumes shared budget");
    }
    const limitedFresh = await signIn(email);
    const limitedFreshChallenge = extractCookie(limitedFresh, "kinship_mfa");
    const auditBeforeLimitedMfa = await failedAuditCount(userId);
    const limitedMfa = await completeMfa(
      "000000",
      limitedFreshChallenge,
      "127.0.0.42",
    );
    assert(
      limitedMfa.status === 429,
      "fresh MFA challenges cannot reset the durable failure budget",
    );
    await assertRequestLog("/api/v1/mfa-challenges", "127.0.0.42", 429);
    assert(
      await failedAuditCount(userId) === auditBeforeLimitedMfa + 1,
      "rate-limited known MFA records one governance audit effect",
    );
    const secondMfaEmail = "auth-003-second-mfa@example.test";
    const { userId: secondMfaUserId } = await registerAndVerify(secondMfaEmail);
    await database`
      insert into crm.user_mfa_totp (
        user_id, encrypted_secret, confirmed_at, created_at, updated_at
      ) values (
        ${secondMfaUserId}::uuid,
        ${await box.encrypt(secret, secondMfaUserId)}, now(), now(), now()
      )
    `;
    const secondUserChallengeResponse = await signIn(secondMfaEmail);
    const secondUserChallenge = extractCookie(
      secondUserChallengeResponse,
      "kinship_mfa",
    );
    const secondUserAccepted = await completeMfa(
      (await generateTotp(secret, new Date())) ?? "",
      secondUserChallenge,
      "127.0.0.42",
    );
    assert(
      secondUserAccepted.status === 200,
      "one user's failures cannot consume another user's MFA budget",
    );
    await assertRequestLog(
      "/api/v1/mfa-challenges",
      "127.0.0.42",
      200,
      secondMfaUserId,
    );

    const resetRequest = await configured.app.request(
      "http://localhost/api/v1/password-reset-requests",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ email }),
      },
    );
    assert(resetRequest.status === 202, "recovery request is accepted");
    const unknownResetRequest = await configured.app.request(
      "http://localhost/api/v1/password-reset-requests",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "X-Kinship-Client-Address": "127.0.0.71",
        },
        body: JSON.stringify({ email: "absent-recovery@example.test" }),
      },
    );
    assert(
      unknownResetRequest.status === 202,
      "unknown recovery request has the same public response",
    );
    const [recoveryWork] = await database<{ count: number }[]>`
      select count(*)::int count from crm.password_reset_requests
      where email in (${email}, 'absent-recovery@example.test')
    `;
    assert(
      recoveryWork?.count === 2,
      "known and unknown recovery requests both commit bounded durable work",
    );
    const resetToken = mail.latestPasswordResetToken(email);
    assert(resetToken, "active identity receives reset mail");
    const resetResponse = await configured.app.request(
      "http://localhost/api/v1/password-resets",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          token: resetToken,
          password: "new correct horse battery staple",
        }),
      },
    );
    assert(resetResponse.status === 200, "valid reset changes password");
    const oldAfterReset = await configured.app.request(
      "http://localhost/api/v1/session",
      { headers: { cookie: `kinship_session=${mfaSession}` } },
    );
    assert(oldAfterReset.status === 401, "password reset revokes old sessions");
    const resetReplay = await configured.app.request(
      "http://localhost/api/v1/password-resets",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          token: resetToken,
          password: "another correct horse battery staple",
        }),
      },
    );
    assert(resetReplay.status === 410, "reset token cannot replay");

    const resetAgain = await configured.app.request(
      "http://localhost/api/v1/password-reset-requests",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ email }),
      },
    );
    assert(resetAgain.status === 202, "second recovery request accepted");
    const expiredToken = mail.latestPasswordResetToken(email);
    assert(
      expiredToken && expiredToken !== resetToken,
      "new reset token exists",
    );
    await database`
      update crm.password_reset_requests set expires_at = now() - interval '1 minute'
      where used_at is null
    `;
    const expiredReset = await configured.app.request(
      "http://localhost/api/v1/password-resets",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          token: expiredToken,
          password: "expired correct horse battery staple",
        }),
      },
    );
    assert(expiredReset.status === 410, "expired reset is rejected");

    const [ownerHash] = await database<{ password_hash: string }[]>`
      select password_hash from crm.users where id = ${userId}::uuid
    `;
    assert(ownerHash, "application password hash exists");
    const importedId = crypto.randomUUID();
    await database`
      insert into crm.users (
        id, email, password_hash, first_name, status, email_verified_at
      ) values (
        ${importedId}::uuid, 'imported-auth-003@example.test',
        ${ownerHash.password_hash}, 'Imported', 'active', now()
      )
    `;
    const imported = await signIn(
      "imported-auth-003@example.test",
      "new correct horse battery staple",
      { clientAddress: "127.0.0.31" },
    );
    const auditsBeforeAnonymous = await failedAuditCount();
    const unknown = await signIn(
      "unknown-auth-003@example.test",
      "new correct horse battery staple",
      { clientAddress: "127.0.0.32" },
    );
    assert(
      imported.status === 401 && unknown.status === 401 &&
        (await imported.clone().json() as { code: string }).code ===
          (await unknown.clone().json() as { code: string }).code,
      "imported and unknown credentials share the safe failure shape",
    );
    assert(
      await failedAuditCount() === auditsBeforeAnonymous,
      "anonymous failure does not fabricate a governance entity",
    );
    const [failureWork] = await database<{
      imported: number;
      unknown: number;
    }[]>`
      select
        count(*) filter (
          where client_ip = '127.0.0.31'::inet and status_code = 401
        )::int imported,
        count(*) filter (
          where client_ip = '127.0.0.32'::inet and status_code = 401
        )::int unknown
      from crm.api_request_logs where path = '/api/v1/sessions'
    `;
    assert(
      failureWork?.imported === 1 && failureWork.unknown === 1,
      "known-inactive and unknown failures traverse the same durable work",
    );
    const [anonymousSecurityLog] = await database<{
      count: number;
      digest_count: number;
      identified_count: number;
    }[]>`
      select
        count(*)::int count,
        count(authentication_subject_digest)::int digest_count,
        count(user_id)::int identified_count
      from crm.api_request_logs
      where path = '/api/v1/sessions'
        and method = 'POST'
        and status_code = 401
        and client_ip = '127.0.0.32'::inet
    `;
    assert(
      anonymousSecurityLog?.count === 1 &&
        anonymousSecurityLog.digest_count === 1 &&
        anonymousSecurityLog.identified_count === 0,
      "anonymous failure records one pseudonymous security log without a fabricated user",
    );

    const auditsBeforeKnownFailures = await failedAuditCount(userId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert(
        (await signIn(email, "wrong password", {
          clientAddress: "127.0.0.43",
        })).status === 401,
        "known subject failure enters its isolated budget",
      );
    }
    assert(
      await failedAuditCount(userId) === auditsBeforeKnownFailures + 5,
      "each known credential rejection records exactly one governance audit effect",
    );
    assert(
      (await signIn(
        "fresh-unknown-after-known@example.test",
        "wrong password",
        {
          clientAddress: "127.0.0.43",
        },
      )).status === 401,
      "known subject failures cannot rate-limit a fresh unknown subject",
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert(
        (await signIn("unknown-budget-a@example.test", "wrong password", {
          clientAddress: "127.0.0.44",
        })).status === 401,
        "unknown subject failure enters its isolated budget",
      );
    }
    assert(
      (await signIn(secondMfaEmail, "wrong password", {
        clientAddress: "127.0.0.44",
      })).status === 401,
      "unknown subject failures cannot rate-limit a fresh known subject",
    );
    const [subjectLogs] = await database<{
      invalid_digest_count: number;
      raw_subject_count: number;
    }[]>`
      select
        count(*) filter (where authentication_subject_digest !~
          '^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$')::int invalid_digest_count,
        count(*) filter (where authentication_subject_digest ilike '%example%')::int
          raw_subject_count
      from crm.api_request_logs
      where path in ('/api/v1/sessions', '/api/v1/mfa-challenges')
    `;
    assert(
      subjectLogs?.invalid_digest_count === 0 &&
        subjectLogs.raw_subject_count === 0,
      "authentication request logs contain only constrained opaque subject digests",
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await signIn(email, "wrong password", {
        clientAddress: "127.0.0.40",
      });
      assert(failed.status === 401, "bounded failures remain generic");
    }
    const restarted = createConfiguredApiApp(
      databaseUrl,
      mail,
      browserSecurityPolicy("test", "http://localhost"),
      mfaKeyset,
    );
    const auditBeforeLimitedPassword = await failedAuditCount(userId);
    const limited = await restarted.app.request(
      "http://localhost/api/v1/sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "X-Kinship-Client-Address": "127.0.0.40",
        },
        body: JSON.stringify({ email, password: "wrong password" }),
      },
    );
    await restarted.close();
    assert(
      limited.status === 429 && Number(limited.headers.get("retry-after")) > 0,
      "password budget survives a fresh application instance",
    );
    assert(
      await failedAuditCount(userId) === auditBeforeLimitedPassword + 1,
      "rate-limited known password attempt records one governance audit effect",
    );

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () =>
        signIn(email, "wrong password", {
          clientAddress: "127.0.0.41",
        })),
    );
    assert(
      concurrent.filter((response) => response.status === 401).length === 5 &&
        concurrent.filter((response) => response.status === 429).length === 3,
      "concurrent password failures are serialized into one durable budget",
    );

    const activeSignOutToken = "active-sign-out-token";
    await database`
      insert into crm.user_sessions (
        user_id, session_hash, purpose, expires_at, created_at, last_seen_at
      ) values (
        ${userId}::uuid,
        ${await tokenService.hash(
      `authenticated-session:${activeSignOutToken}`,
    )},
        'authenticated', now() + interval '1 hour', now(), now()
      )
    `;
    const signedOut = await configured.app.request(
      "http://localhost/api/v1/sign-out",
      {
        method: "POST",
        headers: {
          cookie: `kinship_session=${activeSignOutToken}`,
          origin: "http://localhost",
        },
      },
    );
    assert(signedOut.status === 200, "active session is revoked truthfully");
    const staleSignOut = await configured.app.request(
      "http://localhost/api/v1/sign-out",
      {
        method: "POST",
        headers: {
          cookie: `kinship_session=${activeSignOutToken}`,
          origin: "http://localhost",
        },
      },
    );
    assert(
      staleSignOut.status === 503,
      "stale session cannot be reported as newly revoked",
    );
    const [audit] = await database<{
      failed: number;
      failed_with_actor: number;
      succeeded: number;
      succeeded_without_actor: number;
    }[]>`
      select
        count(*) filter (where action = 'authentication.failed')::int failed,
        count(*) filter (
          where action = 'authentication.failed' and actor_member_id is not null
        )::int failed_with_actor,
        count(*) filter (where action = 'authentication.succeeded')::int succeeded,
        count(*) filter (
          where action = 'authentication.succeeded' and actor_member_id is null
        )::int succeeded_without_actor
      from crm.audit_events where subject_id = ${userId}::uuid
    `;
    assert(
      (audit?.failed ?? 0) >= 1 && (audit?.succeeded ?? 0) >= 1,
      "authentication success and failure effects are auditable",
    );
    assert(
      audit?.failed_with_actor === 0 && audit.succeeded_without_actor === 0,
      "pre-session failures have no actor while success names the authenticated member",
    );
    const [requestActors] = await database<{
      failed_with_user: number;
      successful_with_user: number;
    }[]>`
      select
        count(*) filter (
          where status_code in (401, 410, 429) and user_id is not null
        )::int failed_with_user,
        count(*) filter (
          where status_code = 200 and user_id = ${userId}::uuid
        )::int successful_with_user
      from crm.api_request_logs
      where path in ('/api/v1/sessions', '/api/v1/mfa-challenges')
    `;
    assert(
      requestActors?.failed_with_user === 0 &&
        (requestActors.successful_with_user ?? 0) >= 1,
      "request logs identify only successfully authenticated users",
    );
  },
});

Deno.test({
  name: "authentication PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([
      database.end({ timeout: 1 }),
      configured.close(),
    ]);
  },
});
