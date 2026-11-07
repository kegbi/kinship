import { expect, test } from "./support/test.ts";
import { createPerson, registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { openPersonMenu } from "./support/profile.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

test("[EXPORT-001] exports portable workspace data and a person vCard", {
  annotation: [{ type: "flow", description: "EXPORT-001" }, {
    type: "leaf",
    description: "APP-009B",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const email = `export-${browserName}-${Date.now()}@example.test`;
  await registerVerified(request, {
    email,
    firstName: "Export",
    lastName: "Admin",
    workspaceName: "Export circle",
  }, bareToken);
  await signInAcceptingCompliance(page, email);
  const personId = await createPerson(page.request, {
    familyName: "Lovelace",
    givenName: "Ada",
  });

  await page.goto("/app/settings/export");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.export",
  );
  await expect(page.getByText("No exports yet.")).toBeVisible();
  await page.getByRole("button", { name: "Create export" }).click();
  await expect(page.getByText("Export completed for 1 person.")).toBeVisible();
  await expect(page.locator("[data-export-history]")).toContainText(
    "Completed",
  );
  await page.getByRole("button", { name: "Prepare download" }).click();
  const downloadLink = page.getByRole("link", { name: "Download export" });
  await expect(downloadLink).toBeVisible();
  const href = await downloadLink.getAttribute("href");
  expect(href).toContain("token=");
  const artifact = await page.request.get(`${origin}${href}`);
  expect(artifact.status()).toBe(200);
  expect(artifact.headers()["content-disposition"]).toContain("attachment;");
  const portable = await artifact.json() as {
    format: string;
    tables: { contacts: Array<{ first_name: string }> };
    version: number;
  };
  expect(portable).toMatchObject({ format: "monica-json", version: 1 });
  expect(portable.tables.contacts).toEqual([
    expect.objectContaining({ first_name: "Ada" }),
  ]);
  expect(JSON.stringify(portable)).not.toMatch(/password|secret|storage_key/i);
  await expectAccessible(page);

  if (process.env.E2E_DEV_SHELL === "1") {
    await page.route(
      `**/app/people/${personId}*`,
      async (route) =>
        route.fulfill({
          response: await request.get(
            `${origin}/internal/person-profile-shell`,
          ),
        }),
    );
  }
  await page.goto(`/app/people/${personId}`);
  await openPersonMenu(page);
  const vcardLink = page.getByRole("link", { name: "Export vCard" });
  await expect(vcardLink).toHaveAttribute(
    "href",
    new RegExp(`/api/v1/people/${personId}/vcard\\?workspaceId=`),
  );
  const vcardHref = await vcardLink.getAttribute("href");
  const vcard = await page.request.get(`${origin}${vcardHref}`);
  expect(vcard.status()).toBe(200);
  expect(await vcard.text()).toContain("FN:Ada Lovelace");
});
