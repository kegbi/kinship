import { expect, type Page, test } from "@playwright/test";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { waitForIsland } from "./support/islands.ts";
import { bareToken } from "./support/mail.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { openPersonMenu } from "./support/profile.ts";
import { submitSignIn } from "./support/sign-in.ts";

/** A decodable one-pixel PNG, so the browser really draws the image. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Chooses `file` in the hero's avatar editor and uploads it. */
async function uploadAvatar(
  page: Page,
  file: { buffer: Buffer; mimeType: string; name: string },
): Promise<void> {
  const form = page.getByRole("form", { name: "Change avatar" });
  if (!await form.isVisible()) {
    await openPersonMenu(page);
    await page.getByRole("button", { name: "Change avatar" }).click();
  }
  await expect(form).toBeVisible();
  await form.getByLabel("Avatar image").setInputFiles(file);
  await form.getByRole("button", { name: "Upload avatar" }).click();
}

test(
  "[PEOPLE-007] uploads, replaces, draws, and removes a person's avatar",
  {
    annotation: [{ type: "flow", description: "PEOPLE-007" }, {
      type: "leaf",
      description: "GAP-045",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email = `avatars-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Avatar",
      lastName: "Keeper",
      workspaceName: "Avatar circle",
    }, bareToken);
    await submitSignIn(page, email);
    const personId = await createPerson(page.request, {
      familyName: "Lovelace",
      givenName: "Ada",
    });
    if (process.env.E2E_DEV_SHELL === "1") {
      await page.route(`**/app/people/${personId}*`, async (route) => {
        const shell = await request.get(
          `${origin}/internal/person-profile-shell`,
        );
        await route.fulfill({ response: shell });
      });
    }

    await page.goto(`/app/people/${personId}`);
    await expect(page.getByRole("heading", { name: "Ada Lovelace" }))
      .toBeVisible();
    const avatar = page.locator("#person-profile-avatar");
    const status = page.locator("#person-lifecycle-status");
    await expect(avatar).toHaveText("AL");

    // Refusals leave the initials in place and say why.
    await uploadAvatar(page, {
      buffer: Buffer.from("a plain note"),
      mimeType: "text/plain",
      name: "note.txt",
    });
    await expect(status).toHaveText("Choose a JPEG, PNG, or WebP image.");
    await uploadAvatar(page, {
      buffer: Buffer.concat([PIXEL, Buffer.alloc(1024 * 1024)]),
      mimeType: "image/png",
      name: "huge.png",
    });
    await expect(status).toHaveText("Choose an image of 1 MB or less.");
    await uploadAvatar(page, {
      buffer: Buffer.from("not really a png"),
      mimeType: "image/png",
      name: "disguised.png",
    });
    await expect(status).toHaveText(
      "This image did not pass the file check and was held for review. Choose another image.",
    );
    await expect(avatar).toHaveText("AL");
    await expectAccessible(page);

    // An image becomes the avatar, and a second one replaces it.
    await uploadAvatar(page, {
      buffer: PIXEL,
      mimeType: "image/png",
      name: "ada.png",
    });
    await expect(status).toHaveText("Avatar updated.");
    const image = avatar.locator("img");
    await expect(image).toHaveAttribute(
      "src",
      new RegExp(`^/api/v1/people/${personId}/files/[0-9a-f-]+/content$`),
    );
    const first = await image.getAttribute("src");
    await uploadAvatar(page, {
      buffer: PIXEL,
      mimeType: "image/png",
      name: "ada-again.png",
    });
    await expect(status).toHaveText("Avatar updated.");
    await expect(image).not.toHaveAttribute("src", first!);
    const current = await image.getAttribute("src");

    // The directory and the people palette draw the same image.
    await settlePersonWorkspace(page);
    await page.goto("/app/people");
    const row = page.getByRole("link", { name: /Ada Lovelace/ });
    await expect(row.locator("[data-slot=avatar] img")).toHaveAttribute(
      "src",
      current!,
    );
    await waitForIsland(page, "global-people-search");
    await page.getByRole("combobox", { name: "Find a person" }).fill("Ada");
    await expect(
      page.locator("#global-people-search-results")
        .getByRole("option", { name: /Ada Lovelace/ })
        .locator("[data-slot=avatar] img"),
    ).toHaveAttribute("src", current!);
    await page.keyboard.press("Escape");

    // Bytes that went missing from the object store fall back to initials.
    const fileId = current!.split("/")[6]!;
    databaseSql(
      `update crm.files set storage_key = storage_key || '-gone'
       where id = ${sqlLiteral(fileId)}::uuid`,
    );
    await page.goto(`/app/people/${personId}`);
    await expect(avatar).toHaveText("AL");
    await expect(avatar.locator("img")).toHaveCount(0);
    await expect.poll(() =>
      databaseValue(
        `select status from crm.files where id = ${sqlLiteral(fileId)}::uuid`,
      )
    ).toBe("missing");
    await settlePersonWorkspace(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ada Lovelace" }))
      .toBeVisible();
    await expect(avatar).toHaveText("AL");
    await expect(avatar.locator("img")).toHaveCount(0);

    // Removing resets the person to their initials.
    await uploadAvatar(page, {
      buffer: PIXEL,
      mimeType: "image/png",
      name: "ada-restored.png",
    });
    await expect(status).toHaveText("Avatar updated.");
    await expect(avatar.locator("img")).toHaveCount(1);
    await openPersonMenu(page);
    await page.getByRole("button", { name: "Change avatar" }).click();
    await page.getByRole("form", { name: "Change avatar" })
      .getByRole("button", { name: "Remove avatar" }).click();
    await expect(status).toHaveText(
      "Avatar removed. Initials are shown instead.",
    );
    await expect(avatar).toHaveText("AL");
    await expect(avatar.locator("img")).toHaveCount(0);

    // An archived person's avatar is read-only.
    await openPersonMenu(page);
    await page.getByRole("button", { name: "Archive person" }).click();
    await expect(page.locator("#person-profile-archived")).toBeVisible();
    await openPersonMenu(page);
    await expect(page.getByRole("button", { name: "Change avatar" }))
      .toHaveCount(0);
    const refused = await page.request.put(
      `${origin}/api/v1/people/${personId}/avatar`,
      {
        data: PIXEL,
        headers: {
          "content-type": "image/png",
          origin,
          "X-File-Name": "late.png",
        },
      },
    );
    expect(refused.status()).toBe(409);
    await settlePersonWorkspace(page);
  },
);
