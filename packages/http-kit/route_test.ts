import { Hono } from "hono";
import { z } from "zod";
import {
  defineRoute,
  isJsonMediaType,
  takesJsonBody,
} from "../contracts/registry.ts";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../backend/testing/assert.ts";
import { mount } from "./route.ts";

const jsonRoute = defineRoute({
  method: "post",
  path: "/things",
  operationId: "createThing",
  request: {
    body: {
      required: false,
      content: { "application/json": z.object({ name: z.string() }) },
    },
  },
  responses: { 201: { description: "Created" } },
});

const uploadRoute = defineRoute({
  method: "put",
  path: "/things/content",
  operationId: "uploadThing",
  request: {
    body: { required: true, content: { "image/png": z.string() } },
  },
  responses: { 204: { description: "Stored" } },
});

function app(): Hono {
  const routes = new Hono();
  mount(
    routes,
    jsonRoute,
    (context) => Promise.resolve(context.body(null, 201)),
  );
  mount(
    routes,
    uploadRoute,
    (context) => Promise.resolve(context.body(null, 204)),
  );
  return routes;
}

Deno.test("[AUD-K1] only JSON media types are JSON", () => {
  assert(
    isJsonMediaType("application/json"),
    "isJsonMediaType('application/json'",
  );
  assert(
    isJsonMediaType("Application/JSON; charset=utf-8"),
    "isJsonMediaType('Application/JSON; charset=utf-8'",
  );
  assert(
    isJsonMediaType("application/merge-patch+json"),
    "isJsonMediaType('application/merge-patch+json'",
  );
  assert(!isJsonMediaType("text/plain"), "!isJsonMediaType('text/plain'");
  assert(
    !isJsonMediaType("application/jsonp"),
    "!isJsonMediaType('application/jsonp'",
  );
  assert(!isJsonMediaType(undefined), "!isJsonMediaType(undefined");
  assert(takesJsonBody(jsonRoute), "a JSON body is JSON");
  assert(!takesJsonBody(uploadRoute), "an upload is not");
});

Deno.test("[AUD-K1] a JSON route answers 415 to a body of another media type", async () => {
  const send = (headers: Record<string, string>, body?: string) =>
    app().request("http://localhost/things", {
      method: "POST",
      headers,
      ...(body === undefined ? {} : { body }),
    });

  const plain = await send({ "content-type": "text/plain" }, "{}");
  assertStatus(plain, 415, "text/plain is refused");
  assertEquals(
    (await plain.json() as { readonly code: string }).code,
    "unsupported_media_type",
  );
  assertStatus(
    await send({ "content-type": "application/json" }, "{}"),
    201,
    "JSON is admitted",
  );
  assertStatus(await send({}), 201, "no body is left to the route");
  assertStatus(
    await send({ "content-length": "0" }, ""),
    201,
    "an empty body is left to the route",
  );
  assertStatus(
    await app().request("http://localhost/things/content", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: "png",
    }),
    204,
    "a route that takes another media type is not asked for JSON",
  );
});
