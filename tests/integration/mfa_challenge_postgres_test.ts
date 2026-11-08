/**
 * SECA-06 (the MFA part) and SECA-14 item 4 (AUD-A4): the `kinship_mfa`
 * challenge is a hashed `user_sessions` row, so it survives a restart and is
 * the same challenge on every replica.
 *
 * Each test proves the password on one composition and answers the factor on
 * another, built afresh against the same database, which is what a restart or
 * a second replica is to the challenge.
 */

import { createConfiguredApiApp } from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  AesGcmMfaSecretBox,
  generateTotp,
} from "../../packages/backend/modules/identity/adapters/crypto/totp.ts";
import { WebCryptoRandomSource } from "../../packages/backend/modules/identity/adapters/crypto/secure_tokens.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { resetDatabase } from "../support/database.ts";
import {
  closeResources,
  configured,
  database,
  databaseUrl,
  extractCookie,
  mail,
  mfaKeyset,
  registerAndVerify,
  signIn,
} from "./authentication.test-helper.ts";

const SECRET = "JBSWY3DPEHPK3PXP";

/** Another API process on the same database: a restart, or a replica. */
function rebuiltComposition(): ReturnType<typeof createConfiguredApiApp> {
  return createConfiguredApiApp(
    databaseUrl,
    mail,
    browserSecurityPolicy("test", "http://localhost"),
    mfaKeyset,
  );
}

function submitFactor(
  app: ReturnType<typeof createConfiguredApiApp>["app"],
  factor: string,
  challenge: string,
  clientAddress: string,
): Promise<Response> {
  return Promise.resolve(app.request(
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
  ));
}

/** A verified owner with a confirmed TOTP factor, signed in to its challenge. */
async function challengedOwner(
  email: string,
): Promise<{ readonly challenge: string; readonly userId: string }> {
  const { userId } = await registerAndVerify(email);
  const box = new AesGcmMfaSecretBox(mfaKeyset, new WebCryptoRandomSource());
  await database`
    insert into crm.user_mfa_totp (
      user_id, encrypted_secret, confirmed_at, created_at, updated_at
    ) values (
      ${userId}::uuid, ${await box.encrypt(SECRET, userId)}, now(), now(), now()
    )
  `;
  const challenged = await signIn(email);
  assert(challenged.status === 202, "the password step asks for the factor");
  return { challenge: extractCookie(challenged, "kinship_mfa"), userId };
}

async function validCode(): Promise<string> {
  const code = await generateTotp(SECRET, new Date());
  assert(code, "TOTP fixture generated");
  return code;
}

/** The row id a `kinship_mfa` value names. */
function challengeIdOf(challenge: string): string {
  const [id] = challenge.split(".");
  assert(id, "a challenge names its row");
  return id;
}

Deno.test({
  name:
    "[AUD-A4] a challenge issued before a restart completes on the rebuilt composition",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const { challenge, userId } = await challengedOwner(
      "aud-a4-restart@example.test",
    );
    const rebuilt = rebuiltComposition();
    try {
      const accepted = await submitFactor(
        rebuilt.app,
        await validCode(),
        challenge,
        "127.0.4.1",
      );
      assert(
        accepted.status === 200,
        `a valid code on another process answers 200, not ${accepted.status}`,
      );
      const session = extractCookie(accepted, "kinship_session");
      const resolved = await configured.app.request(
        "http://localhost/api/v1/session",
        { headers: { cookie: `kinship_session=${session}` } },
      );
      assert(resolved.status === 200, "the session it issued resolves");
      const replay = await submitFactor(
        configured.app,
        await validCode(),
        challenge,
        "127.0.4.2",
      );
      assert(replay.status === 410, "the challenge is spent everywhere");
      const [row] = await database<{
        readonly purpose: string;
        readonly revoked: boolean;
        readonly sessionHash: string;
      }[]>`
        select purpose, revoked_at is not null revoked,
          session_hash "sessionHash"
        from crm.user_sessions
        where user_id = ${userId}::uuid and purpose = 'mfa-challenge'
      `;
      assert(
        row?.revoked === true && !challenge.includes(row.sessionHash),
        "the challenge row is stored hashed and revoked once it is used",
      );
    } finally {
      await rebuilt.close();
    }
  },
});

Deno.test({
  name:
    "[AUD-A4] a challenge counts its wrong factors across processes and is never a session",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const { challenge } = await challengedOwner("aud-a4-attempts@example.test");
    const asSession = await configured.app.request(
      "http://localhost/api/v1/session",
      { headers: { cookie: `kinship_session=${challenge}` } },
    );
    assert(asSession.status === 401, "a challenge is not a session");

    const rebuilt = rebuiltComposition();
    try {
      // Each wrong factor comes from its own address and alternates
      // processes, so neither the per-address budget nor one process's
      // memory is what counts them.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const app = attempt % 2 === 0 ? configured.app : rebuilt.app;
        const wrong = await submitFactor(
          app,
          "000000",
          challenge,
          `127.0.5.${attempt + 1}`,
        );
        assert(
          wrong.status === 401,
          `wrong factor ${attempt + 1} answers 401, not ${wrong.status}`,
        );
      }
      const exhausted = await submitFactor(
        rebuilt.app,
        await validCode(),
        challenge,
        "127.0.5.9",
      );
      assert(
        exhausted.status === 429,
        `a valid code after five wrong ones answers 429, not ${exhausted.status}`,
      );
      assert(
        Number(exhausted.headers.get("Retry-After")) > 0,
        "the refusal says when the challenge lapses",
      );
    } finally {
      await rebuilt.close();
    }
  },
});

