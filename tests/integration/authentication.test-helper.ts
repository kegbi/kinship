/**
 * What each authentication suite loads (GAP-035): a configured app with a
 * fixed MFA keyset, its pool and mailbox, and the sign-in, MFA, audit, and
 * request-log probes the suites assert through.
 *
 * Deno loads every test file in its own worker isolate, so each suite that
 * imports this module evaluates it afresh and owns its own app, pools, and
 * mailbox; nothing here is shared between suites. Each suite closes its own
 * instance in its final test, most of them through `closeResources()`.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { apiSupport, PASSWORD } from "../support/api.ts";

export const databaseUrl = requireDatabaseUrl();
export const database = openSql(databaseUrl, { prepare: false });
export const mail = new CapturedVerificationMail();
export const mfaKey = new Uint8Array(32).fill(0x4b);
export const mfaKeyset = {
  activeKeyId: "test",
  keys: new Map([["test", mfaKey]]),
};
export const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
  mfaKeyset,
);
export const immediateResponseEqualizer = {
  run: <T>(work: () => Promise<T>): Promise<T> => work(),
};
const api = apiSupport(configured.app, mail, database);

export async function registerAndVerify(
  email: string,
): Promise<{ readonly entryToken: string; readonly userId: string }> {
  const response = await api.submitRegistration(email, "Ada's circle", {
    firstName: "Ada",
    lastName: "Lovelace",
  });
  assert(
    response.status === 202,
    `registration failed with ${response.status}`,
  );
  const verified = await api.verify(email);
  assert(verified.status === 200, "fixture email verifies");
  const entryToken = extractCookie(verified, "kinship_entry");
  const [user] = await database<{ id: string }[]>`
    select id::text from crm.users where email = ${email}
  `;
  assert(user, "fixture user exists");
  return { entryToken, userId: user.id };
}

export function extractCookie(response: Response, name: string): string {
  const value = response.headers.get("set-cookie")?.match(
    new RegExp(`${name}=([^;,]+)`),
  )?.[1];
  assert(value, `${name} cookie was not issued`);
  return value;
}

export function signIn(
  email: string,
  password = PASSWORD,
  options: {
    readonly clientAddress?: string;
    readonly cookie?: string;
    readonly workspaceId?: string;
  } = {},
): Promise<Response> {
  return api.signIn(email, {
    headers: {
      "X-Kinship-Client-Address": options.clientAddress ?? "127.0.0.10",
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    password,
    workspaceId: options.workspaceId,
  });
}

export async function completeMfa(
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

export async function failedAuditCount(userId?: string): Promise<number> {
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

export interface AuthenticationRequestLog {
  readonly id: string;
  readonly status_code: number | null;
  readonly user_id: string | null;
}

export async function latestAuthenticationRequestLog(
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

/** Closes the app and every pool this suite's instance of the module opened. */
export async function closeResources(): Promise<void> {
  await Promise.all([
    database.end({ timeout: 1 }),
    configured.close(),
  ]);
}
