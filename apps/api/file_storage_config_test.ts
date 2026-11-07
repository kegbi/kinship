/**
 * Object-storage configuration, which moved out of the files route suite when
 * the routes moved into the files module (GAP-024): what the deployment reads
 * from its environment stays with the deployable.
 */

import { resolveObjectStorageConfiguration } from "./file_storage_config.ts";
import { assert } from "../../packages/backend/testing/assert.ts";

Deno.test("[FILES-001] production object storage fails closed without credentials", () => {
  const values = new Map<string, string>([["APP_ENV", "production"]]);
  let failure: unknown;
  try {
    resolveObjectStorageConfiguration({ get: (key) => values.get(key) });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error &&
      failure.message.includes("required in production"),
    "production has no credential fallbacks",
  );

  values.set("OBJECT_STORAGE_ACCESS_KEY", "kinship");
  values.set("OBJECT_STORAGE_SECRET_KEY", "kinship-local-secret");
  values.set("OBJECT_STORAGE_HOST", "objects.internal");
  values.set("OBJECT_STORAGE_BUCKET", "private-files");
  failure = undefined;
  try {
    resolveObjectStorageConfiguration({ get: (key) => values.get(key) });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error,
    "production rejects known local credentials",
  );

  values.set("OBJECT_STORAGE_ACCESS_KEY", "access");
  values.set("OBJECT_STORAGE_SECRET_KEY", "secret-value");
  values.set("OBJECT_STORAGE_HOST", "objects.internal");
  values.set("OBJECT_STORAGE_BUCKET", "private-files");
  const configured = resolveObjectStorageConfiguration({
    get: (key) => values.get(key),
  });
  assert(
    configured.host === "objects.internal" && configured.useSsl === false &&
      configured.requestTimeoutMs === 30_000,
    "explicit production configuration resolves",
  );

  for (
    const [key, value] of [
      ["OBJECT_STORAGE_PORT", "0"],
      ["OBJECT_STORAGE_USE_SSL", "sometimes"],
      ["OBJECT_STORAGE_REQUEST_TIMEOUT_MS", "99"],
      ["OBJECT_STORAGE_REQUEST_TIMEOUT_MS", "120001"],
    ] as const
  ) {
    values.set(key, value);
    let invalid: unknown;
    try {
      resolveObjectStorageConfiguration({ get: (name) => values.get(name) });
    } catch (error) {
      invalid = error;
    }
    assert(invalid instanceof Error, `${key} is validated`);
    values.delete(key);
  }
});

Deno.test("[AUD-K6] object storage without APP_ENV takes no local defaults", () => {
  for (const unset of [undefined, ""]) {
    let failure: unknown;
    try {
      resolveObjectStorageConfiguration({
        get: (name) => name === "APP_ENV" ? unset : undefined,
      });
    } catch (error) {
      failure = error;
    }
    assert(
      failure instanceof Error &&
        failure.message.includes("required in production"),
      `APP_ENV=${JSON.stringify(unset)} resolves as production`,
    );
  }
});
