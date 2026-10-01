import { expect, test } from "@playwright/test";
import { waitForIsland } from "./support/islands.ts";
import { registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { openPersonMenu } from "./support/profile.ts";
import { submitSignIn } from "./support/sign-in.ts";

test(
  "[GIFTS-001] manages person gifts, attachments, debts, and recurring debts",
  {
    annotation: [
      { type: "flow", description: "GIFTS-001" },
      { type: "leaf", description: "APP-007B" },
    ],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email = `gifts-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Gift",
      lastName: "Keeper",
      workspaceName: "Gift circle",
    }, bareToken);
    await submitSignIn(page, email);

    const adaResponse = await page.request.post(`${origin}/api/v1/people`, {
      data: { givenName: "Ada", familyName: "Lovelace", isPartial: false },
      headers: { origin },
    });
    const graceResponse = await page.request.post(`${origin}/api/v1/people`, {
      data: { givenName: "Grace", familyName: "Hopper", isPartial: false },
      headers: { origin },
    });
    expect(adaResponse.status()).toBe(201);
    expect(graceResponse.status()).toBe(201);
    const personId =
      (await adaResponse.json() as { person: { id: string } }).person.id;
    if (process.env.E2E_DEV_SHELL === "1") {
      await page.route(`**/app/people/${personId}*`, async (route) => {
        await route.fulfill({
          response: await request.get(
            `${origin}/internal/person-profile-shell`,
          ),
        });
      });
    }

    const uploaded = await page.request.post(
      `${origin}/api/v1/people/${personId}/files`,
      {
        data: Buffer.from("%PDF-1.7 gift receipt"),
        headers: {
          "Content-Type": "application/pdf",
          origin,
          "X-File-Kind": "document",
          "X-File-Name": "gift.pdf",
          "X-File-Title": "Gift receipt",
        },
      },
    );
    expect(uploaded.status()).toBe(201);
    await page.goto(`/app/people/${personId}?section=gifts`);
    await waitForIsland(page, "person-gifts");
    const gifts = page.locator('[data-person-gifts="gift"]');
    await expect(gifts.getByText("No gifts saved.")).toBeVisible();
    await gifts.getByRole("button", { name: "Add gift" }).click();
    await gifts.getByLabel("Gift name").fill("Train tickets");
    await gifts.getByRole("button", { name: "Save" }).click();
    const tickets = gifts.locator("li", { hasText: "Train tickets" });
    await expect(tickets).toContainText("Amount unknown");
    await expect(tickets).toContainText("No recipient");

    await gifts.getByRole("button", { name: "Add gift" }).click();
    await gifts.getByLabel("Gift name").fill("Photo book");
    await gifts.locator('[data-gift-form] select[name="status"]').selectOption(
      "planned",
    );
    await gifts.getByLabel("Amount (optional)").fill("49.5000");
    await gifts.getByLabel("Currency (with amount)").selectOption("EUR");
    await gifts.getByLabel("Recipient (optional)").selectOption({
      label: "Grace Hopper",
    });
    await gifts.getByLabel("Existing attachment (optional)").selectOption({
      label: "Gift receipt",
    });
    await gifts.getByRole("button", { name: "Save" }).click();
    const photoBook = gifts.locator("li", { hasText: "Photo book" });
    await expect(photoBook).toContainText("Recipient selected");
    await expect(photoBook).toContainText("Attachment linked");

    await tickets.getByLabel("Next status for Train tickets").selectOption(
      "given",
    );
    await tickets.getByRole("button", { name: "Change status" }).click();
    const given = gifts.locator("li", { hasText: "Train tickets" });
    await expect(given).toContainText("given");
    const giftId = await given.getAttribute("data-gift-id");
    expect(
      (await page.request.patch(
        `${origin}/api/v1/people/${personId}/gifts/${giftId}/status`,
        {
          data: { status: "idea" },
          headers: { origin },
        },
      )).status(),
    ).toBe(409);

    const debts = page.locator('[data-person-gifts="debt"]');
    await debts.getByRole("button", { name: "Add debt" }).click();
    await debts.locator('[data-gift-form] input[name="amount"]').fill(
      "24.5000",
    );
    await debts.getByLabel("Currency").selectOption("EUR");
    await debts.getByLabel("Reason (optional)").fill("Lunch");
    await debts.getByRole("button", { name: "Save" }).click();
    const lunch = debts.locator("li", { hasText: "Lunch" });
    await expect(lunch).toContainText("They owe");
    await lunch.getByLabel("Next status for Lunch").selectOption("settled");
    await lunch.getByRole("button", { name: "Change status" }).click();
    await expect(debts.locator("li", { hasText: "Lunch" })).toContainText(
      "settled",
    );

    // A recurring debt that started two months ago charges each period at
    // once, every charge its own open debt, and pausing stops further ones.
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 2);
    const recurring = debts.locator("[data-recurring-debts]");
    await recurring.getByRole("button", { name: "Add recurring debt" })
      .click();
    const rule = recurring.getByRole("form", { name: "Add recurring debt" });
    await rule.getByLabel("Amount").fill("30");
    await rule.getByLabel("Currency").selectOption("EUR");
    await rule.getByLabel("Day of month").fill("1");
    await rule.getByLabel("Starts on").fill(start.toISOString().slice(0, 10));
    await rule.getByLabel("Reason (optional)").fill("Gym membership");
    await rule.getByRole("button", { name: "Save" }).click();
    await expect(debts.locator("[data-gift-state]")).toHaveText(
      "Recurring debt saved. 3 debts charged.",
    );
    await expect(
      debts.locator("[data-gift-list] li", { hasText: "Recurring, due" }),
    ).toHaveCount(3);
    await recurring.getByRole("button", { name: "Pause Gym membership" })
      .click();
    await expect(recurring.getByText("Paused", { exact: true })).toBeVisible();

    await openPersonMenu(page);
    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(gifts.getByRole("button", { name: "Add gift" })).toBeHidden();
    await expect(debts.getByRole("button", { name: "Add debt" })).toBeHidden();
    await expect(
      recurring.getByRole("button", { name: "Add recurring debt" }),
    ).toBeHidden();
    await expectAccessible(page);
  },
);
