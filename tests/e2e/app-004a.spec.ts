import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

async function verificationToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let token: string | undefined;
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
      const link = content.Text?.match(/https?:\/\/\S+\?token=\S+/)?.[0];
      if (link && new URL(link).pathname === "/auth/verify-email") {
        token = new URL(link).searchParams.get("token") ?? undefined;
      }
    }
    return token;
  }).toBeTruthy();
  return token!;
}

async function registerVerified(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Lifecycle",
      lastName: "Writer",
      password,
      workspaceName: "Lifecycle circle",
    },
  })).status()).toBe(202);
  expect((await request.post(`${origin}/api/v1/email-verifications`, {
    data: { token: await verificationToken(request, email) },
  })).status()).toBe(200);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () =>
    (await (globalThis as typeof globalThis & {
      axe: { run(): Promise<{ violations: unknown[] }> };
    }).axe.run()).violations
  );
  expect(violations).toEqual([]);
}

test(
  "[PEOPLE-004] edits, archives, restores, and explicitly deletes a person",
  { annotation: { type: "flow", description: "PEOPLE-004" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    const email = `lifecycle-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);

    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Ada");
    await page.locator(
      '#people-create-form input[name="familyName"]',
    ).fill("Lovelace");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();
    const personPath = new URL(page.url()).pathname;
    await page.goto(personPath);
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit person" }).click();
    await page.locator(
      '#person-edit-form input[name="familyName"]',
    ).fill("Byron");
    await page.getByRole("button", { name: "Save person" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada Byron" }),
    ).toBeFocused();
    await expect(page.locator("#person-lifecycle-status")).toContainText(
      "Person identity updated",
    );

    await page.getByRole("button", { name: "Delete person" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this person?" });
    await expect(dialog).toContainText("Related records are retained");
    await expect(dialog).toContainText("DELETE Ada Byron");
    const confirmation = page.getByLabel("Confirmation");
    const deleteRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "DELETE" &&
        request.url().includes("/api/v1/people/")
      ) {
        deleteRequests.push(request.url());
      }
    });
    await expect(confirmation).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() =>
      dialog.evaluate((element) =>
        element.contains(element.ownerDocument.activeElement)
      )
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect.poll(() =>
      dialog.evaluate((element) =>
        element.contains(element.ownerDocument.activeElement)
      )
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Delete person" }))
      .toBeFocused();
    expect(deleteRequests).toHaveLength(0);

    await page.getByRole("button", { name: "Delete person" }).click();
    await expect(dialog).toContainText("DELETE Ada Byron");
    await page.getByRole("button", { name: "Cancel delete" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Delete person" }))
      .toBeFocused();
    expect(deleteRequests).toHaveLength(0);
    await expect(page.locator("#person-lifecycle-status")).toContainText(
      "Delete cancelled",
    );

    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(page.getByText("Archived person · read-only")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit person" }))
      .toBeHidden();
    await expect(page.locator("#person-lifecycle-status")).toContainText(
      "They now appear in Archived people",
    );
    await expectAccessible(page);

    await page.goto("/app/people/archived");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "people.archived",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Ada Byron" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Ada Byron/ }).click();
    await expect(page).toHaveURL(new RegExp(`${personPath}$`));
    await page.getByRole("button", { name: "Restore person" }).click();
    await expect(page.getByText("Archived person · read-only")).toBeHidden();
    await expect(page.locator("#person-lifecycle-status")).toContainText(
      "They now appear in People",
    );

    await page.goto("/app/people");
    await expect(
      page.getByRole("heading", { level: 2, name: "Ada Byron" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Ada Byron/ }).click();
    await page.getByRole("button", { name: "Delete person" }).click();
    await expect(dialog).toContainText("Related records are retained");
    await page.getByLabel("Confirmation").fill("DELETE Ada Byron");
    await page.getByRole("button", { name: "Confirm delete" }).dblclick();
    await expect(page).toHaveURL(/\/app\/people$/);
    expect(deleteRequests).toHaveLength(1);
    await expect(page.getByRole("heading", { level: 2, name: "Ada Byron" }))
      .toHaveCount(0);
    await page.goto("/app/people/archived");
    await expect(page.getByRole("heading", { level: 2, name: "Ada Byron" }))
      .toHaveCount(0);
    await expectAccessible(page);
  },
);
