import type { Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { openPersonMenu } from "./support/profile.ts";
import { submitSignIn } from "./support/sign-in.ts";

/** Registers a verified owner, signs them in, and names their workspace. */
async function owner(
  page: Page,
  request: Parameters<typeof registerVerified>[0],
  label: string,
): Promise<string> {
  const email = `${label}-${Date.now()}@example.test`;
  await registerVerified(request, {
    email,
    firstName: "Identity",
    lastName: "Keeper",
    workspaceName: "Identity circle",
  }, bareToken);
  await submitSignIn(page, email);
  return databaseValue(
    `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
      sqlLiteral(email)
    }`,
  );
}

/** Serves the static person shell in the development topology. */
async function servePersonShell(
  page: Page,
  request: Parameters<typeof registerVerified>[0],
  personId: string,
): Promise<void> {
  if (process.env.E2E_DEV_SHELL !== "1") return;
  await page.route(`**/app/people/${personId}*`, async (route) => {
    const shell = await request.get(`${origin}/internal/person-profile-shell`);
    await route.fulfill({ response: shell });
  });
}

async function openEditor(page: Page) {
  await openPersonMenu(page);
  await page.getByRole("button", { name: "Edit person" }).click();
  const form = page.getByRole("form", { name: "Edit person" });
  await expect(form).toBeVisible();
  return form;
}

test(
  "[PEOPLE-004] edits the nickname, description, gender, and deceased state",
  {
    annotation: [
      { type: "flow", description: "PEOPLE-004" },
      { type: "flow", description: "PEOPLE-005" },
      { type: "leaf", description: "GAP-047" },
    ],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const workspaceId = await owner(page, request, `identity-${browserName}`);
    databaseSql(`insert into crm.gender_options (workspace_id, name, sort_order)
      values ('${workspaceId}'::uuid, 'Woman', 1),
        ('${workspaceId}'::uuid, 'Man', 2)`);
    const personId = await createPerson(page.request, {
      familyName: "Lovelace",
      givenName: "Ada",
    });
    await servePersonShell(page, request, personId);
    await page.goto(`/app/people/${personId}`);
    const heading = page.getByRole("heading", {
      level: 1,
      name: "Ada Lovelace",
    });
    await expect(heading).toBeVisible();
    const status = page.locator("#person-lifecycle-status");

    // Nickname, description, and gender are edited in the one editor.
    let form = await openEditor(page);
    await form.getByLabel("Nickname").fill("Enchantress");
    await form.getByLabel("Description").fill("Wrote the first program");
    await form.getByLabel("Gender").selectOption({ label: "Woman" });
    await form.getByRole("button", { name: "Save person" }).click();
    await expect(status).toHaveText("Person identity updated.");
    await expect(heading).toBeFocused();
    await expect(page.locator("[data-profile-description]")).toHaveText(
      "Wrote the first program",
    );
    expect(databaseValue(
      `select concat_ws('|', person.nickname, person.description, gender.name)
        from crm.people person
        join crm.gender_options gender on gender.id = person.gender_option_id
        where person.id = '${personId}'::uuid`,
    )).toBe("Enchantress|Wrote the first program|Woman");

    // An edit composed against an older revision is refused and kept.
    form = await openEditor(page);
    await form.getByLabel("Gender").selectOption({ label: "Man" });
    databaseSql(
      `update crm.people set updated_at = updated_at + interval '1 second'
      where id = '${personId}'::uuid`,
    );
    await form.getByRole("button", { name: "Save person" }).click();
    await expect(status).toHaveText(
      "Refresh this person before trying the lifecycle action again.",
    );
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Gender")).toHaveValue(
      databaseValue(
        `select id::text from crm.gender_options where workspace_id = '${workspaceId}'::uuid and name = 'Man'`,
      ),
    );
    await form.getByRole("button", { name: "Cancel edit" }).click();
    await settlePersonWorkspace(page);
    await page.reload();
    await expect(heading).toBeVisible();

    // Marking the person deceased opens the date of death, recorded with an
    // unknown year through the important dates.
    form = await openEditor(page);
    await form.getByRole("checkbox", { name: "This person has died" }).check();
    await form.getByRole("button", { name: "Save person" }).click();
    await expect(status).toHaveText("Person identity updated.");
    await expect(page.getByText("Deceased", { exact: true })).toBeVisible();
    const dateType = page.getByLabel("Date type");
    await expect(dateType).toBeFocused();
    await expect(dateType).toHaveValue("deceased");
    await page.getByLabel("Known components").selectOption("month_day");
    await page.locator("#important-date-month").selectOption("11");
    await page.locator("#important-date-day").fill("27");
    await page.getByRole("button", { name: "Save date" }).click();
    const deceasedDate = page.locator("#person-profile-deceased-date");
    await expect(deceasedDate).toHaveText(
      "Date of death: November 27 (year unknown)",
    );
    await expect(deceasedDate).toBeVisible();
    await expectAccessible(page);

    // Clearing the deceased state keeps the recorded date of death.
    form = await openEditor(page);
    await form.getByRole("checkbox", { name: "This person has died" })
      .uncheck();
    await form.getByRole("button", { name: "Save person" }).click();
    await expect(status).toHaveText("Person identity updated.");
    await expect(page.getByText("Deceased", { exact: true })).toBeHidden();
    await expect(deceasedDate).toBeHidden();
    await expect(page.locator("#important-dates-list")).toContainText(
      "Date of death",
    );
    expect(databaseValue(
      `select count(*) from crm.person_dates where person_id = '${personId}'::uuid and kind = 'deceased'`,
    )).toBe("1");
    await settlePersonWorkspace(page);
  },
);

