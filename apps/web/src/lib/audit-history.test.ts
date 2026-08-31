// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountAuditHistory, mountPersonAuditSummary } from "./audit-history.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const eventId = "00000000-0000-4000-8000-000000000901";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const session = (role: "admin" | "member" | "owner" = "owner") => ({
  member: {
    id: "00000000-0000-4000-8000-000000000002",
    role,
  },
  principal: { userId: "00000000-0000-4000-8000-000000000001" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
});

function historyMarkup() {
  return `<form data-audit-filters>
    <input name="personId"><input name="actorMemberId"><input name="action">
    <input name="from" type="datetime-local"><input name="to" type="datetime-local">
    <button type="submit">Apply</button><button data-audit-clear type="button">Clear</button>
  </form><p data-audit-state></p><ol data-audit-list></ol>
  <button data-audit-more type="button" hidden>Load more</button>
  <button data-audit-retry type="button" hidden>Retry</button>
  <h1 data-audit-heading>Audit history</h1>`;
}

function summaryMarkup() {
  return `<section data-person-audit-summary data-section-state="loading">
    <span data-person-audit-badge>Authorized</span>
    <p data-person-audit-state></p><ol data-person-audit-list></ol>
    <a data-person-audit-link href="/app/people">Open full audit history</a>
    <button data-person-audit-retry hidden>Retry</button>
  </section>`;
}

