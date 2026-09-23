import type { BrowserSecurityPolicy } from "../../packages/http-kit/security_policy.ts";

export type { BrowserSecurityPolicy };

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "[::1]";
}

export function browserSecurityPolicy(
  environment: string,
  configuredOrigin: string | undefined,
): BrowserSecurityPolicy {
  if (
    environment !== "development" && environment !== "test" &&
    environment !== "production"
  ) {
    throw new Error("APP_ENV must be development, test, or production.");
  }
  if (!configuredOrigin && environment === "production") {
    throw new Error("PUBLIC_WEB_ORIGIN is required in production.");
  }
  const url = new URL(configuredOrigin ?? "http://127.0.0.1:4321");
  if (url.origin !== url.href.replace(/\/$/, "")) {
    throw new Error("PUBLIC_WEB_ORIGIN must contain only an origin.");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopback(url.hostname))
  ) {
    throw new Error("PUBLIC_WEB_ORIGIN must use HTTPS outside loopback.");
  }
  if (environment === "production" && url.protocol !== "https:") {
    throw new Error("Production PUBLIC_WEB_ORIGIN must use HTTPS.");
  }
  return { origin: url.origin, secureCookie: url.protocol === "https:" };
}
