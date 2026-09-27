/**
 * How a member wants the application to read.
 *
 * The resolved time zone is returned but never accepted back, because it is
 * what the workspace decided rather than what the member asked for.
 */

import { createSettingsRoutes } from "../settings.ts";
import { assert, assertStatus } from "../../../../../testing/assert.ts";
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

Deno.test("[PLANNING-003] reminder delivery and digest time are saved, cleared, or kept", async () => {
  const received: unknown[] = [];
  const configuration = services();
  const app = createSettingsRoutes({
    ...configuration,
    settings: {
      ...configuration.settings,
      updatePreferences: (actor, input) => {
        received.push(input);
        return configuration.settings.updatePreferences(actor, input);
      },
    },
  });
  const base = {
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
  };
  const put = (body: unknown) =>
    app.request("http://localhost/api/v1/settings/preferences", {
      body: JSON.stringify(body),
      headers,
      method: "PUT",
    });
  const saved = await put({
    ...base,
    digestTime: "07:30",
    reminderDelivery: "both",
  });
  assertStatus(saved, 200, "a delivery choice and digest time save");
  const savedBody = await saved.json();
  assert(
    savedBody.preferences.reminderDelivery === "both" &&
      savedBody.preferences.digestTime === "07:30",
    JSON.stringify(savedBody),
  );
  assertStatus(
    await put({ ...base, digestTime: null, reminderDelivery: "email" }),
    200,
    "a null digest time clears the digest",
  );
  assertStatus(await put(base), 200, "an older client keeps what was chosen");
  assert(
    JSON.stringify(received.map((input) => {
      const fields = input as Record<string, unknown>;
      return ["digestTime", "reminderDelivery"].map((name) =>
        name in fields ? fields[name] : "absent"
      );
    })) ===
      JSON.stringify([["07:30", "both"], [null, "email"], [
        "absent",
        "absent",
      ]]),
    `the use case received ${JSON.stringify(received)}`,
  );
  for (
    const invalid of [
      { digestTime: "7:30" },
      { digestTime: "24:00" },
      { reminderDelivery: "sms" },
    ]
  ) {
    const refused = await put({ ...base, ...invalid });
    assertStatus(refused, 400, `${JSON.stringify(invalid)} is refused`);
  }
});
