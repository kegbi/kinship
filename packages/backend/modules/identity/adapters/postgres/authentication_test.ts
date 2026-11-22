import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";
import { assertEquals } from "../../../../testing/assert.ts";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type { PasswordHasher } from "../../ports/security.ts";
import type { SecureTokenService } from "../crypto/secure_tokens.ts";
import type { AesGcmMfaSecretBox } from "../crypto/totp.ts";
import { PostgresIdentityAuthentication } from "./authentication.ts";

const NIL = "00000000-0000-0000-0000-000000000000";

/** The user id each audit lookup bound, read from the compiled queries. */
async function boundUserIds(subjects: readonly string[]): Promise<string[]> {
  const queries: CompiledQuery[] = [];
  class Driver extends DummyDriver {
    override async acquireConnection(): Promise<DatabaseConnection> {
      const connection = await super.acquireConnection();
      return {
        ...connection,
        streamQuery: connection.streamQuery.bind(connection),
        executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
          queries.push(query);
          return Promise.resolve({ rows: [] as R[] });
        },
      };
    }
  }
  const database = new Kysely<ApplicationDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new Driver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const hasher = {
    hash: () => Promise.resolve("hash"),
  } as unknown as PasswordHasher;
  const authentication = new PostgresIdentityAuthentication(
    database,
    hasher,
    {} as SecureTokenService,
    {} as AesGcmMfaSecretBox,
    { now: () => new Date("2026-11-22T00:00:00.000Z") },
    { create: () => crypto.randomUUID() },
  );
  for (const subject of subjects) {
    await authentication.resolveAuthenticationAuditUser({
      scope: "mfa",
      subject,
    });
  }
  return queries.map((query) =>
    String(
      query.parameters.find((parameter) =>
        typeof parameter === "string" && /^[0-9a-f-]{36}$/i.test(parameter)
      ),
    )
  );
}

Deno.test("[MCP-R3] an MFA audit subject of any UUID version names its user", async () => {
  const random = "6f1c8f0e-2b1a-4c3d-9e8f-0a1b2c3d4e5f";
  const derived = "8e5213b9-8cee-8024-8aed-45319d1b7d1b";
  const timeOrdered = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f";
  assertEquals(
    await boundUserIds([
      `user:${random}`,
      `user:${derived}`,
      `user:${timeOrdered}`,
      "user:not-a-uuid",
      `user:${NIL}`,
    ]),
    [random, derived, timeOrdered, NIL, NIL],
    "a well-formed id is looked up and anything else matches nobody",
  );
});
