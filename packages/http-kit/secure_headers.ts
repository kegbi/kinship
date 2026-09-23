/**
 * The browser security headers the API owns, and the ones it must not.
 *
 * `gateway/security_headers.conf` is added at the nginx `server` level, so it
 * applies to `/api/v1/` too, and that location declares no `proxy_hide_header`
 * of its own. Anything the API sets with one of those six names therefore
 * reaches the browser *beside* the gateway's copy, not instead of it — and two
 * `X-Frame-Options` that disagree, or an upstream `Strict-Transport-Security`
 * that wins because it arrives first and is weaker, is worse than sending
 * nothing. So the rule here is exact: the API never emits a header the gateway
 * emits.
 *
 * What is left is the set the gateway has no opinion about, and it matters on
 * its own, because the gateway is not the only way in — in development the
 * browser reaches the API through the Astro proxy with no nginx anywhere.
 */

import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

/**
 * The headers `gateway/security_headers.conf` adds.
 *
 * `packages/http-kit/secure_headers_test.ts` reads that file and proves this list
 * still names every one of them, so a header added to the gateway cannot start
 * being duplicated here unnoticed.
 */
export const GATEWAY_OWNED_HEADERS: readonly string[] = [
  "Content-Security-Policy",
  "Permissions-Policy",
  "Referrer-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
];

/** The headers this middleware adds, and what each is worth to a JSON API. */
export const API_OWNED_HEADERS: readonly string[] = [
  // An API response is never a legitimate subresource of another site.
  "Cross-Origin-Resource-Policy",
  // Nothing here is a document, so no other origin shares its browsing group.
  "Cross-Origin-Opener-Policy",
  "Origin-Agent-Cluster",
  "X-DNS-Prefetch-Control",
  "X-Download-Options",
  "X-Permitted-Cross-Domain-Policies",
  // Explicitly off: the legacy auditor is a vulnerability, not a defence.
  "X-XSS-Protection",
];

/** The security headers the API adds to every response it owns. */
export function apiSecureHeaders(): MiddlewareHandler {
  return secureHeaders({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: true,
    originAgentCluster: true,
    referrerPolicy: false,
    removePoweredBy: true,
    strictTransportSecurity: false,
    xContentTypeOptions: false,
    xDnsPrefetchControl: true,
    xDownloadOptions: true,
    xFrameOptions: false,
    xPermittedCrossDomainPolicies: true,
    xXssProtection: true,
  });
}
