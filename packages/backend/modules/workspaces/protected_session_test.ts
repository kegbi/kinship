import {
  createProtectedSessionCoordinator,
  type ProtectedSessionDependencies,
  protectedSessionHttpStatus,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dependencies(
  primary: "invalid" | "known-invalid" | "mfa" | "verified" = "verified",
  membership: "active" | "suspended" = "active",
): { deps: ProtectedSessionDependencies; effects: string[] } {
  const effects: string[] = [];
  const context = {
    memberId: "00000000-0000-4000-8000-000000000002",
    role: "owner" as const,
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000003",
    workspaceName: "Ada's circle",
  };
  return {
    effects,
    deps: {
      responseEqualizer: { run: <T>(work: () => Promise<T>) => work() },
      attemptBudget: {
        reserve(command) {
          effects.push(`budget.${command.scope}.begin`);
          return Promise.resolve({
            reservationId: `${command.scope}-reservation`,
            status: "admitted" as const,
          });
        },
        finalize(command) {
          assert(
            command.statusCode === 200
              ? command.userId === context.userId
              : command.userId === undefined,
            "only completed authentication identifies its exact user",
          );
          effects.push(
            `budget.${command.reservationId}.finalize.${command.statusCode}${
              command.transaction ? ".transactional" : ""
            }`,
          );
          return Promise.resolve();
        },
      },
      clock: { now: () => new Date("2026-08-14T12:00:00.000Z") },
      audit: {
        record(command) {
          effects.push(`audit.${command.outcome}`);
          return Promise.resolve("success-audit-id");
        },
        assertPostcondition(command) {
          assert(
            Reflect.get(command, "auditEventId") === "success-audit-id",
            "success postcondition must receive the exact inserted audit id",
          );
          effects.push("audit.postcondition");
          return Promise.resolve();
        },
        recordFailure(command) {
          assert(
            Reflect.get(command, "actorMemberId") === null,
            "pre-session authentication failure has no authenticated actor",
          );
          effects.push("audit.failed");
          return Promise.resolve(
            command.context ? "failure-audit-id" : undefined,
          );
        },
        assertFailurePostcondition(command) {
          assert(
            Reflect.get(command, "actorMemberId") === null,
            "failure postcondition preserves the unauthenticated actor",
          );
          assert(
            Reflect.get(command, "auditEventId") ===
              (command.context ? "failure-audit-id" : undefined),
            "failure postcondition must receive its exact inserted audit id",
          );
          effects.push("audit.failed.postcondition");
          return Promise.resolve();
        },
      },
      identity: {
        authenticationSubjectForMfa() {
          effects.push("identity.mfa.subject");
          return Promise.resolve(`user:${context.userId}`);
        },
        resolveAuthenticationAuditUser() {
          effects.push("identity.audit-subject");
          return Promise.resolve(context.userId);
        },
        authenticatePassword() {
          effects.push("identity.password");
          if (primary === "invalid" || primary === "known-invalid") {
            return Promise.resolve({
              ...(primary === "known-invalid"
                ? { auditUserId: context.userId }
                : {}),
              status: "invalid",
            });
          }
          if (primary === "mfa") {
            return Promise.resolve({
              status: "mfa-required",
              challengeToken: "challenge-token",
              credentialVersion: new Date("2026-08-01T00:00:00.000Z"),
              entryCredentialVersion: "1785542400.000001",
              userId: context.userId,
            });
          }
          return Promise.resolve({
            credentialVersion: new Date("2026-08-01T00:00:00.000Z"),
            entryCredentialVersion: "1785542400.000001",
            status: "verified",
            userId: context.userId,
          });
        },
        completeMfa() {
          effects.push("identity.mfa");
          return Promise.resolve({
            credentialVersion: new Date("2026-08-01T00:00:00.000Z"),
            entryCredentialVersion: "1785542400.000001",
            status: "verified",
            userId: context.userId,
          });
        },
        issueSession(command) {
          assert(
            command.credentialVersion?.toISOString() ===
              "2026-08-01T00:00:00.000Z",
            "session issuance must revalidate the credential version",
          );
          effects.push("identity.session");
          return Promise.resolve({
            expiresAt: new Date("2026-08-15T00:00:00.000Z"),
            token: "new-session-token",
          });
        },
        assertSessionPostcondition() {
          effects.push("identity.postcondition");
          return Promise.resolve();
        },
        resolveSession() {
          return Promise.resolve(undefined);
        },
        revokeSession() {
          return Promise.resolve();
        },
      },
      identityEntry: {
        issueVerifiedIdentityEntry() {
          effects.push("identity.entry");
          return Promise.resolve({
            expiresAt: new Date("2026-08-14T12:10:00.000Z"),
            token: "one-use-entry",
          });
        },
      },
      transaction: {
        async run(work) {
          effects.push("transaction.begin");
          const result = await work({ opaque: "transaction" });
          effects.push("transaction.commit");
          return result;
        },
      },
      workspace: {
        listActiveContexts() {
          return Promise.resolve(
            membership === "active" ? [context] : [],
          );
        },
        resolveAuditContext(command) {
          effects.push("workspace.audit.resolve");
          if (command.userId === "00000000-0000-0000-0000-000000000000") {
            return Promise.resolve(undefined);
          }
          return Promise.resolve(context);
        },
        resolveActiveContext(command) {
          effects.push("workspace.resolve");
          if (command.userId === "00000000-0000-0000-0000-000000000000") {
            return Promise.resolve(undefined);
          }
          return Promise.resolve(membership === "active" ? context : undefined);
        },
        assertActiveContextPostcondition() {
          effects.push("workspace.postcondition");
          return Promise.resolve();
        },
      },
    },
  };
}

Deno.test("protected session resolution lists only accessible workspaces", async () => {
  const fixture = dependencies();
  const active = {
    memberId: "00000000-0000-4000-8000-000000000002",
    role: "owner" as const,
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000003",
    workspaceName: "Ada's circle",
  };
  const second = {
    ...active,
    memberId: "00000000-0000-4000-8000-000000000004",
    role: "member" as const,
    workspaceId: "00000000-0000-4000-8000-000000000005",
    workspaceName: "Community circle",
  };
  const coordinator = createProtectedSessionCoordinator({
    ...fixture.deps,
    identity: {
      ...fixture.deps.identity,
      resolveSession: () => Promise.resolve({ userId: active.userId }),
    },
    workspace: {
      ...fixture.deps.workspace,
      resolveActiveContext: () => Promise.resolve(active),
      listActiveContexts: () => Promise.resolve([active, second]),
    },
  });

  const resolved = await coordinator.resolve({
    sessionToken: "active-session-token",
  });

  assert(resolved?.workspaceId === active.workspaceId, "active workspace kept");
  assert(
    resolved.accessibleWorkspaces.map((workspace) => workspace.workspaceId)
      .join(",") === `${active.workspaceId},${second.workspaceId}`,
    "only the resolver's ordered active memberships are exposed",
  );
});

function responseBarrier(expected: number): {
  readonly allWaiting: Promise<void>;
  readonly equalizer: ProtectedSessionDependencies["responseEqualizer"];
  release(): void;
} {
  let waiting = 0;
  let announce!: () => void;
  let release!: () => void;
  const allWaiting = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    allWaiting,
    equalizer: {
      async run<T>(work: () => Promise<T>): Promise<T> {
        try {
          const result = await work();
          waiting += 1;
          if (waiting === expected) announce();
          await gate;
          return result;
        } catch (error) {
          waiting += 1;
          if (waiting === expected) announce();
          await gate;
          throw error;
        }
      },
    },
    release,
  };
}

