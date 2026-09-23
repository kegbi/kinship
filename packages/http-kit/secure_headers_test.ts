import { Hono } from "hono";
import { assert, assertEquals } from "../backend/testing/assert.ts";
import {
  API_OWNED_HEADERS,
  apiSecureHeaders,
  GATEWAY_OWNED_HEADERS,
} from "./secure_headers.ts";

async function headers(): Promise<Headers> {
  const app = new Hono();
  app.use(apiSecureHeaders());
  app.get("/thing", (context) => context.json({ ok: true }));
  return (await app.request("http://localhost/thing")).headers;
}

function gatewayHeaderNames(config: string): string[] {
  return [...config.matchAll(/^\s*add_header\s+([^\s;]+)\s+/gm)].flatMap((
    match,
  ) => match[1] === undefined ? [] : [match[1]]);
}

Deno.test("[GAP-019] the API adds no header the gateway already adds", async () => {
  const added = await headers();

  for (const header of GATEWAY_OWNED_HEADERS) {
    assertEquals(
      added.get(header),
      null,
      `${header} belongs to gateway/security_headers.conf; two copies contradict`,
    );
  }
});

Deno.test("[GAP-019] the gateway-owned list still names every gateway header", async () => {
  const config = await Deno.readTextFile(
    new URL("../../gateway/security_headers.conf", import.meta.url),
  );
  const declared = gatewayHeaderNames(config);

  assert(declared.length > 0, "the gateway declares response headers");
  for (const header of declared) {
    assert(
      GATEWAY_OWNED_HEADERS.includes(header),
      `${header} is added by the gateway but not listed as gateway-owned`,
    );
  }
  assertEquals(
    GATEWAY_OWNED_HEADERS.length,
    declared.length,
    "the list names the gateway's headers and nothing else",
  );
});

Deno.test("[GAP-019] the API adds the headers the gateway has no opinion about", async () => {
  const added = await headers();

  for (const header of API_OWNED_HEADERS) {
    assert(
      added.get(header) !== null,
      `${header} is declared as API-owned but was not sent`,
    );
  }
  assertEquals(
    added.get("Cross-Origin-Resource-Policy"),
    "same-origin",
    "an API response is nobody else's subresource",
  );
  assertEquals(
    added.get("X-XSS-Protection"),
    "0",
    "the legacy auditor stays off",
  );
  assertEquals(
    added.get("X-Powered-By"),
    null,
    "the server does not announce itself",
  );
});

Deno.test("[GAP-019] a route's own headers survive the security middleware", async () => {
  const app = new Hono();
  app.use(apiSecureHeaders());
  app.get("/private", (context) => {
    context.header("Cache-Control", "private, no-store");
    return context.json({ ok: true });
  });

  const response = await app.request("http://localhost/private");

  assertEquals(
    response.headers.get("Cache-Control"),
    "private, no-store",
    "the route still owns its caching",
  );
  assert(
    response.headers.get("Content-Type")?.startsWith("application/json"),
    "and its media type",
  );
});
