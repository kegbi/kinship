import { expect, type Page, test } from "@playwright/test";
import axe from "axe-core";
import {
  settleNavigation,
  settlePersonWorkspace,
} from "./support/navigation.ts";

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
  "[PLANNING-001] creates, changes, completes, and reopens person and workspace tasks",
  {
    annotation: { type: "flow", description: "PLANNING-001" },
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(10_000);
    const email = `tasks-${browserName}-${Date.now()}@example.test`;
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Task",
        lastName: "Writer",
        password,
        workspaceName: "Task circle",
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

    await settlePersonWorkspace(page);
    await page.goto(`${profilePath}?section=tasks`);
    const taskSection = page.locator("#profile-section-tasks");
    await expect(taskSection).toHaveAttribute("data-section-state", "ready");
    await expect(taskSection.getByText("No tasks in this view.")).toBeVisible();
    await taskSection.getByRole("button", { name: "Add task" }).click();
    const personForm = taskSection.locator("form");
    await personForm.getByLabel("Title").fill("Call Ada");
    const due = new Date();
    due.setDate(due.getDate() + 2);
    const localDue = new Date(due.getTime() - due.getTimezoneOffset() * 60_000)
      .toISOString().slice(0, 16);
    await personForm.getByLabel("Due time (optional)").fill(localDue);
    await personForm.getByRole("button", { name: "Save task" }).click();
    const personOpenTask = taskSection.locator("[data-task-open-list] li", {
      hasText: "Call Ada",
    });
    await expect(personOpenTask).toBeVisible();

    await openPersonMenu(page);
    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(page.getByText("Archived person · read-only")).toBeVisible();
    await expect(taskSection.getByRole("button", { name: "Add task" }))
      .toBeHidden();
    await expect(personOpenTask).toContainText("archived");
    await expect(personOpenTask.getByRole("button", { name: "Complete" }))
      .toHaveCount(0);
    await page.getByRole("button", { name: "Restore person" }).click();
    await expect(page.getByText("Archived person · read-only")).toBeHidden();

    await page.getByLabel("Primary navigation").getByRole("link", {
      name: "Tasks",
    }).click();
    await expect(page).toHaveURL(/\/app\/tasks$/);
    const globalPersonTask = page.locator("[data-task-open-list] li", {
      hasText: "Call Ada",
    });
    await expect(globalPersonTask).toContainText("Ada Lovelace");
    await page.getByRole("button", { name: "Add task" }).click();
    const globalForm = page.locator("[data-task-form]");
    await globalForm.getByLabel("Title").fill("Review notes");
    await globalForm.getByRole("button", { name: "Save task" }).click();
    const workspaceTask = page.locator("[data-task-open-list] li", {
      hasText: "Review notes",
    });
    await expect(workspaceTask).toContainText("Workspace task");
    await workspaceTask.getByRole("button", { name: "Edit task" }).click();
    await globalForm.getByLabel("Title").fill("Review shared notes");
    await globalForm.getByRole("button", { name: "Save task" }).click();
    await expect(
      page.locator("[data-task-open-list] li", {
        hasText: "Review shared notes",
      }),
    ).toBeVisible();

    const taskId = await globalPersonTask.getAttribute("data-task-id");
    expect(taskId).toBeTruthy();
    await globalPersonTask.getByRole("button", { name: "Complete" }).click();
    const completedTask = page.locator("[data-task-completed-list] li", {
      hasText: "Call Ada",
    });
    await expect(completedTask).toBeVisible();
    await completedTask.getByRole("button", { name: "Edit task" }).click();
    await globalForm.getByLabel("Title").fill("Call Ada after completion");
    await globalForm.getByRole("button", { name: "Save task" }).click();
    const editedCompletedTask = page.locator(
      "[data-task-completed-list] li",
      { hasText: "Call Ada after completion" },
    );
    await expect(editedCompletedTask).toBeVisible();
    await expect(
      page.locator("[data-task-open-list] li", {
        hasText: "Call Ada after completion",
      }),
    ).toHaveCount(0);
    const repeated = await page.request.put(
      `${origin}/api/v1/tasks/${taskId}/completion`,
      {
        data: { completed: true },
        headers: { origin },
      },
    );
    expect(repeated.status()).toBe(200);
    expect((await repeated.json() as { status: string }).status).toBe(
      "unchanged",
    );
    await editedCompletedTask.getByRole("button", { name: "Reopen" }).click();
    const reopenedTask = page.locator("[data-task-open-list] li", {
      hasText: "Call Ada after completion",
    });
    await expect(reopenedTask).toBeVisible();
    await reopenedTask.getByRole("button", { name: "Edit task" }).click();
    await globalForm.getByLabel("State").selectOption("cancelled");
    await globalForm.getByRole("button", { name: "Save task" }).click();
    const cancelledTask = page.locator("[data-task-cancelled-list] li", {
      hasText: "Call Ada after completion",
    });
    await expect(cancelledTask).toBeVisible();
    await cancelledTask.getByRole("button", { name: "Reopen" }).click();
    await expect(reopenedTask).toBeVisible();

    await page.goto("/app");
    await expect(page.locator("#today-next-seven-list li", {
      hasText: "Call Ada after completion",
    }))
      .toBeVisible();
    await expect(
      page.locator(".attention-groups li", { hasText: "Review shared notes" }),
    ).toHaveCount(0);

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