Deno.test({
  name:
    "[AUD-A4] a pending challenge is neither a listed session nor an active one a workspace delete would count",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const email = "aud-a4-listing@example.test";
    const { challenge } = await challengedOwner(email);
    const accepted = await submitFactor(
      configured.app,
      await validCode(),
      challenge,
      "127.0.6.1",
    );
    assert(accepted.status === 200, "the owner completes the factor");
    const cookie = `kinship_session=${
      extractCookie(accepted, "kinship_session")
    }`;
    const observe = async (): Promise<string> => {
      const [sessions, impact] = await Promise.all(
        [
          "/api/v1/settings/sessions",
          "/api/v1/settings/workspace-lifecycle",
        ].map((path) =>
          Promise.resolve(
            configured.app.request(`http://localhost${path}`, {
              headers: { cookie },
            }),
          )
        ),
      );
      assert(
        sessions?.status === 200 && impact?.status === 200,
        "the owner reads the session list and the impact preview",
      );
      const listed = await sessions.json() as {
        readonly sessions: readonly unknown[];
      };
      const preview = await impact.json() as {
        readonly activeSessionCount: number;
      };
      return `${listed.sessions.length}/${preview.activeSessionCount}`;
    };
    const before = await observe();
    const pending = await signIn(email);
    assert(pending.status === 202, "a second browser awaits its factor");
    assert(
      await observe() === before,
      `a pending challenge changed the listed and counted sessions from ${before}`,
    );
  },
});

Deno.test({
  name:
    "[AUD-A4] a malformed, forged, or revoked challenge answers 410 and spends the row",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const { challenge, userId } = await challengedOwner(
      "aud-a4-forged@example.test",
    );
    const challengeId = challengeIdOf(challenge);
    for (
      const malformed of [
        "not-a-challenge",
        `${challengeId}`,
        `${challengeId}.secret.extra`,
        `${crypto.randomUUID()}.${challenge.split(".")[1]}`,
      ]
    ) {
      const refused = await submitFactor(
        configured.app,
        await validCode(),
        malformed,
        "127.0.7.1",
      );
      assert(refused.status === 410, `${malformed} answers 410`);
    }
    const forged = await submitFactor(
      configured.app,
      await validCode(),
      `${challengeId}.forged-secret`,
      "127.0.7.2",
    );
    assert(forged.status === 410, "a forged secret answers 410");
    const genuine = await submitFactor(
      configured.app,
      await validCode(),
      challenge,
      "127.0.7.3",
    );
    assert(
      genuine.status === 410,
      "a forged secret spends the row it named, so the genuine one is refused",
    );

    const second = await signIn("aud-a4-forged@example.test");
    const secondChallenge = extractCookie(second, "kinship_mfa");
    await database`
      update crm.user_sessions set revoked_at = now()
      where user_id = ${userId}::uuid and revoked_at is null
    `;
    const revoked = await submitFactor(
      configured.app,
      await validCode(),
      secondChallenge,
      "127.0.7.4",
    );
    assert(
      revoked.status === 410,
      "revoking a user's sessions revokes the challenge",
    );

    const lapsing = await signIn("aud-a4-forged@example.test");
    const lapsingChallenge = extractCookie(lapsing, "kinship_mfa");
    await database`
      update crm.user_sessions set expires_at = now() - interval '1 second'
      where id = ${challengeIdOf(lapsingChallenge)}::uuid
    `;
    const lapsed = await submitFactor(
      configured.app,
      await validCode(),
      lapsingChallenge,
      "127.0.7.6",
    );
    assert(lapsed.status === 410, "a lapsed challenge answers 410");

    const third = await signIn("aud-a4-forged@example.test");
    const thirdChallenge = extractCookie(third, "kinship_mfa");
    await database`
      delete from crm.user_mfa_totp where user_id = ${userId}::uuid
    `;
    const withoutFactor = await submitFactor(
      configured.app,
      "000000",
      thirdChallenge,
      "127.0.7.5",
    );
    const [spent] = await database<{ readonly revoked: boolean }[]>`
      select revoked_at is not null revoked from crm.user_sessions
      where id = ${challengeIdOf(thirdChallenge)}::uuid
    `;
    assert(
      withoutFactor.status === 410 && spent?.revoked === true,
      "a factor removed since the password step spends the challenge",
    );
  },
});

Deno.test({
  name: "[AUD-A4] mfa challenge suite closes its resources",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
