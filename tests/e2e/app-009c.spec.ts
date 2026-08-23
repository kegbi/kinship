import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import { execFileSync } from "node:child_process";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";
const composeArgs = [
  "compose",
  "--file",
  "compose.yaml",
  "--file",
  "compose.test.yaml",
] as const;

function database(statement: string, tuples = false): string {
  return execFileSync("docker", [
    ...composeArgs,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    process.env.POSTGRES_USER ?? "kinship_e2e",
    "-d",
    process.env.POSTGRES_DB ?? "kinship_e2e",
    ...(tuples ? ["-At"] : []),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ], { cwd: process.cwd(), encoding: "utf8", env: process.env }).trim();
}

async function verificationToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let token = "";
  await expect.poll(async () => {
    const messages = (await (await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    )).json() as { messages?: Array<{ ID: string }> }).messages ?? [];
    for (const message of messages) {
      const detail = await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      );
      token = ((await detail.json() as { Text?: string }).Text ?? "").match(
        /token=([^\s]+)/,
      )?.[1] ?? token;
    }
    return token;
  }).toBeTruthy();
  return token;
}

async function registerAndSignIn(
  page: Page,
  request: APIRequestContext,
  email: string,
  workspaceName: string,
): Promise<string> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Lifecycle",
      lastName: "Member",
      password,
      workspaceName,
    },
  })).status()).toBe(202);
  expect((await request.post(`${origin}/api/v1/email-verifications`, {
    data: { token: await verificationToken(request, email) },
  })).status()).toBe(200);
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app(?:$|\/compliance)/);
  if (new URL(page.url()).pathname === "/app/compliance") {
    await page.getByLabel("I have reviewed and accept this exact version.")
      .check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
  }
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
  const deleteForm = page.locator("#delete-identity-form");
  await expect(deleteForm.locator("#delete-confirmation-value")).toHaveText(
    `DELETE ${deletingEmail}`,
  );
  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);

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
