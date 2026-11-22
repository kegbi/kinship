/**
 * The one definition of "a UUID" for the web app.
 *
 * Every RFC 9562 version, 1 through 8, with the RFC variant, in either case —
 * what the API's `z.uuid()` and the backend's `isUuid` accept, without the
 * nil and max sentinels no record carries. Version 8 matters: a person a DAV
 * sync or a retry-safe create made, and a journal post created with a
 * `requestId`, carry the identifier the backend derives, and a page that only
 * knew versions 1 to 5 called such a record not found (MCP-R3).
 *
 * `UUID_SOURCE` is unanchored so a route pattern can embed it.
 */
export const UUID_SOURCE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

const UUID = new RegExp(`^${UUID_SOURCE}$`);

/** True when `value` is a UUID of any RFC 9562 version. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
