import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
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

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseSql(statement: string): void {
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
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
}

function databaseValue(statement: string): string {
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
    "-At",
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
  let token: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = await response.json() as { messages?: Array<{ ID: string }> };
    for (const message of body.messages ?? []) {
      const detail = await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      );
      const content = await detail.json() as { Text?: string };
      const link = content.Text?.match(/https?:\/\/\S+\?token=\S+/)?.[0];
      if (link && new URL(link).pathname === "/auth/verify-email") {
        token = new URL(link).searchParams.get("token") ?? undefined;
      }
    }
    return token;
  }).toBeTruthy();
  return token!;
}

async function registerVerified(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "People",
      lastName: "Writer",
      password,
      workspaceName: "People circle",
    },
  })).status()).toBe(202);
  expect((await request.post(`${origin}/api/v1/email-verifications`, {
    data: { token: await verificationToken(request, email) },
  })).status()).toBe(200);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () =>
    (await (globalThis as typeof globalThis & {
      axe: { run(): Promise<{ violations: unknown[] }> };
    }).axe.run()).violations
  );
  expect(violations).toEqual([]);
}

test(
  "[PEOPLE-001] creates a person in the active workspace",
  { annotation: { type: "flow", description: "PEOPLE-001" } },
  async ({ browserName, context, page, request }) => {
    test.setTimeout(150_000);
    const email = `people-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);
    await page.getByRole("link", { name: "Add person" }).click();
    await expect(page).toHaveURL(/\/app\/people\/new$/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "people.create",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Add a person" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Review the highlighted identity fields",
    );
    await expect(page.getByLabel("Given name")).toBeFocused();

    await page.getByLabel("Family name").fill("Unknown-first-name");
    await page.getByLabel("Some identity details are unknown").check();
    await page.getByRole("button", { name: "Save and add another" }).click();
    await expect(page.locator("#people-create-status")).toContainText(
      "Add another person",
    );
    await expect(page).toHaveURL(/\/app\/people\/new$/);
    await expect(page.getByLabel("Family name")).toHaveValue("");
    await expect(page.getByLabel("Given name")).toBeFocused();

    await page.getByLabel("Given name").fill("Ada");
    await page.getByLabel("Family name").fill("Lovelace");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const canonicalPersonUrl = page.url();
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "people.profile",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();
    await expect(page.getByText("Identity saved")).toBeVisible();
    await expect(page.getByText("Unknown", { exact: true })).toHaveCount(2);
    await expectAccessible(page);

    await page.reload();
    await expect(page).toHaveURL(canonicalPersonUrl);
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();
    await expect(page.getByText("Identity saved")).toBeVisible();

    const direct = await context.newPage();
    await direct.goto(canonicalPersonUrl);
    await expect(
      direct.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();
    await direct.close();

    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill(" ada ");
    await page.getByLabel("Family name").fill(" lovelace ");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    const duplicate = page.getByRole("alert").filter({
      hasText: "Possible duplicate",
    });
    await expect(duplicate).toBeVisible();
    await expect(duplicate).toContainText("Review the match or create anyway");
    await page.getByRole("button", { name: "Review the names" }).click();
    await expect(duplicate).toBeHidden();
    await expect(page.getByLabel("Given name")).toBeFocused();
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(duplicate).toBeVisible();
    await page.getByRole("button", { name: "Create anyway" }).click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);

    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const foreignWorkspaceId = randomUUID();
    const foreignPersonId = randomUUID();
    databaseSql(
      `insert into crm.workspaces (id, name, status) values ('${foreignWorkspaceId}'::uuid, 'Foreign circle', 'active'); insert into crm.people (id, workspace_id, given_name) values ('${foreignPersonId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Foreign person')`,
    );
    const sessionCookie = (await context.cookies()).find((cookie) =>
      cookie.name === "kinship_session"
    );
    expect(sessionCookie).toBeTruthy();
    const crossed = await request.post(`${origin}/api/v1/people`, {
      data: { givenName: "Crossed", isPartial: false },
      headers: {
        cookie: `kinship_session=${sessionCookie!.value}`,
        origin,
        "X-Workspace-Id": foreignWorkspaceId,
      },
    });
    expect(crossed.status()).toBe(401);
    const foreignRead = await request.get(
      `${origin}/api/v1/people/${foreignPersonId}`,
      {
        headers: {
          cookie: `kinship_session=${sessionCookie!.value}`,
          "X-Workspace-Id": workspaceId,
        },
      },
    );
    expect(foreignRead.status()).toBe(404);
    await page.goto(`/app/people/${foreignPersonId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Person not found" }),
    ).toBeVisible();
    await page.goto(`/app/people/${randomUUID()}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Person not found" }),
    ).toBeVisible();
    expect(databaseValue(
      `select count(*)::text from crm.people where workspace_id = '${workspaceId}'::uuid`,
    )).toBe("3");
    expect(databaseValue(
      `select count(*)::text from crm.people where workspace_id = '${foreignWorkspaceId}'::uuid`,
    )).toBe("1");
    expect(databaseValue(
      `select count(*)::text from crm.people where workspace_id = '${foreignWorkspaceId}'::uuid and id = '${foreignPersonId}'::uuid`,
    )).toBe("1");
    expect(databaseValue(
      `select count(*)::text from crm.people where workspace_id = '${workspaceId}'::uuid and given_name = '' and family_name = 'Unknown-first-name' and is_partial = true`,
    )).toBe("1");
    expect(databaseValue(
      `select count(*)::text from crm.audit_events where workspace_id = '${workspaceId}'::uuid and action = 'people.person-created' and person_id = subject_id`,
    )).toBe("3");
  },
);
