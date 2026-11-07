import { expect, test } from "./support/test.ts";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { waitForIsland } from "./support/islands.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

test(
  "[JOURNAL-002] adds, edits, and removes a person's life events",
  { annotation: { type: "flow", description: "JOURNAL-002" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    const email = `life-events-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Milestone",
      lastName: "Keeper",
      workspaceName: "Life events circle",
    });
    await signIn(page, email);
    const personId = await createPerson(page.request, {
      familyName: "Lovelace",
      givenName: "Ada",
    });
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u
        on u.id = w.created_by_user_id where u.email = ${sqlLiteral(email)}`,
    );
    databaseValue(`insert into crm.life_event_types (workspace_id, name)
      values ('${workspaceId}'::uuid, 'Relocation') returning id::text`);

    await page.goto(`/app/people/${personId}?section=life-events`);
    await waitForIsland(page, "person-life-events");
    const section = page.locator("#profile-section-life-events");
    const saved = section.getByRole("list", { name: "Saved life events" });
    const timeline = page.locator("#person-timeline");
    await expect(section).toHaveAttribute("data-section-state", "empty");
    await expect(section.getByText("No life events saved.")).toBeVisible();

    // Add, from the keyboard: the editor's first field takes focus. A label
    // around a native select also names its options, so selects are found by
    // their field name.
    const add = section.getByRole("button", { name: "Add life event" });
    await add.focus();
    await page.keyboard.press("Enter");
    const name = section.getByLabel("Name", { exact: true });
    await expect(name).toBeFocused();
    await name.fill("Moved to Lisbon");
    await section.locator('select[name="typeId"]').selectOption({
      label: "Relocation",
    });
    await section.locator('select[name="precision"]').selectOption(
      "year_month",
    );
    await expect(section.getByLabel("Day", { exact: true })).toBeHidden();
    await section.getByLabel("Year", { exact: true }).fill("2019");
    await section.locator('select[name="month"]').selectOption("6");
    await expectAccessible(page);
    await section.getByRole("button", { name: "Save life event" }).click();
    const lisbon = saved.getByRole("listitem").filter({
      hasText: "Moved to Lisbon",
    });
    await expect(lisbon).toContainText("June 2019");
    await expect(lisbon).toContainText("Relocation");
    await expect(section).toHaveAttribute("data-section-state", "ready");
    await expect(section.locator("#life-events-state")).toHaveText(
      "1 life event.",
    );
    await expect(
      timeline.locator("[data-timeline-id]", { hasText: "Moved to Lisbon" }),
    ).toHaveCount(1);

    // A refused save stays in the editor and names each field.
    await add.click();
    await section.locator('select[name="precision"]').selectOption("year");
    await section.getByRole("button", { name: "Save life event" }).click();
    const formState = section.locator("#life-event-form-state");
    await expect(formState).toHaveText(
      "Review the name, type, precision, and known date components.",
    );
    await expect(formState).toBeFocused();
    await expect(section.getByText("Enter a name or choose a type."))
      .toBeVisible();
    await expect(section.getByText("Enter year for year precision."))
      .toBeVisible();
    await section.getByRole("button", { name: "Cancel" }).click();
    await expect(section.locator("[data-life-event-form]")).toHaveCount(0);

    // Edit at the current revision.
    await lisbon.getByRole("button", { name: "Edit Moved to Lisbon" }).click();
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Moved to Lisbon");
    await name.fill("Moved to Porto");
    await section.getByRole("button", { name: "Save life event" }).click();
    const porto = saved.getByRole("listitem").filter({
      hasText: "Moved to Porto",
    });
    await expect(porto).toContainText("June 2019");
    await expect(saved.getByText("Moved to Lisbon")).toHaveCount(0);
    await expect(
      timeline.locator("[data-timeline-id]", { hasText: "Moved to Porto" }),
    ).toHaveCount(1);

    // Remove, only on the confirming press.
    await porto.getByRole("button", { name: "Remove Moved to Porto" })
      .click();
    await expect(section.locator("#life-events-state")).toHaveText(
      "Press the remove button again to confirm. Reminders attached to this life event are deleted too.",
    );
    await section.getByRole("button", {
      name: "Confirm remove Moved to Porto",
    }).click();
    await expect(section.locator("#life-events-state")).toHaveText(
      "No life events saved.",
    );
    await expect(section).toHaveAttribute("data-section-state", "empty");
    await expect(
      timeline.locator("[data-timeline-id]", { hasText: "Moved to Porto" }),
    ).toHaveCount(0);
    expect(databaseValue(
      `select string_agg(action, ',' order by created_at, action)
        from crm.audit_events where subject_type = 'life_event'
        and person_id = '${personId}'::uuid`,
    )).toBe(
      "journal.life-event-created,journal.life-event-updated,journal.life-event-deleted",
    );

    // Another workspace's person is not reachable through the same route.
    const foreign = await page.request.post(
      `${origin}/api/v1/people/${crypto.randomUUID()}/life-events`,
      {
        data: { name: "Intrusion", precision: "unknown" },
        headers: { origin },
      },
    );
    expect(foreign.status()).toBe(404);

    // An archived person's life events are read-only.
    await add.click();
    await name.fill("Graduated");
    await section.locator('select[name="precision"]').selectOption("year");
    await section.getByLabel("Year", { exact: true }).fill("2011");
    await section.getByRole("button", { name: "Save life event" }).click();
    await expect(saved.getByRole("listitem").filter({ hasText: "Graduated" }))
      .toContainText("2011");
    databaseValue(`update crm.people set archived_at = now()
      where id = '${personId}'::uuid returning id::text`);
    await page.reload();
    await waitForIsland(page, "person-life-events");
    await expect(section).toHaveAttribute("data-section-state", "ready");
    await expect(section.locator("#life-events-state")).toHaveText(
      "1 life event. This archived person is read-only.",
    );
    await expect(saved).toContainText("Graduated");
    await expect(add).toBeHidden();
    await expect(section.getByRole("button", { name: /^Edit / }))
      .toHaveCount(0);
    await expectAccessible(page);
  },
);
