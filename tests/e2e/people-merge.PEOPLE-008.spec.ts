import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { registerVerified } from "./support/api.ts";
import { database, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { waitForIsland } from "./support/islands.ts";
import { bareToken } from "./support/mail.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { openPersonMenu } from "./support/profile.ts";
import { submitSignIn } from "./support/sign-in.ts";

/** Posts `data` to the API as the signed-in page, expecting `status`. */
async function post(
  request: APIRequestContext,
  path: string,
  data: Readonly<Record<string, unknown>>,
  status = 201,
): Promise<Record<string, unknown>> {
  const response = await request.post(`${origin}${path}`, {
    data,
    headers: { origin },
  });
  expect(response.status(), `${path} answers ${status}`).toBe(status);
  return await response.json() as Record<string, unknown>;
}

/** A person, created even when the name is taken, as the member would. */
async function person(
  request: APIRequestContext,
  givenName: string,
  familyName: string,
): Promise<string> {
  const body = await post(request, "/api/v1/people", {
    duplicateOverride: true,
    familyName,
    givenName,
    isPartial: false,
  });
  return (body.person as { id: string }).id;
}

test(
  "[PEOPLE-008] reviews possible duplicates and merges two people into one",
  {
    annotation: [{ type: "flow", description: "PEOPLE-008" }, {
      type: "leaf",
      description: "GAP-049",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email = `merge-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Merge",
      lastName: "Keeper",
      workspaceName: "Merge circle",
    }, bareToken);
    await submitSignIn(page, email);
    const api = page.request;
    const primary = await person(api, "Ada", "Lovelace");
    const duplicate = await person(api, "Ada", "Lovelace");
    const charles = await person(api, "Charles", "Babbage");
    const mary = await person(api, "Mary", "Somerville");
    const workspaceId = databaseValue(
      `select workspace_id::text from crm.people where id = ${
        sqlLiteral(primary)
      }::uuid`,
    );
    const relationshipType = databaseValue(
      `select id::text from crm.relationship_types where workspace_id = ${
        sqlLiteral(workspaceId)
      }::uuid order by sort_order, id limit 1`,
    );
    const emailType = randomUUID();
    // The same email address on both records is the second reason to pair them.
    database(`
      insert into crm.contact_method_types (id, workspace_id, name, kind)
        values ('${emailType}'::uuid, '${workspaceId}'::uuid, 'Email', 'email');
      insert into crm.person_contact_methods (person_id, type_id, value, is_primary)
        values ('${primary}'::uuid, '${emailType}'::uuid, 'ada@example.test', true),
          ('${duplicate}'::uuid, '${emailType}'::uuid, 'ADA@example.test', true);
    `);
    for (
      const [personId, note, date, related] of [
        [primary, "Wrote the first program.", {
          kind: "birthday",
        }, charles],
        [duplicate, "Translated Menabrea's paper.", {
          kind: "custom",
          label: "Notes published",
        }, mary],
      ] as const
    ) {
      await post(api, "/api/v1/interactions", {
        body: note,
        kind: "note",
        personId,
        requestId: randomUUID(),
      });
      await post(api, `/api/v1/people/${personId}/dates`, {
        day: 10,
        isAgeBased: false,
        isYearApproximate: false,
        month: 12,
        precision: "month_day",
        ...date,
      });
      await post(api, `/api/v1/people/${personId}/relationships`, {
        relationshipTypeId: relationshipType,
        targetPersonId: related,
      });
    }
    // Both have a birthday, and only one can stay: the confirmation says which.
    await post(api, `/api/v1/people/${duplicate}/dates`, {
      day: 12,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 3,
      precision: "month_day",
    });

    // The directory offers the pair, folded away until asked.
    await page.goto("/app/people");
    await waitForIsland(page, "people-duplicates");
    const review = page.locator("#people-duplicates");
    await expect(review.getByRole("heading", { name: "Possible duplicates" }))
      .toBeVisible();
    await expect(review).toContainText(
      "1 pair of people may be the same person.",
    );
    await review.getByRole("button", { name: "Review possible duplicates" })
      .click();
    const pairs = review.getByRole("list", {
      name: "Possible duplicate pairs",
    });
    await expect(pairs).toContainText("Ada Lovelace and Ada Lovelace");
    await expect(pairs).toContainText("Same name · same email address");
    await expectAccessible(page);

    // The confirmation picks the primary, says what moves, what is kept and
    // discarded, and that it is final.
    await pairs.getByRole("button", {
      name: "Merge Ada Lovelace and Ada Lovelace…",
    }).click();
    const dialog = page.getByRole("dialog", { name: "Merge two people?" });
    await expect(dialog).toBeVisible();
    const keep = dialog.getByRole("radio", {
      name: "Keep Ada Lovelace (added first)",
    });
    await expect(keep).toBeChecked();
    await expect(keep).toBeFocused();
    await expect(dialog).toContainText(
      /\d+ records that name Ada Lovelace move to Ada Lovelace/,
    );
    await expect(
      dialog.getByRole("list", { name: "What is kept and discarded" }),
    ).toHaveText("Birthday — Kept: 10 December, discarded: 12 March");
    await expect(dialog.getByText("A merge cannot be undone.")).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole("button", { name: "Merge people" }).click();

    // The member lands on the primary, which now holds everything.
    await expect(page).toHaveURL(new RegExp(`/app/people/${primary}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Ada Lovelace" }))
      .toBeVisible();
    const timeline = page.locator("#person-timeline");
    await expect(timeline).toContainText("Wrote the first program.");
    await expect(timeline).toContainText("Translated Menabrea's paper.");
    await expect(page.locator("#profile-section-notes")).toContainText(
      "2 recent notes.",
    );
    const dates = page.locator("#profile-section-important-dates");
    await expect(dates).toContainText("Birthday");
    await expect(dates).toContainText("Notes published");
    const relationships = page.locator("#profile-section-relationships");
    await expect(relationships).toContainText("Charles Babbage");
    await expect(relationships).toContainText("Mary Somerville");
    await expect(page.locator("#profile-section-contact-methods"))
      .toContainText("ada@example.test");
    expect(databaseValue(
      `select count(*)::text from crm.person_contact_methods where person_id = ${
        sqlLiteral(primary)
      }::uuid`,
    )).toBe("1");
    expect(databaseValue(
      `select action || ':' || (payload->>'duplicateId') from crm.audit_events
        where person_id = ${
        sqlLiteral(primary)
      }::uuid and action = 'people.person-merged'`,
    )).toBe(`people.person-merged:${duplicate}`);

    // The duplicate is gone, and nothing is left to review.
    await settlePersonWorkspace(page);
    await page.goto(`/app/people/${duplicate}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Person not found" }),
    ).toBeVisible();
    await page.goto("/app/people");
    await waitForIsland(page, "people-duplicates");
    await expect(page.locator("#people-duplicates")).toBeHidden();

    // From a person's menu the dialog finds the other person first, and a
    // stale revision is refused without changing anything.
    const grace = await person(api, "Grace", "Hopper");
    const graceAgain = await person(api, "Grace", "Hopper");
    await page.goto(`/app/people/${grace}`);
    await expect(page.getByRole("heading", { level: 1, name: "Grace Hopper" }))
      .toBeVisible();
    await openPersonMenu(page);
    await page.getByRole("button", { name: "Merge with another person…" })
      .click();
    const menuDialog = page.getByRole("dialog", { name: "Merge two people?" });
    await menuDialog.getByLabel("Find the person to merge with").fill("Grace");
    await menuDialog.getByRole("button", { name: "Search", exact: true })
      .click();
    await menuDialog.getByRole("button", { name: "Merge with Grace Hopper" })
      .click();
    await expect(
      menuDialog.getByRole("radio", {
        name: "Keep Grace Hopper (this person)",
      }),
    ).toBeChecked();
    await expect(menuDialog.getByText("A merge cannot be undone."))
      .toBeVisible();
    await expect(menuDialog).toContainText(
      /records? that names? Grace Hopper moves? to Grace Hopper/,
    );
    database(
      `update crm.people set updated_at = updated_at + interval '1 second' where id = ${
        sqlLiteral(grace)
      }::uuid`,
    );
    await menuDialog.getByRole("button", { name: "Merge people" }).click();
    await expect(menuDialog).toContainText(
      "One of these people changed. Review them again before merging.",
    );
    expect(databaseValue(
      `select count(*)::text from crm.people where id = ${
        sqlLiteral(graceAgain)
      }::uuid and deleted_at is null`,
    )).toBe("1");
    await menuDialog.getByRole("button", { name: "Cancel merge" }).click();
    await expect(menuDialog).toBeHidden();
    await expect(page.locator("#person-lifecycle-status")).toHaveText(
      "Merge cancelled. No changes were made.",
    );
  },
);