describe("GOVERNANCE-002 audit history UI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
  });

  it("UXD-009 resolves the person-audit breadcrumb", async () => {
    document.body.innerHTML = `${historyMarkup()}
      <nav aria-label="Breadcrumb">
        <a href="/app/people">People</a><span aria-hidden="true">/</span>
        <a data-breadcrumb-person href="/app/people">Loading person…</a><span aria-hidden="true">/</span>
        <span aria-current="page">Audit history</span>
      </nav>`;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        return Promise.resolve(response(
          path.endsWith("/session") ? session() : {
            items: [],
            person: { id: personId, name: "Ada Lovelace" },
            status: "ready",
          },
        ));
      }),
    );

    await mountAuditHistory(personId);

    const personCrumb = document.querySelector("[data-breadcrumb-person]");
    expect({
      href: personCrumb?.getAttribute("href"),
      tagName: personCrumb?.tagName,
      text: personCrumb?.textContent,
    }).toEqual({
      href: `/app/people/${personId}`,
      tagName: "A",
      text: "Ada Lovelace",
    });
  });

  it("renders redacted append pages and forwards accepted filters", async () => {
    document.body.innerHTML = historyMarkup();
    history.replaceState({}, "", "/app/settings/audit");
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        calls.push(url);
        if (url.pathname === "/api/v1/session") {
          return Promise.resolve(response(session()));
        }
        const cursor = url.searchParams.get("cursor");
        return Promise.resolve(response({
          items: [{
            action: cursor ? "people.person-created" : "people.person-updated",
            actor: { name: "Workspace owner" },
            details: cursor ? {} : { section: "contact-methods" },
            id: eventId,
            occurredAt: cursor
              ? "2026-08-16T12:30:00.000Z"
              : "2026-08-17T12:30:00.000Z",
            person: { id: personId, name: "Ada Lovelace" },
            redacted: !cursor,
            subject: { id: personId, type: "person" },
          }],
          ...(cursor ? {} : { nextCursor: "older-page" }),
          status: "ready",
        }));
      }),
    );
    const form = document.querySelector<HTMLFormElement>(
      "[data-audit-filters]",
    )!;
    (form.elements.namedItem("personId") as HTMLInputElement).value = personId;
    (form.elements.namedItem("action") as HTMLInputElement).value =
      "people.person-updated";
    (form.elements.namedItem("from") as HTMLInputElement).value =
      "2026-08-01T00:00";
    await mountAuditHistory();
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]!.searchParams.get("personId")).toBe(personId);
    expect(calls[1]!.searchParams.get("action")).toBe("people.person-updated");
    expect(calls[1]!.searchParams.get("from")).toBe(
      new Date("2026-08-01T00:00").toISOString(),
    );
    expect(document.querySelector("[data-audit-list]")?.textContent).toContain(
      "Redacted",
    );
    document.querySelector<HTMLButtonElement>("[data-audit-more]")!.click();
    await vi.waitFor(() => expect(calls.length).toBe(4));
    expect(calls[3]!.searchParams.get("cursor")).toBe("older-page");
    expect(document.querySelectorAll("[data-audit-list] li")).toHaveLength(2);
    document.querySelector<HTMLButtonElement>("[data-audit-clear]")!.click();
    await vi.waitFor(() => expect(calls.length).toBe(6));
    expect(calls[5]!.searchParams.has("personId")).toBe(false);
    form.requestSubmit();
    await vi.waitFor(() => expect(calls.length).toBe(8));
  });

  it("renders closed date details, lifecycle enums, and nulls as accessible text", async () => {
    document.body.innerHTML = historyMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        return Promise.resolve(
          url.pathname === "/api/v1/session" ? response(session()) : response({
            items: [{
              action: "people.important-date-updated",
              actor: { name: "Workspace owner" },
              details: {
                from: {
                  isYearApproximate: true,
                  precision: "year_month",
                },
                status: "archived",
                to: null,
              },
              id: eventId,
              occurredAt: "2026-08-17T12:30:00.000Z",
              redacted: false,
              subject: { id: personId, type: "person_date" },
            }],
            status: "ready",
          }),
        );
      }),
    );

    await mountAuditHistory();

    const text = document.querySelector("[data-audit-list]")?.textContent;
    expect(text).toContain("From: Approximate year and month");
    expect(text).toContain("Status: Archived");
    expect(text).toContain("To: Not set");
    expect(text).not.toContain("[object Object]");
  });

  it("removes prior rows before a changed first-page scope can fail", async () => {
    document.body.innerHTML = historyMarkup();
    let auditAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/v1/session") {
          return Promise.resolve(response(session()));
        }
        auditAttempts += 1;
        return Promise.resolve(
          auditAttempts === 1
            ? response({
              items: [{
                action: "people.person-created",
                actor: { name: "Workspace owner" },
                details: {},
                id: eventId,
                occurredAt: "2026-08-17T12:30:00.000Z",
                redacted: false,
                subject: { id: personId, type: "person" },
              }],
              status: "ready",
            })
            : response({ detail: "Unavailable", status: 503 }, 503),
        );
      }),
    );

    await mountAuditHistory();
    expect(document.querySelectorAll("[data-audit-list] li")).toHaveLength(1);
    const form = document.querySelector<HTMLFormElement>(
      "[data-audit-filters]",
    )!;
    (form.elements.namedItem("action") as HTMLInputElement).value =
      "people.person-updated";
    form.requestSubmit();
    await vi.waitFor(() => expect(auditAttempts).toBe(2));

    expect(document.querySelector("[data-audit-state]")?.textContent)
      .toContain("could not be loaded");
    expect(document.querySelectorAll("[data-audit-list] li")).toHaveLength(0);
  });

  it.each(["api", "session"])(
    "retries the same retained continuation after a %s failure",
    async (failureAt) => {
      document.body.innerHTML = historyMarkup();
      let auditAttempts = 0;
      let sessionAttempts = 0;
      const auditUrls: URL[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = new URL(String(input), "http://localhost");
          if (url.pathname === "/api/v1/session") {
            sessionAttempts += 1;
            return Promise.resolve(
              failureAt === "session" && sessionAttempts === 2
                ? response({ status: 503 }, 503)
                : response(session()),
            );
          }
          auditAttempts += 1;
          auditUrls.push(url);
          if (failureAt === "api" && auditAttempts === 2) {
            return Promise.resolve(
              response({ detail: "Unavailable", status: 503 }, 503),
            );
          }
          return Promise.resolve(response({
            items: [{
              action: auditAttempts === 1
                ? "people.person-created"
                : "people.person-archived",
              actor: { name: "Workspace member" },
              details: {},
              id: auditAttempts === 1
                ? eventId
                : "00000000-0000-4000-8000-000000000902",
              occurredAt: auditAttempts === 1
                ? "2026-08-17T12:30:00.000Z"
                : "2026-08-16T12:30:00.000Z",
              redacted: false,
              subject: { id: personId, type: "person" },
            }],
            ...(auditAttempts === 1 ? { nextCursor: "older-page" } : {}),
            status: "ready",
          }));
        }),
      );

      await mountAuditHistory();
      const more = document.querySelector<HTMLButtonElement>(
        "[data-audit-more]",
      )!;
      more.click();
      await vi.waitFor(() =>
        expect(document.querySelector("[data-audit-state]")?.textContent)
          .toContain("Existing results are unchanged")
      );
      expect(document.querySelectorAll("[data-audit-list] li")).toHaveLength(
        1,
      );
      expect(more.disabled).toBe(false);

      document.querySelector<HTMLButtonElement>("[data-audit-retry]")!.click();
      await vi.waitFor(() =>
        expect(auditAttempts).toBe(failureAt === "api" ? 3 : 2)
      );
      expect(auditUrls.at(-1)?.searchParams.get("cursor")).toBe("older-page");
      expect(document.querySelectorAll("[data-audit-list] li")).toHaveLength(
        2,
      );
    },
  );

  it.each([403, 404])(
    "keeps accepted rows and removes retry after terminal continuation %s",
    async (status) => {
      document.body.innerHTML = historyMarkup();
      let auditAttempts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = new URL(String(input), "http://localhost");
          if (url.pathname === "/api/v1/session") {
            return Promise.resolve(response(session()));
          }
          auditAttempts += 1;
          return Promise.resolve(
            auditAttempts === 1
              ? response({
                items: [{
                  action: "people.person-created",
                  actor: { name: "Workspace member" },
                  details: {},
                  id: eventId,
                  occurredAt: "2026-08-17T12:30:00.000Z",
                  redacted: false,
                  subject: { id: personId, type: "person" },
                }],
                nextCursor: "older-page",
                status: "ready",
              })
              : response({ detail: "Terminal continuation", status }, status),
          );
        }),
      );

      await mountAuditHistory();
      document.querySelector<HTMLButtonElement>("[data-audit-more]")!.click();
      await vi.waitFor(() => expect(auditAttempts).toBe(2));

      expect(document.querySelectorAll("[data-audit-list] li")).toHaveLength(
        1,
      );
      expect(document.querySelector("[data-audit-state]")?.textContent)
        .toContain("Existing results are unchanged");
      expect(
        document.querySelector<HTMLButtonElement>("[data-audit-retry]")
          ?.hidden,
      ).toBe(true);
      expect(
        document.querySelector<HTMLButtonElement>("[data-audit-more]")
          ?.hidden,
      ).toBe(true);
    },
  );

  it("UXD-009 keeps a failed person-audit crumb truthful and retryable", async () => {
    document.body.innerHTML = `${historyMarkup()}
      <nav aria-label="Breadcrumb">
        <a href="/app/people">People</a><span aria-hidden="true">/</span>
        <a data-breadcrumb-person href="/app/people/${personId}"><span class="skeleton skeleton-chip" aria-hidden="true"></span><span class="sr-only">Loading person…</span></a><span aria-hidden="true">/</span>
        <span aria-current="page">Audit history</span>
      </nav>`;
    history.replaceState({}, "", `/app/people/${personId}/audit`);
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/v1/session") {
          return Promise.resolve(response(session("member")));
        }
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? response({
              detail: "Audit requires an administrator.",
              status: 403,
            }, 403)
            : response({
              items: [],
              person: { id: personId, name: "Ada" },
              status: "archived",
            }),
        );
      }),
    );
    await mountAuditHistory(personId);
    expect(document.querySelector("[data-audit-state]")?.textContent).toContain(
      "permission",
    );
    expect(
      document.querySelector<HTMLButtonElement>("[data-audit-retry]")?.hidden,
    ).toBe(false);
    const personCrumb = document.querySelector<HTMLAnchorElement>(
      "[data-breadcrumb-person]",
    );
    expect({
      href: personCrumb?.getAttribute("href"),
      text: personCrumb?.textContent,
    }).toEqual({
      href: `/app/people/${personId}`,
      text: "Person",
    });
    document.querySelector<HTMLButtonElement>("[data-audit-retry]")!.click();
    await vi.waitFor(() => expect(attempts).toBe(2));
    expect(document.querySelector("[data-audit-state]")?.textContent).toContain(
      "No audit events",
    );
    expect(document.querySelector("[data-audit-heading]")?.textContent)
      .toContain("Ada");
  });

  it.each([
    [404, "not found"],
    [409, "stale"],
    [503, "could not be loaded"],
  ])("renders local %s audit failures", async (status, message) => {
    document.body.innerHTML = historyMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        return Promise.resolve(
          url.pathname === "/api/v1/session"
            ? response(session("admin"))
            : response({ detail: "Safe problem", status }, status),
        );
      }),
    );
    await mountAuditHistory(personId);
    expect(document.querySelector("[data-audit-state]")?.textContent)
      .toContain(message);
    expect(
      document.querySelector<HTMLButtonElement>("[data-audit-retry]")?.hidden,
    ).toBe(false);
  });

  it("keeps session loss and transport failure inside the audit region", async () => {
    document.body.innerHTML = historyMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ status: 401 }, 401))
        .mockResolvedValueOnce(response({ status: 401 }, 401)),
    );
    await mountAuditHistory();
    expect(document.querySelector("[data-audit-state]")?.textContent)
      .toContain("Sign in again");

    document.body.innerHTML = historyMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        return url.pathname === "/api/v1/session"
          ? Promise.resolve(response(session()))
          : Promise.reject(new Error("offline"));
      }),
    );
    await mountAuditHistory();
    expect(document.querySelector("[data-audit-state]")?.textContent)
      .toContain("could not be loaded");
  });

  it("loads a compact profile summary without broadening member access", async () => {
    document.body.innerHTML = summaryMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [],
        status: "ready",
      })),
    );
    await mountPersonAuditSummary(personId, workspaceId);
    expect(document.querySelector("[data-person-audit-state]")?.textContent)
      .toContain("No audit events");
    expect(
      document.querySelector("[data-person-audit-link]")?.getAttribute("href"),
    )
      .toBe(`/app/people/${personId}/audit`);
    expect(
      document.querySelector<HTMLElement>("[data-person-audit-link]")?.hidden,
    ).toBe(false);
    expect(document.querySelector("[data-person-audit-badge]")?.textContent)
      .toBe("Authorized");
  });

  it("retries a forbidden compact summary without affecting the profile", async () => {
    document.body.innerHTML = summaryMarkup();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? response({ detail: "Forbidden", status: 403 }, 403)
            : response({
              items: [{
                action: "people.person-updated",
                actor: { name: "Workspace owner" },
                details: {},
                id: eventId,
                occurredAt: "2026-08-17T12:30:00.000Z",
                redacted: false,
                subject: { id: personId, type: "person" },
              }],
              status: "ready",
            }),
        );
      }),
    );
    await mountPersonAuditSummary(personId, workspaceId);
    expect(
      document.querySelector<HTMLElement>("[data-person-audit-summary]")
        ?.dataset.sectionState,
    ).toBe("forbidden");
    expect(document.querySelector("[data-person-audit-badge]")?.textContent)
      .toBe("Forbidden");
    expect(
      document.querySelector<HTMLAnchorElement>("[data-person-audit-link]")
        ?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLAnchorElement>("[data-person-audit-link]")
        ?.hasAttribute("href"),
    ).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-person-audit-retry]")!
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>("[data-person-audit-summary]")
          ?.dataset.sectionState,
      ).toBe("ready")
    );
    expect(attempts).toBe(2);
    expect(document.querySelector("[data-person-audit-state]")?.textContent)
      .toContain("1 recent authorized");
    expect(document.querySelector("[data-person-audit-badge]")?.textContent)
      .toBe("Authorized");
    expect(
      document.querySelector<HTMLAnchorElement>("[data-person-audit-link]")
        ?.hidden,
    ).toBe(false);
  });

  it("keeps privileged summary navigation hidden while unavailable and restores it after retry", async () => {
    document.body.innerHTML = summaryMarkup();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(response({ items: [], status: "ready" }));
      }),
    );

    await mountPersonAuditSummary(personId, workspaceId);

    expect(
      document.querySelector<HTMLElement>("[data-person-audit-summary]")
        ?.dataset.sectionState,
    ).toBe("error");
    expect(document.querySelector("[data-person-audit-badge]")?.textContent)
      .toBe("Unavailable");
    expect(
      document.querySelector<HTMLAnchorElement>("[data-person-audit-link]")
        ?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLAnchorElement>("[data-person-audit-link]")
        ?.hasAttribute("href"),
    ).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-person-audit-retry]")!
      .click();
    expect(document.querySelector("[data-person-audit-badge]")?.textContent)
      .toBe("Loading");
    expect(
      document.querySelector<HTMLAnchorElement>("[data-person-audit-link]")
        ?.hidden,
    ).toBe(true);
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>("[data-person-audit-summary]")
          ?.dataset.sectionState,
      ).toBe("ready")
    );
    expect(document.querySelector("[data-person-audit-badge]")?.textContent)
      .toBe("Authorized");
    expect(
      document.querySelector<HTMLAnchorElement>("[data-person-audit-link]")
        ?.hidden,
    ).toBe(false);
  });
});
