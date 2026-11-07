/**
 * The keysets a deployment supplies, and the key material it must not supply.
 *
 * Development falls back to fixed local keysets so a developer's data survives
 * a restart, and `compose.test.yaml` publishes fixed test keysets. Both are
 * repository constants that anyone can read, so production refuses any keyset
 * holding one of them, active or retained for decryption (AUD-K6). The check
 * is generic over every configured keyset: a new secret joins it by taking its
 * local fallback from `localKeyset` and listing its published fill here.
 */
import type { ApplicationEnvironment } from "../../packages/backend/platform/application_environment.ts";

/** What every configured keyset shares: its keys, by id or version. */
export interface ConfiguredKeyset {
  readonly keys: ReadonlyMap<unknown, Uint8Array>;
}

const KEY_BYTES = 32;

/**
 * The byte each repository-published key repeats: `compose.test.yaml`'s MFA
 * key (0x00), the local MFA fallback (0x4b), the local and test throttle
 * subject key (0x52), and the local and test DAV key (0x69).
 */
export const REPOSITORY_KEY_FILLS = {
  testMfa: 0x00,
  mfa: 0x4b,
  subject: 0x52,
  dav: 0x69,
} as const;

const DENIED_FILLS: readonly number[] = Object.values(REPOSITORY_KEY_FILLS);

/** Whether `key` is one the repository publishes. */
export function isRepositoryKey(key: Uint8Array): boolean {
  return key.length === KEY_BYTES &&
    DENIED_FILLS.some((fill) => key.every((byte) => byte === fill));
}

/** Refuses a keyset that holds any repository-published key. */
export function assertNoRepositoryKeys(
  name: string,
  keyset: ConfiguredKeyset,
): void {
  for (const key of keyset.keys.values()) {
    if (isRepositoryKey(key)) {
      throw new Error(
        `${name} holds key material published in the repository; production needs privately generated keys.`,
      );
    }
  }
}

/** A development keyset of one fixed key, under the local key id. */
export function localKeyset(fill: number) {
  return () => ({
    activeKeyId: "local-development",
    keys: new Map([[
      "local-development",
      new Uint8Array(KEY_BYTES).fill(fill),
    ]]),
  });
}

/** The development throttle-subject keyset, which is versioned. */
export function localSubjectKeyset() {
  return {
    activeVersion: 1,
    keys: new Map([
      [1, new Uint8Array(KEY_BYTES).fill(REPOSITORY_KEY_FILLS.subject)],
    ]),
  };
}

/**
 * A keyset the deployment must supply in production and may default locally.
 * Production refuses a missing required keyset and any keyset that holds a
 * repository constant.
 */
export function configuredKeyset<Keyset extends ConfiguredKeyset>(
  environment: ApplicationEnvironment,
  name: string,
  override: Keyset | undefined,
  local: () => Keyset,
  required = true,
): Keyset {
  if (override) {
    if (environment === "production") assertNoRepositoryKeys(name, override);
    return override;
  }
  if (required && environment === "production") {
    throw new Error(`${name} is required in production.`);
  }
  return local();
}
