import { expect, test } from "@playwright/test";
import { registerVerified } from "./support/api.ts";
import { database } from "./support/database.ts";
import { origin, password } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

test(
  "[WORKSPACE-002] resets and deletes a workspace with current owner confirmation",
  {
    annotation: [{ type: "flow", description: "WORKSPACE-002" }, {
      type: "leaf",
      description: "APP-009D",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(20_000);
    const email =
      `workspace-lifecycle-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Workspace",
      lastName: "Owner",
      workspaceName: "Lifecycle circle",
    }, bareToken);
    await signInAcceptingCompliance(page, email);

    const workspaceId = database(
      `select w.id from crm.workspaces w join crm.workspace_members wm on wm.workspace_id=w.id join crm.users u on u.id=wm.user_id where u.email='${email}' and wm.role='owner' and wm.status='active'`,
      true,
    );
    expect((await page.request.post(`${origin}/api/v1/people`, {
      data: { familyName: "Impact", givenName: "Current", isPartial: false },
      headers: { origin },
    })).status()).toBe(201);

    await page.goto("/app/settings/workspace/danger-zone");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.workspace-danger",
    );
    await expect(page.locator("[data-danger-counts]")).toContainText("people");
    await expect(page.locator("[data-danger-counts]")).toContainText("1");
    await expectAccessible(page);

    const reset = page.locator("[data-danger-reset]");
    await reset.getByLabel("Reset confirmation").fill("RESET Lifecycle circle");
    await reset.getByLabel("Current password").fill(password);
    await reset.getByRole("button", { name: "Reset workspace data" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(database(
      `select (select count(*) from crm.workspaces where id='${workspaceId}'::uuid)::text || ':' || (select count(*) from crm.people where workspace_id='${workspaceId}'::uuid)::text || ':' || (select count(*) from crm.workspace_lifecycle_records where workspace_id='${workspaceId}'::uuid and action='reset')::text`,
      true,
    )).toBe("1:0:1");

    await signInAcceptingCompliance(page, email);
    await page.goto("/app/settings/workspace/danger-zone");
    const deletion = page.locator("[data-danger-delete]");
    await deletion.getByLabel("Deletion confirmation").fill(
      "DELETE Lifecycle circle",
    );
    await deletion.getByLabel("Current password").fill(password);
    await deletion.getByRole("button", { name: "Delete workspace" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(database(
      `select (select count(*) from crm.workspaces where id='${workspaceId}'::uuid)::text || ':' || (select count(*) from crm.workspace_lifecycle_records where workspace_id='${workspaceId}'::uuid and action='delete')::text`,
      true,
    )).toBe("0:1");
    expect((await page.request.get(`${origin}/api/v1/session`)).status()).toBe(
      401,
    );
  },
);
