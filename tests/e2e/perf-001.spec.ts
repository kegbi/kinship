import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface MvpCapacityProfile {
  readonly clients: {
    readonly responsiveSmoke: {
      readonly height: number;
      readonly width: number;
    };
    readonly timingEngine: string;
  };
  readonly concurrency: { readonly burstUsers: number };
  readonly datasets: Readonly<
    Record<"large" | "medium" | "small", {
      readonly historyRecords: number;
      readonly people: number;
    }>
  >;
  readonly functionalCeilingsMs: {
    readonly boundedImportExportCompletion: number;
    readonly interactivePage: number;
    readonly ordinaryApiMutation: number;
    readonly ordinaryApiRead: number;
    readonly representativeQuery: number;
    readonly workerDueToDelivery: number;
  };
  readonly longRunningWork: { readonly currentPortableMaxPeople: number };
}

const profile = JSON.parse(readFileSync(
  resolve(process.cwd(), "docs/planning/mvp-capacity-profile.json"),
  "utf8",
)) as MvpCapacityProfile;
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

function runWorkerTick(): void {
  execFileSync("docker", [
    ...composeArgs,
    "exec",
    "-T",
    "worker",
    "deno",
    "eval",
    `import { resolveDatabaseUrl } from "./packages/backend/platform/postgres/config.ts";
import { createConfiguredReminderWorker } from "./apps/worker/composition.ts";
const databaseUrl = resolveDatabaseUrl(Deno.env);
if (!databaseUrl) throw new Error("worker database configuration is required");
const configured = createConfiguredReminderWorker(databaseUrl);
try {
  await configured.worker.tick({ owner: "perf-001-explicit-tick" });
} finally {
  await configured.close();
}`,
  ], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
}

function executionTime(statement: string): number {
  const plan = JSON.parse(
    databaseValue(`explain (analyze, format json) ${statement}`),
  ) as [{ readonly "Execution Time": number }];
  return plan[0]["Execution Time"];
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

async function registerAndSignIn(
  request: APIRequestContext,
  page: Page,
  email: string,
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Capacity",
      lastName: "Owner",
      password,
      workspaceName: "Capacity workspace",
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
    await expect(page).toHaveURL(/\/app$/);
  }
}

function assertQueryCeiling(workspaceId: string): void {
  const peopleMs = executionTime(`
    select person.id
    from crm.people person
    where person.workspace_id = '${workspaceId}'::uuid
      and person.archived_at is null and person.deleted_at is null
      and strpos(
        lower(concat_ws(' ', person.given_name, person.middle_name,
          person.family_name, person.nickname)),
        lower('Capacity')
      ) > 0
    order by lower(coalesce(nullif(btrim(person.given_name), ''),
      nullif(btrim(person.nickname), ''), nullif(btrim(person.family_name), ''), '')),
      lower(coalesce(person.family_name, '')), person.id
    limit 21
  `);
  const historyMs = executionTime(`
    select event.id
    from crm.audit_events event
    where event.workspace_id = '${workspaceId}'::uuid
      and event.action = 'perf.history'
    order by event.occurred_at desc
    limit 21
  `);
  expect(Math.max(peopleMs, historyMs)).toBeLessThanOrEqual(
    profile.functionalCeilingsMs.representativeQuery,
  );
}

test(
  "[PERF-001] private MVP boundaries stay within the accepted real-stack profile",
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    expect(browserName).toBe(profile.clients.timingEngine);
    const email = `capacity-${Date.now()}@example.test`;
    await registerAndSignIn(request, page, email);

    const workspaceId = databaseValue(
      `select workspace.id::text from crm.workspaces workspace
       join crm.users account on account.id = workspace.created_by_user_id
       where account.email = ${sqlLiteral(email)}`,
    );
    const memberId = databaseValue(
      `select member.id::text from crm.workspace_members member
       join crm.users account on account.id = member.user_id
       where account.email = ${sqlLiteral(email)}
         and member.workspace_id = '${workspaceId}'::uuid`,
    );

    databaseSql(`
      insert into crm.people (
        workspace_id, created_by_member_id, given_name, family_name, created_at
      )
      select '${workspaceId}'::uuid, '${memberId}'::uuid,
        'Capacity ' || lpad(sequence::text, 5, '0'), 'Small',
        now() - sequence * interval '1 second'
      from generate_series(1, ${profile.datasets.small.people}) sequence;
      insert into crm.audit_events (
        workspace_id, actor_member_id, action, payload, occurred_at
      )
      select '${workspaceId}'::uuid, '${memberId}'::uuid, 'perf.history',
        jsonb_build_object('sequence', sequence),
        now() - sequence * interval '1 millisecond'
      from generate_series(1, ${profile.datasets.small.historyRecords}) sequence;
    `);
    expect(databaseValue(
      `select count(*) from crm.people where workspace_id = '${workspaceId}'::uuid`,
    )).toBe(String(profile.datasets.small.people));
    expect(databaseValue(
      `select count(*) from crm.audit_events
       where workspace_id = '${workspaceId}'::uuid and action = 'perf.history'`,
    )).toBe(String(profile.datasets.small.historyRecords));
    assertQueryCeiling(workspaceId);

    databaseSql(
      `delete from crm.people where workspace_id = '${workspaceId}'::uuid`,
    );
    const portablePeople = profile.longRunningWork.currentPortableMaxPeople;
    const source = {
      attachments: [],
      format: "monica-json",
      tables: {
        contacts: Array.from({ length: portablePeople }, (_, index) => ({
          first_name: `Imported ${String(index + 1).padStart(3, "0")}`,
          id: index + 1,
          last_name: "Capacity",
        })),
      },
      version: 1,
    };
    const importStartedAt = performance.now();
    const dryRun = await page.request.post(
      `${origin}/api/v1/imports/dry-runs`,
      { data: { source }, headers: { origin } },
    );
    expect(dryRun.status()).toBe(201);
    const dryRunBody = await dryRun.json() as {
      readonly importId: string;
      readonly report: { readonly counts: { readonly contacts: number } };
    };
    expect(dryRunBody.report.counts.contacts).toBe(portablePeople);
    const committed = await page.request.post(
      `${origin}/api/v1/imports/${dryRunBody.importId}/commit`,
      { data: { confirmed: true }, headers: { origin } },
    );
    expect(committed.status()).toBe(200);
    expect(performance.now() - importStartedAt).toBeLessThanOrEqual(
      profile.functionalCeilingsMs.boundedImportExportCompletion,
    );
    expect(databaseValue(
      `select status || ':' || (completed_at is not null)::text
       from crm.data_imports where id = '${dryRunBody.importId}'::uuid`,
    )).toBe("completed:true");
    expect(databaseValue(
      `select count(*) from crm.people where workspace_id = '${workspaceId}'::uuid`,
    )).toBe(String(portablePeople));

    const exportStartedAt = performance.now();
    const createdExport = await page.request.post(
      `${origin}/api/v1/exports`,
      { headers: { origin } },
    );
    expect(createdExport.status()).toBe(201);
    const exportBody = await createdExport.json() as {
      readonly exportId: string;
      readonly status: string;
    };
    const exportId = exportBody.exportId;
    expect(exportBody.status).toBe("completed");
    const download = await page.request.post(
      `${origin}/api/v1/exports/${exportId}/downloads`,
      { headers: { origin } },
    );
    expect(download.status()).toBe(201);
    const href = (await download.json() as { readonly href: string }).href;
    const artifact = await page.request.get(`${origin}${href}`);
    expect(artifact.status()).toBe(200);
    const portable = await artifact.json() as {
      readonly tables: { readonly contacts: readonly unknown[] };
    };
    expect(portable.tables.contacts).toHaveLength(portablePeople);
    expect(performance.now() - exportStartedAt).toBeLessThanOrEqual(
      profile.functionalCeilingsMs.boundedImportExportCompletion,
    );
    expect(databaseValue(`
      select export.status || ':' || (export.completed_at is not null)::text ||
        ':' || (stored.status = 'available')::text || ':' ||
        (stored.storage_key is not null)::text || ':' ||
        (export.manifest #>> '{rows,people,count}')
      from crm.data_exports export
      join crm.files stored on stored.id = export.file_id
      where export.id = '${exportId}'::uuid
    `)).toBe(`completed:true:true:true:${portablePeople}`);

    databaseSql(`
      insert into crm.people (
        workspace_id, created_by_member_id, given_name, family_name, created_at
      )
      select '${workspaceId}'::uuid, '${memberId}'::uuid,
        'Capacity ' || lpad(sequence::text, 5, '0'), 'Medium',
        now() - sequence * interval '1 second'
      from generate_series(
        ${portablePeople + 1}, ${profile.datasets.medium.people}
      ) sequence;
      insert into crm.audit_events (
        workspace_id, actor_member_id, action, payload, occurred_at
      )
      select '${workspaceId}'::uuid, '${memberId}'::uuid, 'perf.history',
        jsonb_build_object('sequence', sequence),
        now() - sequence * interval '1 millisecond'
      from generate_series(
        ${profile.datasets.small.historyRecords + 1},
        ${profile.datasets.medium.historyRecords}
      ) sequence;
    `);
    expect(databaseValue(
      `select count(*) from crm.people where workspace_id = '${workspaceId}'::uuid`,
    )).toBe(String(profile.datasets.medium.people));
    expect(databaseValue(
      `select count(*) from crm.audit_events
       where workspace_id = '${workspaceId}'::uuid and action = 'perf.history'`,
    )).toBe(String(profile.datasets.medium.historyRecords));
    assertQueryCeiling(workspaceId);

    databaseSql(`
      insert into crm.people (
        workspace_id, created_by_member_id, given_name, family_name, created_at
      )
      select '${workspaceId}'::uuid, '${memberId}'::uuid,
        'Capacity ' || lpad(sequence::text, 5, '0'), 'Large',
        now() - sequence * interval '1 second'
      from generate_series(
        ${profile.datasets.medium.people + 1},
        ${profile.datasets.large.people}
      ) sequence;
      insert into crm.audit_events (
        workspace_id, actor_member_id, action, payload, occurred_at
      )
      select '${workspaceId}'::uuid, '${memberId}'::uuid, 'perf.history',
        jsonb_build_object('sequence', sequence),
        now() - sequence * interval '1 millisecond'
      from generate_series(
        ${profile.datasets.medium.historyRecords + 1},
        ${profile.datasets.large.historyRecords}
      ) sequence;
    `);
    expect(databaseValue(
      `select count(*) from crm.people where workspace_id = '${workspaceId}'::uuid`,
    )).toBe(String(profile.datasets.large.people));
    expect(databaseValue(
      `select count(*) from crm.audit_events
       where workspace_id = '${workspaceId}'::uuid and action = 'perf.history'`,
    )).toBe(String(profile.datasets.large.historyRecords));
    assertQueryCeiling(workspaceId);

    await page.request.get(
      `${origin}/api/v1/people?search=Capacity%2010000&limit=50`,
    );
    const readStartedAt = performance.now();
    const reads = await Promise.all(
      Array.from(
        { length: profile.concurrency.burstUsers },
        () =>
          page.request.get(
            `${origin}/api/v1/people?search=Capacity%2010000&limit=50`,
          ),
      ),
    );
    expect(reads.every((response) => response.status() === 200)).toBe(true);
    expect(performance.now() - readStartedAt).toBeLessThanOrEqual(
      profile.functionalCeilingsMs.ordinaryApiRead,
    );

    const mutationStartedAt = performance.now();
    const mutations = await Promise.all(
      Array.from(
        { length: profile.concurrency.burstUsers },
        (_, index) =>
          page.request.post(`${origin}/api/v1/people`, {
            data: {
              familyName: "Burst",
              givenName: `Capacity mutation ${index + 1}`,
              isPartial: false,
            },
            headers: { origin },
          }),
      ),
    );
    expect(mutations.every((response) => response.status() === 201)).toBe(true);
    expect(performance.now() - mutationStartedAt).toBeLessThanOrEqual(
      profile.functionalCeilingsMs.ordinaryApiMutation,
    );
    expect(databaseValue(`
      select count(*) from crm.people
      where workspace_id = '${workspaceId}'::uuid and family_name = 'Burst'
    `)).toBe(String(profile.concurrency.burstUsers));

    for (
      const viewport of [
        { height: 900, width: 1280 },
        profile.clients.responsiveSmoke,
      ]
    ) {
      await page.setViewportSize(viewport);
      const pageStartedAt = performance.now();
      await page.goto("/app/people", { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toHaveAttribute(
        "data-page-id",
        "people.index",
        { timeout: profile.functionalCeilingsMs.interactivePage },
      );
      await expect(page.locator("#people-directory-list > li")).toHaveCount(
        20,
        { timeout: profile.functionalCeilingsMs.interactivePage },
      );
      expect(performance.now() - pageStartedAt).toBeLessThanOrEqual(
        profile.functionalCeilingsMs.interactivePage,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
    }

    const reminderId = randomUUID();
    const occurrenceId = randomUUID();
    const reminderPersonId = databaseValue(`
      select id::text from crm.people
      where workspace_id = '${workspaceId}'::uuid
      order by id limit 1
    `);
    const reminderStartedAt = performance.now();
    databaseSql(`
      insert into crm.reminders (
        id, workspace_id, person_id, target_kind, title, anchor_on,
        recurrence_unit, recurrence_interval, send_time, created_by_member_id
      ) values (
        '${reminderId}'::uuid, '${workspaceId}'::uuid,
        '${reminderPersonId}'::uuid, 'person', 'Capacity due reminder',
        current_date, 'none', 1, localtime, '${memberId}'::uuid
      );
      insert into crm.reminder_occurrences (
        id, reminder_id, member_id, occurs_on, deliver_at, status,
        title_snapshot, provider_idempotency_key
      ) values (
        '${occurrenceId}'::uuid, '${reminderId}'::uuid,
        '${memberId}'::uuid, current_date, now() - interval '1 second',
        'pending', 'Capacity due reminder', 'perf-${occurrenceId}'
      );
    `);
    runWorkerTick();
    await expect.poll(() =>
      databaseValue(`
        select status || ':' || provider_result_state || ':' || attempt_count ||
          ':' || (visible_at is not null)
        from crm.reminder_occurrences where id = '${occurrenceId}'::uuid
      `), {
      timeout: profile.functionalCeilingsMs.workerDueToDelivery,
    }).toBe("sent:confirmed:1:true");
    expect(performance.now() - reminderStartedAt).toBeLessThanOrEqual(
      profile.functionalCeilingsMs.workerDueToDelivery,
    );
  },
);
