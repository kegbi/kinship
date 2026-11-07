/**
 * The end-to-end sign-in regression (split from
 * `authentication_postgres_test.ts`, GAP-035).
 *
 * Its final test closes the app and pools it loaded from
 * `authentication.test-helper.ts`.
 */

import { createConfiguredApiApp } from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { type PasswordHasher } from "../../packages/backend/modules/identity/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  AesGcmMfaSecretBox,
  generateTotp,
} from "../../packages/backend/modules/identity/adapters/crypto/totp.ts";
import { Argon2idPasswordHasher } from "../../packages/backend/modules/identity/adapters/crypto/argon2id.ts";
import { PostgresIdentityAuthentication } from "../../packages/backend/modules/identity/adapters/postgres/authentication.ts";
import {
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/adapters/crypto/secure_tokens.ts";
import { PostgresRegistrationTransaction } from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  completeMfa,
  configured,
  database,
  databaseUrl,
  extractCookie,
  failedAuditCount,
  latestAuthenticationRequestLog,
  mail,
  mfaKeyset,
  registerAndVerify,
  signIn,
} from "./authentication.test-helper.ts";
import { resetDatabase } from "../support/database.ts";

Deno.test({
  name:
    "real PostgreSQL sign-in enforces credential provenance, MFA, recovery, rotation, reset, and workspace isolation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
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
    assert(
      challenged.headers.getSetCookie().some((cookie) =>
        cookie.startsWith("kinship_signin_device=") &&
        cookie.includes("; Path=/api/v1/sessions")
      ),
      "a proved password that awaits its factor still issues the device cookie",
    );
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

    // Ten failures from 127.0.0.43 and 127.0.0.40 put the owner behind the
    // per-account ceiling (AUD-A3), so even the correct password from a fresh
    // address is delayed, and the per-address burst below uses its own subject.
    const ceilinged = await signIn(email, "new correct horse battery staple", {
      clientAddress: "127.0.0.45",
    });
    assert(
      ceilinged.status === 429 &&
        Number(ceilinged.headers.get("retry-after")) > 0,
      "failures from two addresses delay the account at a third",
    );
    const concurrent = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          signIn("concurrent-budget@example.test", "wrong password", {
            clientAddress: "127.0.0.41",
          }),
      ),
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
  name:
    "[AUD-K2] session reads neither write nor lock, and revocation and suspension still bind the next request",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const email = `aud-k2-${crypto.randomUUID()}@example.test`;
    const { userId } = await registerAndVerify(email);
    const signInAs = async (clientAddress: string): Promise<string> => {
      const response = await signIn(email, undefined, { clientAddress });
      assert(response.status === 200, "fixture signs in");
      return extractCookie(response, "kinship_session");
    };
    const read = (token: string) =>
      configured.app.request("http://localhost/api/v1/session", {
        headers: { cookie: `kinship_session=${token}` },
      });
    const settle = async <T>(
      work: T | Promise<T>,
      milliseconds: number,
    ) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          Promise.resolve(work).then((value) => ({
            settled: true as const,
            value,
          })),
          new Promise<{ readonly settled: false }>((resolve) => {
            timer = setTimeout(() => resolve({ settled: false }), milliseconds);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    // A row's xmin changes when it is updated and its xmax when it is locked,
    // so an unchanged pair proves the request neither wrote nor locked it.
    const versions = async () =>
      await database<{ readonly row: string; readonly version: string }[]>`
        select 'session:' || s.id::text as row,
          s.xmin::text || '/' || s.xmax::text || '/' || s.last_seen_at::text
            as version
        from crm.user_sessions s
        where s.user_id = ${userId}::uuid
        union all
        select 'user', u.xmin::text || '/' || u.xmax::text
        from crm.users u where u.id = ${userId}::uuid
        union all
        select 'member:' || wm.id::text, wm.xmin::text || '/' || wm.xmax::text
        from crm.workspace_members wm where wm.user_id = ${userId}::uuid
        union all
        select 'workspace:' || w.id::text, w.xmin::text || '/' || w.xmax::text
        from crm.workspace_members wm join crm.workspaces w
          on w.id = wm.workspace_id
        where wm.user_id = ${userId}::uuid
        order by row
      `;

    const token = await signInAs("127.0.0.71");
    const before = JSON.stringify(await versions());
    for (const attempt of [1, 2]) {
      const response = await read(token);
      assert(response.status === 200, `read ${attempt} resolves the session`);
    }
    const after = JSON.stringify(await versions());
    assert(
      before === after,
      `two reads within a minute wrote or locked a row: ${before} -> ${after}`,
    );

    const lastSeen = async () => {
      const [row] = await database<{ readonly last_seen_at: Date }[]>`
        select last_seen_at from crm.user_sessions
        where user_id = ${userId}::uuid and revoked_at is null
          and purpose = 'authenticated'
      `;
      assert(row, "the active session exists");
      return row.last_seen_at.getTime();
    };
    await database`
      update crm.user_sessions
      set last_seen_at = last_seen_at - interval '2 minutes'
      where user_id = ${userId}::uuid and revoked_at is null
        and purpose = 'authenticated'
    `;
    const stale = await lastSeen();
    assert((await read(token)).status === 200, "a stale session resolves");
    const refreshed = await lastSeen();
    assert(
      refreshed - stale >= 110_000,
      "a session last seen over a minute ago records its presence",
    );
    assert((await read(token)).status === 200, "the session still resolves");
    assert(
      await lastSeen() === refreshed,
      "presence is recorded at most once a minute",
    );

    // Revocation: a read does not wait on an open revocation, and the first
    // request after it commits is refused.
    let commitRevocation = (): void => undefined;
    const revocationReleased = new Promise<void>((resolve) => {
      commitRevocation = resolve;
    });
    let markRevoked = (): void => undefined;
    const revokedInTransaction = new Promise<void>((resolve) => {
      markRevoked = resolve;
    });
    const revocation = database.begin(async (transaction) => {
      await transaction`
        update crm.user_sessions set revoked_at = now()
        where user_id = ${userId}::uuid and revoked_at is null
      `;
      markRevoked();
      await revocationReleased;
    });
    await revokedInTransaction;
    const duringRevocation = await settle(read(token), 3_000);
    commitRevocation();
    await revocation;
    assert(
      duringRevocation.settled,
      "a session read waited on an uncommitted revocation",
    );
    assert(
      (await read(token)).status === 401,
      "the first request after a committed revocation is refused",
    );
    const signedOut = await signInAs("127.0.0.72");
    const signOut = await configured.app.request(
      "http://localhost/api/v1/sign-out",
      {
        method: "POST",
        headers: {
          cookie: `kinship_session=${signedOut}`,
          origin: "http://localhost",
        },
      },
    );
    assert(signOut.status < 300, "sign-out succeeds");
    assert(
      (await read(signedOut)).status === 401,
      "the first request after sign-out is refused",
    );

    // Suspension: a write admitted against an open suspension waits for it on
    // the locking revalidation and is refused once it commits; reads never wait.
    const suspendedToken = await signInAs("127.0.0.73");
    const [membership] = await database<{ readonly workspace_id: string }[]>`
      select workspace_id::text from crm.workspace_members
      where user_id = ${userId}::uuid
    `;
    assert(membership, "the fixture membership exists");
    const peopleCount = async () => {
      const [row] = await database<{ readonly count: number }[]>`
        select count(*)::int count from crm.people
        where workspace_id = ${membership.workspace_id}::uuid
      `;
      return row?.count ?? -1;
    };
    const peopleBefore = await peopleCount();
    let commitSuspension = (): void => undefined;
    const suspensionReleased = new Promise<void>((resolve) => {
      commitSuspension = resolve;
    });
    let markSuspended = (): void => undefined;
    const suspendedInTransaction = new Promise<void>((resolve) => {
      markSuspended = resolve;
    });
    const suspension = database.begin(async (transaction) => {
      await transaction`
        update crm.workspace_members set status = 'suspended'
        where user_id = ${userId}::uuid
      `;
      markSuspended();
      await suspensionReleased;
    });
    await suspendedInTransaction;
    const write = Promise.resolve(
      configured.app.request("http://localhost/api/v1/people", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `kinship_session=${suspendedToken}`,
          origin: "http://localhost",
        },
        body: JSON.stringify({ givenName: "Concurrent", isPartial: false }),
      }),
    );
    const duringSuspensionRead = await settle(read(suspendedToken), 3_000);
    const duringSuspensionWrite = await settle(write, 500);
    commitSuspension();
    await suspension;
    const written = await write;
    assert(
      duringSuspensionRead.settled,
      "a session read waited on an uncommitted suspension",
    );
    assert(
      !duringSuspensionWrite.settled,
      "a write did not wait on an uncommitted suspension",
    );
    assert(
      written.status === 401 || written.status === 403,
      `a write racing a suspension was admitted with ${written.status}`,
    );
    assert(
      await peopleCount() === peopleBefore,
      "a write racing a suspension changed the workspace",
    );
    assert(
      (await read(suspendedToken)).status === 401,
      "the first request after a committed suspension is refused",
    );
  },
});

