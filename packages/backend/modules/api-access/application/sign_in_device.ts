/**
 * The sign-in device token (AUD-A3).
 *
 * A browser that has signed in to an account with its password carries this
 * token back to the sign-in route, and the throttle then exempts that browser
 * from the per-account ceiling for that account. The per-address limit still
 * applies. So an attacker who keeps the account behind its ceiling never locks
 * out an owner signing in from a browser they have used before.
 *
 * The token is stateless: `v<key version>.<expiry, epoch seconds>.<mac>`,
 * where the mac is HMAC-SHA256 under the device keyset over the expiry and the
 * account's pseudonymous subject digest. It names neither the account nor the
 * address, it is not a session and proves nothing beyond "this browser signed
 * in to this account before", and anything that fails to verify, belongs to
 * another account, or has expired is treated exactly as no token.
 */

import type {
  AuthenticationSubjectDigester,
  AuthenticationSubjectKeyset,
} from "./authentication_subject.ts";

/** How long a device token exempts its browser: thirty days. */
export const SIGN_IN_DEVICE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const TOKEN = /^v([1-9][0-9]{0,8})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - value.length % 4) % 4),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function signed(
  expiresAtSeconds: number,
  digest: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `kinship.sign-in-device.v1\n${expiresAtSeconds}\n${digest}`,
  );
}

/**
 * One secret, one purpose: the device keyset never repeats a throttle-subject
 * key. Boot and the release preflight both refuse a keyset that does.
 */
export function assertDistinctSignInDeviceKeys(
  deviceKeyset: AuthenticationSubjectKeyset,
  subjectKeyset: AuthenticationSubjectKeyset,
): void {
  const subjectKeys = [...subjectKeyset.keys.values()].map((key) =>
    key.join(",")
  );
  for (const key of deviceKeyset.keys.values()) {
    if (subjectKeys.includes(key.join(","))) {
      throw new Error(
        "AUTH_SIGN_IN_DEVICE_KEYSET must not reuse an AUTH_THROTTLE_SUBJECT_KEYSET key.",
      );
    }
  }
}

export class SignInDeviceTokens {
  readonly #keys = new Map<number, Promise<CryptoKey>>();

  constructor(
    private readonly keyset: AuthenticationSubjectKeyset,
    private readonly digester: AuthenticationSubjectDigester,
  ) {}

  /** A fresh token for a browser that just proved the account's password. */
  async issue(command: {
    readonly issuedAt: Date;
    readonly subject: string;
  }): Promise<{
    readonly expiresAt: Date;
    readonly maxAgeSeconds: number;
    readonly token: string;
  }> {
    const [digest] = await this.digester.digestCandidates(
      "password",
      command.subject,
    );
    if (!digest) throw new Error("Authentication subject digest missing.");
    const expiresAtSeconds = Math.floor(command.issuedAt.getTime() / 1_000) +
      SIGN_IN_DEVICE_LIFETIME_SECONDS;
    const version = this.keyset.activeVersion;
    const mac = await crypto.subtle.sign(
      "HMAC",
      await this.#key(version),
      signed(expiresAtSeconds, digest),
    );
    return {
      expiresAt: new Date(expiresAtSeconds * 1_000),
      maxAgeSeconds: SIGN_IN_DEVICE_LIFETIME_SECONDS,
      token: `v${version}.${expiresAtSeconds}.${
        base64Url(new Uint8Array(mac))
      }`,
    };
  }

  /**
   * Whether `token` is a live device token for the subject whose retained
   * digests are `digests`. Never throws on what a client sent.
   */
  async recognizes(command: {
    readonly at: Date;
    readonly digests: readonly string[];
    readonly token: string | undefined;
  }): Promise<boolean> {
    const match = command.token ? TOKEN.exec(command.token) : null;
    if (!match) return false;
    const version = Number(match[1]);
    const expiresAtSeconds = Number(match[2]);
    const now = command.at.getTime();
    if (
      !this.keyset.keys.has(version) ||
      expiresAtSeconds * 1_000 <= now ||
      expiresAtSeconds * 1_000 > now + SIGN_IN_DEVICE_LIFETIME_SECONDS * 1_000
    ) {
      return false;
    }
    const mac = fromBase64Url(match[3]!);
    const key = await this.#key(version);
    for (const digest of command.digests) {
      if (
        await crypto.subtle.verify(
          "HMAC",
          key,
          mac,
          signed(expiresAtSeconds, digest),
        )
      ) {
        return true;
      }
    }
    return false;
  }

  #key(version: number): Promise<CryptoKey> {
    let key = this.#keys.get(version);
    if (!key) {
      const bytes = this.keyset.keys.get(version);
      if (!bytes) throw new Error("Sign-in device key disappeared.");
      key = crypto.subtle.importKey(
        "raw",
        new Uint8Array(bytes).buffer,
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["sign", "verify"],
      );
      this.#keys.set(version, key);
    }
    return key;
  }
}
