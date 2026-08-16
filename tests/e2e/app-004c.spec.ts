import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

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

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseSql(statement: string): void {
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
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
}

function databaseValue(statement: string): string {
  return execFileSync("docker", [
    ...composeArgs,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    process.env.POSTGRES_USER ?? "kinship_e2e",
    "-d",
    process.env.POSTGRES_DB ?? "kinship_e2e",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ], { cwd: process.cwd(), encoding: "utf8", env: process.env }).trim();
}

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
  expect(
    (await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Facts",
        lastName: "Writer",
        password,
        workspaceName: "Profile facts circle",
      },
    })).status(),
  ).toBe(202);
  expect(
    (await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token: await verificationToken(request, email) },
    })).status(),
  ).toBe(200);
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
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);
}

test("[PEOPLE-006] maintains enabled profile facts in local person sections", {
  annotation: { type: "flow", description: "PEOPLE-006" },
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  const email = `profile-facts-${browserName}-${Date.now()}@example.test`;
  await registerVerified(request, email);
  await signIn(page, email);
  const workspaceId = databaseValue(
    `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
      sqlLiteral(email)
    }`,
  );
  const typeId = randomUUID();
  const labelId = randomUUID();
  const petCategoryId = randomUUID();
  const tagId = randomUUID();
  const introducerId = randomUUID();
  databaseSql(`
    insert into crm.contact_method_types (id, workspace_id, name, kind)
    values ('${typeId}'::uuid, '${workspaceId}'::uuid, 'Email', 'email');
    insert into crm.contact_labels (id, workspace_id, label, applies_to)
    values ('${labelId}'::uuid, '${workspaceId}'::uuid, 'Home', 'any');
    insert into crm.pet_categories (id, name, is_common)
    values ('${petCategoryId}'::uuid, 'Cat ${petCategoryId}', true);
    insert into crm.tags (id, workspace_id, name, slug)
    values ('${tagId}'::uuid, '${workspaceId}'::uuid, 'Friend', 'friend-${tagId}');
    insert into crm.people (id, workspace_id, given_name, family_name)
    values ('${introducerId}'::uuid, '${workspaceId}'::uuid, 'Charles', 'Babbage');
  `);

  await page.goto("/app/people/new");
  await page.getByLabel("Given name").fill("Ada");
  await page.getByLabel("Family name").fill("Lovelace");
  let releaseContacts = () => {};
  const contactsReleased = new Promise<void>((resolve) =>
    releaseContacts = resolve
  );
  let delayContacts = true;
  await page.route("**/facts/contact-methods", async (route) => {
    if (delayContacts && route.request().method() === "GET") {
      delayContacts = false;
      await contactsReleased;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
  const profilePath = new URL(page.url()).pathname;
  await page.goto(profilePath);
  const contacts = page.locator("#profile-section-contact-methods");
  await expect(contacts).toHaveAttribute("data-section-state", "loading");
  await expect(contacts.getByText("Loading contact methods…")).toBeVisible();
  releaseContacts();
  await expect(contacts).toHaveAttribute("data-section-state", "ready");
  await expect(contacts.getByText("No contact methods saved.")).toBeVisible();
  await expect(
    page.locator(
      '[data-profile-fact-section][data-section-state="loading"]',
    ),
  ).toHaveCount(0);

  const calls: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().includes("/facts/")) {
      calls.push(`${outgoing.method()} ${new URL(outgoing.url()).pathname}`);
    }
  });
  await contacts.getByRole("button", { name: "Add contact methods" }).click();
  const contactType = contacts.locator('select[name="typeId"]');
  await expect(contactType).toBeFocused();
  await expect.poll(() => calls).toEqual([
    `GET /api/v1/people/${profilePath.split("/").at(-1)}/facts/contact-methods`,
  ]);
  await contactType.selectOption(typeId);
  await contacts.getByLabel("Contact value").fill("ada@example.test");
  await contacts.getByLabel("Contact labels").selectOption([labelId]);
  await contacts.getByLabel("Primary for this contact type").check();
  calls.length = 0;
  await contacts.getByRole("button", { name: "Save profile fact" }).click();
  await expect(contacts.getByText("Profile fact saved.")).toBeFocused();
  await expect(contacts).toContainText("Email: ada@example.test");
  await expect.poll(() => calls).toEqual([
    `POST /api/v1/people/${
      profilePath.split("/").at(-1)
    }/facts/contact-methods`,
    `GET /api/v1/people/${profilePath.split("/").at(-1)}/facts/contact-methods`,
  ]);

  const address = page.locator("#profile-section-addresses");
  await address.getByRole("button", { name: "Add addresses" }).click();
  await address.getByLabel("Address name").fill("Home");
  await address.getByLabel("Street").fill("1 Analytical Engine Way");
  await address.getByLabel("City").fill("London");
  await address.locator('select[name="labelIds"]').selectOption([labelId]);
  await address.getByLabel("Primary address").check();
  await address.getByRole("button", { name: "Save profile fact" }).click();
  await expect(address).toContainText("Home, 1 Analytical Engine Way, London");

  const firstMeeting = page.locator("#profile-section-first-meeting");
  await firstMeeting.getByRole("button", { name: "Add first meeting" }).click();
  await firstMeeting.getByLabel("Search people").fill("Charles");
  await firstMeeting.getByRole("button", { name: "Search people" }).click();
  await firstMeeting.getByLabel("Introduced by").selectOption(introducerId);
  await firstMeeting.getByLabel("Where or how you first met").fill(
    "London salon",
  );
  await firstMeeting.getByLabel("First meeting story").fill(
    "Introduced while discussing mathematics",
  );
  await firstMeeting.getByRole("button", { name: "Save profile fact" }).click();
  await expect(firstMeeting).toContainText(
    "London salon — Introduced while discussing mathematics",
  );

  const work = page.locator("#profile-section-work");
  await work.getByRole("button", { name: "Add work" }).click();
  await work.getByLabel("Role or title").fill("Mathematician");
  await work.getByLabel("Organization").fill("Analytical Engines");
  await work.getByLabel("Start date").fill("2026-01-02");
  await work.getByLabel("End date").fill("2026-01-01");
  await work.getByRole("button", { name: "Save profile fact" }).click();
  await expect(work.getByText("End date must be on or after the start date."))
    .toBeVisible();
  await expect(work.getByLabel("End date")).toBeFocused();
  await work.getByLabel("End date").fill("2026-12-31");
  await work.getByRole("button", { name: "Save profile fact" }).click();
  await expect(work).toContainText("Mathematician at Analytical Engines");

  await page.getByRole("button", { name: "Edit tags" }).click();
  await page.getByLabel("Assigned tags").selectOption([tagId]);
  await page.getByRole("button", { name: "Save profile fact" }).click();
  await expect(page.locator("#person-profile-tags")).toContainText("Friend");

  const pets = page.locator("#profile-section-pets");
  await pets.getByRole("button", { name: "Add pets" }).click();
  await pets.getByLabel("Pet name").fill("Byron");
  await pets.getByLabel("Pet category").selectOption(petCategoryId);
  await pets.getByRole("button", { name: "Save profile fact" }).click();
  await expect(pets).toContainText("Byron · Cat");

  const food = page.locator("#profile-section-food-preferences");
  await food.getByRole("button", { name: "Add food preferences" }).click();
  await food.getByLabel("Food, allergy, and dietary preferences").fill(
    "Tea; no shellfish",
  );
  await food.getByRole("button", { name: "Save profile fact" }).click();
  await expect(food).toContainText("Tea; no shellfish");
  await food.getByRole("button", { name: "Clear food preferences" }).click();
  await food.getByRole("button", {
    name: "Confirm clear food preferences",
  }).click();
  await expect(
    food.getByRole("list", { name: "Saved food preferences" }).getByRole(
      "listitem",
    ),
  ).toHaveCount(0);
  await expect(food.getByRole("button", { name: "Add food preferences" }))
    .toBeVisible();
  await food.getByRole("button", { name: "Add food preferences" }).click();
  await food.getByLabel("Food, allergy, and dietary preferences").fill(
    "Tea; no shellfish",
  );
  await food.getByRole("button", { name: "Save profile fact" }).click();
  await expectAccessible(page);

  await page.reload();
  await expect(contacts).toContainText("ada@example.test");
  await expect(address).toContainText("Analytical Engine Way");
  await expect(firstMeeting).toContainText("London salon");
  await expect(work).toContainText("Analytical Engines");
  await expect(pets).toContainText("Byron");
  await expect(food).toContainText("no shellfish");
  expect(
    databaseValue(
      `select introduced_by_person_id::text from crm.person_first_meetings where person_id = '${
        profilePath.split("/").at(-1)
      }'::uuid`,
    ),
  ).toBe(introducerId);

  databaseSql(
    `insert into crm.workspace_profile_modules (workspace_id, key, is_active) values ('${workspaceId}'::uuid, 'tags', false)`,
  );
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false },
      }),
    )
  );
  await expect(page.locator('[data-profile-fact-section="tags"]'))
    .toHaveAttribute("data-section-state", "hidden");
  await expect(page.locator("#person-profile-tags")).toBeHidden();
  await expect(page.locator("body")).not.toContainText("Friend");
  expect(await page.locator("body").innerHTML()).not.toContain(tagId);
  expect(
    databaseValue(
      `select count(*) from crm.person_tags link join crm.people person on person.id = link.person_id where person.workspace_id = '${workspaceId}'::uuid`,
    ),
  ).toBe("1");
  databaseSql(
    `update crm.workspace_profile_modules set is_active = true where workspace_id = '${workspaceId}'::uuid and key = 'tags'`,
  );
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false },
      }),
    )
  );
  await expect(page.locator("#person-profile-tags")).toContainText("Friend");

  databaseSql(
    `insert into crm.workspace_profile_modules (workspace_id, key, is_active) values ('${workspaceId}'::uuid, 'contact-methods', false)`,
  );
  await page.reload();
  await expect(contacts).toBeHidden();
  expect(
    databaseValue(
      `select count(*) from crm.person_contact_methods method join crm.people person on person.id = method.person_id where person.workspace_id = '${workspaceId}'::uuid`,
    ),
  ).toBe("1");

  databaseSql(
    `update crm.workspace_profile_modules set is_active = true where workspace_id = '${workspaceId}'::uuid and key = 'contact-methods'`,
  );
  await page.route("**/facts/contact-methods", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        contentType: "application/problem+json",
        json: {
          code: "unavailable",
          detail: "Fixture",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        },
        status: 503,
      });
    }
    await route.continue();
  });
  await page.reload();
  await expect(contacts).toHaveAttribute("data-section-state", "error");
  await expect(
    contacts.getByText(
      "This profile section is temporarily unavailable. Try again.",
    ),
  ).toBeVisible();
  await page.unroute("**/facts/contact-methods");
  await page.route("**/facts/contact-methods", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        contentType: "application/problem+json",
        json: {
          code: "people_forbidden",
          detail: "Fixture",
          status: 403,
          title: "Forbidden",
          type: "about:blank",
        },
        status: 403,
      });
    }
    await route.continue();
  });
  await page.reload();
  await expect(contacts).toHaveAttribute("data-section-state", "forbidden");
  await expect(
    contacts.getByText("Your active workspace no longer permits this action."),
  ).toBeVisible();
  await page.unroute("**/facts/contact-methods");
  await page.goto(profilePath);
  await page.getByRole("button", { name: "Archive person" }).click();
  await expect(contacts).toHaveAttribute("data-section-state", "read-only");
  await expect(contacts.getByRole("button", { name: /Add|Edit|Delete/ }))
    .toHaveCount(0);
  await expect(contacts).toContainText("ada@example.test");
  await expectAccessible(page);
});
