import { expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

test(
  "[INTERACTION-001] logs and reviews a multi-person activity and favorite note",
  { annotation: { type: "flow", description: "INTERACTION-001" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    const email = `interactions-${browserName}-${Date.now()}@example.test`;
    expect(
      (await request.post(`${origin}/api/v1/registrations`, {
        data: {
          email,
          firstName: "Interaction",
          lastName: "Writer",
          password,
          workspaceName: "Shared history",
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
    expect(
      (await page.request.post(
        `${origin}/api/v1/settings/personalization/activity-types`,
        {
          data: { name: "Collaboration", sortOrder: 0 },
          headers: { origin },
        },
      )).status(),
    ).toBe(200);

    async function createPerson(givenName: string, familyName: string) {
      await page.goto("/app/people/new");
      await page.getByLabel("Given name").fill(givenName);
      await page.getByLabel("Family name").fill(familyName);
      await page.getByRole("button", { name: "Save person", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
      return new URL(page.url()).pathname;
    }

    const adaPath = await createPerson("Ada", "Lovelace");
    const gracePath = await createPerson("Grace", "Hopper");
    const beyondName = "Beyond First Page";
    for (let index = 0; index < 25; index += 1) {
      const created = await page.request.post(`${origin}/api/v1/people`, {
        data: {
          givenName: index === 24 ? beyondName : `Paged ${index}`,
          isPartial: false,
        },
        headers: { origin },
      });
      expect(created.status()).toBe(201);
    }

    await page.goto("/app");
    await page.getByRole("button", { name: "Quick capture" }).click();
    const capture = page.getByRole("dialog", {
      name: "Record an activity or note",
    });
    await expect(capture).toBeVisible();
    const quickCapture = page.getByRole("button", { name: "Quick capture" });
    const escapeSummary = capture.getByLabel("Summary");
    await escapeSummary.fill("Draft retained after Escape");
    page.once("dialog", async (confirmation) => await confirmation.dismiss());
    await page.keyboard.press("Escape");
    await expect(capture).toBeVisible();
    await expect(escapeSummary).toHaveValue("Draft retained after Escape");
    page.once("dialog", async (confirmation) => await confirmation.accept());
    await page.keyboard.press("Escape");
    await expect(capture).toBeHidden();
    await expect(quickCapture).toBeFocused();
    await quickCapture.click();
    await expect(capture).toBeVisible();
    await expect(capture.getByLabel("Summary")).toHaveValue("");
    const participantSearch = capture.getByLabel("Search participants");
    const participantSelect = capture.getByLabel("Participants", {
      exact: true,
    });
    const activityType = capture.getByLabel("Activity type", { exact: true });
    const activityTypeOption = activityType.locator("option:not([value=''])")
      .first();
    await expect(activityTypeOption).toHaveCount(1);
    const activityTypeLabel = (await activityTypeOption.textContent())!.trim();
    await activityType.selectOption(
      (await activityTypeOption.getAttribute(
        "value",
      ))!,
    );
    const emotions = capture.getByLabel("Emotions (optional)");
    await expect(emotions.locator("option")).toHaveCount(0);
    for (const name of ["Ada Lovelace", "Grace Hopper", beyondName]) {
      await participantSearch.fill(name);
      await participantSearch.press("Tab");
      await expect(participantSelect.locator("option", { hasText: name }))
        .toHaveCount(1);
      await participantSelect.selectOption([
        ...await participantSelect.locator("option:checked").evaluateAll((
          options,
        ) =>
          options.map((entry) => ({
            value: (entry as HTMLOptionElement).value,
          }))
        ),
        { label: name },
      ]);
    }
    await capture.getByLabel("Summary").fill("Designed a compiler together");
    await capture.getByLabel("Details (optional)").fill(
      "Compared notes and planned the next experiment.",
    );
    await capture.getByRole("button", { name: "Save interaction" }).click();
    await expect(capture.getByText("Activity saved.")).toBeVisible();
    await expect(page.locator("#today-recent-activity")).toContainText(
      "Designed a compiler together",
    );
    for (const name of ["Ada Lovelace", "Grace Hopper", beyondName]) {
      await expect(page.locator("#today-recent-activity")).toContainText(name);
    }
    await expect(page.locator("#today-recent-activity")).toContainText(
      `Category: ${activityTypeLabel}`,
    );
    await expect(page.locator("#today-recent-activity")).not.toContainText(
      "Emotions:",
    );
    await capture.getByLabel("Summary").fill("Second sequential capture");
    await capture.getByRole("button", { name: "Save interaction" }).click();
    await expect(page.locator("#today-recent-activity")).toContainText(
      "Second sequential capture",
    );
    await capture.getByRole("button", { name: "Cancel" }).click();
    await expect(capture).toBeHidden();

    const adaId = adaPath.split("/").at(-1)!;
    for (let index = 0; index < 21; index += 1) {
      const created = await page.request.post(`${origin}/api/v1/interactions`, {
        data: {
          body: `Paged note ${String(index).padStart(2, "0")}`,
          kind: "note",
          personId: adaId,
          requestId: crypto.randomUUID(),
        },
        headers: { origin },
      });
      expect(created.status()).toBe(201);
    }

    await page.goto(`${adaPath}?section=activities`);
    await page.reload();
    const adaActivities = page.locator("#profile-section-activities");
    await expect(adaActivities).toContainText("Designed a compiler together");
    await expect(adaActivities).toContainText(
      `Category: ${activityTypeLabel}`,
    );
    await expect(adaActivities).not.toContainText("Emotions:");
    const reportPath = `${adaPath}/activity-report`;
    const reportLink = adaActivities.getByRole("link", {
      name: "Open activity report",
    });
    await expect(reportLink).toHaveAttribute("href", reportPath);
    await Promise.all([
      page.waitForURL(new RegExp(`${reportPath}$`), { timeout: 15_000 }),
      reportLink.click(),
    ]);
    await expect(page.getByRole("heading", { name: "Ada Lovelace activity" }))
      .toBeVisible();
    await expect(page.getByRole("button", { name: "Load more", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    await expect(page.locator("#activity-report-list")).toContainText(
      "Paged note 00",
    );
    await expect(page.locator("#activity-report-list")).toContainText(
      "Designed a compiler together",
    );
    await expect(page.locator("#activity-report-list")).toContainText(
      `Category: ${activityTypeLabel}`,
    );
    await expect(page.locator("#activity-report-list")).not.toContainText(
      "Emotions:",
    );

    await page.goto(`${gracePath}?section=activities`);
    await expect(page.locator("#profile-section-activities")).toContainText(
      "Designed a compiler together",
    );

    await page.goto(`${adaPath}?section=notes`);
    const adaNotes = page.locator("#profile-section-notes");
    const addNote = adaNotes.getByRole("button", { name: "Add note" });
    await addNote.focus();
    await addNote.press("Enter");
    await expect(capture).toBeVisible();
    await expect(capture.getByLabel("What are you recording?")).toHaveValue(
      "note",
    );
    await expect(capture.getByLabel("When it happened")).toBeDisabled();
    await expect(capture.getByLabel("Participants", { exact: true }))
      .toHaveValue(
        adaPath.split("/").at(-1)!,
      );
    await capture.getByRole("textbox", { name: "Note", exact: true }).fill(
      "Remember the analytical engine sketch.",
    );
    await capture.getByLabel("Keep this note in Today favorites").check();
    await capture.getByRole("button", { name: "Save interaction" }).click();
    await expect(capture.getByText("Note saved.")).toBeVisible();
    await capture.getByRole("button", { name: "Cancel" }).click();
    await expect(adaNotes).toContainText(
      "Remember the analytical engine sketch.",
    );

    await page.goto("/app");
    await expect(page.locator("#today-favorite-notes")).toContainText(
      "Remember the analytical engine sketch.",
    );
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