Deno.test("password sign-in persists a session only after active workspace resolution", async () => {
  const { deps, effects } = dependencies();
  const result = await createProtectedSessionCoordinator(deps).signIn({
    email: "owner@example.test",
    ipAddress: "127.0.0.1",
    password: "correct horse battery staple",
    userAgent: "test",
  });
  assert(result.status === "authenticated", "sign-in must authenticate");
  assert(
    result.workspace.id.endsWith("3"),
    "server-selected workspace returned",
  );
  assert(
    effects.join(",") ===
      "budget.password.begin,identity.password,transaction.begin,workspace.resolve,identity.session,audit.succeeded,identity.postcondition,workspace.postcondition,audit.postcondition,budget.password-reservation.finalize.200.transactional,transaction.commit",
    `unexpected effect order: ${effects.join(",")}`,
  );
});

Deno.test("MFA and suspended membership never issue a session prematurely", async () => {
  const mfa = dependencies("mfa");
  const challenge = await createProtectedSessionCoordinator(mfa.deps).signIn({
    email: "owner@example.test",
    ipAddress: "127.0.0.1",
    password: "correct horse battery staple",
    userAgent: "test",
  });
  assert(challenge.status === "mfa-required", "configured MFA is required");
  assert(
    !mfa.effects.includes("identity.session"),
    "challenge cannot issue session",
  );
  assert(
    mfa.effects.includes("budget.password-reservation.finalize.202"),
    "MFA-required response finalizes the request as HTTP 202",
  );

  const suspended = dependencies("verified", "suspended");
  const rejected = await createProtectedSessionCoordinator(suspended.deps)
    .signIn({
      email: "owner@example.test",
      ipAddress: "127.0.0.1",
      password: "correct horse battery staple",
      userAgent: "test",
    });
  assert(
    rejected.status === "membership-inactive",
    "inactive member is rejected",
  );
  assert(
    !suspended.effects.includes("identity.session"),
    "suspended membership cannot issue a session",
  );
  assert(
    suspended.effects.includes("budget.password-reservation.finalize.403"),
    "inactive membership finalizes the request as HTTP 403",
  );
});

