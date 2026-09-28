import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { waitForIsland } from "./support/islands.ts";
import {
  expectAccessible,
  recordPolicyViolations,
} from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

/** Opens a directory view once its island has every handler attached. */
async function openDirectory(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForIsland(page, "people-directory");
}

test(
  "[PEOPLE-009] tags, archives, restores, and exports several people at once",
  {
    annotation: [{ type: "flow", description: "PEOPLE-009" }, {
      type: "leaf",
      description: "GAP-051",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    const violations = recordPolicyViolations(page);
    const email = `bulk-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Bulk",
      lastName: "Keeper",
      workspaceName: "Bulk circle",
    });
    await signIn(page, email);
    const api = page.request;
    const ada = await createPerson(api, {
      familyName: "Lovelace",
      givenName: "Ada",
    });
    const grace = await createPerson(api, {
      familyName: "Hopper",
      givenName: "Grace",
    });
    const alan = await createPerson(api, {
      familyName: "Turing",
      givenName: "Alan",
    });
    const mary = await createPerson(api, {
      familyName: "Somerville",
      givenName: "Mary",
    });
    const workspaceId = databaseValue(
      `select workspace_id::text from crm.people where id = ${
        sqlLiteral(ada)
      }::uuid`,
    );
    databaseSql(`
      insert into crm.tags (workspace_id, name, slug) values
        (${sqlLiteral(workspaceId)}::uuid, 'Friends', 'friends'),
        (${sqlLiteral(workspaceId)}::uuid, 'Family', 'family');
    `);

    await openDirectory(page, "/app/people");
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    const report = page.locator("#people-bulk-result");
    const row = (id: string) =>
      page.locator(`#people-directory-list a[href="/app/people/${id}"]`);
    await expect(page.locator("#people-directory-list > li")).toHaveCount(4);
    await expect(bar).toHaveCount(0);

    // Select three people and add a tag to all of them.
    for (const name of ["Ada Lovelace", "Grace Hopper", "Alan Turing"]) {
      await page.getByRole("checkbox", { name: `Select ${name}` }).check();
    }
    await expect(bar.getByText("3 selected")).toBeVisible();
    await expect(page.getByRole("link", { name: /Ada Lovelace/ }))
      .toHaveAttribute("href", `/app/people/${ada}`);
    await expectAccessible(page);
    await bar.getByRole("button", { name: "Add tag…" }).click();
    await bar.getByLabel("Tag to add").selectOption({ label: "Friends" });
    await bar.getByRole("button", { name: "Add tag" }).click();
    await expect(report).toContainText("Added “Friends” to 3 people.");
    await expect(report).toContainText("3 done · 0 unchanged · 0 failed");
    await expect(report).toBeFocused();
    await expect(bar).toHaveCount(0);
    for (const id of [ada, grace, alan]) {
      await expect(row(id).locator(".directory-person-tags")).toContainText(
        "Friends",
      );
    }
    await expect(row(mary).locator(".directory-person-tags")).toHaveCount(0);
    await expectAccessible(page);

    // Archive two of them; they leave the active view.
    await page.getByRole("checkbox", { name: "Select Ada Lovelace" }).check();
    await page.getByRole("checkbox", { name: "Select Grace Hopper" }).check();
    await bar.getByRole("button", { name: "Archive" }).click();
    const confirm = page.getByRole("dialog", { name: "Archive 2 people?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Archive 2 people" }).click();
    await expect(report).toContainText("Archived 2 people.");
    await expect(report).toContainText("2 done · 0 unchanged · 0 failed");
    await expect(page.locator("#people-directory-list > li")).toHaveCount(2);
    await expect(row(ada)).toHaveCount(0);
    await expect(row(grace)).toHaveCount(0);

    // Mary is archived in another tab after she was selected here: she fails
    // on her own while Alan is still tagged.
    await page.getByRole("checkbox", { name: "Select Alan Turing" }).check();
    await page.getByRole("checkbox", { name: "Select Mary Somerville" })
      .check();
    await expect(bar.getByText("2 selected")).toBeVisible();
    const elsewhere = await api.post(`${origin}/api/v1/people/bulk`, {
      data: { action: "archive", personIds: [mary] },
      headers: { origin },
    });
    expect(elsewhere.status()).toBe(200);
    await bar.getByRole("button", { name: "Add tag…" }).click();
    await bar.getByLabel("Tag to add").selectOption({ label: "Family" });
    await bar.getByRole("button", { name: "Add tag" }).click();
    await expect(report).toContainText("Added “Family” to 1 person.");
    await expect(report).toContainText("1 done · 0 unchanged · 1 failed");
    await expect(
      report.getByRole("list", { name: "People not changed" }),
    ).toHaveText("Mary Somerville: Archived and read-only; restore first");
    await expect(row(alan).locator(".directory-person-tags")).toContainText(
      "Family",
    );
    await expect(row(mary)).toHaveCount(0);

    // Restore one of them from the archived view.
    await openDirectory(page, "/app/people/archived");
    await expect(page.locator("#people-directory-list > li")).toHaveCount(3);
    await page.getByRole("checkbox", { name: "Select Ada Lovelace" }).check();
    await expect(bar.getByRole("button", { name: "Archive" })).toHaveCount(0);
    await bar.getByRole("button", { name: "Restore" }).click();
    await expect(report).toContainText("Restored 1 person.");
    await expect(page.locator("#people-directory-list > li")).toHaveCount(2);
    await expect(row(ada)).toHaveCount(0);

    // Export two people as one vCard.
    await openDirectory(page, "/app/people");
    await expect(page.locator("#people-directory-list > li")).toHaveCount(2);
    await page.getByRole("checkbox", { name: "Select all 2 shown" }).check();
    const saved = page.waitForEvent("download");
    await bar.getByRole("button", { name: "Export vCard" }).click();
    const download = await saved;
    expect(download.suggestedFilename()).toBe("kinship-people-2.vcf");
    const card = await readFile((await download.path())!, "utf8");
    expect(card).toContain("FN:Ada Lovelace\r\n");
    expect(card).toContain("FN:Alan Turing\r\n");
    expect(card.match(/BEGIN:VCARD/g)).toHaveLength(2);
    await expect(report).toContainText("Exported 2 people to a vCard.");
    await expect(bar.getByText("2 selected")).toBeVisible();
    expect(violations).toEqual([]);
  },
);
