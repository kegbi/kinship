import { execFileSync } from "node:child_process";

/*
 * Direct PostgreSQL access for E2E setup and assertions that the product API
 * deliberately does not expose: seeding a second workspace, suspending a
 * membership, or reading an audit row. Every call runs `psql` inside the test
 * Compose project's `postgres` service.
 */

/** The test Compose project's `docker compose` file arguments. */
export const composeArgs = [
  "compose",
  "--file",
  "compose.yaml",
  "--file",
  "compose.test.yaml",
] as const;

/**
 * Runs `operation` up to three times, 250 ms apart, so a transient
 * `docker compose exec` failure does not fail the spec.
 */
export function withExecRetry<T>(operation: () => T): T {
  for (let attempt = 1;; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

/** Quotes `value` as a PostgreSQL string literal. */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Executes `statement` and discards its output. */
export function databaseSql(statement: string): void {
  withExecRetry(() =>
    execFileSync("docker", [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.POSTGRES_USER ?? "kinship_e2e",
      "-d",
      process.env.POSTGRES_DB ?? "kinship_e2e",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ], { cwd: process.cwd(), env: process.env, stdio: "pipe" })
  );
}

/**
 * Executes `statement` and returns its trimmed output: psql's aligned table
 * by default, or bare tuples (`-At`) when `tuples` is set. psql runs with
 * `ON_ERROR_STOP` unless `onErrorStop` is false.
 */
export function database(
  statement: string,
  tuples = false,
  { onErrorStop = true }: { readonly onErrorStop?: boolean } = {},
): string {
  return withExecRetry(() =>
    execFileSync("docker", [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.POSTGRES_USER ?? "kinship_e2e",
      "-d",
      process.env.POSTGRES_DB ?? "kinship_e2e",
      ...(tuples ? ["-At"] : []),
      ...(onErrorStop ? ["-v", "ON_ERROR_STOP=1"] : []),
      "-c",
      statement,
    ], { cwd: process.cwd(), encoding: "utf8", env: process.env })
  ).trim();
}

/** Executes `statement` and returns its bare, trimmed tuples (`-At`). */
export function databaseValue(statement: string): string {
  return database(statement, true);
}
