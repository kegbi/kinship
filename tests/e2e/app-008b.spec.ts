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

let documentId = "";

test.beforeEach(() => {
  documentId = crypto.randomUUID();
  database(`insert into crm.legal_documents
    (id, document_type, version, content, published_at, is_active)
    values ('${documentId}'::uuid, 'terms', 'APP-008B',
      'Kinship exact acceptance test terms.', now() - interval '1 minute', true)`);
});

test.afterEach(() => {
  if (!documentId) return;
  database(`begin;
    delete from crm.legal_acceptances
      where legal_document_id = '${documentId}'::uuid;
    delete from crm.audit_events
      where subject_type = 'legal_document'
        and subject_id = '${documentId}'::uuid;
    delete from crm.legal_documents where id = '${documentId}'::uuid;
    commit;`);
  documentId = "";
});

test("[GOVERNANCE-001] reviews and accepts an exact required legal version", {
  annotation: [{ type: "flow", description: "GOVERNANCE-001" }, {
    type: "leaf",
    description: "APP-008B",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  await page.goto("/terms");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "legal.terms",
  );
  await expect(page.getByRole("heading", { name: "Terms of service" }))
    .toBeVisible();
  await expect(page.locator("[data-legal-version]")).toContainText("APP-008B");
  await expect(page.locator("[data-legal-content]")).toHaveText(
    "Kinship exact acceptance test terms.",
  );

  const email = `legal-${browserName}-${Date.now()}@example.test`;
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Legal",
      lastName: "Reviewer",
      password,
      workspaceName: "Legal circle",
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

  const signIn = async () => {
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/compliance/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "compliance.accept",
    );
    await expect(page.locator("[data-compliance-content]")).toHaveText(
      "Kinship exact acceptance test terms.",
    );
  };
  await signIn();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await signIn();

  const accept = page.getByRole("button", { name: "Accept and continue" });
  await expect(accept).toBeDisabled();
  await page.getByLabel("I have reviewed and accept this exact version.")
    .check();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();

  const replay = await page.request.post(`${origin}/api/v1/legal-acceptances`, {
    data: { documentId },
    headers: { origin },
  });
  expect(replay.status()).toBe(200);
  expect(database(
    `select count(*) from crm.legal_acceptances
    where legal_document_id = '${documentId}'::uuid`,
    true,
  )).toBe("1");
  await page.goto("/app/journal");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "journal.index",
  );
  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);
});
