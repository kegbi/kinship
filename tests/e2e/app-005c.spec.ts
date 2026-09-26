import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { settleNavigation } from "./support/navigation.ts";

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

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

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

test(
  "[GOVERNANCE-002] reviews authorized redacted person and workspace history",
  {
    annotation: { type: "flow", description: "GOVERNANCE-002" },
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(10_000);
    const email = `audit-${browserName}-${Date.now()}@example.test`;
    expect(
      (await request.post(`${origin}/api/v1/registrations`, {
        data: {
          email,
          firstName: "Audit",
          lastName: "Owner",
          password,
          workspaceName: "Audit circle",
        },
      })).status(),
    ).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const search = await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
      );
      const messages =
        (await search.json() as { messages?: Array<{ ID: string }> })
          .messages ??
          [];
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
    expect(
      (await request.post(`${origin}/api/v1/email-verifications`, {
        data: { token },
      })).status(),
    ).toBe(200);
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await settleNavigation(page);
    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Ada");
    await page.getByLabel("Family name").fill("Lovelace");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const profilePath = new URL(page.url()).pathname;
    const personId = profilePath.split("/").at(-1)!;
    const context = database(
      `select workspace.id::text || '|' || member.id::text
      from crm.workspaces workspace
      join crm.users account on account.id = workspace.created_by_user_id
      join crm.workspace_members member on member.workspace_id = workspace.id
        and member.user_id = account.id
      where account.email = ${sqlLiteral(email)}`,
      true,
    ).split("|");
    const workspaceId = context[0]!;
    const memberId = context[1]!;
    const events = Array.from({ length: 22 }, (_, index) => {
      const id = randomUUID();
      return `('${id}'::uuid, '${workspaceId}'::uuid, '${memberId}'::uuid,
      '${personId}'::uuid, 'person', '${personId}'::uuid,
      'people.person-updated',
      '{"section":"contact-methods","password":"hidden-${index}"}'::jsonb,
      '2026-08-${String(16 - Math.floor(index / 12)).padStart(2, "0")}T${
        String(23 - index % 12).padStart(2, "0")
      }:00:00Z'::timestamptz,
      now())`;
    }).join(",");
    database(`insert into crm.audit_events
    (id, workspace_id, actor_member_id, person_id, subject_type, subject_id,
      action, payload, occurred_at, created_at) values ${events};`);

    await page.goto(`${profilePath}?section=audit-summary`);
    const summary = page.locator("#profile-section-audit-summary");
    await expect(summary).toHaveAttribute("data-section-state", "ready");
    await expect(summary).toContainText("Redacted");
    await summary.getByRole("link", { name: "Open full audit history" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${personId}/audit$`));
    await expect(page.locator("[data-audit-state]")).toContainText(
      "audit event",
    );
    await page.getByRole("searchbox", { name: "Action", exact: true }).fill(
      "people.person-updated",
    );
    await page.getByLabel("Actor member ID").fill(memberId);
    await page.getByLabel("From").fill("2026-08-01T00:00");
    await page.getByLabel("Before").fill("2026-09-01T00:00");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.locator("[data-audit-list] li")).toHaveCount(20);
    await expect(page.locator("[data-audit-list]")).not.toContainText(
      "hidden-",
    );
    await page.getByRole("button", { name: "Load older events" }).click();
    await expect(page.locator("[data-audit-list] li")).toHaveCount(22);

    await page.goto("/app/settings/audit");
    await page.getByLabel("Person ID").fill(personId);
    await page.getByLabel("Actor member ID").fill(memberId);
    await page.getByRole("searchbox", { name: "Action", exact: true }).fill(
      "people.person-updated",
    );
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.locator("[data-audit-list] li")).toHaveCount(20);

    database(`update crm.workspace_members set role = 'member'
    where id = '${memberId}'::uuid`);
    await page.goto(`${profilePath}?section=audit-summary`);
    await expect(summary).toHaveAttribute("data-section-state", "forbidden");
    await expect(summary.locator("[data-person-audit-badge]")).toHaveText(
      "Forbidden",
    );
    const privilegedAuditLink = summary.locator("[data-person-audit-link]");
    await expect(privilegedAuditLink).toBeHidden();
    await expect(privilegedAuditLink).not.toHaveAttribute("href", /.+/);
    await expect(summary).not.toContainText("Authorized");

    await page.goto("/app/settings/audit");
    await expect(page.locator("#access-state")).toContainText(
      "Audit history unavailable",
    );
    await expect(page.locator("#protected-shell")).toBeHidden();
    await expect(page.locator("[data-audit-filters]")).toBeHidden();

    await page.evaluate(axe.source);
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);
  },
);
