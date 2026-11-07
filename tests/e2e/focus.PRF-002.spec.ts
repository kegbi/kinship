import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { createPerson, registerVerified } from "./support/api.ts";
import { bareToken } from "./support/mail.ts";

async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  if (page.context().browser()?.browserType().name() === "webkit") {
    // Exercise focus presentation and activation with explicit WebKit tab stops;
    // this does not assert its default implicit-anchor keyboard reachability.
    await target.evaluate((element) => {
      if (element instanceof HTMLAnchorElement) element.tabIndex = 0;
    });
  }
  // Set a nearby starting point; actual Tab traversal must return to the target.
  // Avoid wrapping through browser chrome or the development toolbar.
  await target.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => element.matches(":focus-visible")))
    .toBe(true);
}

/**
 * A focused button or link draws the 2px focus ring 2px outside itself. A
 * focused text field or select instead keeps its outline flush and
 * transparent and shows a soft halo, except in forced colours, where the
 * system paints that outline in Highlight.
 */
async function expectControlFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const field = await target.evaluate((element) =>
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !["checkbox", "radio", "range", "color", "file", "submit", "button"]
        .includes(element.type))
  );
  await expect(target).toHaveCSS("outline-style", "solid");
  await expect(target).toHaveCSS("outline-width", "2px");
  await expect(target).toHaveCSS("outline-offset", field ? "0px" : "2px");
  const boxShadow = await target.evaluate((element) =>
    getComputedStyle(element).boxShadow
  );
  expect(boxShadow).not.toContain("inset");
  const forced = await target.evaluate(() =>
    matchMedia("(forced-colors: active)").matches
  );
  if (field && !forced) expect(boxShadow).toMatch(/ 0px 0px 0px 3px$/);
  const expectedColor = await target.evaluate((_, transparent) => {
    const probe = document.createElement("span");
    probe.style.forcedColorAdjust = "none";
    probe.style.color = matchMedia("(forced-colors: active)").matches
      ? "Highlight"
      : transparent
      ? "transparent"
      : getComputedStyle(document.documentElement).getPropertyValue(
        "--focus-ring",
      );
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, field);
  await expect(target).toHaveCSS("outline-color", expectedColor);
}

async function expectDestination(target: Locator, cue: Locator): Promise<void> {
  await expect(target).toBeFocused();
  await expect(target).toHaveCSS("outline-style", "none");
  expect(
    await target.evaluate((element) => getComputedStyle(element).boxShadow),
  )
    .not.toContain("inset");
  await expect(cue).toHaveCSS("text-decoration-line", "underline");
  await expect(cue).toHaveCSS("text-decoration-thickness", "2px");
}

async function expectUnclipped(
  target: Locator,
  scrollport: string,
): Promise<void> {
  // Read both rectangles together while keyboard scrolling and snapping settle.
  await expect.poll(() =>
    target.evaluate((element, selector) => {
      const targetBox = element.getBoundingClientRect();
      const portBox = element.closest(selector)!.getBoundingClientRect();
      // Both the two-pixel gap and the outline must fit on every side.
      return Math.min(
        targetBox.top - 4 - portBox.top,
        portBox.bottom - targetBox.bottom - 4,
        targetBox.left - 4 - portBox.left,
        portBox.right - targetBox.right - 4,
      );
    }, scrollport)
  ).toBeGreaterThanOrEqual(0);
}

