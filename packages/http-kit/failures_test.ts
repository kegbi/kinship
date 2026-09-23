/**
 * The failure responder the route files answer refusals with.
 *
 * The pins on each route file's own refusal tables live beside the app that
 * mounts every one of them, in `apps/api/failures_test.ts`; what is left here
 * is the kit's own behaviour: the kernel status map and the responder.
 */

import { Hono } from "hono";
import { SHARED_FAILURE_STATUSES } from "../backend/shared-kernel/result.ts";
import {
  assert,
  assertEquals,
  assertStatus,
  assertThrows,
} from "../backend/testing/assert.ts";
import { failureResponder, KERNEL_FAILURE_STATUS } from "./failures.ts";

Deno.test("[GAP-019] every shared kernel failure has one HTTP status", () => {
  const mapped = KERNEL_FAILURE_STATUS as Record<string, number | undefined>;
  for (const status of SHARED_FAILURE_STATUSES) {
    assert(
      mapped[status] !== undefined,
      `the kernel status ${status} has no HTTP status`,
    );
  }
  assertEquals(
    Object.keys(KERNEL_FAILURE_STATUS).length,
    SHARED_FAILURE_STATUSES.length,
    "the map names the shared vocabulary and nothing else",
  );
});

Deno.test("[GAP-019] a responder answers named statuses and falls back to the rest", async () => {
  const respond = failureResponder({
    fallback: {
      code: "widgets_unavailable",
      detail: "Later.",
      status: 503,
      title: "Widgets unavailable",
    },
    statuses: {
      "not-found": {
        code: "widget_not_found",
        detail: "No such widget.",
        title: "Widget unavailable",
      },
    },
  });
  const app = new Hono();
  app.get("/named", (context) => respond(context, "not-found"));
  app.get("/fallback", (context) => respond(context, { status: "exploded" }));
  app.get(
    "/errors",
    (context) =>
      respond(context, { errors: { name: "Too short." }, status: "nope" }),
  );
  app.get(
    "/named-ignores-errors",
    (context) =>
      respond(context, { errors: { name: "Too short." }, status: "not-found" }),
  );

  const named = await app.request("http://localhost/named");
  const fallback = await app.request("http://localhost/fallback");
  const errors = await app.request("http://localhost/errors");
  const ignored = await app.request("http://localhost/named-ignores-errors");

  assertStatus(named, 404);
  assertStatus(fallback, 503);
  assertEquals(
    ((await errors.json()) as { readonly errors?: Record<string, string> })
      .errors?.name,
    "Too short.",
    "the fallback carries the result's field messages",
  );
  assert(
    !("errors" in (await ignored.json() as Record<string, unknown>)),
    "a named failure says only what its table declares",
  );
});

Deno.test("[GAP-019] a status outside the kernel vocabulary must declare its own", () => {
  assertThrows(
    () =>
      failureResponder({
        fallback: {
          code: "widgets_unavailable",
          detail: "Later.",
          status: 503,
          title: "Widgets unavailable",
        },
        statuses: {
          "spun-too-fast": {
            code: "widget_spun",
            detail: "Slow down.",
            title: "Widget spun",
          },
        },
      }),
    "a table with an unmapped status is refused when it is composed",
  );
});
