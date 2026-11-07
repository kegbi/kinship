import { expect, test } from "./support/test.ts";
import { createPerson, registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { waitForIsland } from "./support/islands.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

/** An iCalendar body with its folded lines joined back. */
function unfolded(body: string): string {
  return body.replaceAll("\r\n ", "");
}

test(
  "[INTEGRATION-002] subscribes to a calendar of dates and reminders, rotates, and revokes",
  { annotation: { type: "flow", description: "INTEGRATION-002" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    const email = `calendar-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Calendar",
      lastName: "Owner",
      workspaceName: "Calendar circle",
    }, bareToken);
    await signInAcceptingCompliance(page, email);

    const personId = await createPerson(page.request, {
      familyName: "Lovelace",
      givenName: "Ada",
    });
    const dated = await page.request.post(
      `${origin}/api/v1/people/${personId}/dates`,
      {
        data: {
          day: 10,
          isAgeBased: false,
          isYearApproximate: false,
          kind: "birthday",
          month: 12,
          precision: "full",
          year: 1815,
        },
        headers: { origin },
      },
    );
    expect(dated.status()).toBe(201);
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const anchorOn = soon.toISOString().slice(0, 10);
    const reminded = await page.request.post(`${origin}/api/v1/reminders`, {
      data: {
        anchorOn,
        personId,
        recurrenceInterval: 1,
        recurrenceUnit: "none",
        requestId: crypto.randomUUID(),
        sendTime: "09:00",
        title: "Call Ada about the engine",
      },
      headers: { origin },
    });
    expect(reminded.status()).toBe(201);

    await page.goto("/app/settings/preferences");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.preferences",
    );
    await waitForIsland(page, "settings-calendar-feed");
    const section = page.locator("[data-calendar-feed-surface]");
    const status = section.locator("[data-calendar-feed-state]");
    await expect(status).toHaveText("No calendar feed yet.");
    await section.getByRole("button", { name: "Create calendar feed" })
      .click();
    const link = section.getByLabel("Calendar feed link");
    await expect(link).toBeFocused();
    await expect(section).toContainText(
      "Anyone with this link can see the names, dates, and reminders in this feed.",
    );
    const url = await link.inputValue();
    expect(url).toMatch(
      new RegExp(`^${origin}/api/v1/calendar-feeds/kin_cal_[^/]+\\.ics$`),
    );
    await expectAccessible(page);

    // A calendar application: no session, no cookie.
    const feed = await request.get(url);
    expect(feed.status()).toBe(200);
    expect(feed.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(feed.headers()["cache-control"]).toBe("private, max-age=300");
    expect(feed.headers()["referrer-policy"]).toBe("no-referrer");
    const body = unfolded(await feed.text());
    expect(body).toContain("SUMMARY:Ada Lovelace — Birthday\r\n");
    expect(body).toContain("DTSTART;VALUE=DATE:18151210\r\nRRULE:FREQ=YEARLY");
    expect(body).toContain(
      `DTSTART;VALUE=DATE:${
        anchorOn.replaceAll("-", "")
      }\r\nSUMMARY:Call Ada about the engine\r\n`,
    );
    expect(body).toContain(`${origin}/app/people/${personId}`);
    const tag = feed.headers()["etag"];
    expect(tag).toBeTruthy();
    const unchanged = await request.get(url, {
      headers: { "If-None-Match": tag! },
    });
    expect(unchanged.status()).toBe(304);

    await section.getByRole("button", { name: "I have saved it" }).click();
    await expect(link).toHaveCount(0);
    // The section reads the feed's status once; a fresh visit shows the use
    // the calendar application's fetch recorded, and never the link again.
    await page.reload();
    await waitForIsland(page, "settings-calendar-feed");
    await expect(status).toHaveText("Your calendar feed is active.");
    await expect(section.locator("[data-calendar-feed-summary]"))
      .toContainText("Last used");
    await expect(link).toHaveCount(0);

    await section.getByRole("button", { name: "Rotate link" }).click();
    await expect(link).toBeFocused();
    const rotated = await link.inputValue();
    expect(rotated).not.toBe(url);
    expect((await request.get(url)).status()).toBe(404);
    expect((await request.get(rotated)).status()).toBe(200);

    await section.getByRole("button", { name: "Revoke feed" }).click();
    await expect(status).toHaveText(
      "Calendar feed revoked. Its link no longer works.",
    );
    await expect(
      section.getByRole("button", { name: "Create calendar feed" }),
    ).toBeFocused();
    const revoked = await request.get(rotated);
    expect(revoked.status()).toBe(404);
    expect((await revoked.json() as { code: string }).code).toBe(
      "calendar_feed_not_found",
    );
    await expectAccessible(page);
  },
);