Deno.test("invitation-scoped authentication issues only a bounded one-use identity entry", async () => {
  const fixture = dependencies("verified", "suspended");
  let issuance: Record<string, unknown> | undefined;
  const identityEntry = {
    issueVerifiedIdentityEntry(command: Record<string, unknown>) {
      issuance = command;
      return Promise.resolve({
        expiresAt: new Date("2026-08-14T12:10:00.000Z"),
        token: "one-use-entry",
      });
    },
  };
  const coordinator = createProtectedSessionCoordinator({
    ...fixture.deps,
    identity: {
      ...fixture.deps.identity,
      issueSession() {
        throw new Error("normal session issuance must remain domain separated");
      },
    },
    identityEntry,
  });
  const result = await coordinator.signIn({
    email: "invitee@example.test",
    expectedEmail: "invitee@example.test",
    identityOnly: true,
    ipAddress: "127.0.0.1",
    password: "correct horse battery staple",
  });
  assert(result.status === "identity-authenticated", "identity entry succeeds");
  assert(
    issuance?.expectedEmail === "invitee@example.test" &&
      issuance?.credentialVersion === "1785542400.000001",
    "dedicated entry issuance is bound to invited email and credential version",
  );
  assert(
    !fixture.effects.includes("workspace.resolve") &&
      !fixture.effects.includes("audit.succeeded") &&
      !fixture.effects.includes("identity.session"),
    "identity entry neither broadens membership nor claims a workspace audit",
  );
});

Deno.test("invitation-scoped MFA preserves the same identity-only boundary", async () => {
  const fixture = dependencies("mfa", "suspended");
  const coordinator = createProtectedSessionCoordinator(fixture.deps);
  const challenge = await coordinator.signIn({
    email: "invitee@example.test",
    expectedEmail: "invitee@example.test",
    identityOnly: true,
    ipAddress: "127.0.0.1",
    password: "correct horse battery staple",
  });
  assert(challenge.status === "mfa-required", "MFA cannot be skipped");
  assert(
    !fixture.effects.includes("workspace.resolve"),
    "no membership is required for the scoped challenge",
  );
  assert(challenge.status === "mfa-required", "challenge token is available");
  const accepted = await coordinator.completeMfa({
    challengeToken: challenge.status === "mfa-required"
      ? challenge.challengeToken
      : "",
    expectedEmail: "invitee@example.test",
    factor: "123456",
    identityOnly: true,
    ipAddress: "127.0.0.1",
  });
  assert(
    accepted.status === "identity-authenticated",
    "MFA yields only entry authority",
  );
  assert(
    fixture.effects.includes("identity.entry") &&
      !fixture.effects.includes("identity.session"),
    "MFA preserves entry/session token domain separation",
  );
});

