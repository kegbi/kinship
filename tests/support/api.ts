/**
 * The in-process HTTP steps the integration suites share (GAP-035): register
 * an owner, verify the captured address, sign in, and send requests carrying
 * the session cookie and the workspace header.
 *
 * The suites drive the configured Hono app with `app.request`, so nothing
 * listens on a socket. The helpers are bound to one file's app, mailbox, and
 * pool by `apiSupport`, which keeps every file's resources its own.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import type { Sql } from "./database.ts";

/** Every fixture account's password. */
export const PASSWORD = "correct horse battery staple";

/** The browser origin the test security policy trusts. */
export const ORIGIN = "http://localhost";

/** Headers of a same-origin JSON write. */
export const originHeaders = {
  "content-type": "application/json",
  origin: ORIGIN,
} as const;

/** The slice of the configured Hono app the suites drive. */
export interface RequestableApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

/** The captured verification mail a registration writes to. */
export interface VerificationMailbox {
  latestToken(email: string): string | undefined;
}

export type WorkspaceRole = "admin" | "member" | "owner";

/** A signed-in owner: the session cookie and the workspace it acts in. */
export interface SignedInFixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/** What a request needs to act inside a workspace. */
export interface WorkspaceSession {
  readonly cookie: string;
  readonly workspaceId: string;
}

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface RegistrationNames {
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface SignInOptions {
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly password?: string | undefined;
  readonly workspaceId?: string | undefined;
}

/**
 * The cookie and workspace headers of a request inside a workspace. A write
 * also carries the trusted origin, and a request with a body its JSON type.
 */
export function workspaceHeaders(
  session: WorkspaceSession,
  options: {
    readonly json?: boolean;
    readonly method?: HttpMethod;
    readonly workspaceId?: string | undefined;
  } = {},
): Record<string, string> {
  const method = options.method ?? "GET";
  return {
    cookie: session.cookie,
    ...(options.json ? { "content-type": "application/json" } : {}),
    ...(method === "GET" ? {} : { origin: ORIGIN }),
    "X-Workspace-Id": options.workspaceId ?? session.workspaceId,
  };
}

/** The first cookie a response sets, as a request `cookie` header value. */
export function sessionCookie(response: Response): string | undefined {
  return response.headers.get("set-cookie")?.split(";")[0];
}

export interface ApiSupport {
  /** Posts a registration, returning the response untouched. */
  submitRegistration(
    email: string,
    workspaceName: string,
    names?: RegistrationNames,
  ): Promise<Response>;
  /** Verifies the latest captured token for the address. */
  verify(email: string): Promise<Response>;
  /** Posts a sign-in from the trusted origin. */
  signIn(email: string, options?: SignInOptions): Promise<Response>;
  /** Registers, verifies, and signs in one owner of a new workspace. */
  register(
    email: string,
    workspaceName: string,
    names?: RegistrationNames,
  ): Promise<SignedInFixture>;
  /** Sends a request inside the session's workspace. */
  request(
    session: WorkspaceSession,
    path: string,
    method?: HttpMethod,
    body?: unknown,
    workspaceId?: string,
  ): Promise<Response>;
}

/** Binds the shared HTTP steps to one file's app, mailbox, and pool. */
export function apiSupport(
  app: RequestableApp,
  mail: VerificationMailbox,
  sql: Sql,
): ApiSupport {
  const post = async (
    path: string,
    body: unknown,
    headers: Readonly<Record<string, string>>,
  ): Promise<Response> =>
    await app.request(`${ORIGIN}${path}`, {
      body: JSON.stringify(body),
      headers: { ...headers },
      method: "POST",
    });

  const support: ApiSupport = {
    submitRegistration: (email, workspaceName, names = {}) =>
      post("/api/v1/registrations", {
        email,
        firstName: names.firstName ?? "Test",
        lastName: names.lastName ?? "Member",
        password: PASSWORD,
        workspaceName,
      }, { "content-type": "application/json" }),

    async verify(email) {
      const token = mail.latestToken(email);
      assert(token, `verification token captured for ${email}`);
      return await post("/api/v1/email-verifications", { token }, {
        "content-type": "application/json",
      });
    },

    signIn: (email, options = {}) =>
      post("/api/v1/sessions", {
        email,
        password: options.password ?? PASSWORD,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      }, { ...originHeaders, ...options.headers }),

    async register(email, workspaceName, names) {
      const registered = await support.submitRegistration(
        email,
        workspaceName,
        names,
      );
      assert(registered.status === 202, `${email} registers`);
      const verified = await support.verify(email);
      assert(verified.status === 200, `${email} verifies`);
      const signed = await support.signIn(email);
      const cookie = sessionCookie(signed);
      assert(signed.status === 200 && cookie, `${email} signs in`);
      const body = await signed.json() as {
        readonly member: { readonly id: string; readonly role: WorkspaceRole };
        readonly workspace: { readonly id: string };
      };
      const [user] = await sql<{ readonly id: string }[]>`
        select id::text from crm.users where email = ${email.toLowerCase()}
      `;
      assert(user, `${email} has an identity`);
      return {
        cookie,
        memberId: body.member.id,
        role: body.member.role,
        userId: user.id,
        workspaceId: body.workspace.id,
      };
    },

    async request(session, path, method = "GET", body, workspaceId) {
      return await app.request(`${ORIGIN}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: workspaceHeaders(session, {
          json: body !== undefined,
          method,
          workspaceId,
        }),
        method,
      });
    },
  };
  return support;
}
