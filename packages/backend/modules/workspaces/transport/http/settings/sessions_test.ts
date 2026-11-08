/**
 * Every browser a member is signed in on, and the button that ends one.
 *
 * Revoking the current session clears the cookie as well; revoking another
 * one leaves it alone.
 */

import { createSettingsRoutes } from "../settings.ts";
import { assert, assertStatus } from "../../../../../testing/assert.ts";
import { headers, services, settings } from "./settings.test-helper.ts";

Deno.test("AUTH-004 HTTP lists ISO sessions and clears only a revoked current cookie", async () => {
  const app = createSettingsRoutes(services());
  const listed = await app.request(
    "http://localhost/api/v1/settings/sessions",
    {
      headers,
    },
  );
  const body = await listed.json() as {
    readonly sessions?: readonly { readonly createdAt?: string }[];
  };
  assertStatus(listed, 200, "owned sessions list");
  assert(
    body.sessions?.[0]?.createdAt === "2026-08-15T08:00:00.000Z",
    "dates are RFC3339",
  );
  const revoked = await app.request(
    "http://localhost/api/v1/settings/sessions/00000000-0000-4000-8000-000000000010",
    { method: "DELETE", headers },
  );
  assertStatus(revoked, 200, "current session revokes");
  assert(
    revoked.headers.get("set-cookie")?.includes("Max-Age=0"),
    "current credential clears",
  );
});

Deno.test("AUTH-004 HTTP answers a session that is not the member's own as stale", async () => {
  const app = createSettingsRoutes(services(settings({
    revokeSession: () => Promise.resolve({ status: "stale" as const }),
  })));
  const response = await app.request(
    "http://localhost/api/v1/settings/sessions/00000000-0000-4000-8000-000000000010",
    { method: "DELETE", headers },
  );
  assert(response.status === 404, "stale, foreign, and unknown all answer 404");
  assert(
    response.headers.get("set-cookie") === null,
    "failed revocation retains credential",
  );
});
