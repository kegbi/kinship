import { expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

test.use({ timezoneId: "Europe/Belgrade" });

test("[JOURNAL-001] maintains the personal journal", {
  annotation: [{ type: "flow", description: "JOURNAL-001" }, {
    type: "leaf",
    description: "APP-008A",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const email = `journal-${browserName}-${Date.now()}@example.test`;
  expect(
    (await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Journal",
        lastName: "Keeper",
        password,
        workspaceName: "Journal circle",
      },
    })).status(),
  ).toBe(202);
  let token = "";
  await expect.poll(async () => {
    const messages = (await (await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    )).json() as { messages?: Array<{ ID: string }> }).messages ?? [];
    for (const message of messages) {
      const detail = await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      );
      token = ((await detail.json() as { Text?: string }).Text ?? "").match(
        /token=([^\s]+)/,
      )?.[1] ?? token;
    }
    return token;
  }).toBeTruthy();
  expect(
    (await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token },
    })).status(),
  ).toBe(200);
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const person = await page.request.post(`${origin}/api/v1/people`, {
    data: { givenName: "Ada", isPartial: false },
    headers: { origin },
  });
  const personId =
    (await person.json() as { person: { id: string } }).person.id;
  const activity = await page.request.post(`${origin}/api/v1/interactions`, {
    data: {
      happenedAt: "2026-08-22T12:00:00.000Z",
      kind: "activity",
      participantIds: [personId],
      requestId: crypto.randomUUID(),
      summary: "Shared a walk",
    },
    headers: { origin },
  });
  expect(activity.status()).toBe(201);

  await page.goto("/app/journal");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "journal.index",
  );
  await expect(page.getByText("No journal items yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Title (optional)").fill("Today");
  await page.getByLabel("Entry").fill("First version");
  await page.getByLabel("When", { exact: true }).fill("2026-08-23T18:30");
  await page.getByRole("button", { name: "Save item" }).click();
  const post = page.locator("[data-journal-list] li", { hasText: "Today" });
  await expect(post).toContainText("First version");
  await post.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("When", { exact: true })).toHaveValue(
    "2026-08-23T18:30",
  );
  await page.getByLabel("Entry").fill("Edited version");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator("[data-journal-list] li", { hasText: "Today" }))
    .toContainText("Edited version");
  await page.locator("[data-journal-list] li", { hasText: "Today" })
    .getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("When", { exact: true })).toHaveValue(
    "2026-08-23T18:30",
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item type").selectOption("day-rating");
  await page.getByLabel("Date").fill("2026-08-23");
  await page.locator('[data-journal-form] select[name="rating"]').selectOption(
    "4",
  );
  await page.getByLabel("Comment (optional)").fill("Good day");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(
    page.locator("[data-journal-list] li", { hasText: "Day rating: 4/5" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item type").selectOption("day-rating");
  await page.getByLabel("Date").fill("2026-08-23");
  await page.locator('[data-journal-form] select[name="rating"]').selectOption(
    "5",
  );
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(
    page.locator("[data-journal-list] li", { hasText: "Day rating: 5/5" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item type").selectOption("activity");
  const activityChoice = page.locator(
    '[data-journal-activity] select[name="activityId"]',
  );
  await activityChoice.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(
    page.locator("[data-journal-list] li", { hasText: "Shared a walk" }),
  ).toBeVisible();

  const postLink = page.locator("[data-journal-list] li", { hasText: "Today" })
    .getByRole("link", { name: "Today" });
  const detailPath = await postLink.getAttribute("href");
  if (process.env.E2E_DEV_SHELL === "1" && detailPath) {
    await page.route(
      `**${detailPath}`,
      async (route) =>
        route.fulfill({
          response: await request.get(`${origin}/internal/journal-item-shell`),
        }),
    );
  }
  await postLink.click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "journal.item",
  );
  await expect(page.getByText("Edited version")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(
    page.getByText("This item does not exist in the active workspace."),
  ).toBeVisible();
  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);
});
