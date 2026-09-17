/**
 * Cookie reading and writing, in the one spelling the API already used.
 *
 * Seventeen route files carried the same four-line `cookieValue()`; the
 * `Set-Cookie` composer existed once, inside `invitations.ts`, and the flows
 * that need it are spread across three more files. Both live here now, and
 * both keep the behaviour their originals had: `cookieValue` splits on `;`,
 * trims, and returns the first match's value verbatim, and the composer emits
 * the attributes in the order the invitation cookies already emitted them.
 */

import type { BrowserSecurityPolicy } from "../security_config.ts";

/** The cookie the browser carries a protected session in. */
export const SESSION_COOKIE = "kinship_session";

/** Reads one cookie out of a raw `Cookie` header. */
export function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

/** What a cookie this API sets always is: the parts a caller chooses. */
export interface CookieAttributes {
  /** Seconds from now; a non-positive value expires the cookie. */
  readonly maxAgeSeconds: number;
  readonly name: string;
  readonly path: string;
  readonly value: string;
}

/**
 * Composes one `Set-Cookie` value.
 *
 * Every cookie this API sets is `HttpOnly` and `SameSite=Strict`, and is
 * `Secure` exactly when the configured browser origin is HTTPS — the three
 * decisions no caller may take on its own.
 */
export function setCookie(
  policy: BrowserSecurityPolicy,
  attributes: CookieAttributes,
): string {
  return [
    `${attributes.name}=${attributes.value}`,
    "HttpOnly",
    "SameSite=Strict",
    policy.secureCookie ? "Secure" : undefined,
    `Max-Age=${Math.max(0, Math.floor(attributes.maxAgeSeconds))}`,
    `Path=${attributes.path}`,
  ].filter(Boolean).join("; ");
}
