/**
 * What a personal-token suite needs (MCP-A1): the configured app over the
 * disposable database, an owner to act as, a token minted with given scopes
 * through the real management route, and requests that present the token and
 * nothing else — no cookie and no Origin.
 *
 * Each token-enabled lane writes its own `tests/integration` file on these, so
 * the steps that make a bearer request are written once. Deno loads every test
 * file in its own isolate, so each suite that calls `composeTokenSuite` owns
 * its app, pool, and mailbox.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  type ApiSupport,
  apiSupport,
  type HttpMethod,
  ORIGIN,
  type RequestableApp,
  type SignedInFixture,
} from "./api.ts";
import { openSql, requireDatabaseUrl, type Sql } from "./database.ts";

/** A token as its minting answered: the record, and the one-time secret. */
export interface MintedToken {
  readonly record: {
    readonly expiresAt?: string;
    readonly id: string;
    readonly name: string;
    readonly scopes: readonly string[];
  };
  readonly secret: string;
}

export interface MintOptions {
  readonly expiresAt?: string;
  readonly name?: string;
}

export interface BearerOptions {
  readonly body?: unknown;
  /** Extra headers, such as `X-Workspace-Id`; never needed for a token. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: HttpMethod;
}

export interface TokenSupport {
  /** Mints a token through `POST /api/v1/settings/api-tokens`. */
  mint(
    fixture: SignedInFixture,
    scopes: readonly string[],
    options?: MintOptions,
  ): Promise<MintedToken>;
  /** Sends a request that carries the token and no cookie or Origin. */
  bearer(
    secret: string,
    path: string,
    options?: BearerOptions,
  ): Promise<Response>;
}

/** Binds the token steps to one suite's app and its session steps. */
export function tokenSupport(
  app: RequestableApp,
  api: Pick<ApiSupport, "request">,
): TokenSupport {
  return {
    async mint(fixture, scopes, options = {}) {
      const response = await api.request(
        fixture,
        "/api/v1/settings/api-tokens",
        "POST",
        {
          ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
          name: options.name ?? (scopes.join(" + ") || "Connector"),
          scopes,
        },
      );
      assert(
        response.status === 201,
        `token ${scopes.join(", ")} minted: ${response.status}`,
      );
      return await response.json() as MintedToken;
    },

    bearer: async (secret, path, options = {}) =>
      await app.request(`${ORIGIN}${path}`, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${secret}`,
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...options.headers,
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      }),
  };
}

/** One token suite's app, pool, mailbox, and the steps bound to them. */
export interface TokenSuite {
  readonly api: ApiSupport;
  readonly app: RequestableApp;
  /** Closes the app's pool and the suite's own; the last test calls it. */
  close(): Promise<void>;
  readonly databaseUrl: string;
  readonly mail: CapturedVerificationMail;
  /** Registers, verifies, and signs in the owner of a new workspace. */
  register(email: string, workspaceName: string): Promise<SignedInFixture>;
  readonly sql: Sql;
  readonly tokens: TokenSupport;
}

/** Composes the deployment's app over the disposable database. */
export function composeTokenSuite(): TokenSuite {
  const databaseUrl = requireDatabaseUrl();
  const sql = openSql(databaseUrl);
  const mail = new CapturedVerificationMail();
  const configured = createConfiguredApiApp(
    databaseUrl,
    mail,
    browserSecurityPolicy("test", ORIGIN),
  );
  const app = configured.app;
  const api = apiSupport(app, mail, sql);
  return {
    api,
    app,
    close: async () => {
      await configured.close();
      await sql.end();
    },
    databaseUrl,
    mail,
    register: (email, workspaceName) =>
      api.register(email, workspaceName, {
        firstName: "API",
        lastName: "Tester",
      }),
    sql,
    tokens: tokenSupport(app, api),
  };
}
