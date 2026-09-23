import { Hono } from "hono";
import { assert, assertEquals } from "../backend/testing/assert.ts";
import {
  acceptableRequestId,
  REQUEST_ID_HEADER,
  requestId,
  type RequestIdEnv,
  requestIdOf,
} from "./request_id.ts";

function tracked(generate?: () => string): Hono<RequestIdEnv> {
  const app = new Hono<RequestIdEnv>();
  app.use(requestId(generate ? { generate } : {}));
  app.get("/thing", (context) => context.json({ seen: requestIdOf(context) }));
  return app;
}

Deno.test("[GAP-019] a supplied identifier is echoed and handed to the route", async () => {
  const response = await tracked().request("http://localhost/thing", {
    headers: { [REQUEST_ID_HEADER]: "gateway-7f3a" },
  });

  assertEquals(
    response.headers.get(REQUEST_ID_HEADER),
    "gateway-7f3a",
    "the caller's identifier comes back",
  );
  assertEquals(
    ((await response.json()) as { readonly seen: string }).seen,
    "gateway-7f3a",
    "and the route sees the same one",
  );
});

Deno.test("[GAP-019] an absent identifier is minted", async () => {
  const response = await tracked(() => "minted-1").request(
    "http://localhost/thing",
  );

  assertEquals(
    response.headers.get(REQUEST_ID_HEADER),
    "minted-1",
    "the middleware supplies one",
  );
});

Deno.test("[GAP-019] an identifier that is not one is replaced, never echoed", async () => {
  for (
    const supplied of [
      "has space",
      "semi;colon",
      'quo"ted',
      "",
      "x".repeat(129),
    ]
  ) {
    const response = await tracked(() => "minted-1").request(
      "http://localhost/thing",
      { headers: { [REQUEST_ID_HEADER]: supplied } },
    );

    assertEquals(
      response.headers.get(REQUEST_ID_HEADER),
      "minted-1",
      `${JSON.stringify(supplied)} is replaced`,
    );
  }
  assert(
    acceptableRequestId("a-B_9") && !acceptableRequestId(undefined) &&
      !acceptableRequestId("carriage\r\nreturn"),
    "the shape rule is what the middleware applies, header splitting included",
  );
});

Deno.test("[GAP-019] the minted identifier is unique per request", async () => {
  const app = tracked();
  const first = await app.request("http://localhost/thing");
  const second = await app.request("http://localhost/thing");

  assert(
    first.headers.get(REQUEST_ID_HEADER) !==
      second.headers.get(REQUEST_ID_HEADER),
    "two requests are told apart",
  );
});
