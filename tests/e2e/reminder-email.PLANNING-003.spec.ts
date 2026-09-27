import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { registerVerified } from "./support/api.ts";
import { saveNewPerson } from "./support/directory.ts";
import { mailOrigin, origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

/**
 * How long past its due time a reminder email may take to arrive: a few
 * five-second worker ticks, the SMTP hand-off, and Mailpit indexing it.
 */
const DELIVERY_MARGIN_MS = 60_000;

/**
 * Polls Mailpit until a message to `email` matches `pattern`, for as long as
 * the worker needs to bring the reminder due at `due`, and returns its text.
 */
async function reminderMail(
  request: APIRequestContext,
  email: string,
  pattern: RegExp,
  due: Date,
): Promise<string> {
  let text: string | undefined;
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
      if (content.Text && pattern.test(content.Text)) text = content.Text;
    }
    return text;
  }, {
    timeout: Math.max(0, due.getTime() - Date.now()) + DELIVERY_MARGIN_MS,
  }).toBeTruthy();
  return text!;
}

/** Saves the reminder-delivery preferences through the settings form. */
async function chooseDelivery(
  page: Page,
  delivery: "both" | "email" | "in_app",
  digestTime: string,
): Promise<void> {
  await page.goto("/app/settings/preferences");
  const form = page.locator("#preferences-form");
  const choice = form.getByLabel("Reminder delivery");
  await expect(choice).toBeEnabled();
  await form.getByLabel("Time zone").fill("UTC");
  await choice.selectOption(delivery);
  await form.getByLabel("Daily email digest").fill(digestTime);
  await expect(page.locator("#reminder-delivery-hint")).toContainText(
    "verified email address",
  );
  await form.getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.locator("#settings-status")).toHaveText(
    "Preferences saved.",
  );
}

/** Adds a one-time reminder that comes due at `at`, read in UTC. */
async function addReminder(
  page: Page,
  profilePath: string,
  title: string,
  at: Date,
): Promise<void> {
  await page.goto(`${profilePath}?section=reminders`);
  await settlePersonWorkspace(page);
  const section = page.locator("#profile-section-reminders");
  const form = section.locator("form");
  const reminderTitle = form.getByLabel("Title");
  await section.getByRole("button", { name: "Add reminder" }).click();
  await expect(form).toBeVisible();
  await expect(reminderTitle).toBeFocused();
  await reminderTitle.pressSequentially(title);
  await expect(reminderTitle).toHaveValue(title);
  await form.getByLabel("First date").fill(at.toISOString().slice(0, 10));
  await form.getByLabel("Send time").fill(at.toISOString().slice(11, 16));
  await form.getByLabel("Repeat").selectOption("none");
  await form.getByRole("button", { name: "Save reminder" }).click();
  await expect(section.locator("li", { hasText: title })).toContainText(
    "pending",
  );
}

test(
  "[PLANNING-003] delivers a reminder email with the person link, then a daily digest",
  { annotation: { type: "flow", description: "PLANNING-003" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(480_000);
    page.setDefaultTimeout(15_000);
    const email = `reminder-email-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Reminder",
      lastName: "Reader",
      workspaceName: "Email reminders",
    }, bareToken);
    await signIn(page, email);
    const profilePath = await saveNewPerson(page, "Ada", "Lovelace");
    const personLink = `${origin}${profilePath}`;

    // Immediate email: no digest time, so the reminder is sent when due.
    await chooseDelivery(page, "email", "");
    await expectAccessible(page);
    const immediateAt = new Date(Date.now() + 75_000);
    await addReminder(page, profilePath, "Email Ada once", immediateAt);
    const immediate = await reminderMail(
      request,
      email,
      /Email Ada once/,
      immediateAt,
    );
    expect(immediate).toContain(personLink);

    // Digest: reminders due before the next digest time arrive together then.
    const due = new Date(Date.now() + 75_000);
    const digestAt = new Date(
      Math.ceil((due.getTime() + 60_000) / 60_000) * 60_000,
    );
    await chooseDelivery(page, "email", digestAt.toISOString().slice(11, 16));
    await addReminder(page, profilePath, "Digest Ada later", due);
    const digest = await reminderMail(
      request,
      email,
      /You have 1 reminder due\.[\s\S]*Digest Ada later/,
      digestAt,
    );
    expect(digest).toContain(personLink);
    expect(digest).not.toContain("Email Ada once");
  },
);
