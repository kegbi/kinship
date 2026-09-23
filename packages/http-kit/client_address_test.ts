/**
 * The pin on what counts as a client address.
 *
 * The value this module returns becomes a throttle subject and an audit row,
 * so both halves matter: every address the five hand-written readers accepted
 * is still accepted, and the strings they wrongly accepted are named here as
 * refusals rather than left to be rediscovered.
 */

import { Hono } from "hono";
import { assert, assertEquals } from "../backend/testing/assert.ts";
import {
  CLIENT_ADDRESS_HEADER,
  CLIENT_ADDRESS_MAX_LENGTH,
  clientAddress,
  LOOPBACK_ADDRESS,
  parseClientAddress,
  trustedClientAddress,
} from "./client_address.ts";

const ACCEPTED: readonly string[] = [
  "127.0.0.1",
  "0.0.0.0",
  "255.255.255.255",
  "192.0.2.42",
  "203.0.113.8",
  "127.0.0.10",
  "::",
  "::1",
  "2001:db8::42",
  "2001:0db8:0000:0000:0000:0000:0000:0042",
  "2001:db8:0:0:0:0:0:1",
  "fe80::1",
  "FE80::ABCD",
  "1:2:3:4:5:6:7:8",
  "1:2:3:4:5:6:7::",
  "::ffff:192.0.2.1",
  "1:2:3:4:5:6:1.2.3.4",
];

const REFUSED: readonly string[] = [
  "",
  "not-an-ip",
  "1.2.3",
  "1.2.3.4.5",
  "256.0.0.1",
  "010.0.0.1",
  "1.2.3.-1",
  "...",
  ":::::",
  "1::2::3",
  "1:2:3:4:5:6:7:8:9",
  "12345::1",
  "fe80::1%eth0",
  "fe80::1%25eth0",
  "[::1]",
  "[::1]:8080",
  "1.2.3.4:5678",
  "::ffff:1.2.3.4.5",
  "2001:db8::42 ",
  " 2001:db8::42",
  "::ffff:999.0.2.1",
];

Deno.test("[GAP-020] every address the route files accepted still parses", () => {
  for (const value of ACCEPTED) {
    assertEquals(
      parseClientAddress(value),
      value,
      `${value} is an address and is returned verbatim`,
    );
  }
});

Deno.test("[GAP-020] a zone index, a port, and plain garbage are nobody", () => {
  for (const value of REFUSED) {
    assertEquals(
      parseClientAddress(value),
      undefined,
      `${value} is not an address`,
    );
  }
});

Deno.test("[GAP-020] an address longer than the bound is refused unparsed", () => {
  const longest = "2001:0db8:0000:0000:0000:0000:0000:0042";
  const padded = `${"0".repeat(CLIENT_ADDRESS_MAX_LENGTH)}${longest}`;

  assert(
    longest.length <= CLIENT_ADDRESS_MAX_LENGTH,
    "the longest IPv6 text fits inside the bound",
  );
  assertEquals(
    parseClientAddress(padded),
    undefined,
    "an oversized header is not parsed at all",
  );
  assertEquals(
    parseClientAddress(undefined),
    undefined,
    "an absent header is nobody",
  );
});

Deno.test("[GAP-020] the two readings differ only in what an unknown address is", async () => {
  const app = new Hono();
  app.get("/address", (context) =>
    context.json({
      supplied: clientAddress(context),
      trusted: trustedClientAddress(context) ?? null,
    }));

  const read = async (value?: string) =>
    await (await app.request("http://localhost/address", {
      ...(value ? { headers: { [CLIENT_ADDRESS_HEADER]: value } } : {}),
    })).json() as {
      readonly supplied: string;
      readonly trusted: string | null;
    };

  assertEquals(
    await read("2001:db8::42"),
    { supplied: "2001:db8::42", trusted: "2001:db8::42" },
    "a real address reaches both readings",
  );
  assertEquals(
    await read("not-an-ip"),
    { supplied: LOOPBACK_ADDRESS, trusted: null },
    "an unreadable address is the loopback, or nothing to record",
  );
  assertEquals(
    await read(),
    { supplied: LOOPBACK_ADDRESS, trusted: null },
    "no header at all reads the same way",
  );
});

Deno.test("[GAP-020] a forwarded-for header is never the client address", async () => {
  const app = new Hono();
  app.get("/address", (context) => context.text(clientAddress(context)));

  const response = await app.request("http://localhost/address", {
    headers: { "X-Forwarded-For": "203.0.113.200" },
  });

  assertEquals(
    await response.text(),
    LOOPBACK_ADDRESS,
    "only the gateway's own header is read",
  );
});
