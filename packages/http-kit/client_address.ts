/**
 * The address a request came from, as the gateway reports it.
 *
 * Nothing behind this API may trust a socket address: the gateway terminates
 * TLS and sets `X-Kinship-Client-Address` from `$remote_addr`, and that one
 * header is the only thing read here. `X-Forwarded-For` is deliberately not
 * read — it is a list any client may extend, and the governance suite proves a
 * value supplied there never reaches an audit row.
 *
 * Five route files each decided for themselves what an address is. Four tested
 * `/^[0-9A-Fa-f:.]+$/`, which accepts `1.2.3.4.5`, `:::::`, and `...`; one
 * asked `node:net`. Both answers went into a throttle key and an audit row, so
 * the loose ones let a caller mint as many distinct throttle subjects as they
 * liked out of strings that are not addresses at all. The parser below is the
 * strict reading of RFC 4291 and dotted-quad IPv4, and it is the only one now.
 *
 * What it refuses is as much of the contract as what it accepts: a zone index
 * (`fe80::1%eth0`) names an interface on the host that wrote it and means
 * nothing to a peer, a bracketed or port-suffixed form (`[::1]:8080`,
 * `1.2.3.4:5678`) is an authority rather than an address, and a leading zero
 * (`010.0.0.1`) has read as octal often enough to be worth refusing outright.
 * Each of those is nobody, which the two callers answer differently:
 * `clientAddress` substitutes the loopback address the throttle already used
 * for an absent header, and `trustedClientAddress` records nothing at all.
 */

import type { Context } from "hono";

/** The header the gateway puts the peer's address in. */
export const CLIENT_ADDRESS_HEADER = "X-Kinship-Client-Address";

/** What an unreadable or absent address counts as. */
export const LOOPBACK_ADDRESS = "127.0.0.1";

/**
 * The longest address worth parsing.
 *
 * The longest legal IPv6 text is 45 characters; the bound the route files
 * already applied is 64, and it is kept so a header that was accepted before
 * is still accepted now.
 */
export const CLIENT_ADDRESS_MAX_LENGTH = 64;

/** The eight groups of an IPv6 address, and the four bytes of an IPv4 one. */
const IPV6_GROUPS = 8;
const IPV4_OCTETS = 4;

/** One decimal octet: 0-255, and never written with a leading zero. */
function octet(value: string): boolean {
  if (value.length === 0 || value.length > 3) return false;
  if (value.length > 1 && value.startsWith("0")) return false;
  for (const character of value) {
    if (character < "0" || character > "9") return false;
  }
  return Number(value) <= 255;
}

/** Whether this is a dotted-quad IPv4 address and nothing else. */
export function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === IPV4_OCTETS && parts.every(octet);
}

/** One IPv6 group: one to four hexadecimal digits. */
function group(value: string): boolean {
  if (value.length === 0 || value.length > 4) return false;
  for (const character of value) {
    const lowered = character.toLowerCase();
    const digit = lowered >= "0" && lowered <= "9";
    const hex = lowered >= "a" && lowered <= "f";
    if (!digit && !hex) return false;
  }
  return true;
}

/**
 * How many groups a run of text is worth.
 *
 * Every run is groups separated by `:`, except that the last run of a
 * v4-mapped address ends in a dotted quad, which is worth two groups.
 */
function groupsIn(run: string, mayEndInIpv4: boolean): number | undefined {
  if (run.length === 0) return 0;
  const parts = run.split(":");
  let counted = 0;
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1;
    if (last && mayEndInIpv4 && part.includes(".")) {
      if (!isIpv4(part)) return undefined;
      counted += 2;
      continue;
    }
    if (!group(part)) return undefined;
    counted += 1;
  }
  return counted;
}

/** Whether this is an IPv6 address, compressed or not, and nothing else. */
export function isIpv6(value: string): boolean {
  const compressed = value.split("::");
  if (compressed.length > 2) return false;
  if (compressed.length === 1) {
    return groupsIn(value, true) === IPV6_GROUPS;
  }
  const [head = "", tail = ""] = compressed;
  const before = groupsIn(head, false);
  const after = groupsIn(tail, true);
  if (before === undefined || after === undefined) return false;
  return before + after < IPV6_GROUPS;
}

/**
 * The address this text names, or nothing.
 *
 * The value is returned exactly as it arrived rather than in a canonical form:
 * a throttle subject and an audit row both read better as what the gateway
 * actually reported.
 */
export function parseClientAddress(
  value: string | undefined,
): string | undefined {
  if (!value || value.length > CLIENT_ADDRESS_MAX_LENGTH) return undefined;
  return isIpv4(value) || isIpv6(value) ? value : undefined;
}

/** The address behind this request, or the loopback address. */
export function clientAddress(context: Context): string {
  return parseClientAddress(context.req.header(CLIENT_ADDRESS_HEADER)) ??
    LOOPBACK_ADDRESS;
}

/** The address behind this request, or nothing worth recording. */
export function trustedClientAddress(context: Context): string | undefined {
  return parseClientAddress(context.req.header(CLIENT_ADDRESS_HEADER));
}
