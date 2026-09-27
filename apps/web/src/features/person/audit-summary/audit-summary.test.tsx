// @vitest-environment happy-dom

import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import { ids, preferences, sectionProps } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSection,
} from "../../../testing/render.tsx";
import { mountPersonAuditSummary } from "./audit-summary.tsx";

const { person: personId, workspace: workspaceId } = ids;
const AUDIT = "GET /api/v1/people/:personId/audit";
const eventId = "00000000-0000-4000-8000-000000000901";

/** The card as `AuditSummarySection.astro` draws it before hydration. */
function markup(): HTMLElement {
  drawShell(`<main>
    <section id="profile-section-audit-summary" class="profile-section-card audit-summary-card" data-profile-section="audit-summary" data-person-audit-summary data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-audit-summary-heading">
      <header class="profile-section-heading"><div class="profile-section-title"><h3 id="profile-section-audit-summary-heading">Audit summary</h3><span data-person-audit-badge>Loading</span></div></header>
      <p data-person-audit-state class="section-state"><span class="sr-only">Loading authorized audit summary…</span></p>
      <ol data-person-audit-list class="audit-event-list" aria-label="Recent authorized person audit events"></ol>
      <div data-form-actions>
        <a data-person-audit-link href="/app/people" hidden>Open full audit history</a>
        <button data-person-audit-retry type="button" hidden>Retry audit summary</button>
      </div>
    </section>
  </main>`);
  return element("[data-person-audit-summary]");
}

const props = () =>
  sectionProps({
    preferences: preferences({ effectiveTimezone: "UTC", locale: "en" }),
  });
const mount = () => mountSection(mountPersonAuditSummary, props());
const card = () => within(element("[data-person-audit-summary]"));
const stateLine = () => element("[data-person-audit-state]").textContent;
const badge = () => element("[data-person-audit-badge]").textContent;
const link = () => element<HTMLAnchorElement>("[data-person-audit-link]");
const retry = () => element<HTMLButtonElement>("[data-person-audit-retry]");

const event = (overrides: Record<string, unknown> = {}) => ({
  action: "people.person-updated",
  actor: { name: "Workspace owner" },
  details: {},
  id: eventId,
  occurredAt: "2026-08-17T12:30:00.000Z",
  redacted: false,
  subject: { id: personId, type: "person" },
  ...overrides,
});

describe("GOVERNANCE-002 person audit summary", () => {
  it("loads a compact profile summary without broadening member access", async () => {
    const section = markup();
    const api = stubApi({
      [AUDIT]: jsonResponse({ items: [], status: "ready" }),
    });
    await mount();
    expect(section.dataset.island).toBe("person-audit-summary");
    expect(section.dataset.sectionState).toBe("ready");
    expect(stateLine()).toContain("No audit events");
    expect(link().getAttribute("href")).toBe(`/app/people/${personId}/audit`);
    expect(link().hidden).toBe(false);
    expect(badge()).toBe("Authorized");
    expect(
      card().getByRole("heading", { level: 3, name: "Audit summary" }).id,
    ).toBe("profile-section-audit-summary-heading");
    const [request] = api.requests();
    expect(request?.url.searchParams.get("limit")).toBe("3");
    expect(request?.headers.get("X-Workspace-Id")).toBe(workspaceId);
    await expectNoAxeViolations(section);
  });

  it("lists recent events with their redaction and time", async () => {
    markup();
    stubApi({
      [AUDIT]: jsonResponse({
        items: [event({ redacted: true }), event({ id: crypto.randomUUID() })],
        status: "ready",
      }),
    });
    await mount();
    const items = card().getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("People person updated");
    expect(items[0]!.textContent).toContain("Redacted");
    expect(items[0]!.querySelector("time")?.dateTime).toBe(
      "2026-08-17T12:30:00.000Z",
    );
    expect(stateLine()).toBe("2 recent authorized audit events.");
  });

  it("retries a forbidden compact summary without affecting the profile", async () => {
    const section = markup();
    stubApi({
      [AUDIT]: [
        problemResponse(403, { detail: "Forbidden" }),
        jsonResponse({ items: [event()], status: "ready" }),
      ],
    });
    await mount();
    expect(section.dataset.sectionState).toBe("forbidden");
    expect(badge()).toBe("Forbidden");
    expect(stateLine()).toBe(
      "Audit summary requires owner or administrator permission.",
    );
    expect(link().hidden).toBe(true);
    expect(link().hasAttribute("href")).toBe(false);
    await userEvent.setup().click(
      card().getByRole("button", { name: "Retry audit summary" }),
    );
    await waitFor(() => expect(section.dataset.sectionState).toBe("ready"));
    expect(stateLine()).toContain("1 recent authorized");
    expect(badge()).toBe("Authorized");
    expect(link().hidden).toBe(false);
    expect(retry().hidden).toBe(true);
  });

  it("keeps privileged summary navigation hidden while unavailable and restores it after retry", async () => {
    const section = markup();
    const answer = deferred<Response>();
    stubApi({
      [AUDIT]: [
        () => Promise.reject(new Error("offline")),
        answer.promise,
      ],
    });
    await mount();
    expect(section.dataset.sectionState).toBe("error");
    expect(badge()).toBe("Unavailable");
    expect(stateLine()).toContain("Other profile sections remain available");
    expect(link().hidden).toBe(true);
    expect(link().hasAttribute("href")).toBe(false);
    await userEvent.setup().click(
      card().getByRole("button", { name: "Retry audit summary" }),
    );
    expect(badge()).toBe("Loading");
    expect(stateLine()).toBe("Loading authorized audit summary…");
    expect(section.dataset.sectionState).toBe("loading");
    expect(link().hidden).toBe(true);
    expect(retry().hidden).toBe(true);
    await act(async () => {
      answer.resolve(jsonResponse({ items: [], status: "ready" }));
      await answer.promise;
    });
    await waitFor(() => expect(section.dataset.sectionState).toBe("ready"));
    expect(badge()).toBe("Authorized");
    expect(link().hidden).toBe(false);
  });

  it("keeps the loading skeleton until the first answer arrives", async () => {
    const section = markup();
    const answer = deferred<Response>();
    stubApi({ [AUDIT]: answer.promise });
    const settled = mountPending(() =>
      mountPersonAuditSummary(document.body, props())
    );
    expect(section.hasAttribute("data-island-ready")).toBe(true);
    expect(section.dataset.sectionState).toBe("loading");
    expect(section.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(stateLine()).toBe("Loading authorized audit summary…");
    await act(async () => {
      answer.resolve(jsonResponse({ items: [], status: "ready" }));
      await settled;
    });
    expect(section.dataset.sectionState).toBe("ready");
  });

  it("does nothing without the card", async () => {
    drawShell("<main></main>");
    const api = stubApi({});
    await mount();
    expect(api.requests()).toHaveLength(0);
  });
});
