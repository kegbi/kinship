import type { EnvironmentReader } from "./postgres/config.ts";

export type ApplicationEnvironment = "development" | "test" | "production";

/**
 * The deployment's `APP_ENV`, read the one way every process reads it.
 *
 * Configuration fails closed (AUD-K6): an unset or empty `APP_ENV` is
 * production, so a deployment that loses the variable gets production's
 * refusals rather than development's public defaults. Development and test
 * are opted into by name, and any other value refuses to start.
 */
export function resolveApplicationEnvironment(
  environment: EnvironmentReader,
): ApplicationEnvironment {
  const value = environment.get("APP_ENV") || "production";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error("APP_ENV must be development, test, or production.");
  }
  return value;
}
