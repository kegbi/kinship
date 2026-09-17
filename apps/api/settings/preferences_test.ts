/**
 * How a member wants the application to read.
 *
 * The resolved time zone is returned but never accepted back, because it is
 * what the workspace decided rather than what the member asked for.
 */

import { createSettingsRoutes } from "../settings.ts";
import {
  assert,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { actor, headers, services } from "./settings.test-helper.ts";

Deno.test("APR-009 member preference response exposes resolved timezone as read-only", async () => {
  const configuration = services();
  const app = createSettingsRoutes({
    ...configuration,
    protectedSessions: {
      ...configuration.protectedSessions,
      resolve: () => Promise.resolve({ ...actor, role: "member" }),
    },
  });
  const read = await app.request(
    "http://localhost/api/v1/settings/preferences",
    { headers },
  );
  const body = await read.json();
  assert(
    read.status === 200 &&
      body.preferences.effectiveTimezone === "Europe/Belgrade",
    "ordinary member receives resolved settings",
  );
  assert(
    !("timezone" in body.preferences),
    "inherited timezone remains unset in editable input",
  );
  const rejected = await app.request(
    "http://localhost/api/v1/settings/preferences",
    {
      headers,
      method: "PUT",
      body: JSON.stringify(body.preferences),
    },
  );
  assertStatus(rejected, 400, "read-only resolved field cannot be written");
  const { effectiveTimezone: _resolved, ...input } = body.preferences;
  const saved = await app.request(
    "http://localhost/api/v1/settings/preferences",
    {
      headers,
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  const savedBody = await saved.json();
  assert(
    saved.status === 200 &&
      savedBody.preferences.effectiveTimezone === "Europe/Belgrade" &&
      !("timezone" in savedBody.preferences),
    "saving editable fields preserves inheritance",
  );
});
