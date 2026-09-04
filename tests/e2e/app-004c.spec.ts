import {
  type APIRequestContext,
  expect,
  type Locator,
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

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseSql(statement: string): void {
  withExecRetry(() =>
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
    ], { cwd: process.cwd(), env: process.env, stdio: "pipe" })
  );
}

function databaseValue(statement: string): string {
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
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ], { cwd: process.cwd(), encoding: "utf8", env: process.env })
  ).trim();
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

async function openPersonMenu(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open person menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
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

async function openLocalEditor(
  trigger: Locator,
  editor: Locator,
): Promise<void> {
  await expect(trigger).toHaveCount(1);
  await expect(editor).toHaveCount(1);
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(editor).toBeVisible();
}

async function controlPresentation(control: Locator) {
  await expect(control).toBeVisible();
  return await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      alignItems: style.alignItems,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      color: style.color,
      display: style.display,
      fontFamily: style.fontFamily,
      height: element.getBoundingClientRect().height,
      justifyContent: style.justifyContent,
      minHeight: style.minHeight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      paddingTop: style.paddingTop,
    };
  });
}

async function expectAlignedControls(
  first: Locator,
  second: Locator,
): Promise<void> {
  const [firstStyle, secondStyle] = await Promise.all([
    controlPresentation(first),
    controlPresentation(second),
  ]);
  expect(Math.abs(firstStyle.height - secondStyle.height)).toBeLessThanOrEqual(
    0.5,
  );
  for (
    const property of [
      "alignItems",
      "borderRadius",
      "borderStyle",
      "borderWidth",
      "display",
      "fontFamily",
      "justifyContent",
      "minHeight",
      "paddingBottom",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
    ] as const
  ) {
    expect(firstStyle[property]).toBe(secondStyle[property]);
  }
}

