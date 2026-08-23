import type { EnvironmentReader } from "../../packages/backend/platform/postgres/config.ts";

export interface ObjectStorageConfiguration {
  readonly accessKey: string;
  readonly bucket: string;
  readonly host: string;
  readonly port: number;
  readonly requestTimeoutMs: number;
  readonly secretKey: string;
  readonly useSsl: boolean;
}

export function resolveObjectStorageConfiguration(
  environment: EnvironmentReader,
): ObjectStorageConfiguration {
  const applicationEnvironment = environment.get("APP_ENV") ?? "development";
  const production = applicationEnvironment === "production";
  const accessKey = environment.get("OBJECT_STORAGE_ACCESS_KEY");
  const secretKey = environment.get("OBJECT_STORAGE_SECRET_KEY");
  const host = environment.get("OBJECT_STORAGE_HOST");
  const bucket = environment.get("OBJECT_STORAGE_BUCKET");
  const localCredentials = accessKey === "kinship" &&
    secretKey === "kinship-local-secret";
  if (
    production &&
    (!accessKey || !secretKey || !host || !bucket || localCredentials)
  ) {
    throw new Error(
      "Explicit non-local OBJECT_STORAGE_ACCESS_KEY, OBJECT_STORAGE_SECRET_KEY, OBJECT_STORAGE_HOST, and OBJECT_STORAGE_BUCKET are required in production.",
    );
  }
  const port = Number(environment.get("OBJECT_STORAGE_PORT") ?? "9000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "OBJECT_STORAGE_PORT must be an integer between 1 and 65535.",
    );
  }
  const ssl = environment.get("OBJECT_STORAGE_USE_SSL") ?? "false";
  if (ssl !== "true" && ssl !== "false") {
    throw new Error("OBJECT_STORAGE_USE_SSL must be true or false.");
  }
  const requestTimeoutMs = Number(
    environment.get("OBJECT_STORAGE_REQUEST_TIMEOUT_MS") ?? "30000",
  );
  if (
    !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 ||
    requestTimeoutMs > 120_000
  ) {
    throw new Error(
      "OBJECT_STORAGE_REQUEST_TIMEOUT_MS must be an integer between 100 and 120000.",
    );
  }
  return {
    accessKey: accessKey ?? "kinship",
    bucket: bucket ?? "attachments",
    host: host ?? "127.0.0.1",
    port,
    requestTimeoutMs,
    secretKey: secretKey ?? "kinship-local-secret",
    useSsl: ssl === "true",
  };
}
