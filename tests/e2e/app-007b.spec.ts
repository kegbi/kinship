import { expect, type Page, test } from "@playwright/test";
import axe from "axe-core";
import { waitForIsland } from "./support/islands.ts";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

async function openPersonMenu(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open person menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test(
  "[GIFTS-001] manages person gifts, attachments, and debts",
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
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Gift",
        lastName: "Keeper",
        password,
        workspaceName: "Gift circle",
      },
    })).status()).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const messages = (await (await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
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

    await openPersonMenu(page);
    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(gifts.getByRole("button", { name: "Add gift" })).toBeHidden();
    await expect(debts.getByRole("button", { name: "Add debt" })).toBeHidden();
    await page.addScriptTag({ content: axe.source });
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);
  },
);
