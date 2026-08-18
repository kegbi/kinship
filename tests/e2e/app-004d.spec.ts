import { expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";
test(
  "[RELATIONSHIP-001] creates, changes, inversely displays, and unlinks relationships",
  { annotation: { type: "flow", description: "RELATIONSHIP-001" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    const email = `relationships-${browserName}-${Date.now()}@example.test`;
    expect(
      (await request.post(`${origin}/api/v1/registrations`, {
        data: {
          email,
          firstName: "Graph",
          lastName: "Writer",
          password,
          workspaceName: "Relationship circle",
        },
      })).status(),
    ).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const search = await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
      );
      const body = await search.json() as { messages?: Array<{ ID: string }> };
      for (const message of body.messages ?? []) {
        const detail = await request.get(
          `${mailOrigin}/api/v1/message/${message.ID}`,
        );
        const text = (await detail.json() as { Text?: string }).Text ?? "";
        token = text.match(/token=([^\s]+)/)?.[1] ?? token;
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
    async function createPerson(givenName: string, familyName: string) {
      await page.goto("/app/people/new");
      await page.getByLabel("Given name").fill(givenName);
      await page.getByLabel("Family name").fill(familyName);
      await page.getByRole("button", { name: "Save person", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
      return new URL(page.url()).pathname;
    }
    const sourcePath = await createPerson("Ada", "Lovelace");
    const targetPath = await createPerson("Charles", "Babbage");
    const targetId = targetPath.split("/").at(-1)!;
    await page.goto(sourcePath);
    const section = page.locator("#profile-section-relationships");
    await expect(section).toHaveAttribute("data-section-state", "ready");
    await expect(section.getByText("No relationships saved.")).toBeVisible();
    await section.getByRole("button", { name: "Add relationship" }).click();
    await expect(section.getByRole("searchbox", {
      name: "Search relationship types",
      exact: true,
    })).toBeVisible();
    await expect(section.getByRole("navigation", {
      name: "Relationship type pages",
      exact: true,
    })).toHaveCount(1);
    await expect(section.locator("#relationship-types-previous")).toBeHidden();
    await expect(section.locator("#relationship-types-next")).toBeVisible();
    const relationshipType = section.getByRole("combobox", {
      name: "Relationship type",
      exact: true,
    });
    const relationshipForm = section.locator("#relationship-form");
    const submitRelationship = relationshipForm.locator(
      'button[type="submit"]',
    );
    await section.locator("#relationship-types-next").click();
    await expect(relationshipType.getByRole("option", {
      name: "mentor / protege",
      exact: true,
    })).toHaveCount(1);
    await expect(section.locator("#relationship-types-next")).toBeHidden();
    await expect(section.locator("#relationship-types-previous")).toBeVisible();
    await expect(relationshipType).toBeFocused();
    await section.locator("#relationship-types-previous").click();
    await expect(relationshipType.getByRole("option", {
      name: "parent / child",
      exact: true,
    })).toHaveCount(1);
    await expect(section.locator("#relationship-types-previous")).toBeHidden();
    await expect(section.locator("#relationship-types-next")).toBeVisible();
    await expect(relationshipType).toBeFocused();
    const peopleResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" &&
        url.pathname === "/api/v1/people" &&
        url.searchParams.get("search") === "Charles";
    });
    await section.getByLabel("Search people").fill("Charles");
    const searchPeople = section.getByRole("button", {
      name: "Search people",
      exact: true,
    });
    await searchPeople.focus();
    await searchPeople.press("Enter");
    expect((await peopleResponse).ok()).toBe(true);
    await expect(
      section.locator(`#relationship-target option[value="${targetId}"]`),
    ).toHaveText("Charles Babbage");
    await section.getByLabel("Related person").selectOption(targetId);
    await relationshipType.selectOption({ label: "parent / child" });
    const calls: string[] = [];
    page.on("request", (outgoing) => {
      const path = new URL(outgoing.url()).pathname;
      if (
        path.includes("/relationships") ||
        path === `/api/v1/people/${sourcePath.split("/").at(-1)}`
      ) calls.push(`${outgoing.method()} ${path}`);
    });
    await submitRelationship.click();
    await expect(
      section.getByText("Relationship saved on both person workspaces."),
    ).toBeFocused();
    await expect(section).toContainText("parent: Charles Babbage");
    expect(
      calls.some((call) =>
        call.startsWith("GET") && !call.endsWith("/relationships")
      ),
    ).toBe(false);

    await page.goto(targetPath);
    const inverse = page.locator("#profile-section-relationships");
    await expect(inverse).toContainText("child: Ada Lovelace");
    await inverse.getByLabel("Relationship type for Ada Lovelace").selectOption(
      { label: "grandparent / grandchild" },
    );
    await inverse.getByRole("button", {
      name: "Save relationship with Ada Lovelace",
    }).click();
    await expect(inverse).toContainText("grandchild: Ada Lovelace");
    await page.goto(sourcePath);
    await expect(section).toContainText("grandparent: Charles Babbage");

    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(section).toHaveAttribute("data-section-state", "read-only");
    await expect(section).toContainText(
      "Relationships are read-only because this person is archived.",
    );
    await expect(section.getByRole("button", { name: "Add relationship" }))
      .toBeHidden();
    await expect(section.getByRole("button", {
      name: "Unlink Charles Babbage",
    })).toHaveCount(0);
    await page.getByRole("button", { name: "Restore person" }).click();
    await expect(section).toHaveAttribute("data-section-state", "ready");
    await expect(section.getByRole("button", { name: "Add relationship" }))
      .toBeVisible();
    await expect(section.getByRole("button", {
      name: "Unlink Charles Babbage",
    })).toBeVisible();

    await page.goto(targetPath);
    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(page.locator("#profile-section-relationships"))
      .toHaveAttribute("data-section-state", "read-only");
    await page.goto(sourcePath);
    await section.getByRole("button", {
      name: "Save relationship with Charles Babbage",
    }).click();
    await expect(section).toContainText(
      "Restore both people before changing their relationship.",
    );
    await page.goto(targetPath);
    await page.getByRole("button", { name: "Restore person" }).click();
    await page.goto(sourcePath);
    await section.getByRole("button", { name: "Unlink Charles Babbage" })
      .click();
    await expect(
      section.getByText("People unlinked. Neither person was deleted."),
    ).toBeFocused();
    await expect(section.getByText("No relationships saved.")).toBeVisible();

    await section.getByRole("button", { name: "Add relationship" }).click();
    await section.getByLabel("New person given name").fill("Grace");
    await section.getByLabel("New person family name").fill("Hopper");
    await relationshipType.selectOption({
      label: "grandparent / grandchild",
    });
    await submitRelationship.click();
    await expect(section).toContainText("grandparent: Grace Hopper");
    await section.getByRole("button", { name: "Add relationship" }).click();
    await section.getByLabel("New person given name").fill("Grace");
    await section.getByLabel("New person family name").fill("Hopper");
    await relationshipType.selectOption({ label: "parent / child" });
    await submitRelationship.click();
    await expect(section.getByRole("group", {
      name: "Possible duplicate person choices",
    })).toBeVisible();
    await expect(section.getByLabel("New person given name")).toHaveValue(
      "Grace",
    );
    await section.getByRole("button", { name: "Create anyway" }).click();
    await expect(section).toContainText("parent: Grace Hopper");
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