test(
  "[PEOPLE-006] PRF-001 scans profile blocks and edits long facts across screen sizes",
  {
    annotation: { type: "flow", description: "PEOPLE-006" },
  },
  async ({ browserName, page, request }, testInfo) => {
    test.setTimeout(180_000);
    const email = `profile-blocks-${browserName}-${Date.now()}@example.test`;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await registerVerified(request, email);
    await signIn(page, email);
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const personId = randomUUID();
    const typeId = randomUUID();
    const revision = "2026-08-16T12:00:00.000000Z";
    const longEmail =
      "ada.lovelace.correspondence@analytical-engines.example.test";
    databaseSql(
      `insert into crm.people (id, workspace_id, given_name, family_name, description)
    values ('${personId}'::uuid, '${workspaceId}'::uuid, 'Ada', 'Lovelace', 'Mathematician, writer, and a friend from the Analytical Society.');
    insert into crm.notes (workspace_id, person_id, body)
    select '${workspaceId}'::uuid, '${personId}'::uuid,
      'Conversation ' || sequence || ': discussed mathematics and plans for the next visit.'
    from generate_series(1, 8) sequence;`,
    );
    await page.route(`**/people/${personId}/facts/*`, async (route) => {
      const section = new URL(route.request().url()).pathname.split("/").at(
        -1,
      )!;
      const values: Record<string, unknown> = {
        "contact-methods": {
          typeId,
          labelIds: [],
          isPrimary: true,
          value: longEmail,
        },
        addresses: {
          displayName: "Home",
          street: "1 Analytical Engine Way, Apartment 123",
          city: "London",
          region: "Greater London",
          postalCode: "SW1A 1AA",
          country: "United Kingdom",
          isPrimary: true,
          labelIds: [],
        },
        work: {
          title: "Mathematician and scientific correspondent",
          organizationName: "Analytical Engines Research Society",
          isCurrent: true,
        },
        "food-preferences": {
          foodPreferences:
            "Vegetarian meals; no shellfish. Loves a pot of tea after a long walk.",
        },
      };
      await route.fulfill({
        json: {
          options: section === "contact-methods"
            ? [{ id: typeId, kind: "contact-type", name: "Personal email" }]
            : [],
          personUpdatedAt: revision,
          status: "ready",
          records: values[section]
            ? [{
              id: randomUUID(),
              section,
              updatedAt: revision,
              value: values[section],
            }]
            : [],
        },
      });
    });
    await page.goto(`/app/people/${personId}`);
    const contacts = page.locator("#profile-section-contact-methods");
    const relationships = page.locator("#profile-section-relationships");
    const address = page.locator("#profile-section-addresses");
    await expect(contacts).toContainText(longEmail);
    await expect(address).toContainText("Greater London");
    await expect(page.locator("[data-timeline-list] > li")).toHaveCount(8);
    await expect(
      page.locator('.profile-facts-rail [data-section-state="loading"]'),
    ).toHaveCount(0);
    if (await page.locator("#person-first-run").isVisible()) {
      await page.getByRole("button", { name: "Show all sections" }).click();
    }
    const directory = page.locator(".profile-section-directory");
    for (
      const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 768, height: 900 },
        { width: 1050, height: 900 },
      ]
    ) {
      const { width } = viewport;
      await page.setViewportSize(viewport);
      const layout = await page.locator(".profile-facts-column").evaluate((
        element,
      ) => ({
        position: getComputedStyle(element).position,
        overflow: getComputedStyle(element).overflowY,
        maxHeight: getComputedStyle(element).maxHeight,
      }));
      expect(layout).toEqual({
        position: "static",
        overflow: "visible",
        maxHeight: "none",
      });
      const [contactBox, relationshipBox, streamBox] = await Promise.all([
        contacts.boundingBox(),
        relationships.boundingBox(),
        page.locator(".profile-section-list").boundingBox(),
      ]);
      expect(contactBox!.width).toBeGreaterThanOrEqual(
        width >= 1200 ? 245 : 300,
      );
      if (width >= 1200) {
        expect(relationshipBox!.x).toBeGreaterThan(
          contactBox!.x + contactBox!.width,
        );
        expect(Math.abs(relationshipBox!.y - contactBox!.y)).toBeLessThan(2);
        expect(streamBox!.width).toBeGreaterThanOrEqual(640);
      } else if (width < 600) {
        expect(relationshipBox!.x).toBe(contactBox!.x);
        expect(relationshipBox!.y).toBeGreaterThan(
          contactBox!.y + contactBox!.height,
        );
      }
      expect(
        await contacts.locator(".profile-fact-actions > button").evaluateAll((
          buttons,
        ) => buttons.map((button) => button.firstChild?.textContent)),
      ).toEqual(["Edit", "Delete"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);

      await page.locator("#profile-section-stay-in-touch")
        .scrollIntoViewIfNeeded();
      const summary = directory.locator("summary");
      expect.soft(
        await summary.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          )?.closest("summary") === element;
        }),
      ).toBe(true);
      if (
        !await directory.evaluate((element) =>
          (element as HTMLDetailsElement).open
        )
      ) {
        await summary.click({ timeout: 5_000 });
      }
      await page.locator('[data-section-link="addresses"]').click();
      await expect(address).toBeFocused();
      await expect(page).toHaveURL(/section=addresses/);
      {
        const navigatorBounds = await page.locator(
          ".person-workspace-navigation",
        ).boundingBox();
        const headingBounds = await address.getByRole("heading", {
          name: "Addresses",
          exact: true,
        }).boundingBox();
        expect.soft(headingBounds!.y).toBeGreaterThanOrEqual(
          navigatorBounds!.y + navigatorBounds!.height + 8,
        );
      }
      await address.getByRole("button", { name: /^Edit Home/ }).click();
      const editor = address.locator("form[data-profile-fact-form]");
      await expect(editor).toBeVisible();
      for (
        const control of await editor.locator(
          "input:visible, select:visible, textarea:visible, button:visible",
        ).all()
      ) {
        const bounds = await control.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      if (width < 600) {
        expect(
          await editor.evaluate((element) =>
            getComputedStyle(element).position
          ),
        ).toBe("fixed");
      }
      await editor.getByRole("button", { name: "Cancel" }).press("Enter");
      await expect(editor).toBeHidden();
      if (
        await directory.evaluate((element) =>
          (element as HTMLDetailsElement).open
        )
      ) {
        await directory.locator("summary").click();
      }
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await testInfo.attach(`profile-blocks-${width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      if (width === 1440) {
        await page.locator('[data-person-vital-value="work"]').click();
        await expect(page.locator("#profile-section-work")).toBeFocused();
        await expect(page.locator("[data-timeline-list] > li")).toHaveCount(8);
        const navigatorBounds = await page.locator(
          ".person-workspace-navigation",
        ).boundingBox();
        const headingBounds = await page.locator(
          "#profile-section-work-heading",
        ).boundingBox();
        expect.soft(headingBounds!.y).toBeGreaterThanOrEqual(
          navigatorBounds!.y + navigatorBounds!.height + 8,
        );
      }
    }
    await page.setViewportSize({ width: 375, height: 667 });
    // Development chrome must not intercept the production menu's pointer test.
    await page.addStyleTag({
      content: "astro-dev-toolbar { display: none !important; }",
    });
    await directory.locator("summary").scrollIntoViewIfNeeded();
    await directory.locator("summary").click({ timeout: 5_000 });
    const menu = directory.locator("nav");
    await expect.poll(async () => {
      const bounds = await menu.boundingBox();
      return bounds!.y + bounds!.height;
    }).toBeLessThanOrEqual(659);
    const auditLink = menu.locator('[data-section-link="audit-summary"]');
    await auditLink.click({ timeout: 5_000 });
    await expect(page.locator("#profile-section-audit-summary")).toBeFocused();
    await expect(page).toHaveURL(/section=audit-summary/);
    await expect(menu).toBeHidden();
    // Reopen after the navigator has stuck while viewing the final section.
    await directory.locator("summary").click({ timeout: 5_000 });
    await expect.poll(async () => {
      const bounds = await menu.boundingBox();
      return bounds!.y + bounds!.height;
    }).toBeLessThanOrEqual(659);
    await auditLink.click();
    await expect(page.locator("#profile-section-audit-summary")).toBeFocused();
    await expect(menu).toBeHidden();
  },
);

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
  const organizationId = randomUUID();
  databaseSql(`
    insert into crm.contact_method_types (id, workspace_id, name, kind)
    values ('${typeId}'::uuid, '${workspaceId}'::uuid, 'Email', 'email');
    insert into crm.contact_labels (id, workspace_id, label, applies_to)
    values ('${labelId}'::uuid, '${workspaceId}'::uuid, 'Home', 'any');
    insert into crm.pet_categories (id, name, is_common)
    values ('${petCategoryId}'::uuid, 'Cat ${petCategoryId}', true);
    insert into crm.tags (id, workspace_id, name, slug)
    values ('${tagId}'::uuid, '${workspaceId}'::uuid, 'Friend', 'friend-${tagId}');
    insert into crm.organizations (id, workspace_id, name)
    values ('${organizationId}'::uuid, '${workspaceId}'::uuid, 'Analytical Engines');
    insert into crm.organizations (workspace_id, name)
    select '${workspaceId}'::uuid,
      '000 Organization ' || lpad(series::text, 3, '0')
    from generate_series(1, 55) series;
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
  await expect(page.locator("#person-first-run")).toBeVisible();
  await page.getByRole("button", { name: "Show all sections" }).click();
  await expect(page.locator("#person-first-run")).toBeHidden();

  await openPersonMenu(page);
  const editPerson = page.getByRole("button", { name: "Edit person" });
  const exportVCard = page.getByRole("link", { name: "Export vCard" });
  await expectAlignedControls(editPerson, exportVCard);
  const [editPersonStyle, exportStyle] = await Promise.all([
    controlPresentation(editPerson),
    controlPresentation(exportVCard),
  ]);
  expect(exportStyle.borderColor).toBe(editPersonStyle.borderColor);

  await expectAlignedControls(
    page.getByRole("button", { name: "Log activity" }),
    page.getByRole("link", { name: "Open activity report" }),
  );

  const cadence = page.locator('[data-profile-section="stay-in-touch"]');
  await cadence.getByRole("button", { name: "Add stay-in-touch cadence" })
    .click();
  const [cadenceCountStyle, cadenceUnitStyle] = await Promise.all([
    controlPresentation(cadence.getByLabel("Reconnect every")),
    controlPresentation(cadence.getByLabel("Calendar unit")),
  ]);
  expect(Math.abs(cadenceCountStyle.height - cadenceUnitStyle.height))
    .toBeLessThanOrEqual(2);
  for (
    const property of [
      "backgroundColor",
      "borderColor",
      "borderRadius",
      "borderStyle",
      "borderWidth",
      "fontFamily",
      "minHeight",
      "paddingBottom",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
    ] as const
  ) {
    expect(cadenceCountStyle[property]).toBe(cadenceUnitStyle[property]);
  }
  expect(cadenceCountStyle.borderColor).not.toBe(
    cadenceCountStyle.backgroundColor,
  );

  const coordinationFood = page.locator(
    "#profile-section-food-preferences",
  );
  const coordinationFoodEditor = coordinationFood.locator(
    "form[data-profile-fact-form]",
  );
  await openLocalEditor(
    coordinationFood.getByRole("button", { name: "Add food preferences" }),
    coordinationFoodEditor,
  );
  const coordinationAddress = page.locator("#profile-section-addresses");
  const coordinationAddressEditor = coordinationAddress.locator(
    "form[data-profile-fact-form]",
  );
  await openLocalEditor(
    coordinationAddress.getByRole("button", { name: "Add addresses" }),
    coordinationAddressEditor,
  );
  await expect(coordinationFoodEditor).toHaveCount(1);
  await expect(coordinationFoodEditor).toBeHidden();
  await expect(
    coordinationAddressEditor.locator(
      'input:not([type="hidden"]), select, textarea',
    ).first(),
  ).toBeFocused();
  await coordinationAddressEditor.getByRole("button", { name: "Cancel" })
    .click();

  const calls: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().includes("/facts/")) {
      calls.push(`${outgoing.method()} ${new URL(outgoing.url()).pathname}`);
    }
  });
  const contactEditor = contacts.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    contacts.getByRole("button", { name: "Add contact methods" }),
    contactEditor,
  );
  const contactType = contactEditor.locator('select[name="typeId"]');
  await expect(contactType).toBeFocused();
  await expect.poll(() => calls).toEqual([
    `GET /api/v1/people/${profilePath.split("/").at(-1)}/facts/contact-methods`,
  ]);
  await contactType.selectOption(typeId);
  await contactEditor.getByLabel("Contact value").fill("ada@example.test");
  await contactEditor.getByLabel("Contact labels").selectOption([labelId]);
  await contactEditor.getByLabel("Primary for this contact type").check();
  calls.length = 0;
  await contactEditor.getByRole("button", { name: "Save profile fact" })
    .click();
  await expect(contacts.getByText("Profile fact saved.")).toBeFocused();
  await expect(contacts).toContainText("Email: ada@example.test");
  const editContact = contacts.getByRole("button", {
    name: "Edit Email: ada@example.test",
  });
  const deleteContact = contacts.getByRole("button", {
    name: "Delete Email: ada@example.test",
  });
  await expect(editContact).toHaveClass(/\bbutton-secondary\b/);
  await expect(deleteContact).toHaveClass(/\bbutton-danger\b/);
  const [editContactStyle, deleteContactStyle] = await Promise.all([
    controlPresentation(editContact),
    controlPresentation(deleteContact),
  ]);
  expect(deleteContactStyle.backgroundColor).not.toBe(
    editContactStyle.backgroundColor,
  );
  expect(deleteContactStyle.borderColor).not.toBe(
    editContactStyle.borderColor,
  );
  expect(deleteContactStyle.color).not.toBe(editContactStyle.color);
  await expect.poll(() => calls).toEqual([
    `POST /api/v1/people/${
      profilePath.split("/").at(-1)
    }/facts/contact-methods`,
    `GET /api/v1/people/${profilePath.split("/").at(-1)}/facts/contact-methods`,
  ]);

  const address = page.locator("#profile-section-addresses");
  const addressEditor = address.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    address.getByRole("button", { name: "Add addresses" }),
    addressEditor,
  );
  await addressEditor.getByLabel("Address name").fill("Home");
  await addressEditor.getByLabel("Street").fill("1 Analytical Engine Way");
  await addressEditor.getByLabel("City").fill("London");
  await addressEditor.locator('select[name="labelIds"]').selectOption([
    labelId,
  ]);
  await addressEditor.getByLabel("Primary address").check();
  await addressEditor.getByRole("button", { name: "Save profile fact" })
    .click();
  await expect(address.locator(".profile-address-summary > span")).toHaveText([
    "Home",
    "1 Analytical Engine Way",
    "London",
  ]);

  const firstMeeting = page.locator("#profile-section-first-meeting");
  const firstMeetingEditor = firstMeeting.locator(
    "form[data-profile-fact-form]",
  );
  await openLocalEditor(
    firstMeeting.getByRole("button", { name: "Add first meeting" }),
    firstMeetingEditor,
  );
  await firstMeetingEditor.getByLabel("Search people").fill("Charles");
  await firstMeetingEditor.getByRole("button", { name: "Search people" })
    .click();
  await firstMeetingEditor.getByLabel("Introduced by").selectOption(
    introducerId,
  );
  await firstMeetingEditor.getByLabel("Where or how you first met").fill(
    "London salon",
  );
  await firstMeetingEditor.getByLabel("First meeting story").fill(
    "Introduced while discussing mathematics",
  );
  await firstMeetingEditor.getByRole("button", { name: "Save profile fact" })
    .click();
  await expect(firstMeeting).toContainText(
    "London salon — Introduced while discussing mathematics",
  );

  const work = page.locator("#profile-section-work");
  const workEditor = work.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    work.getByRole("button", { name: "Add work" }),
    workEditor,
  );
  await workEditor.getByLabel("Role or title").fill("Mathematician");
  const organization = workEditor.getByLabel("Existing organization");
  expect(await organization.locator("option").count()).toBeLessThanOrEqual(51);
  await expect(organization.locator(`option[value="${organizationId}"]`))
    .toHaveCount(0);
  await workEditor.getByLabel("Search organizations").fill("Analytical");
  await workEditor.getByRole("button", { name: "Search organizations" })
    .click();
  await expect(organization.locator(`option[value="${organizationId}"]`))
    .toHaveCount(1);
  await organization.selectOption(
    organizationId,
  );
  await workEditor.getByLabel("Start date").fill("2026-01-02");
  await workEditor.getByLabel("End date").fill("2026-01-01");
  await workEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(
    workEditor.getByText("End date must be on or after the start date."),
  )
    .toBeVisible();
  await expect(workEditor.getByLabel("End date")).toBeFocused();
  await workEditor.getByLabel("End date").fill("2026-12-31");
  await workEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(work).toContainText("Mathematician at Analytical Engines");

  const tags = page.locator('[data-profile-fact-section="tags"]');
  const tagEditor = tags.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    tags.getByRole("button", { name: "Edit tags" }),
    tagEditor,
  );
  await tagEditor.getByLabel("Assigned tags").selectOption([tagId]);
  await tagEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(page.locator("#person-profile-tags")).toContainText("Friend");

  const pets = page.locator("#profile-section-pets");
  const petsEditor = pets.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    pets.getByRole("button", { name: "Add pets" }),
    petsEditor,
  );
  await petsEditor.getByLabel("Pet name").fill("Byron");
  await petsEditor.getByLabel("Pet category").selectOption(petCategoryId);
  await petsEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(pets).toContainText("Byron · Cat");

  const food = page.locator("#profile-section-food-preferences");
  const foodEditor = food.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    food.getByRole("button", { name: "Add food preferences" }),
    foodEditor,
  );
  await foodEditor.getByLabel("Food, allergy, and dietary preferences").fill(
    "Tea; no shellfish",
  );
  await foodEditor.getByRole("button", { name: "Save profile fact" }).click();
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
  await openLocalEditor(
    food.getByRole("button", { name: "Add food preferences" }),
    foodEditor,
  );
  await foodEditor.getByLabel("Food, allergy, and dietary preferences").fill(
    "Tea; no shellfish",
  );
  await foodEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expectAccessible(page);

  await page.reload();
  await expect(contacts).toContainText("ada@example.test");
  await expect(address).toContainText("Analytical Engine Way");
  await expect(firstMeeting).toContainText("London salon");
  await expect(work).toContainText("Analytical Engines");
  await openLocalEditor(
    work.getByRole("button", {
      name: "Edit Mathematician at Analytical Engines",
    }),
    workEditor,
  );
  await expect(workEditor.getByLabel("Existing organization"))
    .toHaveValue(organizationId);
  await expect(
    workEditor.locator(`option[value="${organizationId}"]`),
  ).toHaveText("Analytical Engines");
  await workEditor.getByRole("button", { name: "Cancel" }).click();
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
  await openPersonMenu(page);
  await page.getByRole("button", { name: "Archive person" }).click();
  await expect(contacts).toHaveAttribute("data-section-state", "read-only");
  await expect(contacts.getByRole("button", { name: /Add|Edit|Delete/ }))
    .toHaveCount(0);
  await expect(contacts).toContainText("ada@example.test");
  await expectAccessible(page);
});
