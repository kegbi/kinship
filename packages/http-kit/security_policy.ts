/**
 * The browser-facing security facts every route is built against.
 *
 * The kit and the module routes read this shape and nothing else: the one
 * origin a browser write may come from, and whether cookies are marked
 * `Secure`. Deciding those values from `APP_ENV` and `PUBLIC_WEB_ORIGIN` is
 * configuration, and stays with the deployable in `apps/api/security_config.ts`.
 */
export interface BrowserSecurityPolicy {
  readonly origin: string;
  readonly secureCookie: boolean;
}
