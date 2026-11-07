/**
 * The cookie that ties a verification to the browser that registered
 * (SECA-01, AUD-A1).
 *
 * Both registration routes — the first workspace and the invitee's own — set
 * it, and only the verification route can read it: the path is that route
 * alone, and like every cookie this API sets it is `HttpOnly`,
 * `SameSite=Strict`, and `Secure` whenever the web origin is HTTPS. The value
 * is a fresh 256-bit secret per registration; identity stores only its
 * digest. A verification that does not carry it still proves the address but
 * asks the owner to choose a password, so a registrant who is not the mailbox
 * owner never keeps the password they chose.
 */

import { setCookie } from "../../../../../http-kit/cookies.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import { VERIFICATION_WINDOW_MS } from "../../public.ts";

/** The registering browser's verifier. */
export const REGISTRANT_COOKIE = "kinship_registrant";
/** The one route that reads it. */
export const REGISTRANT_COOKIE_PATH = "/api/v1/email-verifications";

/** A fresh registrant verifier: 32 random bytes, base64url. */
export function newRegistrantVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/, "");
}

/** The `Set-Cookie` value that stores, or with `""` clears, the verifier. */
export function registrantCookie(
  policy: BrowserSecurityPolicy,
  value: string,
): string {
  return setCookie(policy, {
    maxAgeSeconds: value === "" ? 0 : VERIFICATION_WINDOW_MS / 1_000,
    name: REGISTRANT_COOKIE,
    path: REGISTRANT_COOKIE_PATH,
    value,
  });
}
