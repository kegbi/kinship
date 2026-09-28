import { expect, type Page, test } from "@playwright/test";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { waitForIsland } from "./support/islands.ts";
import { bareToken } from "./support/mail.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import {
  expectAccessible,
  recordPolicyViolations,
} from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

/** Opens the directory once its island has every handler attached. */
async function openDirectory(page: Page, path = "/app/people"): Promise<void> {
  await page.goto(path);
  await waitForIsland(page, "people-directory");
}

test(
  "[PEOPLE-010] stars a person and browses the directory by tag and order",
  {
    annotation: [{ type: "flow", description: "PEOPLE-010" }, {
      type: "leaf",
      description: "GAP-053",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    const violations = recordPolicyViolations(page);
    const email = `stars-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Star",
      lastName: "Keeper",
      workspaceName: "Star circle",
    }, bareToken);
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
    const workspaceId = databaseValue(
      `select workspace_id::text from crm.people where id = ${
        sqlLiteral(ada)
      }::uuid`,
    );
    databaseSql(`
      with friends as (
        insert into crm.tags (workspace_id, name, slug)
        values (${sqlLiteral(workspaceId)}::uuid, 'Friends', 'friends')
        returning id
      ), family as (
        insert into crm.tags (workspace_id, name, slug)
        values (${sqlLiteral(workspaceId)}::uuid, 'Family', 'family')
        returning id
      )
      insert into crm.person_tags (person_id, tag_id)
      select ${sqlLiteral(ada)}::uuid, id from friends
      union all select ${sqlLiteral(grace)}::uuid, id from friends
      union all select ${sqlLiteral(alan)}::uuid, id from family;
      insert into crm.calls (workspace_id, person_id, called_at) values
        (${sqlLiteral(workspaceId)}::uuid, ${sqlLiteral(grace)}::uuid,
          now() - interval '1 day'),
        (${sqlLiteral(workspaceId)}::uuid, ${sqlLiteral(alan)}::uuid,
          now() - interval '9 days');
    `);

    // Star Ada from her workspace's hero.
    await page.goto(`/app/people/${ada}`);
    await waitForIsland(page, "person-hero");
    const star = page.getByRole("button", { name: "Star", exact: true });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(page.locator("#person-lifecycle-status")).toHaveText(
      "Starred. Everyone in this workspace sees the star.",
    );
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Favorite", { exact: true })).toBeVisible();
    await expectAccessible(page);
    await settlePersonWorkspace(page);

    // The directory marks her, and lists only starred people when asked.
    await openDirectory(page);
    const rows = page.locator("#people-directory-list > li");
    const row = (id: string) =>
      page.locator(`#people-directory-list a[href="/app/people/${id}"]`);
    await expect(rows).toHaveCount(3);
    await expect(row(ada).locator(".directory-person-star")).toHaveCount(1);
    await expect(row(grace).locator(".directory-person-star")).toHaveCount(0);
    await page.getByLabel("Starred only").check();
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(rows).toHaveCount(1);
    await expect(row(ada)).toHaveCount(1);
    await expect(page).toHaveURL(/starred=1/);
    await page.getByLabel("Starred only").uncheck();
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(rows).toHaveCount(3);

    // The tag facet counts the view's people and filters by a chip.
    const facet = page.locator("#people-tag-facet");
    const friends = facet.getByRole("button", { name: "Friends, 2 people" });
    await expect(facet.getByRole("button", { name: "Family, 1 person" }))
      .toBeVisible();
    await expectAccessible(page);
    await friends.click();
    await expect(friends).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(2);
    await expect(row(alan)).toHaveCount(0);
    await friends.click();
    await expect(friends).toHaveAttribute("aria-pressed", "false");
    await expect(rows).toHaveCount(3);

    // Last contacted lists Grace, then Alan, then never-contacted Ada; with
    // starred people first, Ada leads.
    await page.getByLabel("Sort by").selectOption("last-contacted");
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(rows.locator("h2")).toHaveText([
      "Grace Hopper",
      "Alan Turing",
      "Ada Lovelace",
    ]);
    await page.getByLabel("Starred first").check();
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(rows.locator("h2")).toHaveText([
      "Ada Lovelace",
      "Grace Hopper",
      "Alan Turing",
    ]);
    await expect(page).toHaveURL(/sort=last-contacted/);

    // An archived person's star is read-only.
    const archived = await api.post(`${origin}/api/v1/people/bulk`, {
      data: { action: "archive", personIds: [ada] },
      headers: { origin },
    });
    expect(archived.status()).toBe(200);
    const refused = await api.delete(`${origin}/api/v1/people/${ada}/star`, {
      headers: { origin },
    });
    expect(refused.status()).toBe(409);
    await page.goto(`/app/people/${ada}`);
    await waitForIsland(page, "person-hero");
    await expect(page.getByRole("button", { name: "Star", exact: true }))
      .toBeDisabled();
    await settlePersonWorkspace(page);
    expect(violations).toEqual([]);
  },
);
