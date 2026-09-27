// @vitest-environment happy-dom

vi.mock("../../lib/time-presentation.ts", async (original) => ({
  ...await original<typeof import("../../lib/time-presentation.ts")>(),
  loadTimePreferences: vi.fn().mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  }),
}));

import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type ApiHandler,
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  type StubbedApi,
} from "../../testing/api.ts";
import { ids, workspaceSession } from "../../testing/fixtures.ts";
import { drawShell, element, mountSettled } from "../../testing/render.tsx";
import { mountAuditHistory } from "./audit-history.tsx";

const { person: personId } = ids;
const eventId = "00000000-0000-4000-8000-000000000901";
const SESSION = "GET /api/v1/session";
const AUDIT = "GET /api/v1/*";
const ENTRY = "POST /api/v1/application-entry";

/** The audit reads a suite's stub received, person or workspace. */
const auditReads = (api: StubbedApi) =>
  api.requests().filter((request) => /audit/.test(request.url.pathname));

const session = (role: "admin" | "member" | "owner" = "owner") =>
  jsonResponse(workspaceSession({ member: { id: ids.member, role } }));

/** The region the audit pages draw, before the island takes it over. */
function historyMarkup(scope: "person" | "workspace" = "workspace"): string {
  return `<h1 data-audit-heading>Audit history</h1>
    <div class="contents" data-audit-history>
      <form data-audit-filters method="get">
        ${
    scope === "workspace"
      ? '<label>Person ID <input name="personId" type="text"></label>'
      : ""
  }
        <label>Actor member ID <input name="actorMemberId" type="text"></label>
        <label>Action <input name="action" type="search"></label>
        <label>From <input name="from" type="datetime-local"></label>
        <label>Before <input name="to" type="datetime-local"></label>
        <button type="submit" disabled>Apply filters</button>
        <button data-audit-clear type="button" disabled>Clear filters</button>
      </form>
      <p data-audit-state>Loading audit history…</p><ol data-audit-list></ol>
      <button data-audit-more type="button" hidden>Load older events</button>
      <button data-audit-retry type="button" hidden>Retry audit history</button>
    </div>`;
}

const crumbMarkup = (content: string) =>
  `<nav aria-label="Breadcrumb">
    <a href="/app/people">People</a><span aria-hidden="true">/</span>
    <a data-breadcrumb-person href="/app/people">${content}</a><span aria-hidden="true">/</span>
    <span aria-current="page">Audit history</span>
  </nav>`;

function event(overrides: Record<string, unknown> = {}) {
  return {
    action: "people.person-created",
    actor: { name: "Workspace owner" },
    details: {},
    id: eventId,
    occurredAt: "2026-08-17T12:30:00.000Z",
    redacted: false,
    subject: { id: personId, type: "person" },
    ...overrides,
  };
}

const page = (items: readonly unknown[], extra: Record<string, unknown> = {}) =>
  jsonResponse({ items, status: "ready", ...extra });

const mount = (id?: string) => mountSettled(() => mountAuditHistory(id));
const stateLine = () => element("[data-audit-state]").textContent;
const rows = () => document.querySelectorAll("[data-audit-list] li");
const button = (name: string) =>
  within(element("[data-audit-history]")).getByRole("button", { name });
/** A control that may be hidden, which the accessibility tree omits. */
const hiddenButton = (name: string) =>
  [...element("[data-audit-history]").querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  )!;

