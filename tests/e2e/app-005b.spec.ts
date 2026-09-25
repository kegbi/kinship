import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { settleNavigation } from "./support/navigation.ts";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";
const composeArgs = [
  "compose",
  "--file",
  "compose.yaml",
  "--file",
  "compose.test.yaml",
] as const;

function withExecRetry<T>(operation: () => T): T {
  for (let attempt = 1;; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

function database(statement: string, tuples = false): string {
  return withExecRetry(() =>
    execFileSync("docker", [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.POSTGRES_USER ?? "kinship_e2e",
      "-d",
      process.env.POSTGRES_DB ?? "kinship_e2e",
      ...(tuples ? ["-At"] : []),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ], { cwd: process.cwd(), encoding: "utf8", env: process.env })
  ).trim();
}

test("[INTERACTION-002] logs calls and conversations in the person workspace", {
  annotation: { type: "flow", description: "INTERACTION-002" },
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(10_000);
  const email = `communications-${browserName}-${Date.now()}@example.test`;
  expect(
    (await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Communication",
        lastName: "Writer",
        password,
        workspaceName: "Communication circle",
      },
    })).status(),
  ).toBe(202);
  let token = "";
  await expect.poll(async () => {
    const search = await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const messages =
      (await search.json() as { messages?: Array<{ ID: string }> }).messages ??
        [];
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
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
  const profilePath = new URL(page.url()).pathname;
  const personId = profilePath.split("/").at(-1)!;
  const workspaceId = database(
    `select workspace.id::text from crm.workspaces workspace join crm.users account on account.id = workspace.created_by_user_id where account.email = ${
      sqlLiteral(email)
    }`,
    true,
  );
  const channelTypeId = randomUUID();
  const contactMethodId = randomUUID();
  const emotionId = randomUUID();
  database(`
    insert into crm.contact_method_types (id, workspace_id, name, kind)
      values ('${channelTypeId}'::uuid, '${workspaceId}'::uuid, 'Email', 'email');
    insert into crm.person_contact_methods (id, person_id, type_id, value, is_primary)
      values ('${contactMethodId}'::uuid, '${personId}'::uuid, '${channelTypeId}'::uuid, 'ada@example.test', true);
    insert into crm.emotion_options (id, name) values ('${emotionId}'::uuid, 'Grateful ${emotionId}');
  `);

  await page.goto(`${profilePath}?section=calls`);
  const timeline = page.locator("#person-timeline");
  const calls = page.locator("#profile-section-calls");
  await expect(calls).toHaveAttribute("data-section-state", "ready");
  await calls.getByRole("button", { name: "Log call" }).click();
  const callForm = calls.locator("form");
  await callForm.getByLabel("Call direction").selectOption("contact");
  await callForm.getByLabel("Details (optional)").fill(
    "Planned the next visit.",
  );
  await callForm.getByLabel("Emotions (optional)").selectOption(emotionId);
  await callForm.getByRole("button", { name: "Save call" }).click();
  await expect(callForm.getByText("Call saved.")).toBeVisible();
  const callTimelineRow = timeline.locator("[data-timeline-id]", {
    hasText: "Planned the next visit.",
  });
  await expect(callTimelineRow).toHaveCount(1);
  await callTimelineRow.locator("summary").click();
  await expect(callTimelineRow).toContainText("Incoming call");
  await expect(callTimelineRow).toContainText("Emotions: Grateful");
  await expect(page.locator("[data-profile-last-contact]")).not.toHaveText(
    "None recorded",
  );

  const conversations = page.locator("#profile-section-conversations");
  await expect(conversations).toHaveAttribute("data-section-state", "ready");
  await conversations.getByRole("button", { name: "Log conversation" }).click();
  const conversationForm = conversations.locator("form");
  await conversationForm.getByLabel("Channel").selectOption(channelTypeId);
  await conversationForm.getByLabel("Specific contact method (optional)")
    .selectOption(contactMethodId);
  await conversationForm.getByLabel("Title (optional)").fill("Travel details");
  await conversationForm.getByRole("button", { name: "Add message" }).click();
  await conversationForm.getByRole("button", { name: "Add message" }).click();
  const rows = conversationForm.locator("[data-message-row]");
  await rows.nth(0).getByRole("textbox", { name: "Message" }).fill(
    "Did you arrive?",
  );
  await rows.nth(1).getByLabel("Direction").selectOption("inbound");
  await rows.nth(1).getByRole("textbox", { name: "Message" }).fill(
    "Yes, safely.",
  );
  await conversationForm.getByRole("button", { name: "Save conversation" })
    .click();
  await expect(conversationForm.getByText("Conversation saved.")).toBeVisible();
  const travelTimelineRow = timeline.locator("[data-timeline-id]", {
    hasText: "Travel details",
  });
  await expect(travelTimelineRow).toHaveCount(1);
  await travelTimelineRow.locator("summary").click();
  await expect(travelTimelineRow).toContainText("Outbound: Did you arrive?");
  await expect(travelTimelineRow).toContainText("Inbound: Yes, safely.");
  await expect(travelTimelineRow).toContainText("Via ada@example.test");

  const removeMessages = conversationForm.getByRole("button", {
    name: "Remove message",
  });
  while (await removeMessages.count() > 0) {
    await removeMessages.first().click();
  }
  await conversationForm.getByLabel("Title (optional)").fill(
    "Direction unknown",
  );
  await conversationForm.getByRole("button", { name: "Save conversation" })
    .click();
  const unknownDirectionTimelineRow = timeline.locator("[data-timeline-id]", {
    hasText: "Direction unknown",
  });
  await expect(unknownDirectionTimelineRow).toHaveCount(1);
  await unknownDirectionTimelineRow.locator("summary").click();
  await expect(unknownDirectionTimelineRow).toContainText(
    "Direction not recorded",
  );
  const invalidMethod = await page.request.post(
    `${origin}/api/v1/interactions`,
    {
      data: {
        channelTypeId,
        contactMethodId: randomUUID(),
        happenedAt: new Date().toISOString(),
        kind: "conversation",
        personId,
        requestId: randomUUID(),
      },
      headers: { origin },
    },
  );
  expect(invalidMethod.status()).toBe(404);

  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);
});
