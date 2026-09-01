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

function withExecRetry<T>(operation: () => T): T {
  for (let attempt = 1;; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

function database(statement: string, tuples = false): string {
  return withExecRetry(() =>
    execFileSync("docker", [
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
    ], { cwd: process.cwd(), encoding: "utf8", env: process.env })
  ).trim();
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

async function signIn(page: Page, email: string): Promise<void> {
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
}

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
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Workspace",
        lastName: "Owner",
        password,
        workspaceName: "Lifecycle circle",
      },
    })).status()).toBe(202);
    expect((await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token: await verificationToken(request, email) },
    })).status()).toBe(200);
    await signIn(page, email);

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
    await page.addScriptTag({ content: axe.source });
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);

    const reset = page.locator("[data-danger-reset]");
    await reset.getByLabel("Reset confirmation").fill("RESET Lifecycle circle");
    await reset.getByLabel("Current password").fill(password);
    await reset.getByRole("button", { name: "Reset workspace data" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(database(
      `select (select count(*) from crm.workspaces where id='${workspaceId}'::uuid)::text || ':' || (select count(*) from crm.people where workspace_id='${workspaceId}'::uuid)::text || ':' || (select count(*) from crm.workspace_lifecycle_records where workspace_id='${workspaceId}'::uuid and action='reset')::text`,
      true,
    )).toBe("1:0:1");

    await signIn(page, email);
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
