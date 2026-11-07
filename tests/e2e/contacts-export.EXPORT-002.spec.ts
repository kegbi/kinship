import type { Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { createPerson, registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

/** Creates an export in `format` from the page and downloads the newest. */
async function exportAs(page: Page, format: string, expected: string) {
  await page.getByLabel(format, { exact: true }).check();
  await page.getByRole("button", { name: "Create export" }).click();
  await expect(page.getByText("Export completed for 2 persons.")).toBeVisible();
  const newest = page.locator("[data-export-history] li").first();
  await expect(newest).toHaveAttribute("data-export-format", expected);
  await newest.getByRole("button", { name: "Prepare download" }).click();
  const link = newest.getByRole("link", { name: "Download export" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toContain("token=");
  const artifact = await page.request.get(`${origin}${href}`);
  expect(artifact.status()).toBe(200);
  expect(artifact.headers()["content-disposition"]).toContain("attachment;");
  return { artifact, href: href! };
}

test("[EXPORT-002] exports contacts as a CSV archive and one vCard file", {
  annotation: [{ type: "flow", description: "EXPORT-002" }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const email = `contacts-export-${browserName}-${Date.now()}@example.test`;
  await registerVerified(request, {
    email,
    firstName: "Export",
    lastName: "Admin",
    workspaceName: "Contacts export circle",
  }, bareToken);
  await signInAcceptingCompliance(page, email);
  const ada = await createPerson(page.request, {
    familyName: "Lovelace",
    givenName: "Ada",
  });
  await createPerson(page.request, { givenName: "=SUM(1+1)" });

  await page.goto("/app/settings/export");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.export",
  );
  await expect(page.getByText("No exports yet.")).toBeVisible();
  await expect(page.getByLabel("JSON", { exact: true })).toBeChecked();
  await expectAccessible(page);

  const csv = await exportAs(page, "CSV", "csv");
  expect(csv.artifact.headers()["content-type"]).toBe("application/zip");
  const archive = (await csv.artifact.body()).toString("utf8");
  expect(archive.startsWith("PK")).toBe(true);
  for (
    const name of [
      "people.csv",
      "contact_methods.csv",
      "dates.csv",
      "manifest.json",
    ]
  ) expect(archive).toContain(name);
  expect(archive).toContain(`${ada},Ada,,Lovelace`);
  expect(archive).toContain("'=SUM(1+1)");
  expect(archive).not.toMatch(/,=SUM/);

  const vcard = await exportAs(page, "vCard", "vcard");
  expect(vcard.artifact.headers()["content-type"]).toContain("text/vcard");
  const cards = await vcard.artifact.text();
  expect(cards.match(/BEGIN:VCARD/g)).toHaveLength(2);
  expect(cards).toContain("FN:Ada Lovelace");

  // A download reference is spent once; asking again says it expired.
  expect((await page.request.get(`${origin}${csv.href}`)).status()).toBe(410);
  await expect(page.locator("[data-export-history]")).toContainText(
    "2 persons · CSV",
  );
  await expect(page.locator("[data-export-history]")).toContainText(
    "2 persons · vCard",
  );
});
