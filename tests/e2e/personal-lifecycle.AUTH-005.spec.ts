import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { registerVerified } from "./support/api.ts";
import { database } from "./support/database.ts";
import { origin, password } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

async function registerAndSignIn(
  page: Page,
  request: APIRequestContext,
  email: string,
  workspaceName: string,
): Promise<string> {
  await registerVerified(request, {
    email,
    firstName: "Lifecycle",
    lastName: "Member",
    workspaceName,
  }, bareToken);
  await signInAcceptingCompliance(page, email);
  return database(
    `select w.id from crm.workspaces w join crm.workspace_members wm on wm.workspace_id = w.id join crm.users u on u.id = wm.user_id where u.email = '${email}' and wm.role = 'owner' and wm.status = 'active' order by w.created_at limit 1`,
    true,
  );
}

function addBackupOwner(workspaceId: string): void {
  const backupEmail = `backup-${crypto.randomUUID()}@example.test`;
  database(`with backup as (
    insert into crm.users (email, first_name, last_name, status, email_verified_at)
    values ('${backupEmail}', 'Backup', 'Owner', 'active', now()) returning id
  ) insert into crm.workspace_members
    (workspace_id, user_id, role, status, joined_at, created_at, updated_at)
    select '${workspaceId}'::uuid, id, 'owner', 'active', now(), now(), now()
    from backup`);
}

test("[AUTH-005] leaves a workspace or deletes personal identity safely", {
  annotation: [{ type: "flow", description: "AUTH-005" }, {
    type: "leaf",
    description: "APP-009C",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);

  const leavingEmail = `leave-${browserName}-${Date.now()}@example.test`;
  const leavingWorkspace = await registerAndSignIn(
    page,
    request,
    leavingEmail,
    "Leave circle",
  );
  await page.goto("/app/settings/profile");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.profile",
  );
  // FEQ-11: the panel reads the current impact once the reader reaches it.
  await page.locator("#lifecycle-impact").scrollIntoViewIfNeeded();
  await expect(page.locator("#lifecycle-blockers")).toContainText(
    "final active owner",
  );
  await expect(page.locator("#lifecycle-blockers")).toContainText(
    "Transfer ownership",
  );
  await expect(
    page.locator("#leave-workspace-form").getByRole("button", {
      name: "Leave workspace",
    }),
  ).toBeDisabled();

  addBackupOwner(leavingWorkspace);
  await page.reload();
  const leaveForm = page.locator("#leave-workspace-form");
  await expect(leaveForm.locator("#leave-confirmation-value")).toHaveText(
    "LEAVE Leave circle",
  );
  await leaveForm.getByLabel("Leave confirmation").fill("LEAVE Leave circle");
  await leaveForm.getByLabel("Current password").fill(password);
  await leaveForm.getByRole("button", { name: "Leave workspace" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  expect(database(
    `select count(*) from crm.workspace_members wm join crm.users u on u.id = wm.user_id where u.email = '${leavingEmail}' and wm.status = 'active'`,
    true,
  )).toBe("0");

  const deletingEmail = `delete-${browserName}-${Date.now()}@example.test`;
  const deletingWorkspace = await registerAndSignIn(
    page,
    request,
    deletingEmail,
    "Delete circle",
  );
  addBackupOwner(deletingWorkspace);
  await page.goto("/app/settings/profile");
  await page.locator("#lifecycle-impact").scrollIntoViewIfNeeded();
  const deleteForm = page.locator("#delete-identity-form");
  await expect(deleteForm.locator("#delete-confirmation-value")).toHaveText(
    `DELETE ${deletingEmail}`,
  );
  await expectAccessible(page);

  await deleteForm.getByLabel("Deletion confirmation").fill(
    `DELETE ${deletingEmail}`,
  );
  await deleteForm.getByLabel("Current password").fill("wrong password");
  await deleteForm.getByRole("button", { name: "Delete personal identity" })
    .click();
  await expect(page.locator("#lifecycle-status")).toContainText(
    "current password",
  );
  await expect(
    deleteForm.getByRole("button", { name: "Delete personal identity" }),
  ).toBeEnabled();

  await deleteForm.getByLabel("Current password").fill(password);
  await deleteForm.getByRole("button", { name: "Delete personal identity" })
    .click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  expect(database(
    `select status || ':' || (password_hash is null)::text from crm.users where email = 'deleted+' || id::text || '@invalid.kinship.local' and id in (select user_id from crm.workspace_members where workspace_id = '${deletingWorkspace}'::uuid and status = 'left')`,
    true,
  )).toBe("deleted:true");
  expect((await page.request.get(`${origin}/api/v1/session`)).status()).toBe(
    401,
  );
});
