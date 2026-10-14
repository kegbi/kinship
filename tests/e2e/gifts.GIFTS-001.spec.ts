import { expect, type Locator, type Page, test } from "@playwright/test";
import { waitForIsland } from "./support/islands.ts";
import { registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { openPersonMenu } from "./support/profile.ts";
import { submitSignIn } from "./support/sign-in.ts";

/** The same rendered compact style, including the CSS outside the island. */
async function actionStyle(button: Locator) {
  return await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      color: style.color,
      font: style.font,
      height: element.getBoundingClientRect().height,
      padding: style.padding,
    };
  });
}

async function expectBoundedDebtDialog(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Permanently delete this debt?",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();
  const bounds = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewportWidth);
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press("Tab");
    // Base UI's sibling focus guards redirect on the next animation frame.
    // Wait for the actual control so a guard cannot count as trapped focus.
    await expect(dialog.getByRole("button", {
      name: step % 2 === 0 ? "Delete debt permanently" : "Keep it",
    })).toBeFocused();
  }
  return dialog;
}

async function expectCompactDebtActions(
  page: Page,
  row: Locator,
  reference: Locator,
) {
  await page.mouse.move(0, 0);
  const style = await actionStyle(reference);
  expect(style.height).toBe(34);
  for (const button of await row.getByRole("button").all()) {
    expect(await actionStyle(button)).toEqual(style);
  }
}

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
    const desktop = page.viewportSize()!;
    const reference = photoBook.getByRole("button", { name: "Change status" });
    for (const width of [desktop.width, 375, 320]) {
      await page.setViewportSize({ width, height: desktop.height });
      await expectCompactDebtActions(page, lunch, reference);
      await lunch.getByRole("button", { name: "Delete Lunch" }).click();
      const dialog = await expectBoundedDebtDialog(page);
      await dialog.getByRole("button", { name: "Keep it" }).click();
      await expect(dialog).toBeHidden();
      await expect(lunch.getByRole("button", { name: "Delete Lunch" }))
        .toBeFocused();
    }
    await page.setViewportSize(desktop);
    await lunch.getByLabel("Next status for Lunch").selectOption("settled");
    await lunch.getByRole("button", { name: "Change status" }).click();
    const settlementDialog = page.getByRole("dialog", {
      name: "Settle this debt",
    });
    await expect(settlementDialog).toBeVisible();
    await expect(settlementDialog.getByLabel("Settlement reason (optional)"))
      .toBeFocused();
    await settlementDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(lunch).toContainText("open");
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: desktop.height });
      await lunch.getByRole("button", { name: "Change status" }).click();
      const bounds = await settlementDialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.width + bounds!.x).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(settlementDialog).toBeHidden();
      await expect(lunch.getByRole("button", { name: "Change status" }))
        .toBeFocused();
    }
    await page.setViewportSize(desktop);
    await lunch.getByRole("button", { name: "Change status" }).click();
    await settlementDialog.getByLabel("Settlement reason (optional)").fill(
      "Repaid by bank transfer",
    );
    await settlementDialog.getByLabel("Settlement photo (optional)")
      .setInputFiles({
        name: "settlement.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await settlementDialog.getByRole("button", { name: "Settle debt" }).click();
    await expect(settlementDialog).toBeHidden();
    await expect(debts.locator("li", { hasText: "Lunch" })).toContainText(
      "settled",
    );
    await page.reload();
    await waitForIsland(page, "person-gifts");
    await lunch.getByRole("button", { name: "Settlement history for Lunch" })
      .click();
    await expect(lunch).toContainText("Repaid by bank transfer");
    const settlementPhoto = lunch.getByRole("link", {
      name: "Open settlement photo: settlement.png",
    });
    expect(
      (await page.request.get((await settlementPhoto.getAttribute("href"))!))
        .status(),
    ).toBe(200);
    const firstSettlementTime = await lunch.locator(
      "[data-debt-settlement] time",
    ).getAttribute("datetime");
    await lunch.getByRole("button", { name: "Settlement history for Lunch" })
      .click();
    for (const width of [desktop.width, 375, 320]) {
      await page.setViewportSize({ width, height: desktop.height });
      await expectCompactDebtActions(page, lunch, reference);
      await lunch.getByRole("button", { name: "Delete Lunch" }).click();
      const dialog = await expectBoundedDebtDialog(page);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(lunch.getByRole("button", { name: "Delete Lunch" }))
        .toBeFocused();
    }
    await page.setViewportSize(desktop);
    await lunch.getByRole("button", { name: "Reopen Lunch" }).click();
    await expect(lunch.locator(":scope > p")).toContainText("· open");
    await expect(lunch.getByRole("button", { name: "Reopen Lunch" }))
      .toBeHidden();
    await lunch.getByRole("button", { name: "Settlement history for Lunch" })
      .click();
    await expect(lunch).toContainText("Repaid by bank transfer");
    await expect(lunch.locator("[data-debt-settlement] time")).toHaveAttribute(
      "datetime",
      firstSettlementTime!,
    );
    await lunch.getByRole("button", { name: "Settlement history for Lunch" })
      .click();
    const lunchId = await lunch.getAttribute("data-debt-id");
    const reopenedList = await page.request.get(
      `${origin}/api/v1/people/${personId}/gifts`,
    );
    const reopenedDebts = await reopenedList.json() as {
      debts: { id: string; settledAt?: string }[];
    };
    expect(reopenedDebts.debts.find((debt) => debt.id === lunchId)?.settledAt)
      .toBeUndefined();
    await lunch.getByRole("button", { name: "Delete Lunch" }).click();
    const debtDialog = page.getByRole("dialog", {
      name: "Permanently delete this debt?",
    });
    await expect(debtDialog).toBeVisible();
    await debtDialog.getByRole("button", { name: "Keep it" }).click();
    await expect(lunch).toBeVisible();
    await lunch.getByLabel("Next status for Lunch").selectOption("settled");
    await lunch.getByRole("button", { name: "Change status" }).click();
    await settlementDialog.getByRole("button", { name: "Settle debt" }).click();
    await expect(settlementDialog).toBeHidden();
    await expect(lunch).toContainText("settled");
    await lunch.getByRole("button", { name: "Settlement history for Lunch" })
      .click();
    await expect(lunch.locator("[data-debt-settlement]")).toHaveCount(2);
    await expect(lunch).toContainText("Repaid by bank transfer");
    await expect(lunch).toContainText("No settlement reason supplied.");
    await lunch.getByRole("button", { name: "Settlement history for Lunch" })
      .click();
    await lunch.getByRole("button", { name: "Delete Lunch" }).click();
    await page.route(
      `**/api/v1/people/${personId}/debts/${lunchId}`,
      async (route) => {
        await route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({
            detail: "The debt could not be deleted. Try again.",
          }),
        });
      },
      { times: 1 },
    );
    await debtDialog.getByRole("button", { name: "Delete debt permanently" })
      .click();
    await expect(debtDialog.getByRole("status")).toHaveText(
      "The debt could not be deleted. Try again.",
    );
    let releaseDeletion!: () => void;
    const deletionHeld = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    await page.route(
      `**/api/v1/people/${personId}/debts/${lunchId}`,
      async (route) => {
        await deletionHeld;
        await route.continue();
      },
      { times: 1 },
    );
    await debtDialog.getByRole("button", { name: "Delete debt permanently" })
      .click();
    try {
      await expect(
        debtDialog.getByRole("button", { name: "Delete debt permanently" }),
      ).toBeDisabled();
      await expect(debtDialog.getByRole("button", { name: "Keep it" }))
        .toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(debtDialog).toBeVisible();
    } finally {
      releaseDeletion();
    }
    await expect(lunch).toHaveCount(0);

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
    // Moving the start earlier charges the two missing months while keeping
    // the three existing debts, even though the new day differs from theirs.
    start.setUTCMonth(start.getUTCMonth() - 2);
    await recurring.getByRole("button", { name: "Edit Gym membership" })
      .click();
    const editRule = recurring.getByRole("form", {
      name: "Edit recurring debt",
    });
    await editRule.getByLabel("Starts on").fill(
      start.toISOString().slice(0, 10),
    );
    await editRule.getByLabel("Day of month").fill("2");
    await editRule.getByRole("button", { name: "Save" }).click();
    await expect(debts.locator("[data-gift-state]")).toHaveText(
      "Recurring debt saved. 2 debts charged.",
    );
    await expect(
      debts.locator("[data-gift-list] li", { hasText: "Recurring, due" }),
    ).toHaveCount(5);
    const charge = debts.locator("[data-gift-list] li", {
      hasText: "Recurring, due",
    }).first();
    for (const width of [desktop.width, 375, 320]) {
      await page.setViewportSize({ width, height: desktop.height });
      await charge.getByRole("button", { name: "Delete Gym membership" })
        .click();
      const dialog = await expectBoundedDebtDialog(page);
      await expect(dialog).toContainText(
        "The recurring schedule continues; future charges stay.",
      );
      await expect(dialog).toContainText(
        "Changing the schedule later may charge deleted periods again.",
      );
      if (width === 320 && browserName === "chromium") {
        await page.screenshot({
          path: ".artifacts/local/debt-confirmation-mobile.png",
        });
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    await page.setViewportSize(desktop);
    await charge.getByRole("button", { name: "Delete Gym membership" }).click();
    await expect(debtDialog).toContainText(
      "The recurring schedule continues; future charges stay.",
    );
    await debtDialog.getByRole("button", { name: "Delete debt permanently" })
      .click();
    await expect(
      debts.locator("[data-gift-list] li", { hasText: "Recurring, due" }),
    ).toHaveCount(4);
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
