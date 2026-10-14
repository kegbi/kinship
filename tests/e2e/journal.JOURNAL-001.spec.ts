import { expect, test } from "@playwright/test";
import { registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { submitSignIn } from "./support/sign-in.ts";

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
  await registerVerified(request, {
    email,
    firstName: "Journal",
    lastName: "Keeper",
    workspaceName: "Journal circle",
  }, bareToken);
  await submitSignIn(page, email);
  const person = await page.request.post(`${origin}/api/v1/people`, {
    data: { givenName: "Ada", isPartial: false },
    headers: { origin },
  });
  const personId =
    (await person.json() as { person: { id: string } }).person.id;
  const companion = await page.request.post(`${origin}/api/v1/people`, {
    data: { givenName: "Grace", isPartial: false },
    headers: { origin },
  });
  const companionId =
    (await companion.json() as { person: { id: string } }).person.id;
  const activity = await page.request.post(`${origin}/api/v1/interactions`, {
    data: {
      happenedAt: "2026-08-22T12:00:00.000Z",
      kind: "activity",
      participantIds: [personId, companionId],
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

  const linkedActivity = page.locator("[data-journal-list] li", {
    hasText: "Shared a walk",
  });
  for (const [name, id] of [["Ada", personId], ["Grace", companionId]]) {
    await expect(linkedActivity.getByRole("link", { name, exact: true }))
      .toHaveAttribute("href", `/app/people/${id}`);
  }
  const activityLink = linkedActivity.getByRole("link", {
    name: "Shared a walk",
  });
  const activityPath = await activityLink.getAttribute("href");
  if (process.env.E2E_DEV_SHELL === "1" && activityPath) {
    await page.route(
      `**${activityPath}`,
      async (route) =>
        route.fulfill({
          response: await request.get(`${origin}/internal/journal-item-shell`),
        }),
    );
  }
  await activityLink.click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "journal.item",
  );
  for (const [name, id] of [["Ada", personId], ["Grace", companionId]]) {
    await expect(
      page.locator("[data-journal-list]").getByRole("link", {
        name,
        exact: true,
      }),
    )
      .toHaveAttribute("href", `/app/people/${id}`);
  }
  await page.goto("/app/journal");

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
  await expectAccessible(page);
});
