import { Hono } from "hono";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../backend/testing/assert.ts";
import {
  matchingOrigin,
  ORIGIN_INVALID,
  rejectForeignOrigin,
  requireCookieWriteOrigin,
  requireMatchingOrigin,
  UNSAFE_METHODS,
} from "./origin.ts";

const policy = { origin: "https://app.test", secureCookie: true };

function guarded(): Hono {
  const app = new Hono();
  app.use(requireMatchingOrigin(policy));
  app.all("/thing", (context) => context.json({ reached: true }));
  return app;
}

Deno.test("[GAP-019] a write without the configured origin is refused", async () => {
  const app = guarded();

  for (const method of [...UNSAFE_METHODS]) {
    const foreign = await app.request("http://localhost/thing", {
      headers: { Origin: "https://attacker.test" },
      method,
    });
    const silent = await app.request("http://localhost/thing", { method });
    const body = await foreign.json() as { readonly code: string };

    assertStatus(foreign, 403, `${method} from a foreign origin`);
    assertStatus(silent, 403, `${method} with no Origin at all`);
    assertEquals(body.code, "origin_invalid", `${method} names the refusal`);
  }
});

Deno.test("[GAP-019] a write from the configured origin reaches the route", async () => {
  const response = await guarded().request("http://localhost/thing", {
    headers: { Origin: policy.origin },
    method: "POST",
  });

  assertStatus(response, 200);
  assert(
    ((await response.json()) as { readonly reached: boolean }).reached,
    "the handler ran",
  );
});

Deno.test("[GAP-019] a read is not asked for an origin", async () => {
  const read = await guarded().request("http://localhost/thing");
  const head = await guarded().request("http://localhost/thing", {
    method: "HEAD",
  });

  assertStatus(read, 200, "GET is untouched");
  assertStatus(head, 200, "HEAD is untouched");
});

Deno.test("[GAP-019] the inline check answers the same 403 the middleware does", async () => {
  const app = new Hono();
  app.post("/thing", (context) => {
    const refused = rejectForeignOrigin(context, policy);
    return refused ?? context.json({ reached: true });
  });
  app.post(
    "/asked",
    (context) => context.json({ matching: matchingOrigin(context, policy) }),
  );

  const refused = await app.request("http://localhost/thing", {
    headers: { Origin: "https://attacker.test" },
    method: "POST",
  });
  const allowed = await app.request("http://localhost/thing", {
    headers: { Origin: policy.origin },
    method: "POST",
  });
  const asked = await app.request("http://localhost/asked", {
    headers: { Origin: policy.origin },
    method: "POST",
  });

  assertStatus(refused, 403);
  assertStatus(allowed, 200);
  assertEquals(
    (await refused.json() as { readonly detail: string }).detail,
    ORIGIN_INVALID.detail,
    "the inline refusal carries the shared prose",
  );
  assert(
    (await asked.json() as { readonly matching: boolean }).matching,
    "the predicate agrees with the responder",
  );
});

Deno.test("[MCP-B2] the cookie-write check leaves a bearer write to its token admission", async () => {
  const app = new Hono();
  app.use(requireCookieWriteOrigin(policy));
  app.all("/thing", (context) => context.json({ reached: true }));

  const bearer = await app.request("http://localhost/thing", {
    headers: { Authorization: "Bearer anything" },
    method: "POST",
  });
  const cookie = await app.request("http://localhost/thing", {
    headers: { Cookie: "kinship_session=current" },
    method: "POST",
  });
  const sameOrigin = await app.request("http://localhost/thing", {
    headers: { Origin: policy.origin },
    method: "DELETE",
  });
  const read = await app.request("http://localhost/thing");

  assertStatus(bearer, 200, "a request presenting Authorization passes on");
  assertStatus(cookie, 403, "a cookie write without Origin is refused");
  assertStatus(sameOrigin, 200, "a same-origin cookie write passes");
  assertStatus(read, 200, "a read is not asked for an origin");
});
