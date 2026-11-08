/**
 * SECA-01 and SECA-02 (AUD-A1): a registration cannot plant a password on an
 * address its requester does not hold.
 *
 * Each test replays a request sequence from the 2026-11-07 audit against the
 * real PostgreSQL schema through the configured API. The attacker and the
 * mailbox owner are two cookie jars: the attacker never sees the mailbox, and
 * the owner never holds the attacker's cookies.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import { apiSupport, ORIGIN, originHeaders, PASSWORD } from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 3, prepare: false });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
);
const api = apiSupport(configured.app, mail, sql);

const ATTACKER_PASSWORD = "attacker chosen passphrase";

/** The `name=value` pairs a response sets, as one request `cookie` header. */
function cookiesFrom(response: Response): string {
  return response.headers.getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

function post(
  path: string,
  body: unknown,
  cookie = "",
  headers: Readonly<Record<string, string>> = originHeaders,
): Promise<Response> {
  return Promise.resolve(configured.app.request(`${ORIGIN}${path}`, {
    body: JSON.stringify(body),
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    method: "POST",
  }));
}

function registration(email: string, password: string): Promise<Response> {
  return post("/api/v1/registrations", {
    email,
    firstName: "Someone",
    lastName: "Else",
    password,
    workspaceName: "Whatever",
  });
}

function signIn(email: string, password: string): Promise<Response> {
  return post("/api/v1/sessions", { email, password });
}

Deno.test({
  name:
    "SECA-01 a verification without the registrant's browser discards the registrant's password",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const victim = "victim@example.test";

    const planted = await registration(victim, ATTACKER_PASSWORD);
    assert(planted.status === 202, "the attacker's registration is accepted");
    await planted.body?.cancel();
    const early = await signIn(victim, ATTACKER_PASSWORD);
    assert(early.status === 401, "nobody signs in before verification");
    await early.body?.cancel();

    const token = mail.latestToken(victim);
    assert(token, "the verification link reaches the mailbox");
    const verified = await post("/api/v1/email-verifications", { token });
    const verifiedBody = await verified.json() as {
      readonly next: string;
      readonly status: string;
    };
    assert(
      verified.status === 200 && verifiedBody.status === "password-required",
      `the owner's click verifies the address and asks for a password, got ${verified.status} ${
        JSON.stringify(verifiedBody)
      }`,
    );
    assert(
      !verified.headers.getSetCookie().some((cookie) =>
        /^kinship_entry=[^;]+/.test(cookie)
      ),
      "a verification without the registrant's browser enters nothing",
    );

    const hijack = await signIn(victim, ATTACKER_PASSWORD);
    assert(
      hijack.status === 401,
      `the attacker's password no longer signs in, got ${hijack.status}`,
    );
    await hijack.body?.cancel();

    const resetToken = new URL(verifiedBody.next, ORIGIN).searchParams.get(
      "token",
    );
    assert(
      new URL(verifiedBody.next, ORIGIN).pathname === "/auth/reset-password" &&
        resetToken,
      "the owner is sent to the password-reset step",
    );
    const chosen = await post("/api/v1/password-resets", {
      password: PASSWORD,
      token: resetToken,
    });
    assert(chosen.status === 200, "the owner sets their own password");
    await chosen.body?.cancel();
    const owner = await signIn(victim, PASSWORD);
    assert(owner.status === 200, "the owner signs in with their password");
    await owner.body?.cancel();
    const attackerAgain = await signIn(victim, ATTACKER_PASSWORD);
    assert(attackerAgain.status === 401, "the attacker stays locked out");
    await attackerAgain.body?.cancel();
  },
});

