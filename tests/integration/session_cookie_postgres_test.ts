/**
 * SECA-07, SECA-09, and SECT-06 (AUD-K4): the session cookie and sign-out.
 *
 * - Signing out of a session that is already over answers 200 and clears the
 *   cookie, instead of a 503 that leaves it in place.
 * - Over HTTPS the cookie is `__Host-kinship_session`, which no sibling
 *   subdomain can set; a request carrying more than one session cookie is
 *   nobody, and the answer clears the cookie.
 * - Revoking a session id that belongs to somebody else answers exactly what
 *   an unknown id answers, and leaves that session alone.
 */

import { createConfiguredApiApp } from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { resetDatabase } from "../support/database.ts";
import { apiSupport, PASSWORD } from "../support/api.ts";
import {
  closeResources,
  configured,
  database,
  databaseUrl,
  mail,
  mfaKeyset,
} from "./authentication.test-helper.ts";

const api = apiSupport(configured.app, mail, database);
const HTTPS_ORIGIN = "https://kinship.example.test";

/** The `Set-Cookie` lines a response sends for one cookie name. */
function setCookiesNamed(response: Response, name: string): string[] {
  return response.headers.getSetCookie().filter((line) =>
    line.startsWith(`${name}=`)
  );
}

/** Whether a response expires the named cookie. */
function clears(response: Response, name: string): boolean {
  return setCookiesNamed(response, name).some((line) =>
    line.startsWith(`${name}=;`) && line.includes("Max-Age=0")
  );
}

function signOut(cookie: string): Promise<Response> {
  return Promise.resolve(configured.app.request(
    "http://localhost/api/v1/sign-out",
    {
      method: "POST",
      headers: { cookie, origin: "http://localhost" },
    },
  ));
}

Deno.test({
  name:
    "[AUD-K4] signing out of a session that is already over answers 200 and clears the cookie",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const owner = await api.register("aud-k4-stale@example.test", "Stale");

    const first = await signOut(owner.cookie);
    assert(first.status === 200, "the live session signs out");
    assert(clears(first, "kinship_session"), "and its cookie is cleared");

    const again = await signOut(owner.cookie);
    assert(
      again.status === 200,
      `an already revoked cookie answers 200, not ${again.status}`,
    );
    assert(clears(again, "kinship_session"), "and is cleared again");

    const unknown = await signOut(`kinship_session=${"x".repeat(43)}`);
    assert(unknown.status === 200, "an unknown cookie answers 200");
    assert(clears(unknown, "kinship_session"), "and is cleared");
  },
});

Deno.test({
  name:
    "[AUD-K4] revoking another user's session id answers what an unknown id answers",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const victim = await api.register("aud-k4-victim@example.test", "Victim");
    const caller = await api.register("aud-k4-caller@example.test", "Caller");
    const [victimSession] = await database<{ readonly id: string }[]>`
      select id::text from crm.user_sessions
      where user_id = ${victim.userId}::uuid and purpose = 'authenticated'
        and revoked_at is null
    `;
    assert(victimSession, "the victim holds a live session");

    const foreign = await api.request(
      caller,
      `/api/v1/settings/sessions/${victimSession.id}`,
      "DELETE",
    );
    const unknown = await api.request(
      caller,
      `/api/v1/settings/sessions/${crypto.randomUUID()}`,
      "DELETE",
    );
    const foreignBody = await foreign.text();
    const unknownBody = await unknown.text();
    assert(
      foreign.status === 404,
      `a foreign session id answers 404, not ${foreign.status}`,
    );
    assert(
      unknown.status === 404 && foreignBody === unknownBody,
      "a foreign id and an unknown id cannot be told apart",
    );
    const [still] = await database<{ readonly revoked: boolean }[]>`
      select revoked_at is not null revoked from crm.user_sessions
      where id = ${victimSession.id}::uuid
    `;
    assert(still && !still.revoked, "the victim's session is untouched");
    const victimRead = await api.request(victim, "/api/v1/session");
    assert(victimRead.status === 200, "and still resolves");
  },
});

Deno.test({
  name:
    "[AUD-K4] over HTTPS the session cookie is __Host- prefixed, and a duplicate is nobody",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(database);
    const owner = await api.register("aud-k4-host@example.test", "Host");
    const secure = createConfiguredApiApp(
      databaseUrl,
      mail,
      browserSecurityPolicy("test", HTTPS_ORIGIN),
      mfaKeyset,
    );
    const read = (cookie: string) =>
      Promise.resolve(secure.app.request(`${HTTPS_ORIGIN}/api/v1/session`, {
        headers: { cookie },
      }));
    try {
      const signedIn = await secure.app.request(
        `${HTTPS_ORIGIN}/api/v1/sessions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: HTTPS_ORIGIN,
            "X-Kinship-Client-Address": "127.0.0.84",
          },
          body: JSON.stringify({
            email: "aud-k4-host@example.test",
            password: PASSWORD,
          }),
        },
      );
      assert(signedIn.status === 200, `HTTPS sign-in answers 200`);
      const [issued] = setCookiesNamed(signedIn, "__Host-kinship_session");
      assert(issued, "the session cookie is named __Host-kinship_session");
      assert(
        issued.includes("; Secure") && issued.includes("; Path=/") &&
          !/;\s*Domain=/i.test(issued),
        "with Secure, Path=/, and no Domain, as the prefix requires",
      );
      assert(
        setCookiesNamed(signedIn, "kinship_session").length === 0,
        "and the unprefixed name is never set over HTTPS",
      );
      const token = issued.split(";")[0]!.slice(
        "__Host-kinship_session=".length,
      );

      const resolved = await read(`__Host-kinship_session=${token}`);
      assert(resolved.status === 200, "the prefixed cookie resolves");

      const legacy = await read(`kinship_session=${token}`);
      assert(
        legacy.status === 401,
        "the unprefixed name is not read over HTTPS (a forced sign-in)",
      );
      const tossed = await read(
        `kinship_session=tossed; __Host-kinship_session=${token}`,
      );
      assert(
        tossed.status === 200,
        "a sibling's unprefixed cookie cannot shadow the prefixed one",
      );

      for (
        const pair of [
          `__Host-kinship_session=${token}; __Host-kinship_session=forged`,
          `__Host-kinship_session=forged; __Host-kinship_session=${token}`,
        ]
      ) {
        const duplicated = await read(pair);
        assert(
          duplicated.status === 401,
          `two session cookies answer 401 whatever their order, not ${duplicated.status}`,
        );
        assert(
          clears(duplicated, "__Host-kinship_session"),
          "and the answer clears the cookie",
        );
      }
    } finally {
      await secure.close();
    }

    const plainDuplicate = await configured.app.request(
      "http://localhost/api/v1/session",
      { headers: { cookie: `${owner.cookie}; kinship_session=forged` } },
    );
    assert(
      plainDuplicate.status === 401 &&
        clears(plainDuplicate, "kinship_session"),
      "over loopback HTTP a duplicate is refused and cleared too",
    );
    await closeResources();
  },
});
