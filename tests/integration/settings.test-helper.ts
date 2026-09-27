/**
 * What each settings suite loads (GAP-035): a configured app, pool, and
 * mailbox, and the settings-shaped request they drive.
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
import {
  addMembership as addMembershipFor,
  openSql,
  requireDatabaseUrl,
} from "../support/database.ts";
import { apiSupport, originHeaders } from "../support/api.ts";

export const databaseUrl = requireDatabaseUrl();
export const sql = openSql(databaseUrl, { max: 3, prepare: false });
export const mail = new CapturedVerificationMail();
export const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);

export interface IdentityFixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

export function register(
  email: string,
  workspaceName: string,
): Promise<IdentityFixture> {
  return api.register(email, workspaceName);
}

export function signIn(email: string, workspaceId?: string): Promise<Response> {
  return api.signIn(email, { workspaceId });
}

export function addMembership(
  identity: IdentityFixture,
  workspaceId: string,
  role: "admin" | "member",
): Promise<string> {
  return addMembershipFor(sql, identity.userId, workspaceId, role);
}

export async function settingsRequest(
  cookie: string,
  path: string,
  options: {
    readonly body?: unknown;
    readonly method?: string;
    readonly workspaceId?: string;
  } = {},
): Promise<Response> {
  return await configured.app.request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...originHeaders,
      cookie,
      ...(options.workspaceId ? { "X-Workspace-Id": options.workspaceId } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

/** Closes the app and every pool this suite's instance of the module opened. */
export async function closeResources(): Promise<void> {
  await sql.end();
  await configured.close();
}
