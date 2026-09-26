import { expect, type Page, test } from "@playwright/test";
import axe from "axe-core";
import { settleNavigation } from "./support/navigation.ts";

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
  "[PLANNING-002] creates calendar reminders and cadence and delivers once",
  { annotation: { type: "flow", description: "PLANNING-002" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email = `reminders-${browserName}-${Date.now()}@example.test`;
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Reminder",
        lastName: "Writer",
        password,
        workspaceName: "Reminder circle",
      },
    })).status()).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const search = await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
      );
      const messages =
        (await search.json() as { messages?: Array<{ ID: string }> })
          .messages ?? [];
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

    await settleNavigation(page);
    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Ada");
    await page.getByLabel("Family name").fill("Lovelace");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const profilePath = new URL(page.url()).pathname;

    const target = new Date(Date.now() + 75_000);
    const targetDate = target.toISOString().slice(0, 10);
    const targetTime = target.toISOString().slice(11, 16);
    await settleNavigation(page);
    await page.goto(`${profilePath}?section=reminders`);
    const reminderSection = page.locator("#profile-section-reminders");
    await expect(reminderSection.getByText("No reminders yet.")).toBeVisible();
    const reminderForm = reminderSection.locator("form");
    const reminderTitle = reminderForm.getByLabel("Title");
    await reminderSection.getByRole("button", { name: "Add reminder" }).click();
    await expect(reminderForm).toBeVisible();
    await expect(reminderTitle).toBeFocused();
    await reminderTitle.pressSequentially("Call Ada once");
    await expect(reminderTitle).toHaveValue("Call Ada once");
    await reminderForm.getByLabel("First date").fill(targetDate);
    await reminderForm.getByLabel("Send time").fill(targetTime);
    await reminderForm.getByLabel("Repeat").selectOption("none");
    await reminderForm.getByRole("button", { name: "Save reminder" }).click();
    await expect(reminderSection.locator("li", { hasText: "Call Ada once" }))
      .toContainText("pending");

    await page.goto(`${profilePath}?section=stay-in-touch`);
    const cadenceSection = page.locator("#profile-section-stay-in-touch");
    await expect(cadenceSection.getByText("No stay-in-touch cadence yet."))
      .toBeVisible();
    const cadenceForm = cadenceSection.locator("form");
    const cadenceCount = cadenceForm.getByLabel("Reconnect every");
    await cadenceSection.getByRole("button", {
      name: "Add stay-in-touch cadence",
    }).click();
    await expect(cadenceForm).toBeVisible();
    await expect(cadenceCount).toBeFocused();
    await cadenceCount.fill("1");
    await cadenceForm.getByLabel("Calendar unit").selectOption("day");
    await cadenceForm.getByRole("button", { name: "Save cadence" }).click();
    await expect(cadenceSection.getByText("Stay-in-touch cadence is active."))
      .toBeVisible();

    await openPersonMenu(page);
    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(page.getByText("Archived person · read-only")).toBeVisible();
    const cadenceAdd = cadenceSection.locator("[data-cadence-add]");
    await expect(cadenceAdd).toHaveCount(1);
    await expect(cadenceAdd).toBeHidden();
    await expect(
      cadenceSection.locator('[data-cadence-form] button[type="submit"]'),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Restore person" }).click();

    await expect.poll(async () => {
      const response = await page.request.get(
        `${origin}/api/v1/today/reminders`,
      );
      if (response.status() !== 200) return "unavailable";
      const body = await response.json() as {
        reminders: Array<{
          status: string;
          title: string;
          visibleAt?: string;
        }>;
      };
      const item = body.reminders.find((item) =>
        item.title === "Call Ada once"
      );
      return item ? `${item.status}:${Boolean(item.visibleAt)}` : "missing";
    }, { timeout: 120_000 }).toBe("sent:true");
    await page.goto("/app");
    await expect(
      page.locator("#today-reminders-list li", { hasText: "Call Ada once" }),
    ).toContainText("Notification visible");
    await expect(
      page.locator("#today-cadences-list li", { hasText: "Ada Lovelace" }),
    ).toBeVisible();

    await page.evaluate(axe.source);
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);
  },
);
