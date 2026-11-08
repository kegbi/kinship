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

import type { BrowserSecurityPolicy } from "./security_policy.ts";

/** Reads one cookie out of a raw `Cookie` header. */
export function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  return cookieValues(header, name)[0];
}

/** Every value a raw `Cookie` header carries under one name, in order. */
function cookieValues(header: string | undefined, name: string): string[] {
  return (header?.split(";") ?? []).map((value) => value.trim()).filter((
    value,
  ) => value.startsWith(`${name}=`)).map((value) =>
    value.slice(name.length + 1)
  );
}

/**
 * The cookie the browser carries a protected session in (SECA-09).
 *
 * Over HTTPS it is `__Host-kinship_session`: the browser accepts that name
 * only from this exact host, `Secure`, on `Path=/`, and without `Domain`, so a
 * sibling subdomain cannot plant one beside it. A loopback deployment over
 * plain HTTP cannot set a `Secure` cookie, so it keeps `kinship_session`.
 * Nothing reads the unprefixed name over HTTPS: the release that introduced
 * the prefix signed every browser out once (AUD-K4), which a session's
 * 12-hour lifetime bounded anyway.
 */
export function sessionCookieName(policy: BrowserSecurityPolicy): string {
  return policy.secureCookie ? "__Host-kinship_session" : "kinship_session";
}

/**
 * The session token a raw `Cookie` header carries, or nothing.
 *
 * More than one session cookie is nothing too (SECA-09): which of two is the
 * browser's own cannot be known, and taking the first let a planted cookie
 * shadow the real one.
 */
export function sessionToken(
  header: string | undefined,
  policy: BrowserSecurityPolicy,
): string | undefined {
  const values = cookieValues(header, sessionCookieName(policy));
  return values.length === 1 ? values[0] || undefined : undefined;
}

/** Whether a raw `Cookie` header carries more than one session cookie. */
export function sessionCookieDuplicated(
  header: string | undefined,
  policy: BrowserSecurityPolicy,
): boolean {
  return cookieValues(header, sessionCookieName(policy)).length > 1;
}

/** The `Set-Cookie` value that carries a session token for its lifetime. */
export function sessionCookie(
  policy: BrowserSecurityPolicy,
  value: string,
  maxAgeSeconds: number,
): string {
  return setCookie(policy, {
    maxAgeSeconds,
    name: sessionCookieName(policy),
    path: "/",
    value,
  });
}

/** The `Set-Cookie` value that removes the session cookie. */
export function expiredSessionCookie(policy: BrowserSecurityPolicy): string {
  return sessionCookie(policy, "", 0);
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