test(
  "[WORKSPACE-003] hides a person-workspace section from personalization and shows it again",
  {
    annotation: [
      { type: "flow", description: "WORKSPACE-003" },
      { type: "flow", description: "PEOPLE-003" },
      { type: "leaf", description: "GAP-047" },
    ],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    await owner(page, request, `sections-${browserName}`);
    const personId = await createPerson(page.request, {
      familyName: "Lovelace",
      givenName: "Ada",
    });
    await servePersonShell(page, request, personId);
    const work = page.locator('[data-profile-section="work"]');
    const workLink = page.locator(
      '#person-profile-sections li:has([data-section-link="work"])',
    );
    const toggle = async (action: "Disable" | "Enable") => {
      await page.goto("/app/settings/personalization?section=profile-modules");
      const row = page.locator(".personalization-row").filter({
        has: page.getByLabel("Name for Work"),
      });
      await expect(row).toContainText("Core section · cannot be deleted");
      await row.getByRole("button", { name: action }).click();
      await expect(page.locator("#personalization-status")).toHaveText(
        "Option updated.",
      );
      await expect(
        row.getByRole("button", {
          name: action === "Disable" ? "Enable" : "Disable",
        }),
      ).toBeVisible();
    };

    await toggle("Disable");
    await page.goto(`/app/people/${personId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Ada Lovelace" }))
      .toBeVisible();
    await settlePersonWorkspace(page);
    await expect(work).toBeHidden();
    await expect(work).toHaveAttribute("data-section-state", "hidden");
    await expect(workLink).toHaveAttribute("hidden", "");
    await expect(page.locator('[data-person-vital-value="work"]'))
      .toHaveCount(0);

    // A deep link to the hidden section lands on its quiet notice.
    await page.goto(`/app/people/${personId}?section=work`);
    const notice = page.locator("#person-profile-section-notice");
    await expect(notice).toContainText(
      "Work — this section is hidden in this workspace.",
    );
    await expect(notice.getByRole("link", { name: "Open personalization" }))
      .toHaveAttribute(
        "href",
        "/app/settings/personalization?section=profile-modules",
      );
    await expect(work).toBeHidden();
    await expectAccessible(page);
    await settlePersonWorkspace(page);

    await toggle("Enable");
    await page.goto(`/app/people/${personId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Ada Lovelace" }))
      .toBeVisible();
    await expect(work).toBeVisible();
    await expect(workLink).not.toHaveAttribute("hidden", "");
    await settlePersonWorkspace(page);
  },
);