test(
  "[PEOPLE-002] [PRF-002] keeps focus visible without covering controls or page destinations",
  {
    annotation: [{ type: "flow", description: "PEOPLE-002" }, {
      type: "leaf",
      description: "PRF-002",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    const email = `focus-${browserName}-${Date.now()}@example.test`;
    const password = "correct horse battery staple";
    await registerVerified(request, {
      email,
      firstName: "Focus",
      lastName: "Reviewer",
      workspaceName: "Focus circle",
    }, bareToken);
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    const personId = await createPerson(page.request, {
      givenName: "Ada",
      familyName: "Focus",
    });
    const personPath = `/app/people/${personId}`;

    // Pointer navigation still moves accessible focus to the new page heading.
    await page.goto("/app/people");
    await page.locator(`.person-directory-link[href="${personPath}"]`).click();
    const heading = page.locator("#person-profile-name");
    await expect(heading).toHaveText("Ada Focus");
    await expect(heading).toBeFocused();
    await expect(heading).toHaveCSS("outline-style", "none");
    expect(
      await heading.evaluate((element) => getComputedStyle(element).boxShadow),
    ).toBe("none");

    for (const theme of ["light", "dark", "forced-colors"] as const) {
      await page.goto("/app/tasks");
      await expect(page.getByRole("heading", { level: 1, name: "Tasks" }))
        .toBeVisible();
      await expect(page.locator("[data-task-state]"))
        .toHaveText("No tasks in this view.");
      await page.emulateMedia({
        forcedColors: theme === "forced-colors" ? "active" : "none",
      });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme === "dark" ? "dark" : "light");

      const add = page.getByRole("button", { name: "Add task", exact: true });
      await add.click();
      await expect(add).toHaveCSS("outline-style", "none");
      const title = page.getByRole("textbox", { name: "Title", exact: true });
      await title.click();
      await expectControlFocus(title);
      await page.keyboard.press("Tab");
      await expectControlFocus(
        page.getByRole("textbox", { name: "Description (optional)" }),
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      const state = page.locator("[data-task-status-filter]");
      await state.click();
      await page.keyboard.press("Escape");
      expect(
        await state.evaluate((element) => getComputedStyle(element).boxShadow),
      ).not.toContain("inset");
      await page.keyboard.press("Tab");
      await expectControlFocus(page.locator("[data-task-person-filter]"));
      await page.keyboard.press("Shift+Tab");
      await expectControlFocus(state);

      await page.locator(".brand").focus();
      await page.keyboard.press("Shift+Tab");
      await expectControlFocus(page.locator(".skip-link"));
      await expect(page.locator(".skip-link")).toBeInViewport();
      await page.keyboard.press("Enter");
      await expectDestination(
        page.locator("#main-content"),
        page.getByRole("heading", { level: 1, name: "Tasks" }),
      );

      for (
        const [path, selectors] of [
          ["/app/people/new", ['.person-form input[name="givenName"]']],
          ["/app/settings/preferences", [
            '.settings-form input[name="locale"]',
            '.settings-form select[name="temperatureScale"]',
          ]],
        ] as const
      ) {
        await page.goto(path);
        await expect(page.locator(selectors[0])).toBeEnabled();
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme === "dark" ? "dark" : "light");
        for (const selector of selectors) {
          const invalid = page.locator(selector);
          // Exercise rendered invalid-state styling independently of validation rules.
          await invalid.evaluate((element) =>
            element.setAttribute("aria-invalid", "true")
          );
          await tabTo(page, invalid);
          await expectControlFocus(invalid);
        }
      }

      await page.goto(`${personPath}?section=important-dates`);
      const section = page.locator("#profile-section-important-dates");
      await expect(section).toBeFocused();
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme === "dark" ? "dark" : "light");
      await expectDestination(
        section,
        section.getByRole("heading", { name: "Important dates", exact: true }),
      );
      const addDate = page.getByRole("button", {
        name: "Add important date",
        exact: true,
      });
      await expect(addDate).toBeVisible();
      await expect(section).toBeFocused();
      await page.keyboard.press("Tab");
      await expectControlFocus(addDate);
    }
    await page.emulateMedia({ forcedColors: "none" });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });

    // A keyboard section jump and history restoration cue its heading, not its card.
    const directory = page.locator(".profile-section-directory summary");
    await tabTo(page, directory);
    await page.keyboard.press("Enter");
    await tabTo(page, page.locator('[data-section-link="contact-methods"]'));
    await page.keyboard.press("Enter");
    const contact = page.locator("#profile-section-contact-methods");
    await expectDestination(
      contact,
      contact.getByRole("heading", { name: "Contact methods", exact: true }),
    );
    await page.goBack();
    const dates = page.locator("#profile-section-important-dates");
    await expectDestination(
      dates,
      dates.getByRole("heading", { name: "Important dates", exact: true }),
    );
    await page.goForward();
    await expectDestination(
      contact,
      contact.getByRole("heading", { name: "Contact methods", exact: true }),
    );
    await directory.click();
    await page.locator('[data-section-link="important-dates"]').click();
    await expect(dates).toBeFocused();
    await expect(dates).toHaveCSS("outline-style", "none");
    expect(
      await dates.evaluate((element) => getComputedStyle(element).boxShadow),
    ).not.toContain("inset");
    await expect(
      dates.getByRole("heading", { name: "Important dates", exact: true }),
    ).toHaveCSS("text-decoration-line", "none");

    // Scrollable navigation keeps enough room for the whole external outline.
    await page.getByRole("button", { name: "Show all sections", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    const people = page.locator('.primary-nav a[href="/app/people"]');
    await tabTo(page, people);
    await expectControlFocus(people);
    await expectUnclipped(people, ".primary-nav");
    const all = page.locator('[data-zone-filter="all"]');
    await tabTo(page, all);
    await expectControlFocus(all);
    await expectUnclipped(all, ".zone-switcher");

    // A disabled section's status remains a focused destination with a local cue.
    await page.route(`**/api/v1/people/${personId}?*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.person.profileSections = [{
        id: "important-dates",
        status: "hidden",
      }];
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${personPath}?section=important-dates`);
    const notice = page.locator("#person-profile-section-notice");
    await expectDestination(notice, notice);
    const personalization = notice.getByRole("link", {
      name: "Open personalization",
    });
    if (browserName === "webkit") {
      await personalization.evaluate((element) => element.tabIndex = 0);
    }
    await page.keyboard.press("Tab");
    await expectControlFocus(personalization);
  },
);
