import { expect, test } from "./support/test.ts";
import { randomUUID } from "node:crypto";
import { registerVerified } from "./support/api.ts";
import { database, sqlLiteral } from "./support/database.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";
import { createPersonThroughUi } from "./support/directory.ts";

test(
  "[GOVERNANCE-002] reviews authorized redacted person and workspace history",
  {
    annotation: { type: "flow", description: "GOVERNANCE-002" },
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(10_000);
    const email = `audit-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Audit",
      lastName: "Owner",
      workspaceName: "Audit circle",
    }, bareToken);
    await signIn(page, email);
    const profilePath = await createPersonThroughUi(page, "Ada", "Lovelace");
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

    await expectAccessible(page);
  },
);