Deno.test("known and unknown password failures await the same bounded audit work", async () => {
  const known = dependencies("known-invalid");
  const unknown = dependencies("invalid");
  const [knownResult, unknownResult] = await Promise.all([
    createProtectedSessionCoordinator(known.deps).signIn({
      email: "owner@example.test",
      ipAddress: "127.0.0.1",
      password: "wrong password",
    }),
    createProtectedSessionCoordinator(unknown.deps).signIn({
      email: "absent@example.test",
      ipAddress: "127.0.0.2",
      password: "wrong password",
    }),
  ]);
  assert(
    known.effects.join(",") === unknown.effects.join(","),
    `failure work diverged: ${known.effects.join(",")} / ${
      unknown.effects.join(",")
    }`,
  );
  assert(
    known.effects.join(",") ===
      "budget.password.begin,identity.password,transaction.begin,workspace.audit.resolve,audit.failed,audit.failed.postcondition,transaction.commit,budget.password-reservation.finalize.401",
    "durable failure audit must commit before either generic response",
  );
  assert(
    knownResult.status === "invalid-credentials" &&
      unknownResult.status === "invalid-credentials",
    "known and unknown failures remain generic",
  );
});

Deno.test("password failures and verifier-free rate limits share one response floor", async () => {
  const barrier = responseBarrier(3);
  const known = dependencies("known-invalid");
  const unknown = dependencies("invalid");
  const limited = dependencies();
  const limitedCoordinator = createProtectedSessionCoordinator({
    ...limited.deps,
    responseEqualizer: barrier.equalizer,
    attemptBudget: {
      reserve: () =>
        Promise.resolve({
          reservationId: "prework-limited",
          retryAfterSeconds: 60,
          status: "rate-limited" as const,
        }),
      finalize: limited.deps.attemptBudget.finalize,
    },
  });
  let settled = 0;
  const attempts = [
    createProtectedSessionCoordinator({
      ...known.deps,
      responseEqualizer: barrier.equalizer,
    }).signIn({
      email: "owner@example.test",
      ipAddress: "127.0.0.1",
      password: "wrong password",
    }),
    createProtectedSessionCoordinator({
      ...unknown.deps,
      responseEqualizer: barrier.equalizer,
    }).signIn({
      email: "absent@example.test",
      ipAddress: "127.0.0.2",
      password: "wrong password",
    }),
    limitedCoordinator.signIn({
      email: "owner@example.test",
      ipAddress: "127.0.0.3",
      password: "must-not-be-verified",
    }),
  ].map((attempt) => attempt.finally(() => settled += 1));

  await Promise.race([
    barrier.allWaiting,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("attempts skipped response floor")),
        100,
      )
    ),
  ]);
  assert(settled === 0, "no generic outcome settles before the common floor");
  assert(
    known.effects.includes("budget.password-reservation.finalize.401") &&
      unknown.effects.includes("budget.password-reservation.finalize.401") &&
      limited.effects.includes("budget.prework-limited.finalize.429"),
    "database and governance work completes before the timer-only floor",
  );
  assert(
    !limited.effects.includes("identity.password"),
    "prework rejection never invokes the expensive verifier",
  );
  barrier.release();
  const results = await Promise.all(attempts);
  assert(
    results[0]?.status === "invalid-credentials" &&
      results[1]?.status === "invalid-credentials" &&
      results[2]?.status === "rate-limited" && (settled as number) === 3,
    "all three outcomes settle only after the shared release",
  );
});

