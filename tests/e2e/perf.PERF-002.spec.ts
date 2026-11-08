/// <reference lib="dom" />
import type { BrowserContext, CDPSession, Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { activateGlobalSearch, waitForIsland } from "./support/islands.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

/*
 * PERF-002 (AUD-P1): the request, layout-shift, and paint budgets that keep
 * the audit's fixes fixed. Every authenticated page in the page catalog opens
 * in a fresh tab of one signed-in context (an empty `sessionStorage`, so no
 * session accelerator, and a shared HTTP cache, so warm static assets) at the
 * profile's viewport, against a seeded workspace, and its `/api/v1/` requests
 * are collected until the network is quiet. A page fails on a repeated GET
 * URL, on more requests than its budget, or on a longer chain of sequential
 * steps than its budget. The budgets, the CLS ceiling, and the LCP ceiling
 * live in `docs/planning/mvp-capacity-profile.json` under `requestBudgets`
 * and `webVitals`, so a later ticket lowers a number there, not here.
 *
 * Each measured tab adds a fixed latency to every request it sends
 * (`requestBudgets.latencyMs`, as the 01 report's 100 ms runs did), so reads
 * that do not wait for one another are sent while the earlier ones are still
 * on the wire and land in the same step however the browser schedules the
 * effects that send them. Counts and steps depend only on the seeded data:
 * the rich person's order is fixed, the session (1), the person with its rail
 * (2), and the unified timeline (3), which starts only after that read
 * answers, with the notifications and the recorded view off the chain.
 * Today's CLS and the person page's LCP on the 4x-CPU
 * profile are the only timed assertions (the LCP ceiling carries headroom over
 * the measured value), and the four primary navigation clicks (FER-16) are
 * recorded, never asserted.
 */

/** One `/api/v1/` request a page sent, in the order the browser sent it. */
export interface ObservedRequest {
  readonly method: string;
  /** The path and query, without the origin. */
  readonly url: string;
  /**
   * 1 for a request sent before any API answer arrived; otherwise one more
   * than the deepest request that had been answered when this one was sent.
   * This is the 01 report's "sequential depth": an observed upper bound on
   * the page's longest chain of requests that wait for one another. A read
   * the page defers to idle by design (`requestBudgets.offChain`) is 0: it
   * counts as a request but neither has nor adds a step, because when the
   * browser goes idle is a matter of timing, not of the page's chain.
   */
  readonly step: number;
}

export interface RequestBudget {
  readonly requests: number;
  readonly steps: number;
}

/**
 * Every way `requests` breaks `budget`: a GET of a URL already read (FEQ-01's
 * duplicates), more requests than the budget, or a deeper chain.
 */
export function budgetViolations(
  requests: readonly ObservedRequest[],
  budget: RequestBudget,
): string[] {
  const violations: string[] = [];
  const read = new Set<string>();
  for (const request of requests) {
    if (request.method !== "GET") continue;
    if (read.has(request.url)) {
      violations.push(`duplicate GET ${request.url}`);
    }
    read.add(request.url);
  }
  if (requests.length > budget.requests) {
    violations.push(
      `${requests.length} requests, over the budget of ${budget.requests}`,
    );
  }
  const steps = Math.max(0, ...requests.map((request) => request.step));
  if (steps > budget.steps) {
    violations.push(
      `${steps} sequential steps, over the budget of ${budget.steps}`,
    );
  }
  return violations;
}

interface PageBudget extends RequestBudget {
  readonly basis: string;
}

interface Perf002Profile {
  readonly requestBudgets: {
    readonly viewport: { readonly height: number; readonly width: number };
    readonly quietMs: number;
    readonly latencyMs: number;
    readonly offChain: readonly {
      readonly method: string;
      readonly path: string;
      readonly reason: string;
    }[];
    readonly palette: PageBudget;
    readonly pages: Readonly<Record<string, PageBudget>>;
  };
  readonly webVitals: {
    readonly todayCls: { readonly ceiling: number };
    readonly personLcpCpu4Ms: {
      readonly ceiling: number;
      readonly cpuThrottlingRate: number;
    };
    readonly navigationClicksCpu4: {
      readonly cpuThrottlingRate: number;
      readonly runs: number;
    };
  };
}

const profile = JSON.parse(readFileSync(
  resolve(process.cwd(), "docs/planning/mvp-capacity-profile.json"),
  "utf8",
)) as Perf002Profile;
const budgets = profile.requestBudgets;

/** Second shapes of a cataloged page, each budgeted on its own. */
const PAGE_VARIANTS = ["people.profile#blank"] as const;

/** Page catalog accesses that need no signed-in member. */
const UNAUTHENTICATED_ACCESS = new Set([
  "public",
  "anonymous",
  "anonymous-or-authenticated",
  "authentication-challenge",
]);

/**
 * The page catalog's authenticated pages that are built: every page whose
 * access needs a signed-in member, less optional modules (billing).
 */
function catalogedAuthenticatedPages(): string[] {
  const catalog = readFileSync(
    resolve(process.cwd(), "docs/product/page-catalog.yaml"),
    "utf8",
  );
  const pages = catalog.slice(catalog.indexOf("\npages:\n"));
  const ids: string[] = [];
  for (const entry of pages.split(/\n {2}- id: /).slice(1)) {
    const id = entry.slice(0, entry.indexOf("\n")).trim();
    const access = /\n {4}access: (\S+)/.exec(entry)?.[1];
    const optional = /\n {4}availability: optional-module/.test(entry);
    if (access && !UNAUTHENTICATED_ACCESS.has(access) && !optional) {
      ids.push(id);
    }
  }
  return ids.sort();
}

/**
 * Collects one page's `/api/v1/` requests and knows when they are done. A
 * request's step counts from the answers that had arrived when it was sent:
 * the browser reports a response's headers before the page can read its body,
 * so a request that waited on another's answer is always one step deeper.
 */
class ApiRequests {
  readonly observed: ObservedRequest[] = [];
  #steps = new Map<object, number>();
  #pending = new Set<object>();
  #deepestAnswered = 0;
  #lastActivity = Date.now();
  #stopped = false;

  constructor(page: Page) {
    const isApi = (url: string) => {
      const parsed = new URL(url);
      return parsed.origin === new URL(origin).origin &&
        parsed.pathname.startsWith("/api/v1/");
    };
    page.on("request", (request) => {
      if (this.#stopped || !isApi(request.url())) return;
      const parsed = new URL(request.url());
      const offChain = budgets.offChain.some(({ method, path }) =>
        method === request.method() &&
        new RegExp(`^${path}$`).test(parsed.pathname)
      );
      const step = offChain ? 0 : this.#deepestAnswered + 1;
      this.#steps.set(request, step);
      this.#pending.add(request);
      this.#lastActivity = Date.now();
      this.observed.push({
        method: request.method(),
        step,
        url: `${parsed.pathname}${parsed.search}`,
      });
    });
    const answered = (request: object) => {
      const step = this.#steps.get(request);
      if (!step) return;
      this.#deepestAnswered = Math.max(this.#deepestAnswered, step);
      this.#lastActivity = Date.now();
    };
    page.on("response", (response) => answered(response.request()));
    const settle = (request: object) => {
      if (!this.#pending.delete(request)) return;
      answered(request);
    };
    page.on("requestfinished", settle);
    page.on("requestfailed", settle);
  }

  /**
   * Ignores every later request and stops waiting for the ones in flight: the
   * document being measured has left, and the browser may never report the
   * end of a request the navigation cut off.
   */
  stop(): void {
    this.#stopped = true;
    this.#pending.clear();
  }

  /** The requests since `from`, with their steps counted from there. */
  since(from: number): ObservedRequest[] {
    const later = this.observed.slice(from);
    const onChain = later.map((request) => request.step).filter(Boolean);
    const base = onChain.length === 0 ? 0 : Math.min(...onChain) - 1;
    return later.map((request) => ({
      ...request,
      step: request.step && request.step - base,
    }));
  }

  /**
   * Waits until nothing is in flight and nothing was sent or answered for
   * the profile's quiet window. Idle-time reads (the directory's duplicates,
   * the person page's recorded view) start well inside it.
   */
  async quiet(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (
      this.#pending.size > 0 ||
      Date.now() - this.#lastActivity < budgets.quietMs
    ) {
      if (Date.now() > deadline) {
        throw new Error(
          `the API never went quiet: ${this.#pending.size} in flight after ${
            JSON.stringify(this.observed.map((request) => request.url))
          }`,
        );
      }
      await new Promise((done) => setTimeout(done, 50));
    }
  }
}

function report(lines: readonly string[]): void {
  console.log(lines.join("\n"));
  for (const line of lines) {
    test.info().annotations.push({ type: "PERF-002", description: line });
  }
}

async function throttleCpu(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
}

/**
 * Adds the profile's fixed latency to every request `page` sends, so an
 * answer never arrives before the reads sent alongside its own request.
 */
async function emulateLatency(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    downloadThroughput: -1,
    latency: budgets.latencyMs,
    offline: false,
    uploadThroughput: -1,
  });
}

/** Shifts without recent input, summed, for every document of `context`. */
async function recordLayoutShifts(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const state = { supported: false, total: 0 };
    Object.assign(globalThis, { __perf002Shifts: state });
    if (!PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
      return;
    }
    state.supported = true;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) state.total += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function largestContentfulPaint(page: Page): Promise<number> {
  return await page.evaluate(() =>
    new Promise<number>((done, fail) => {
      setTimeout(
        () => fail(new Error("no largest-contentful-paint entry")),
        5_000,
      );
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        done(entries[entries.length - 1]!.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    })
  );
}

test.use({ viewport: profile.requestBudgets.viewport });

test("[PERF-002] the budget check fails a page that repeats a GET", async ({ browserName, page }) => {
  test.skip(browserName !== "chromium", "PERF-002 is calibrated on Chromium.");
  // The positive control: a fixture page served at the gateway's origin reads
  // the same API URL twice, one read after the other, and then two distinct
  // URLs together.
  await page.route(`${origin}/__perf-002/fixture`, (route) =>
    route.fulfill({
      body:
        `<!doctype html><title>PERF-002 fixture</title><script type="module">
        const read = (url) =>
          fetch(url, { cache: "no-store" }).then((answer) => answer.text());
        await read("/api/v1/health");
        await read("/api/v1/health");
        await Promise.all([
          read("/api/v1/health?distinct=a"),
          read("/api/v1/health?distinct=b"),
        ]);
        document.body.dataset.done = "";
      </script>`,
      contentType: "text/html",
    }));
  await emulateLatency(page);
  const requests = new ApiRequests(page);
  await page.goto(`${origin}/__perf-002/fixture`);
  await expect(page.locator("body")).toHaveAttribute("data-done", "");
  await requests.quiet();
  expect(requests.observed).toEqual([
    { method: "GET", step: 1, url: "/api/v1/health" },
    { method: "GET", step: 2, url: "/api/v1/health" },
    { method: "GET", step: 3, url: "/api/v1/health?distinct=a" },
    { method: "GET", step: 3, url: "/api/v1/health?distinct=b" },
  ]);
  expect(budgetViolations(requests.observed, { requests: 4, steps: 3 }))
    .toEqual(["duplicate GET /api/v1/health"]);
  expect(budgetViolations(requests.observed, { requests: 3, steps: 2 }))
    .toEqual([
      "duplicate GET /api/v1/health",
      "4 requests, over the budget of 3",
      "3 sequential steps, over the budget of 2",
    ]);
  // Two reads sent together are one step, and distinct URLs are no repeat.
  expect(budgetViolations(requests.since(2), { requests: 2, steps: 1 }))
    .toEqual([]);
});

interface Seeded {
  /** A person with nothing recorded: AUD-F5's blank person. */
  readonly blankPersonId: string;
  readonly importId: string;
  readonly richPersonId: string;
  readonly richPersonName: string;
}

/**
 * A busy workspace in the 01 report's shape: a directory with archived
 * people, a rich person with every section filled, Today's attention queue,
 * reminders, recent people, favorite notes, and activity, tasks, journal
 * posts, an import, and an export. Facts with no create shortcut are written
 * directly; everything else goes through the public API.
 */
async function seedWorkspace(page: Page): Promise<Seeded> {
  const session = await (await page.request.get(`${origin}/api/v1/session`))
    .json() as { member: { id: string }; workspace: { id: string } };
  const workspace = sqlLiteral(session.workspace.id);
  const member = sqlLiteral(session.member.id);
  const post = async (path: string, data: Record<string, unknown>) => {
    const response = await page.request.post(`${origin}/api/v1${path}`, {
      data,
      headers: { origin },
    });
    expect(response.status(), path).toBeLessThan(300);
    return await response.json() as Record<string, unknown>;
  };
  const richPersonName = "Abigail Hollingsworth";
  const rich = await createPerson(page.request, {
    familyName: "Hollingsworth",
    givenName: "Abigail",
  });
  const relatives: string[] = [];
  for (const givenName of ["Beatrice", "Cecil", "Dorian", "Edith"]) {
    relatives.push(
      await createPerson(page.request, {
        familyName: "Hollingsworth",
        givenName,
      }),
    );
  }
  const typeId = crypto.randomUUID();
  const relationshipTypeId = crypto.randomUUID();
  const richId = sqlLiteral(rich);
  databaseSql(`
    insert into crm.people (workspace_id, created_by_member_id, given_name,
      family_name, is_starred, created_at)
    select ${workspace}::uuid, ${member}::uuid, 'Person ' || lpad(i::text, 2, '0'),
      'Directory', i % 6 = 0, now() - i * interval '1 hour'
    from generate_series(1, 30) i;
    update crm.people set archived_at = now()
    where workspace_id = ${workspace}::uuid and given_name in
      ('Person 28', 'Person 29', 'Person 30');
    update crm.people set food_preferences = 'Vegetarian; no peanuts'
    where id = ${richId}::uuid;
    insert into crm.contact_method_types (id, workspace_id, name, kind)
    values ('${typeId}'::uuid, ${workspace}::uuid, 'PERF-002 email', 'email');
    insert into crm.person_contact_methods (person_id, type_id, value, is_primary,
      workspace_id)
    values (${richId}::uuid, '${typeId}'::uuid, 'abigail@example.test', true,
        ${workspace}::uuid),
      (${richId}::uuid, '${typeId}'::uuid, 'abigail.work@example.test', false,
        ${workspace}::uuid);
    with places as (
      insert into crm.locations (workspace_id, street, city, country)
      values (${workspace}::uuid, '1 Harbour Row', 'Lisbon', 'PT'),
        (${workspace}::uuid, '9 Mill Lane', 'York', 'GB')
      returning id
    )
    insert into crm.person_addresses (person_id, location_id, display_name,
      workspace_id)
    select ${richId}::uuid, id, 'Home', ${workspace}::uuid from places;
    insert into crm.person_first_meetings (person_id, place_text, notes,
      workspace_id)
    values (${richId}::uuid, 'The harbour book fair', 'Introduced over tea',
      ${workspace}::uuid);
    with employer as (
      insert into crm.organizations (workspace_id, name)
      values (${workspace}::uuid, 'Harbour Press') returning id
    )
    insert into crm.person_occupations (person_id, organization_id, title,
      is_current, workspace_id)
    select ${richId}::uuid, id, 'Editor', true, ${workspace}::uuid from employer;
    insert into crm.pets (person_id, name, workspace_id)
    values (${richId}::uuid, 'Biscuit', ${workspace}::uuid),
      (${richId}::uuid, 'Juniper', ${workspace}::uuid);
    with labels as (
      insert into crm.tags (workspace_id, name, slug)
      values (${workspace}::uuid, 'Family', 'perf-family'),
        (${workspace}::uuid, 'Book club', 'perf-book-club')
      returning id
    )
    insert into crm.person_tags (person_id, tag_id, workspace_id)
    select ${richId}::uuid, id, ${workspace}::uuid from labels;
    insert into crm.relationship_types (id, workspace_id, forward_label, reverse_label)
    values ('${relationshipTypeId}'::uuid, ${workspace}::uuid, 'sibling of', 'sibling of');
    insert into crm.relationships (workspace_id, from_person_id, to_person_id,
      relationship_type_id)
    select ${workspace}::uuid, ${richId}::uuid, relative::uuid,
      '${relationshipTypeId}'::uuid
    from unnest(array[${relatives.map(sqlLiteral).join(", ")}]) relative;
  `);
  await post(`/people/${rich}/dates`, {
    day: 12,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday",
    month: 4,
    precision: "full",
    year: 1961,
  });
  await post(`/people/${rich}/dates`, {
    day: 3,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "custom",
    label: "Anniversary",
    month: 9,
    precision: "month_day",
  });
  await post(`/people/${rich}/life-events`, {
    name: "Moved to Lisbon",
    precision: "year",
    year: 2004,
  });
  await post(`/people/${rich}/life-events`, {
    name: "Opened the press",
    precision: "year_month",
    month: 5,
    year: 2011,
  });
  const hour = 60 * 60_000;
  const now = Date.now();
  for (let index = 0; index < 3; index += 1) {
    await post("/interactions", {
      body: `Prefers a short agenda before calls (${index + 1}).`,
      isFavorited: index === 0,
      kind: "note",
      personId: rich,
      requestId: crypto.randomUUID(),
    });
    await post("/interactions", {
      happenedAt: new Date(now - (index + 1) * hour).toISOString(),
      kind: "activity",
      participantIds: [rich, relatives[index % relatives.length]],
      requestId: crypto.randomUUID(),
      summary: `Walked along the harbour (${index + 1})`,
    });
  }
  for (let index = 0; index < 2; index += 1) {
    await post("/interactions", {
      calledAt: new Date(now - (index + 2) * 24 * hour).toISOString(),
      contactWasCaller: index === 0,
      kind: "call",
      personId: rich,
      requestId: crypto.randomUUID(),
    });
  }
  await post("/interactions", {
    channelTypeId: typeId,
    happenedAt: new Date(now - 5 * 24 * hour).toISOString(),
    kind: "conversation",
    personId: rich,
    requestId: crypto.randomUUID(),
    title: "Planning the autumn fair",
  });
  for (const [index, anchorOn] of ["2030-09-15", "2030-10-01"].entries()) {
    await post("/reminders", {
      anchorOn,
      personId: rich,
      recurrenceInterval: 1,
      recurrenceUnit: index === 0 ? "none" : "year",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title: `Write to Abigail (${index + 1})`,
    });
  }
  for (const personId of [rich, ...relatives.slice(0, 2)]) {
    await post("/stay-in-touch-cadences", {
      intervalCount: 1,
      intervalUnit: "day",
      personId,
      requestId: crypto.randomUUID(),
    });
  }
  for (const [index, offset] of [-50, -26, 2, 30, 14 * 24].entries()) {
    await post("/tasks", {
      dueAt: new Date(now + offset * hour).toISOString(),
      personId: index < 3 ? rich : relatives[index % relatives.length],
      requestId: crypto.randomUUID(),
      title: `Follow up on the fair, part ${index + 1}`,
    });
  }
  await post(`/people/${rich}/gifts`, {
    name: "A first edition",
    status: "idea",
  });
  await post(`/people/${rich}/gifts`, {
    name: "Harbour print",
    status: "given",
  });
  await post(`/people/${rich}/debts`, {
    amount: "20.00",
    currencyCode: "EUR",
    direction: "they_owe",
    status: "open",
  });
  for (let index = 0; index < 3; index += 1) {
    await post("/journal/posts", {
      body: `Spent the morning sorting the press archive (${index + 1}).`,
      occurredAt: new Date(now - (index + 1) * 24 * hour).toISOString(),
      title: `Archive day ${index + 1}`,
    });
  }
  for (const personId of [rich, ...relatives]) {
    expect((await page.request.post(
      `${origin}/api/v1/people/${personId}/view`,
      { headers: { origin } },
    )).status()).toBe(200);
  }
  const dryRun = await post("/imports/dry-runs", {
    source: {
      attachments: [],
      format: "monica-json",
      tables: {
        contacts: [{ first_name: "Imported", id: 1, last_name: "Reader" }],
      },
      version: 1,
    },
  });
  expect((await page.request.post(`${origin}/api/v1/exports`, {
    headers: { origin },
  })).status()).toBe(201);
  const blank = await createPerson(page.request, {
    familyName: "Blank",
    givenName: "Zelda",
  });
  return {
    blankPersonId: blank,
    importId: String(dryRun.importId),
    richPersonId: rich,
    richPersonName,
  };
}

test(
  "[PERF-002] every cataloged authenticated page stays within its request budget",
  async ({ browserName, context, page, request }) => {
    test.skip(
      browserName !== "chromium",
      "PERF-002 is calibrated on Chromium.",
    );
    test.setTimeout(420_000);
    page.setDefaultTimeout(20_000);
    const email = `perf-002-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Budget",
      lastName: "Owner",
      workspaceName: "Budget workspace",
    });
    await signInAcceptingCompliance(page, email, { expectToday: true });
    const seeded = await seedWorkspace(page);
    await recordLayoutShifts(context);

    // A budget key is a catalog page ID, or a page ID and a variant after `#`
    // for a second shape of the same page: the person page is budgeted rich
    // (`people.profile`) and blank (`people.profile#blank`, AUD-Q3's measured value).
    const visits = [...catalogedAuthenticatedPages(), ...PAGE_VARIANTS].sort();
    expect.soft(Object.keys(budgets.pages).sort(), "a budget for every page")
      .toEqual(visits);
    // The journal item's id comes from the journal's own first link, so the
    // journal opens first.
    let journalItem = "";
    const path = (id: string): string => {
      const person = `/app/people/${seeded.richPersonId}`;
      const paths: Readonly<Record<string, string>> = {
        "app.today": "/app",
        "compliance.accept": "/app/compliance",
        "journal.index": "/app/journal",
        "journal.item": journalItem,
        "people.activity-report": `${person}/activity-report`,
        "people.archived": "/app/people/archived",
        "people.audit": `${person}/audit`,
        "people.create": "/app/people/new",
        "people.index": "/app/people",
        "people.profile": person,
        "people.profile#blank": `/app/people/${seeded.blankPersonId}`,
        "settings.api-access": "/app/settings/api",
        "settings.audit": "/app/settings/audit",
        "settings.export": "/app/settings/export",
        "settings.import": "/app/settings/import",
        "settings.import-new": "/app/settings/import/new",
        "settings.import-report": `/app/settings/import/${seeded.importId}`,
        "settings.index": "/app/settings",
        "settings.integrations": "/app/settings/integrations",
        "settings.members": "/app/settings/members",
        "settings.personalization": "/app/settings/personalization",
        "settings.preferences": "/app/settings/preferences",
        "settings.profile": "/app/settings/profile",
        "settings.security": "/app/settings/security",
        "settings.storage": "/app/settings/storage",
        "settings.workspace": "/app/settings/workspace",
        "settings.workspace-danger": "/app/settings/workspace/danger-zone",
        "tasks.index": "/app/tasks",
      };
      const found = paths[id];
      if (found === undefined) throw new Error(`no path for ${id}`);
      return found;
    };
    const order = [
      "journal.index",
      ...visits.filter((visit) => visit !== "journal.index"),
    ];
    const lines: string[] = [];
    for (const visit of order) {
      const id = visit.split("#")[0]!;
      const budget = budgets.pages[visit] ??
        { basis: "missing", requests: 0, steps: 0 };
      const tab = await context.newPage();
      tab.setDefaultTimeout(20_000);
      await emulateLatency(tab);
      const requests = new ApiRequests(tab);
      if (id === "compliance.accept") {
        // With nothing left to accept, the review forwards the member to
        // Today. Publishing a required version is instance-wide state that
        // only the exclusive GOVERNANCE-001 project may change (REL-057), so
        // the budget covers the compliance document until it leaves.
        tab.on("framenavigated", (frame) => {
          if (
            frame === tab.mainFrame() &&
            new URL(frame.url()).pathname !== "/app/compliance"
          ) requests.stop();
        });
        await tab.goto(path(visit));
        await expect(tab).toHaveURL(/\/app$/);
      } else {
        await tab.goto(path(visit));
        await expect(tab.locator("body")).toHaveAttribute("data-page-id", id);
      }
      if (id === "people.profile") await settlePersonWorkspace(tab);
      else await tab.waitForLoadState("load");
      await requests.quiet();
      const observed = requests.observed;
      const steps = Math.max(0, ...observed.map((request) => request.step));
      const line =
        `${visit}: ${observed.length} requests (budget ${budget.requests}), ${steps} steps (budget ${budget.steps}): ${
          observed.map((request) =>
            `${request.step}:${request.method} ${request.url}`
          ).join(", ")
        }`;
      console.log(line);
      lines.push(line);
      expect.soft(
        budgetViolations(observed, budget),
        `${visit} ${JSON.stringify(observed)}`,
      ).toEqual([]);
      if (id === "journal.index") {
        journalItem = await tab.locator('a[href^="/app/journal/"]').first()
          .getAttribute("href") ?? "";
        expect(journalItem).toMatch(/^\/app\/journal\/[\w-]+$/);
      }
      if (id === "app.today") {
        // Today's layout shift (FER-06) once every list has answered.
        const shifts = await tab.evaluate(() =>
          (globalThis as unknown as {
            __perf002Shifts: { supported: boolean; total: number };
          }).__perf002Shifts
        );
        expect(shifts.supported, "Chromium reports layout shifts").toBe(true);
        lines.push(
          `app.today CLS ${
            shifts.total.toFixed(4)
          } (ceiling ${profile.webVitals.todayCls.ceiling})`,
        );
        expect.soft(shifts.total, "Today's CLS").toBeLessThan(
          profile.webVitals.todayCls.ceiling,
        );
        // The palette's empty query (FEQ-05), on a quiet page.
        const before = requests.observed.length;
        await activateGlobalSearch(tab);
        await tab.getByRole("combobox", { name: "Find a person" }).press(
          "ArrowDown",
        );
        await expect(
          tab.locator("#global-people-search-results").getByRole("option")
            .first(),
        ).toBeVisible();
        await requests.quiet();
        const palette = requests.since(before);
        expect(palette.length, "the palette reads its recent people")
          .toBeGreaterThan(0);
        const line =
          `palette: ${palette.length} requests (budget ${budgets.palette.requests}): ${
            palette.map((request) => `${request.method} ${request.url}`)
          }`;
        console.log(line);
        lines.push(line);
        expect.soft(
          budgetViolations(palette, budgets.palette),
          `palette ${JSON.stringify(palette)}`,
        ).toEqual([]);
      }
      await tab.close();
    }
    report(lines);

    // The person page's LCP on the 4x-CPU profile (FER-11), in a fresh tab.
    const lcp = profile.webVitals.personLcpCpu4Ms;
    const tab = await context.newPage();
    tab.setDefaultTimeout(60_000);
    await throttleCpu(tab, lcp.cpuThrottlingRate);
    await tab.goto(path("people.profile"));
    await settlePersonWorkspace(tab);
    const paint = await largestContentfulPaint(tab);
    await tab.close();
    report([
      `people.profile LCP at ${lcp.cpuThrottlingRate}x CPU ${
        paint.toFixed(0)
      } ms (ceiling ${lcp.ceiling} ms)`,
    ]);
    expect(paint, "the person page's LCP at 4x CPU").toBeLessThanOrEqual(
      lcp.ceiling,
    );
  },
);

test(
  "[PERF-002] records the four primary navigation clicks at 4x CPU",
  async ({ browserName, page, request }) => {
    test.skip(
      browserName !== "chromium",
      "PERF-002 is calibrated on Chromium.",
    );
    test.setTimeout(300_000);
    page.setDefaultTimeout(30_000);
    const email = `perf-002-nav-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Navigation",
      lastName: "Owner",
      workspaceName: "Navigation workspace",
    });
    await signInAcceptingCompliance(page, email, { expectToday: true });
    const seeded = await seedWorkspace(page);
    const settings = profile.webVitals.navigationClicksCpu4;
    await throttleCpu(page, settings.cpuThrottlingRate);

    const todayReady = () =>
      page.waitForFunction(
        () => {
          const state = document.querySelector("#today-attention-state");
          return state !== null && !/Loading/.test(state.textContent ?? "");
        },
        undefined,
        { polling: "raf" },
      );
    const timed = async (
      click: () => Promise<void>,
      ready: () => Promise<unknown>,
    ): Promise<number> => {
      const started = Date.now();
      await click();
      await ready();
      const elapsed = Date.now() - started;
      await page.waitForLoadState("load");
      return elapsed;
    };
    const clicks: Record<string, number[]> = {
      "Today to People (primary nav)": [],
      "People to Person (row link)": [],
      "Person to Today (brand link)": [],
      "Settings overview to Preferences": [],
    };
    const person = `/app/people/${seeded.richPersonId}`;
    for (let run = 0; run < settings.runs; run += 1) {
      await page.goto("/app");
      await todayReady();
      await page.waitForLoadState("load");
      clicks["Today to People (primary nav)"]!.push(
        await timed(
          () => page.locator('.primary-nav a[href="/app/people"]').click(),
          () => page.locator("#people-directory-list > li").first().waitFor(),
        ),
      );
      clicks["People to Person (row link)"]!.push(
        await timed(
          () =>
            page.locator(`#people-directory-list a[href="${person}"]`).first()
              .click(),
          () =>
            page.getByRole("heading", { name: seeded.richPersonName, level: 1 })
              .waitFor(),
        ),
      );
      await settlePersonWorkspace(page);
      clicks["Person to Today (brand link)"]!.push(
        await timed(() => page.locator("a.brand").click(), todayReady),
      );
      await page.goto("/app/settings");
      await page.waitForLoadState("load");
      clicks["Settings overview to Preferences"]!.push(
        await timed(
          () =>
            page.locator(
              'a.settings-card-link[href="/app/settings/preferences"]',
            ).click(),
          () => waitForIsland(page, "settings-preferences"),
        ),
      );
    }
    const median = (values: readonly number[]) =>
      [...values].sort((left, right) => left - right)[
        Math.floor(values.length / 2)
      ]!;
    report(
      Object.entries(clicks).map(([name, values]) =>
        `navigation ${name} at ${settings.cpuThrottlingRate}x CPU: median ${
          median(values)
        } ms (runs ${values.join(", ")} ms)`
      ),
    );
  },
);
