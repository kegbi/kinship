import { expect, type Page } from "@playwright/test";

/* Page object for the canonical person workspace, `/app/people/:personId`. */

/** Opens the person menu with a click unless it is already open. */
export async function openPersonMenu(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open person menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** One person read with its rail, as the person page receives it (AUD-Q3). */
export interface PersonRailAnswer {
  readonly rail: Record<string, unknown>;
  readonly summary?: { sectionCounts: { readonly id: string }[] };
  readonly [field: string]: unknown;
}

/** The person read that carries each rail section's first page (AUD-Q3). */
export function personRailRead(personId = "*"): string {
  return `**/api/v1/people/${personId}?include=rail`;
}

/**
 * Rewrites the person page's composed read, which serves every rail
 * section's first page, so a spec can fail or fake one section where the page
 * now reads it. `rewrite` returns the body to answer, or `undefined` to pass
 * the upstream answer through. Returns the route's pattern for `unroute`.
 */
export async function routePersonRail(
  page: Page,
  rewrite: (answer: PersonRailAnswer) => PersonRailAnswer | undefined,
  personId = "*",
): Promise<string> {
  const pattern = personRailRead(personId);
  await page.route(pattern, async (route) => {
    const upstream = await route.fetch();
    if (!upstream.ok()) return route.fulfill({ response: upstream });
    const answer = rewrite(await upstream.json() as PersonRailAnswer);
    if (!answer) return route.fulfill({ response: upstream });
    // The rewritten body differs from the upstream one, whose length and
    // encoding headers would no longer describe it; a browser that honours a
    // stale Content-Length (Linux WebKit, REL-039) would cut it short.
    // Playwright sets the right length when those headers are left out.
    const {
      "content-encoding": _encoding,
      "content-length": _length,
      ...headers
    } = upstream.headers();
    await route.fulfill({ headers, json: answer, status: upstream.status() });
  });
  return pattern;
}
