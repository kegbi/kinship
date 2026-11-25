import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { registerVerified } from "./support/api.ts";
import { saveNewPerson } from "./support/directory.ts";
import { mailOrigin, origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import { expectAccessible } from "./support/page-checks.ts";
import {
  ageDueReminder,
  bringReminderDue,
  upcomingSendTime,
} from "./support/reminders.ts";
import { signIn } from "./support/sign-in.ts";

/**
 * How long a due reminder's email may take to arrive: a few five-second worker
 * ticks, the SMTP hand-off, and Mailpit indexing it.
 */
const DELIVERY_MARGIN_MS = 60_000;

/** Longer than two worker ticks, each of which would claim what is due. */
const HELD_MS = 12_000;

/** The text of a message to `email` in Mailpit that matches `pattern`. */
async function findMail(
  request: APIRequestContext,
  email: string,
  pattern: RegExp,
): Promise<string | undefined> {
  const response = await request.get(
    `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const body = await response.json() as { messages?: Array<{ ID: string }> };
  for (const message of body.messages ?? []) {
    const detail = await request.get(
      `${mailOrigin}/api/v1/message/${message.ID}`,
    );
    const content = await detail.json() as { Text?: string };
    if (content.Text && pattern.test(content.Text)) return content.Text;
  }
  return undefined;
}

/** Polls Mailpit for that message while the worker delivers it. */
async function reminderMail(
  request: APIRequestContext,
  email: string,
  pattern: RegExp,
): Promise<string> {
  let text: string | undefined;
  await expect.poll(async () => {
    text = await findMail(request, email, pattern);
    return text;
  }, { timeout: DELIVERY_MARGIN_MS }).toBeTruthy();
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
    test.setTimeout(240_000);
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
    const immediateAt = upcomingSendTime();
    await addReminder(page, profilePath, "Email Ada once", immediateAt);
    bringReminderDue(email, "Email Ada once", immediateAt);
    const immediate = await reminderMail(request, email, /Email Ada once/);
    expect(immediate).toContain(personLink);

    // Digest: a reminder due since the last digest time waits for the next
    // one, and those due before a digest time arrive together then. Five
    // minutes ago is the latest digest time throughout, read in UTC.
    const digestAt = new Date(Date.now() - 5 * 60_000);
    await chooseDelivery(page, "email", digestAt.toISOString().slice(11, 16));
    const digestDue = upcomingSendTime();
    await addReminder(page, profilePath, "Digest Ada later", digestDue);
    bringReminderDue(email, "Digest Ada later", digestDue);
    await page.waitForTimeout(HELD_MS);
    expect(await findMail(request, email, /Digest Ada later/)).toBeUndefined();
    ageDueReminder(email, "Digest Ada later");
    const digest = await reminderMail(
      request,
      email,
      /You have 1 reminder due\.[\s\S]*Digest Ada later/,
    );
    expect(digest).toContain(personLink);
    expect(digest).not.toContain("Email Ada once");
  },
);