Deno.test({
  name:
    "[AUD-A3] a password hash made with weaker parameters is upgraded by a successful sign-in",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "rehash-owner@example.test";
    const { userId } = await registerAndVerify(email);
    const random = new WebCryptoRandomSource();
    const current = new Argon2idPasswordHasher(random, {
      memoryKiB: 19_456,
      iterations: 2,
      parallelism: 1,
      saltLength: 16,
      hashLength: 32,
    });
    const weaker = await new Argon2idPasswordHasher(random, {
      memoryKiB: 8_192,
      iterations: 1,
      parallelism: 1,
      saltLength: 16,
      hashLength: 32,
    }).hash("correct horse battery staple");
    assert(current.needsUpgrade(weaker), "fixture hash is below current cost");
    const [before] = await database<{ password_changed_at: Date | null }[]>`
      update crm.users set password_hash = ${weaker}
      where id = ${userId}::uuid
      returning password_changed_at
    `;
    assert(before, "fixture credential is replaced");
    const earlier = await signIn(email, undefined, {
      clientAddress: "127.0.6.1",
    });
    assert(earlier.status === 200, "the weaker hash still verifies");
    const earlierToken = extractCookie(earlier, "kinship_session");

    const [after] = await database<{
      password_changed_at: Date | null;
      password_hash: string;
    }[]>`
      select password_hash, password_changed_at from crm.users
      where id = ${userId}::uuid
    `;
    assert(
      after && after.password_hash !== weaker &&
        !current.needsUpgrade(after.password_hash) &&
        await current.verify(
          "correct horse battery staple",
          after.password_hash,
        ),
      "a successful sign-in stores the password under the current cost",
    );
    assert(
      after.password_changed_at?.toISOString() ===
        before.password_changed_at?.toISOString(),
      "an upgrade is not a password change and keeps the credential version",
    );
    const stillValid = await configured.app.request(
      "http://localhost/api/v1/session",
      { headers: { cookie: `kinship_session=${earlierToken}` } },
    );
    assert(
      stillValid.status === 200,
      "the session issued before the upgrade stays valid",
    );
    const again = await signIn(email, undefined, {
      clientAddress: "127.0.6.1",
    });
    assert(again.status === 200, "the upgraded hash verifies on sign-in");
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
