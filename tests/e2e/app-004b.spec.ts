import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

async function verificationToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let token: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = await response.json() as { messages?: Array<{ ID: string }> };
    for (const message of body.messages ?? []) {
      const detail = await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      );
      const content = await detail.json() as { Text?: string };
      const link = content.Text?.match(/https?:\/\/\S+\?token=\S+/)?.[0];
      if (link && new URL(link).pathname === "/auth/verify-email") {
        token = new URL(link).searchParams.get("token") ?? undefined;
      }
    }
    return token;
  }).toBeTruthy();
  return token!;
}

async function registerVerified(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Dates",
      lastName: "Writer",
      password,
      workspaceName: "Important dates circle",
    },
  })).status()).toBe(202);
  expect((await request.post(`${origin}/api/v1/email-verifications`, {
    data: { token: await verificationToken(request, email) },
  })).status()).toBe(200);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () =>
    (await (globalThis as typeof globalThis & {
      axe: { run(): Promise<{ violations: unknown[] }> };
    }).axe.run()).violations
  );
  expect(violations).toEqual([]);
}

test(
  "[PEOPLE-005] manages honest important dates on the person profile",
  { annotation: { type: "flow", description: "PEOPLE-005" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    const email = `important-dates-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);

    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Ada");
    await page.getByLabel("Family name").fill("Lovelace");
    let releaseDates = () => {};
    const datesReleased = new Promise<void>((resolve) => {
      releaseDates = resolve;
    });
    let delayInitialDates = true;
    await page.route("**/api/v1/people/*/dates", async (route) => {
      if (delayInitialDates && route.request().method() === "GET") {
        delayInitialDates = false;
        await datesReleased;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const profilePath = new URL(page.url()).pathname;
    await page.goto(profilePath);
    const section = page.locator("#profile-section-important-dates");
    const savedDates = page.locator("#important-dates-list");
    await expect(section).toHaveAttribute("data-section-state", "loading");
    await expect(section.getByText("Loading important dates…")).toBeVisible();
    releaseDates();
    await expect(section).toHaveAttribute("data-section-state", "ready");
    await expect(section.getByText("No important dates recorded."))
      .toBeVisible();
    await expectAccessible(page);

    const add = page.getByRole("button", { name: "Add important date" });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Date type")).toBeFocused();
    await page.getByLabel("Known components").selectOption("full");
    await page.locator("#important-date-year").fill("2023");
    await page.locator("#important-date-month").selectOption("4");
    await page.locator("#important-date-day").fill("31");
    await page.getByRole("button", { name: "Save date" }).click();
    const calendarError = page.locator("#important-date-form-state");
    await expect(calendarError).toHaveText("Enter a real calendar date.");
    await expect(calendarError).toBeFocused();
    await expect(page.locator("#important-date-day")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await page.locator("#important-date-month").selectOption("2");
    await page.locator("#important-date-day").fill("29");
    await page.getByRole("button", { name: "Save date" }).click();
    await expect(calendarError).toHaveText("Enter a real calendar date.");
    await expect(calendarError).toBeFocused();
    await page.getByLabel("Known components").selectOption("year");
    await expect(page.locator("#important-date-month")).toBeHidden();
    await expect(page.locator("#important-date-day")).toBeHidden();
    await page.locator("#important-date-year").fill("1984");
    await page.getByLabel("The stated year is approximate").check();
    await page.getByLabel("Show age when the year is known").check();
    await page.getByRole("button", { name: "Save date" }).click();
    const birthday = savedDates.getByRole("listitem").filter({
      hasText: "Birthday",
    });
    await expect(birthday).toContainText("about 1984");
    await expect(birthday).toContainText(
      "No reminder scheduled; month and day are not both known.",
    );

    await birthday.getByRole("button", { name: "Edit Birthday" }).click();
    await page.getByLabel("Known components").selectOption("full");
    await page.locator("#important-date-month").selectOption("2");
    await page.locator("#important-date-day").fill("29");
    await page.getByRole("button", { name: "Save date" }).click();
    await expect(birthday).toContainText("February 29, about 1984");
    await expect(birthday).toContainText(
      "Annual reminder scheduled because month and day are known.",
    );

    await add.click();
    await page.getByLabel("Date type").selectOption("custom");
    await expect(page.getByLabel("Custom label")).toBeVisible();
    await page.getByLabel("Custom label").fill("Citizenship day");
    await page.getByLabel("Known components").selectOption("month_day");
    await expect(page.locator("#important-date-year")).toBeHidden();
    await expect(page.getByLabel("The stated year is approximate"))
      .toBeHidden();
    await page.locator("#important-date-month").selectOption("5");
    await page.locator("#important-date-day").fill("6");
    await page.getByRole("button", { name: "Save date" }).click();
    const custom = savedDates.getByRole("listitem").filter({
      hasText: "Citizenship day",
    });
    await expect(custom).toContainText("May 6 (year unknown)");
    await expect(custom).not.toContainText("1984");

    await add.click();
    await page.getByLabel("Date type").selectOption("first_met");
    await page.getByLabel("Known components").selectOption("year_month");
    await page.locator("#important-date-year").fill("2012");
    await page.locator("#important-date-month").selectOption("4");
    await page.getByRole("button", { name: "Save date" }).click();
    await expect(
      savedDates.getByRole("listitem").filter({
        hasText: "First meeting",
      }),
    ).toContainText("April 2012");

    await page.reload();
    await expect(section).toHaveAttribute("data-section-state", "ready");
    await expect(page.getByText("February 29, about 1984")).toBeVisible();
    await expect(page.getByText("May 6 (year unknown)")).toBeVisible();
    await expect(page.getByText("April 2012")).toBeVisible();

    await custom.getByRole("button", { name: "Delete Citizenship day" })
      .click();
    await expect(section.getByText("Press the delete button again to confirm."))
      .toBeVisible();
    await custom.getByRole("button", {
      name: "Confirm delete Citizenship day",
    }).click();
    await expect(custom).toHaveCount(0);

    await page.route("**/api/v1/people/*/dates", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/problem+json",
          json: {
            detail: "Unavailable fixture",
            status: 503,
            title: "Unavailable",
            type: "about:blank",
          },
          status: 503,
        });
        return;
      }
      await route.continue();
    });
    await page.reload();
    await expect(section).toHaveAttribute("data-section-state", "error");
    await expect(section.getByText(
      "Important dates are temporarily unavailable. Try again.",
    )).toBeVisible();
    await page.unroute("**/api/v1/people/*/dates");
    await page.route("**/api/v1/people/*/dates", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/problem+json",
          json: {
            detail: "Forbidden fixture",
            status: 403,
            title: "Forbidden",
            type: "about:blank",
          },
          status: 403,
        });
        return;
      }
      await route.continue();
    });
    await page.reload();
    await expect(section).toHaveAttribute("data-section-state", "forbidden");
    await expect(section.getByText(
      "Your active workspace no longer permits this action.",
    )).toBeVisible();
    await page.unroute("**/api/v1/people/*/dates");
    await page.goto(profilePath);
    await expect(section).toHaveAttribute("data-section-state", "ready");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(section.getByRole("heading", { name: "Important dates" }))
      .toBeVisible();
    expect(
      await section.evaluate((element) =>
        element.scrollWidth <= element.clientWidth
      ),
    ).toBe(true);
    await expectAccessible(page);

    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(page.getByText("Archived person · read-only")).toBeVisible();
    await expect(section.getByText(
      "Important dates loaded. This archived person is read-only.",
    )).toBeVisible();
    await expect(add).toBeHidden();
    await expect(section.getByRole("button", { name: /Edit|Delete/ }))
      .toHaveCount(0);
    await expect(page.getByText("February 29, about 1984")).toBeVisible();
    await expectAccessible(page);
  },
);
