import { expect, test } from "./support/test.ts";
import { registerVerified } from "./support/api.ts";
import { database } from "./support/database.ts";
import { origin, password } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";

let documentId = "";
let privacyId = "";

test.beforeEach(() => {
  // The active terms are instance-wide, so this spec runs only in its
  // browser's `-exclusive` project, after every parallel spec (REL-057).
  test.skip(
    !test.info().project.name.endsWith("-exclusive"),
    "runs in the browser's -exclusive project after the parallel specs",
  );
  documentId = crypto.randomUUID();
  database(`insert into crm.legal_documents
    (id, document_type, version, content, published_at, is_active)
    values ('${documentId}'::uuid, 'terms', 'APP-008B',
      'Kinship exact acceptance test terms.', now() - interval '1 minute', true)`);
});

test.afterEach(() => {
  if (privacyId) {
    database(`delete from crm.legal_documents where id = '${privacyId}'::uuid`);
    privacyId = "";
  }
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
}, async ({ browser, browserName, page, request }) => {
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
  await registerVerified(request, {
    email,
    firstName: "Legal",
    lastName: "Reviewer",
    workspaceName: "Legal circle",
  }, bareToken);

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
  await expectAccessible(page);

  // ADR 0007 (AUD-G5): the legal pages render on demand with their text, so
  // a reader without JavaScript can read them. The privacy policy is
  // published only now, after the review above required the terms alone.
  privacyId = crypto.randomUUID();
  database(`insert into crm.legal_documents
    (id, document_type, version, content, published_at, is_active)
    values ('${privacyId}'::uuid, 'privacy', 'AUD-G5',
      'Kinship exact privacy test policy.', now() - interval '1 minute', true)`);
  const reader = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
  });
  try {
    const withoutScript = await reader.newPage();
    for (
      const [path, pageId, heading, version, text] of [
        [
          "/privacy",
          "legal.privacy",
          "Privacy policy",
          "AUD-G5",
          "Kinship exact privacy test policy.",
        ],
        [
          "/terms",
          "legal.terms",
          "Terms of service",
          "APP-008B",
          "Kinship exact acceptance test terms.",
        ],
      ] as const
    ) {
      const response = await withoutScript.goto(path);
      expect(response?.status()).toBe(200);
      await expect(withoutScript.locator("body")).toHaveAttribute(
        "data-page-id",
        pageId,
      );
      await expect(withoutScript.getByRole("heading", { name: heading }))
        .toBeVisible();
      await expect(withoutScript.locator("[data-legal-version]"))
        .toContainText(version);
      await expect(withoutScript.locator("[data-legal-content]")).toHaveText(
        text,
      );
    }
  } finally {
    await reader.close();
  }
});