Deno.test("MFA outcomes and unavailable errors cannot bypass the response floor", async () => {
  const barrier = responseBarrier(2);
  const expired = dependencies();
  const unavailable = dependencies();
  let settled = 0;
  const expiredAttempt = createProtectedSessionCoordinator({
    ...expired.deps,
    responseEqualizer: barrier.equalizer,
    identity: {
      ...expired.deps.identity,
      completeMfa() {
        return Promise.resolve({ status: "expired" as const });
      },
    },
  }).completeMfa({
    challengeToken: "expired-challenge",
    factor: "000000",
    ipAddress: "127.0.0.4",
  }).finally(() => settled += 1);
  const unavailableAttempt = createProtectedSessionCoordinator({
    ...unavailable.deps,
    responseEqualizer: barrier.equalizer,
    identity: {
      ...unavailable.deps.identity,
      authenticationSubjectForMfa() {
        return Promise.reject(new Error("subject service unavailable"));
      },
    },
  }).completeMfa({
    challengeToken: "unavailable-challenge",
    factor: "000000",
    ipAddress: "127.0.0.5",
  }).finally(() => settled += 1);
  await Promise.race([
    barrier.allWaiting,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("MFA skipped response floor")), 100)
    ),
  ]);
  assert(settled === 0, "neither MFA result nor failure settles early");
  barrier.release();
  const [expiredResult, unavailableResult] = await Promise.allSettled([
    expiredAttempt,
    unavailableAttempt,
  ]);
  assert(
    expiredResult.status === "fulfilled" &&
      expiredResult.value.status === "challenge-expired" &&
      unavailableResult.status === "rejected" &&
      (settled as number) === 2,
    "MFA result and error settle only after the common release",
  );
});

Deno.test("every known authentication rejection commits its governance audit", async () => {
  const limited = dependencies();
  const limitedCoordinator = createProtectedSessionCoordinator({
    ...limited.deps,
    attemptBudget: {
      reserve() {
        return Promise.resolve({
          reservationId: "password-rejection",
          retryAfterSeconds: 60,
          status: "rate-limited" as const,
        });
      },
      finalize: limited.deps.attemptBudget.finalize,
    },
  });
  const limitedResult = await limitedCoordinator.signIn({
    email: "owner@example.test",
    ipAddress: "127.0.0.1",
    password: "wrong password",
  });
  assert(limitedResult.status === "rate-limited", "budget blocks sign-in");
  assert(
    !limited.effects.includes("identity.password") &&
      limited.effects.includes("identity.audit-subject"),
    "rejected admission performs only the cheap audit-subject lookup",
  );
  assert(
    limited.effects.includes("audit.failed.postcondition"),
    "known rate limit is audited before return",
  );
  assert(
    limited.effects.at(-1) ===
      "budget.password-rejection.finalize.429",
    "rate-limit row finalizes only after required audit work",
  );

  const suspended = dependencies("verified", "suspended");
  await createProtectedSessionCoordinator(suspended.deps).signIn({
    email: "owner@example.test",
    ipAddress: "127.0.0.1",
    password: "correct horse battery staple",
    requestedWorkspaceId: "00000000-0000-4000-8000-000000000099",
  });
  assert(
    suspended.effects.includes("audit.failed.postcondition"),
    "membership and unowned selection rejection is audited",
  );

  const expired = dependencies();
  const expiredCoordinator = createProtectedSessionCoordinator({
    ...expired.deps,
    identity: {
      ...expired.deps.identity,
      completeMfa() {
        expired.effects.push("identity.mfa.expired");
        return Promise.resolve({
          auditUserId: "00000000-0000-4000-8000-000000000001",
          status: "expired" as const,
        });
      },
    },
  });
  const expiredResult = await expiredCoordinator.completeMfa({
    challengeToken: "expired-challenge",
    factor: "000000",
    ipAddress: "127.0.0.1",
  });
  assert(expiredResult.status === "challenge-expired", "challenge expires");
  assert(
    expired.effects.includes("audit.failed.postcondition"),
    "known expired challenge is audited",
  );
  assert(
    expired.effects.includes("budget.mfa-reservation.finalize.410"),
    "expired challenge finalizes the request as HTTP 410",
  );
});