describe("GOVERNANCE-002 audit history UI", () => {
  it("UXD-009 resolves the person-audit breadcrumb", async () => {
    drawShell(`${historyMarkup("person")}${crumbMarkup("Loading person…")}`);
    stubApi({
      [SESSION]: session(),
      [AUDIT]: page([], { person: { id: personId, name: "Ada Lovelace" } }),
    });

    await mount(personId);

    const personCrumb = element("[data-breadcrumb-person]");
    expect({
      href: personCrumb.getAttribute("href"),
      tagName: personCrumb.tagName,
      text: personCrumb.textContent,
    }).toEqual({
      href: `/app/people/${personId}`,
      tagName: "A",
      text: "Ada Lovelace",
    });
    expect(element("[data-audit-heading]").textContent).toBe(
      "Ada Lovelace audit history",
    );
    expect(element("[data-audit-history]").dataset.island).toBe(
      "audit-history",
    );
    expect(screenLabel("Person ID")).toBeNull();
  });

  it("renders redacted append pages and forwards accepted filters", async () => {
    drawShell(historyMarkup());
    history.replaceState({}, "", "/app/settings/audit");
    const form = element<HTMLFormElement>("[data-audit-filters]");
    // Typed into the static filters before the island took over.
    (form.elements.namedItem("personId") as HTMLInputElement).value = personId;
    (form.elements.namedItem("action") as HTMLInputElement).value =
      "people.person-updated";
    (form.elements.namedItem("from") as HTMLInputElement).value =
      "2026-08-01T00:00";
    const reads: ApiHandler = (request) => {
      const cursor = request.url.searchParams.get("cursor");
      return page([
        event({
          action: cursor ? "people.person-created" : "people.person-updated",
          details: cursor ? {} : { section: "contact-methods" },
          occurredAt: cursor
            ? "2026-08-16T12:30:00.000Z"
            : "2026-08-17T12:30:00.000Z",
          person: { id: personId, name: "Ada Lovelace" },
          redacted: !cursor,
        }),
      ], cursor ? {} : { nextCursor: "older-page" });
    };
    const api = stubApi({ [SESSION]: session(), [AUDIT]: reads });
    await mount();
    const audits = () => auditReads(api);
    expect(audits()).toHaveLength(1);
    const first = audits()[0]!.url.searchParams;
    expect(first.get("personId")).toBe(personId);
    expect(first.get("action")).toBe("people.person-updated");
    expect(first.get("from")).toBe(new Date("2026-08-01T00:00").toISOString());
    expect(element("[data-audit-list]").textContent).toContain("Redacted");
    expect(element("[data-audit-list]").textContent).toContain(
      "Section: contact-methods",
    );
    const user = userEvent.setup();
    await user.click(button("Load older events"));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(audits()[1]!.url.searchParams.get("cursor")).toBe("older-page");
    expect(stateLine()).toBe(
      "2 audit events in immutable newest-first order.",
    );
    await user.click(button("Clear filters"));
    await waitFor(() => expect(audits()).toHaveLength(3));
    expect(audits()[2]!.url.searchParams.has("personId")).toBe(false);
    expect((screenField("Action") as HTMLInputElement).value).toBe("");
    await user.click(button("Apply filters"));
    await waitFor(() => expect(audits()).toHaveLength(4));
  });

  it("renders closed date details, lifecycle enums, and nulls as accessible text", async () => {
    drawShell(historyMarkup());
    stubApi({
      [SESSION]: session(),
      [AUDIT]: page([event({
        action: "people.important-date-updated",
        details: {
          from: { isYearApproximate: true, precision: "year_month" },
          status: "archived",
          to: null,
        },
        subject: { id: personId, type: "person_date" },
      })]),
    });

    await mount();

    const text = element("[data-audit-list]").textContent;
    expect(text).toContain("From: Approximate year and month");
    expect(text).toContain("Status: Archived");
    expect(text).toContain("To: Not set");
    expect(text).not.toContain("[object Object]");
  });

  it("removes prior rows before a changed first-page scope can fail", async () => {
    drawShell(historyMarkup());
    stubApi({
      [SESSION]: session(),
      [AUDIT]: [page([event()]), problemResponse(503)],
    });

    await mount();
    expect(rows()).toHaveLength(1);
    const user = userEvent.setup();
    await user.type(screenField("Action"), "people.person-updated");
    await user.click(button("Apply filters"));
    await waitFor(() => expect(stateLine()).toContain("could not be loaded"));
    expect(rows()).toHaveLength(0);
  });

  it.each(["api", "session"])(
    "retries the same retained continuation after a %s failure",
    async (failureAt) => {
      drawShell(historyMarkup());
      const archived = event({
        action: "people.person-archived",
        actor: { name: "Workspace member" },
        id: "00000000-0000-4000-8000-000000000902",
        occurredAt: "2026-08-16T12:30:00.000Z",
      });
      const api = stubApi({
        [SESSION]: failureAt === "session"
          ? [session(), problemResponse(503), session()]
          : session(),
        [AUDIT]: failureAt === "api"
          ? [
            page([event()], { nextCursor: "older-page" }),
            problemResponse(503),
            page([archived]),
          ]
          : [page([event()], { nextCursor: "older-page" }), page([archived])],
      });

      await mount();
      const user = userEvent.setup();
      const more = button("Load older events");
      await user.click(more);
      await waitFor(() =>
        expect(stateLine()).toContain("Existing results are unchanged")
      );
      expect(rows()).toHaveLength(1);
      expect((more as HTMLButtonElement).disabled).toBe(false);

      await user.click(button("Retry audit history"));
      await waitFor(() => expect(rows()).toHaveLength(2));
      const audits = auditReads(api);
      expect(audits).toHaveLength(failureAt === "api" ? 3 : 2);
      expect(audits.at(-1)?.url.searchParams.get("cursor")).toBe("older-page");
    },
  );

  it.each([403, 404])(
    "keeps accepted rows and removes retry after terminal continuation %s",
    async (status) => {
      drawShell(historyMarkup());
      const api = stubApi({
        [SESSION]: session(),
        [AUDIT]: [
          page([event()], { nextCursor: "older-page" }),
          problemResponse(status, { detail: "Terminal continuation" }),
        ],
      });

      await mount();
      await userEvent.setup().click(button("Load older events"));
      await waitFor(() =>
        expect(stateLine()).toContain("Existing results are unchanged")
      );
      expect(auditReads(api)).toHaveLength(2);
      expect(rows()).toHaveLength(1);
      expect(hiddenButton("Retry audit history").hidden).toBe(true);
      expect(hiddenButton("Load older events").hidden).toBe(true);
    },
  );

  it("UXD-009 keeps a failed person-audit crumb truthful and retryable", async () => {
    drawShell(`${historyMarkup("person")}${
      crumbMarkup(
        '<span data-slot="skeleton" aria-hidden="true"></span><span class="sr-only">Loading person…</span>',
      )
    }`);
    element<HTMLAnchorElement>("[data-breadcrumb-person]").href =
      `/app/people/${personId}`;
    history.replaceState({}, "", `/app/people/${personId}/audit`);
    stubApi({
      [SESSION]: session("member"),
      [AUDIT]: [
        problemResponse(403, { detail: "Audit requires an administrator." }),
        page([], { person: { id: personId, name: "Ada" }, status: "archived" }),
      ],
    });
    await mount(personId);
    expect(stateLine()).toContain("permission");
    expect(hiddenButton("Retry audit history").hidden).toBe(false);
    const personCrumb = element("[data-breadcrumb-person]");
    expect({
      href: personCrumb.getAttribute("href"),
      text: personCrumb.textContent,
    }).toEqual({ href: `/app/people/${personId}`, text: "Person" });
    await userEvent.setup().click(button("Retry audit history"));
    await waitFor(() => expect(stateLine()).toContain("No audit events"));
    expect(element("[data-audit-heading]").textContent).toContain("Ada");
    expect(personCrumb.textContent).toBe("Ada");
  });

  it("names an archived person's history readable", async () => {
    drawShell(historyMarkup("person"));
    stubApi({
      [SESSION]: session(),
      [AUDIT]: page([event()], {
        person: { id: personId, name: "Ada" },
        status: "archived",
      }),
    });
    await mount(personId);
    expect(stateLine()).toBe(
      "1 audit event in immutable newest-first order. Archived person history remains readable.",
    );
    expect(element("[data-audit-heading]").textContent).toBe(
      "Ada audit history",
    );
  });

  it("names the person even on a page drawn without its heading", async () => {
    drawShell(`${historyMarkup("person")}${crumbMarkup("Loading person…")}`);
    element("[data-audit-heading]").remove();
    stubApi({
      [SESSION]: session(),
      [AUDIT]: page([], { person: { id: personId, name: "Ada" } }),
    });
    await mount(personId);
    expect(element("[data-breadcrumb-person]").textContent).toBe("Ada");
  });

  it("keeps a crumb that already names someone when a read fails", async () => {
    drawShell(`${historyMarkup("person")}${crumbMarkup("Ada")}`);
    stubApi({ [SESSION]: session(), [AUDIT]: problemResponse(503) });
    await mount(personId);
    expect(stateLine()).toContain("could not be loaded");
    expect(element("[data-breadcrumb-person]").textContent).toBe("Ada");
  });

  it("lands only the newest search when an earlier one answers late", async () => {
    drawShell(historyMarkup());
    const late = deferred<Response>();
    const api = stubApi({
      [SESSION]: session(),
      [AUDIT]: [page([event()]), late.promise, page([])],
    });
    await mount();
    const user = userEvent.setup();
    await user.type(screenField("Action"), "first");
    await user.click(button("Apply filters"));
    await waitFor(() => expect(auditReads(api)).toHaveLength(2));
    await user.click(button("Apply filters"));
    await waitFor(() =>
      expect(stateLine()).toBe("No audit events match this scope.")
    );
    await act(async () => {
      late.resolve(page([event(), event()]));
      await late.promise;
    });
    expect(stateLine()).toBe("No audit events match this scope.");
    expect(rows()).toHaveLength(0);
  });

  it.each([
    [404, "not found"],
    [409, "stale"],
    [503, "could not be loaded"],
  ])("renders local %s audit failures", async (status, message) => {
    drawShell(historyMarkup());
    stubApi({
      [SESSION]: session("admin"),
      [AUDIT]: problemResponse(status, { detail: "Safe problem" }),
    });
    await mount(personId);
    expect(stateLine()).toContain(message);
    expect(hiddenButton("Retry audit history").hidden).toBe(false);
  });

  it("restarts a stale continuation from the first page", async () => {
    drawShell(historyMarkup());
    const api = stubApi({
      [SESSION]: session(),
      [AUDIT]: [
        page([event()], { nextCursor: "older-page" }),
        problemResponse(409),
        page([event()]),
      ],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(button("Load older events"));
    await waitFor(() => expect(stateLine()).toContain("stale"));
    expect(stateLine()).toContain("Existing results are unchanged");
    expect(hiddenButton("Load older events").hidden).toBe(true);
    await user.click(button("Retry audit history"));
    await waitFor(() => expect(auditReads(api)).toHaveLength(3));
    expect(auditReads(api).at(-1)?.url.searchParams.has("cursor")).toBe(false);
  });

  it("keeps session loss and transport failure inside the audit region", async () => {
    drawShell(historyMarkup());
    stubApi({ [ENTRY]: problemResponse(401), [SESSION]: problemResponse(401) });
    await mount();
    expect(stateLine()).toContain("Sign in again");
  });

  it("reports an unreachable audit read as could not be loaded", async () => {
    drawShell(historyMarkup());
    stubApi({
      [SESSION]: session(),
      [AUDIT]: () => Promise.reject(new Error("offline")),
    });
    await mount();
    expect(stateLine()).toContain("could not be loaded");
  });

  it("does nothing on a page without the history region", async () => {
    drawShell("<main></main>");
    const api = stubApi({});
    await mount();
    expect(api.requests()).toHaveLength(0);
  });
});

function screenLabel(name: string): HTMLElement | null {
  return within(document.body).queryByLabelText(name);
}

function screenField(name: string): HTMLElement {
  return within(element("[data-audit-history]")).getByLabelText(name);
}