Deno.test({
  name:
    "SECA-01 an invitee replaces a squatted pending account and joins with their own password",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const employer = await api.register(
      "employer@example.test",
      "Employer Confidential WS",
    );
    // Only an address verified for a day may invite (SECA-03, AUD-M3).
    await sql`
      update crm.users set email_verified_at = now() - interval '25 hours'
      where email = 'employer@example.test'
    `;
    const victim = "invited-victim@example.test";
    const invited = await post(
      "/api/v1/workspace-invitations",
      { email: victim, role: "member" },
      employer.cookie,
      { ...originHeaders, "X-Workspace-Id": employer.workspaceId },
    );
    assert(invited.status === 201, "the employer invites the victim");
    await invited.body?.cancel();
    const invitationToken = mail.latestInvitationToken(victim);
    assert(invitationToken, "the invitation reaches the mailbox");

    const planted = await registration(victim, ATTACKER_PASSWORD);
    assert(planted.status === 202, "the attacker pre-registers the address");
    await planted.body?.cancel();

    const registered = await post("/api/v1/workspace-invitations/register", {
      email: victim,
      firstName: "Invited",
      lastName: "Victim",
      password: PASSWORD,
      token: invitationToken,
    });
    assert(
      registered.status === 202,
      `the invitee registers through the invitation, got ${registered.status}`,
    );
    await registered.body?.cancel();
    const victimJar = cookiesFrom(registered);

    const token = mail.latestToken(victim);
    assert(token, "the invitee's verification link reaches the mailbox");
    const verified = await post(
      "/api/v1/email-verifications",
      { token },
      victimJar,
    );
    const verifiedBody = await verified.json() as { readonly next: string };
    assert(
      verified.status === 200 && verifiedBody.next === "/invite/continue",
      `the invitee's own browser verifies and continues to the invitation, got ${verified.status} ${
        JSON.stringify(verifiedBody)
      }`,
    );
    const entry = cookiesFrom(verified);
    const accepted = await post(
      "/api/v1/workspace-invitations/accept",
      {},
      `${victimJar}; ${entry}`,
    );
    assert(accepted.status === 200, "the invitee joins the workspace");
    await accepted.body?.cancel();

    const hijack = await signIn(victim, ATTACKER_PASSWORD);
    assert(
      hijack.status === 401,
      `the attacker's password signs nobody in, got ${hijack.status}`,
    );
    await hijack.body?.cancel();
    const own = await post("/api/v1/sessions", {
      email: victim,
      password: PASSWORD,
      workspaceId: employer.workspaceId,
    });
    assert(own.status === 200, "the invitee signs in with their own password");
    const ownBody = await own.json() as {
      readonly workspace: { readonly name: string };
    };
    assert(
      ownBody.workspace.name === "Employer Confidential WS",
      "the invitee is a member of the inviting workspace",
    );
    const [identities] = await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.users where email = ${victim}
    `;
    assert(identities?.count === 1, "one identity holds the address");
  },
});

Deno.test({
  name:
    "SECA-01/SECA-02 a later registration replaces a pending one, an existing account answers the same, and cross-site writes are refused",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const address = "squatted@example.test";

    const planted = await registration(address, ATTACKER_PASSWORD);
    assert(planted.status === 202, "the first registration is accepted");
    await planted.body?.cancel();
    const attackerJar = cookiesFrom(planted);
    const plantedToken = mail.latestToken(address);
    assert(plantedToken, "the first registration is mailed");

    const owned = await registration(address, PASSWORD);
    assert(owned.status === 202, "a pending address is not a conflict");
    const ownedBody = await owned.text();
    assert(
      ownedBody === JSON.stringify({ status: "verification-required" }),
      "the replacing registration answers exactly as a fresh one",
    );
    const ownerJar = cookiesFrom(owned);
    const [state] = await sql<
      {
        readonly intents: number;
        readonly users: number;
        readonly workspaces: number;
      }[]
    >`
      select
        (select count(*)::int from crm.users where email = ${address}) users,
        (select count(*)::int from crm.users
          where pending_workspace_name is not null) intents,
        (select count(*)::int from crm.workspaces) workspaces
    `;
    assert(
      state?.users === 1 && state.intents === 1 && state.workspaces === 0,
      "the pending identity is replaced, not duplicated, and nothing is provisioned before verification",
    );

    const stale = await post(
      "/api/v1/email-verifications",
      { token: plantedToken },
      attackerJar,
    );
    assert(
      stale.status === 400 || stale.status === 409,
      `the replaced registration's link is void, got ${stale.status}`,
    );
    await stale.body?.cancel();

    const token = mail.latestToken(address);
    assert(token && token !== plantedToken, "the replacement is mailed anew");
    const verified = await post(
      "/api/v1/email-verifications",
      { token },
      ownerJar,
    );
    const verifiedBody = await verified.json() as { readonly status: string };
    assert(
      verified.status === 200 && verifiedBody.status === "verified" &&
        verified.headers.getSetCookie().some((cookie) =>
          cookie.startsWith("kinship_registrant=;")
        ),
      "the registering browser keeps its password and drops its verifier",
    );
    const [provisioned] = await sql<{ readonly workspaces: number }[]>`
      select count(*)::int workspaces from crm.workspaces w
      join crm.users u on u.id = w.created_by_user_id
      where u.email = ${address}
    `;
    assert(
      provisioned?.workspaces === 1,
      "verification provisions the replacing registration's one workspace",
    );
    const signed = await signIn(address, PASSWORD);
    assert(signed.status === 200, "the registrant signs in with its password");
    await signed.body?.cancel();
    const attacker = await signIn(address, ATTACKER_PASSWORD);
    assert(attacker.status === 401, "the replaced password is gone");
    await attacker.body?.cancel();

    // SECA-02: a verified address answers what a fresh one does, and its
    // owner is told, with a reset link that works.
    const resetsBefore = mail.accountExistsTokens(address).length;
    const verificationsBefore = mail.tokens(address).length;
    const again = await registration(address, ATTACKER_PASSWORD);
    assert(
      again.status === 202 &&
        await again.text() ===
          JSON.stringify({ status: "verification-required" }) &&
        again.headers.getSetCookie().some((cookie) =>
          cookie.startsWith("kinship_registrant=")
        ),
      "an existing account is answered like a fresh registration",
    );
    assert(
      mail.tokens(address).length === verificationsBefore,
      "an existing account is never sent a verification link",
    );
    const accountExists = mail.accountExistsTokens(address);
    const resetToken = accountExists.at(-1);
    assert(
      accountExists.length === resetsBefore + 1 && resetToken,
      "the owner is told somebody tried to register their address",
    );
    const untouched = await signIn(address, PASSWORD);
    assert(untouched.status === 200, "the existing password still works");
    await untouched.body?.cancel();

    const changesBefore = mail.passwordChangeCount(address);
    const reset = await post("/api/v1/password-resets", {
      password: "a brand new passphrase",
      token: resetToken,
    });
    assert(reset.status === 200, "the mailed reset link works");
    await reset.body?.cancel();
    assert(
      mail.passwordChangeCount(address) === changesBefore + 1,
      "the address is told its password changed",
    );

    // SECA-13 item 6: the three public writes refuse a foreign origin.
    for (
      const [path, body] of [
        ["/api/v1/registrations", {
          email: "cross-site@example.test",
          firstName: "Cross",
          lastName: "Site",
          password: PASSWORD,
          workspaceName: "Cross site",
        }],
        ["/api/v1/email-verifications", { token: "x".repeat(43) }],
        ["/api/v1/email-verification-deliveries", { email: address }],
      ] as const
    ) {
      for (
        const headers of [
          { "content-type": "application/json" },
          {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          { "content-type": "application/json", origin: "null" },
        ]
      ) {
        const refused = await post(path, body, "", headers);
        assert(
          refused.status === 403,
          `${path} refuses ${
            headers.origin ?? "a missing"
          } origin, got ${refused.status}`,
        );
        await refused.body?.cancel();
      }
      const crossSiteText = await post(path, body, "", {
        "content-type": "text/plain",
        origin: "https://evil.example",
      });
      assert(
        crossSiteText.status === 415,
        `${path} refuses a cross-site text body, got ${crossSiteText.status}`,
      );
      await crossSiteText.body?.cancel();
    }
    const [crossSite] = await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.users
      where email = 'cross-site@example.test'
    `;
    assert(crossSite?.count === 0, "a refused registration writes nothing");
  },
});

Deno.test({
  name:
    "SECA-02 a verified address over the reset limit is still mailed and answered like a fresh one",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const address = "throttled-owner@example.test";
    const fresh = "never-registered@example.test";
    await api.register(address, "Throttled circle");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const requested = await post("/api/v1/password-reset-requests", {
        email: address,
      });
      assert(requested.status === 202, "each reset request is accepted");
      await requested.body?.cancel();
    }

    const freshResponse = await registration(fresh, ATTACKER_PASSWORD);
    const freshBody = await freshResponse.text();
    assert(
      freshResponse.status === 202 && mail.tokens(fresh).length === 1,
      "a fresh address is mailed one verification link",
    );

    const toldBefore = mail.accountExistsTokens(address).length;
    const again = await registration(address, ATTACKER_PASSWORD);
    assert(
      again.status === freshResponse.status &&
        await again.text() === freshBody,
      `an over-limit account answers what a fresh address does, got ${again.status}`,
    );
    const told = mail.accountExistsTokens(address);
    assert(
      told.length === toldBefore + 1 && told.at(-1) === undefined,
      `the owner is still told once, without a reset link (${
        told.length - toldBefore
      })`,
    );
    const untouched = await signIn(address, PASSWORD);
    assert(untouched.status === 200, "the existing password still works");
    await untouched.body?.cancel();
  },
});

Deno.test({
  name: "registration takeover PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([sql.end({ timeout: 1 }), configured.close()]);
  },
});