Deno.test("failed rate-limit audit finalizes the exact pending row unavailable", async () => {
  const limited = dependencies();
  const coordinator = createProtectedSessionCoordinator({
    ...limited.deps,
    attemptBudget: {
      reserve: () =>
        Promise.resolve({
          reservationId: "rejected-reservation",
          retryAfterSeconds: 60,
          status: "rate-limited" as const,
        }),
      finalize: limited.deps.attemptBudget.finalize,
    },
    audit: {
      ...limited.deps.audit,
      recordFailure() {
        limited.effects.push("audit.failed.unavailable");
        return Promise.reject(new Error("governance unavailable"));
      },
    },
  });
  let rejected = false;
  try {
    await coordinator.signIn({
      email: "owner@example.test",
      ipAddress: "127.0.0.1",
      password: "must-not-be-verified",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "required rate-limit audit failure propagates");
  assert(
    !limited.effects.includes("identity.password"),
    "rejected budget never invokes the password verifier",
  );
  assert(
    limited.effects.at(-1) ===
      "budget.rejected-reservation.finalize.503",
    `exact rejected reservation becomes unavailable: ${limited.effects}`,
  );
  assert(
    !limited.effects.includes("budget.rejected-reservation.finalize.429"),
    "failed required work never leaves a contradictory 429 result",
  );
});

Deno.test("transactional request-log failure aborts authenticated establishment", async () => {
  const failed = dependencies();
  const coordinator = createProtectedSessionCoordinator({
    ...failed.deps,
    attemptBudget: {
      ...failed.deps.attemptBudget,
      finalize(command) {
        failed.effects.push(
          `budget.${command.reservationId}.finalize.${command.statusCode}${
            command.transaction ? ".transactional" : ""
          }`,
        );
        if (command.statusCode === 200) {
          return Promise.reject(new Error("request log unavailable"));
        }
        return Promise.resolve();
      },
    },
  });
  let rejected = false;
  try {
    await coordinator.signIn({
      email: "owner@example.test",
      ipAddress: "127.0.0.1",
      password: "correct horse battery staple",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "transactional finalization failure propagates");
  assert(
    !failed.effects.includes("transaction.commit"),
    "session transaction cannot commit without its exact 200 request row",
  );
  assert(
    failed.effects.slice(-2).join(",") ===
      "budget.password-reservation.finalize.200.transactional,budget.password-reservation.finalize.503",
    `rolled-back reservation recovers as 503: ${failed.effects.join(",")}`,
  );
});

Deno.test("post-factor establishment failure finalizes the exact request as unavailable", async () => {
  const failed = dependencies();
  const coordinator = createProtectedSessionCoordinator({
    ...failed.deps,
    identity: {
      ...failed.deps.identity,
      issueSession() {
        failed.effects.push("identity.session.failed");
        return Promise.reject(new Error("database unavailable"));
      },
    },
  });
  let rejected = false;
  try {
    await coordinator.completeMfa({
      challengeToken: "challenge-token",
      factor: "123456",
      ipAddress: "127.0.0.1",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "establishment failure remains unavailable to transport");
  assert(
    failed.effects.at(-1) === "budget.mfa-reservation.finalize.503",
    `exact reservation must finalize 503: ${failed.effects.join(",")}`,
  );
});

Deno.test("protected-session result mapping is the HTTP source of truth", () => {
  assert(
    protectedSessionHttpStatus({ status: "invalid-credentials" }) === 401 &&
      protectedSessionHttpStatus({ status: "invalid-mfa" }) === 401 &&
      protectedSessionHttpStatus({ status: "membership-inactive" }) === 403 &&
      protectedSessionHttpStatus({ status: "challenge-expired" }) === 410 &&
      protectedSessionHttpStatus({
          retryAfterSeconds: 1,
          status: "rate-limited",
        }) === 429 &&
      protectedSessionHttpStatus({
          challengeToken: "challenge",
          status: "mfa-required",
        }) === 202,
    "every pre-session outcome maps to its endpoint status",
  );
});
