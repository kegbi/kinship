import { expect, test } from "@playwright/test";
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

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function database(statement: string): string {
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

test("[PEOPLE-003] reads the complete canonical person workspace", {
  annotation: [{ type: "flow", description: "PEOPLE-003" }, {
    type: "leaf",
    description: "APP-008C",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const email = `complete-profile-${browserName}-${Date.now()}@example.test`;
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Profile",
      lastName: "Reader",
      password,
      workspaceName: "Complete profile circle",
    },
  })).status()).toBe(202);
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
  expect((await request.post(`${origin}/api/v1/email-verifications`, {
    data: { token },
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
    await expect(page).toHaveURL(/\/app$/);
  }

  const created = await page.request.post(`${origin}/api/v1/people`, {
    data: {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: true,
    },
    headers: { origin },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json() as { person: { id: string } }).person
    .id;
  expect((await page.request.post(`${origin}/api/v1/tasks`, {
    data: {
      personId,
      requestId: crypto.randomUUID(),
      title: "Review correspondence",
    },
    headers: { origin },
  })).status()).toBe(201);
  expect((await page.request.post(`${origin}/api/v1/reminders`, {
    data: {
      anchorOn: "2030-09-15",
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "none",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title: "Write to Ada",
    },
    headers: { origin },
  })).status()).toBe(201);
  expect((await page.request.post(`${origin}/api/v1/stay-in-touch-cadences`, {
    data: {
      intervalCount: 1,
      intervalUnit: "month",
      personId,
      requestId: crypto.randomUUID(),
    },
    headers: { origin },
  })).status()).toBe(201);

  const workspaceId = database(
    `select w.id::text from crm.workspaces w join crm.users u
      on u.id = w.created_by_user_id where u.email = ${sqlLiteral(email)}`,
  );
  database(`insert into crm.life_events
    (workspace_id, person_id, name, note, year, month, precision)
    values ('${workspaceId}'::uuid, '${personId}'::uuid, 'Published Notes',
      'The first published computer algorithm.', 1843, 12, 'year_month')`);
  const foreignWorkspaceId = crypto.randomUUID();
  const foreignPersonId = crypto.randomUUID();
  database(`insert into crm.workspaces (id, name, status)
    values ('${foreignWorkspaceId}'::uuid, 'Foreign profile', 'active');
    insert into crm.people (id, workspace_id, given_name)
    values ('${foreignPersonId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Private')`);

  const taskRequests: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && sent.url().includes("/api/v1/tasks")) {
      taskRequests.push(new URL(sent.url()).pathname);
    }
  });
  await page.goto(`/app/people/${personId}?section=life-events`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "people.profile",
  );
  await expect(page.getByRole("heading", { name: "Ada Lovelace" }))
    .toBeVisible();
  await expect(page.getByText("Partial identity · unknown values preserved"))
    .toBeVisible();
  await expect(page.locator("#person-profile-due-state")).toContainText(
    "1 open task",
  );
  await expect(page.locator("#person-profile-due-state")).toContainText(
    "next reminder",
  );
  await expect(page.locator("#person-profile-due-state")).toContainText(
    "stay in touch",
  );

  const sections = page.locator("[data-profile-section]");
  await expect(sections).toHaveCount(22);
  await page.locator('[data-zone="things"]').scrollIntoViewIfNeeded();
  await page.locator('[data-zone="admin"]').scrollIntoViewIfNeeded();
  await expect.poll(async () =>
    await sections.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.sectionState)
        .filter((state) =>
          state === "loading" || state === "unavailable" ||
          state === "error" || state === "forbidden"
        ).length
    )
  ).toBe(0);
  const history = page.locator("#profile-section-life-events");
  await expect(history).toHaveAttribute("data-section-state", "ready");
  await expect(history).toBeFocused();
  await expect(history).toContainText("December 1843");
  await expect(history).toContainText("Published Notes");
  await expect(history.getByRole("button", { name: /add/i })).toHaveCount(0);

  const tasks = page.locator("#profile-section-tasks");
  await tasks.getByRole("button", { name: "Add task" }).click();
  await tasks.getByLabel("Title").fill("Owning facade proof");
  await tasks.getByRole("button", { name: "Save task" }).click();
  await expect(tasks.getByText("Owning facade proof")).toBeVisible();
  expect(taskRequests).toEqual(["/api/v1/tasks"]);

  await page.route(
    `**/api/v1/people/${personId}/life-events`,
    (route) =>
      route.fulfill({
        body: JSON.stringify({
          detail: "History temporarily unavailable.",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        }),
        contentType: "application/problem+json",
        status: 503,
      }),
  );
  await page.reload();
  await expect(history).toHaveAttribute("data-section-state", "error");
  await expect(history).toContainText("History temporarily unavailable.");
  await expect(page.locator("#profile-section-tasks")).not.toHaveAttribute(
    "data-section-state",
    "error",
  );
  await page.unroute(`**/api/v1/people/${personId}/life-events`);
  await history.getByRole("button", { name: "Retry life events" }).click();
  await expect(history).toHaveAttribute("data-section-state", "ready");

  database(`insert into crm.workspace_profile_modules
    (workspace_id, key, name, is_active) values
    ('${workspaceId}'::uuid, 'life-events', 'Life events', false)
    on conflict (workspace_id, key) do update set is_active = false`);
  await page.reload();
  await expect(history).toBeHidden();
  await expect(page.locator('[data-section-link="life-events"]')).toBeHidden();
  expect(database(
    `select count(*) from crm.life_events where workspace_id =
      '${workspaceId}'::uuid and person_id = '${personId}'::uuid`,
  )).toBe("1");
  expect((await page.request.get(
    `${origin}/api/v1/people/${foreignPersonId}/life-events`,
  )).status()).toBe(404);

  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);
});
