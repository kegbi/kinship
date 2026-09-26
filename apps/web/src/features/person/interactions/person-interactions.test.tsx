// @vitest-environment happy-dom

import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import { ids, personProfile, sectionProps } from "../../../testing/fixtures.ts";
import { drawShell, element, mountSection } from "../../../testing/render.tsx";
import { mountPersonInteractions } from "./mount.tsx";

const personId = ids.person;
const REPORT = "GET /api/v1/people/:personId/activity-report";

/** The hero's shortcuts and both cards, as the static shell draws them. */
function shell(): void {
  drawShell(`
    <nav><ul>
      <li><a data-section-link="activities"></a></li>
      <li><a data-section-link="notes"></a></li>
    </ul></nav>
    <header>
      <button data-person-interaction-capture data-quick-capture data-interaction-capture-ready="false" data-interaction-intended-kind="activity" type="button" disabled>Log interaction</button>
      <button data-person-interaction-capture data-quick-capture data-interaction-capture-ready="false" data-interaction-intended-kind="note" type="button" disabled>Add note</button>
    </header>
    <main>
      ${
    ["activities", "notes"].map((id) =>
      `<section id="profile-section-${id}" class="profile-section-card interaction-section-card" data-profile-section="${id}" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-${id}-heading">
          <header class="profile-section-heading"><div class="profile-section-title"><h3 id="profile-section-${id}-heading">${id}</h3></div></header>
          <p id="person-${id}-state" class="section-state">Loading ${id}…</p>
          <ul id="person-${id}-list" class="interaction-list" hidden><li>Saved ${id}</li></ul>
        </section>`
    ).join("")
  }
    </main>`);
}

const activity = (label: string) => ({
  emotions: [],
  happenedAt: "2026-08-17T12:30:00.000Z",
  id: crypto.randomUUID(),
  kind: "activity",
  participants: [{ id: personId, name: "Ada Lovelace" }],
  summary: label,
});

const note = (label: string) => ({
  body: label,
  createdAt: "2026-08-17T12:31:00.000Z",
  id: crypto.randomUUID(),
  isFavorited: false,
  kind: "note",
  participants: [{ id: personId, name: "Ada Lovelace" }],
});

const report = (items: readonly unknown[]) =>
  jsonResponse({
    items,
    person: { id: personId, name: "Ada Lovelace" },
    status: "ready",
  });

const page = (
  kind: "activity" | "note",
  count: number,
  label: string = kind,
) =>
  report(
    Array.from(
      { length: count },
      (_, index) =>
        kind === "activity"
          ? activity(`${label} ${index}`)
          : note(`${label} ${index}`),
    ),
  );

const mount = (
  options: { readonly archived?: boolean; readonly hidden?: string[] } = {},
) =>
  mountSection(
    mountPersonInteractions,
    sectionProps({
      archived: options.archived ?? false,
      initial: personProfile({
        person: {
          profileSections: (options.hidden ?? []).map((id) => ({
            id: id as "notes",
            status: "hidden" as const,
          })),
        },
      }),
    }),
  );

const section = (id: "activities" | "notes") =>
  element(`[data-profile-section="${id}"]`);
const stateOf = (id: "activities" | "notes") =>
  element(`#person-${id}-state`).textContent;
const retry = (id: "activities" | "notes") =>
  element<HTMLButtonElement>(`#person-${id}-retry`);
const shortcut = (where: "header" | "main", kind: "activity" | "note") =>
  element<HTMLButtonElement>(
    `${where} [data-person-interaction-capture][data-interaction-intended-kind="${kind}"]`,
  );
const created = () =>
  act(() => {
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
  });
const lifecycle = (targetPersonId: string, archived: boolean) =>
  act(() => {
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived,
          personId: targetPersonId,
          state: archived ? "archived" : "active",
        },
      }),
    );
  });
/** Quick capture wires every opener it finds, as it does once it is ready. */
const wire = () => {
  for (
    const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-quick-capture]",
    )
  ) {
    button.dataset.interactionCaptureReady = "true";
    button.disabled = button.hasAttribute("hidden");
  }
};

describe("INTERACTION-001 person notes and activities", () => {
  it("renders person activity and note sections with archive and hidden states", async () => {
    shell();
    const api = stubApi({ [REPORT]: page("activity", 1) });
    await mount({ archived: true, hidden: ["notes"] });
    const root = section("activities");
    expect(root.dataset.island).toBe("person-interactions");
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    expect(stateOf("activities")).toBe(
      "1 recent activity. Listed in the timeline above.",
    );
    expect(section("activities").dataset.sectionState).toBe("ready");
    expect(section("notes").dataset.sectionState).toBe("hidden");
    expect(section("notes").hidden).toBe(true);
    expect(stateOf("notes")).toBe(
      "Notes are hidden by workspace personalization.",
    );
    for (const where of ["header", "main"] as const) {
      expect(shortcut(where, "activity").hidden).toBe(true);
      expect(shortcut(where, "activity").disabled).toBe(true);
    }
    const link = within(root).getByRole("link", {
      name: "Open activity report",
    });
    expect(link.getAttribute("href")).toBe(
      `/app/people/${personId}/activity-report`,
    );
    expect(within(root).getByRole("heading", { level: 3 }).id).toBe(
      "profile-section-activities-heading",
    );
    expect(api.calls()).toEqual([
      `GET /api/v1/people/${personId}/activity-report?kind=activity&limit=20`,
    ]);
    await expectNoAxeViolations(element("main"));
  });

  it("loads kind-scoped profile sections so a page of newer notes cannot conceal an activity", async () => {
    shell();
    const api = stubApi({
      [REPORT]: ({ url }) =>
        url.searchParams.get("kind") === "activity"
          ? page("activity", 1)
          : jsonResponse({
            items: Array.from({ length: 20 }, (_, index) =>
              note(`Newer note ${index}`)),
            nextCursor: "more-notes",
            person: { id: personId, name: "Ada Lovelace" },
            status: "ready",
          }),
    });
    await mount();
    expect(
      api.requests().map((request) => request.url.searchParams.get("kind"))
        .sort(),
    ).toEqual(["activity", "note"]);
    for (const id of ["activities", "notes"] as const) {
      const list = element<HTMLUListElement>(`#person-${id}-list`);
      expect(list.hidden).toBe(true);
      expect(list.children).toHaveLength(0);
      expect(section(id).dataset.sectionState).toBe("ready");
    }
    expect(stateOf("activities")).toBe(
      "1 recent activity. Listed in the timeline above.",
    );
    expect(stateOf("notes")).toBe(
      "20 recent notes. Listed in the timeline above.",
    );
  });

  it("says a card with nothing recorded is empty", async () => {
    shell();
    stubApi({ [REPORT]: report([]) });
    await mount();
    expect(stateOf("activities")).toBe("No activities recorded yet.");
    expect(stateOf("notes")).toBe("No notes recorded yet.");
  });

  it("renders successful activity and note projections independently when the other request fails", async () => {
    shell();
    const api = stubApi({
      [REPORT]: ({ url }) =>
        url.searchParams.get("kind") === "activity"
          ? problemResponse(503, { detail: "offline" })
          : page("note", 1),
    });
    await mount();
    expect(section("activities").dataset.sectionState).toBe("error");
    expect(stateOf("activities")).toBe(
      "Activities could not be loaded. Saved activity is unchanged.",
    );
    expect(retry("activities").hidden).toBe(false);
    expect(retry("activities").getAttribute("aria-controls")).toBe(
      "person-activities-list",
    );
    expect(retry("notes").hidden).toBe(true);
    expect(stateOf("notes")).toBe(
      "1 recent note. Listed in the timeline above.",
    );
    expect(section("notes").dataset.sectionState).toBe("ready");

    api.route(
      REPORT,
      ({ url }) => page(url.searchParams.get("kind") as "activity" | "note", 1),
    );
    fireEvent.click(
      within(section("activities")).getByRole("button", {
        name: "Retry activities",
      }),
    );
    expect(section("activities").dataset.sectionState).toBe("loading");
    expect(stateOf("activities")).toBe("Loading recent activities…");
    expect(retry("activities").hidden).toBe(true);
    await waitFor(() =>
      expect(stateOf("activities")).toBe(
        "1 recent activity. Listed in the timeline above.",
      )
    );
    expect(section("activities").dataset.sectionState).toBe("ready");
    expect(stateOf("notes")).toBe(
      "1 recent note. Listed in the timeline above.",
    );
  });

  it("retries only the notes card when only its read failed", async () => {
    shell();
    let noteAttempts = 0;
    stubApi({
      [REPORT]: ({ url }) => {
        if (url.searchParams.get("kind") === "activity") {
          return page("activity", 1);
        }
        noteAttempts += 1;
        return noteAttempts === 1
          ? problemResponse(503, { detail: "offline" })
          : page("note", 1);
      },
    });
    await mount();
    expect(stateOf("notes")).toBe(
      "Notes could not be loaded. Saved notes are unchanged.",
    );
    expect(section("notes").dataset.sectionState).toBe("error");
    fireEvent.click(retry("notes"));
    await waitFor(() =>
      expect(stateOf("notes")).toBe(
        "1 recent note. Listed in the timeline above.",
      )
    );
    expect(stateOf("activities")).toBe(
      "1 recent activity. Listed in the timeline above.",
    );
    expect(section("activities").dataset.sectionState).toBe("ready");
  });

  it("keeps a newer profile retry when an older retry resolves last", async () => {
    shell();
    const older = deferred<Response>();
    let activityCalls = 0;
    stubApi({
      [REPORT]: ({ url }) => {
        if (url.searchParams.get("kind") === "note") return report([]);
        activityCalls += 1;
        return activityCalls === 1
          ? problemResponse(503)
          : activityCalls === 2
          ? older.promise
          : page("activity", 2, "Newest retry");
      },
    });
    await mount();
    fireEvent.click(retry("activities"));
    expect(section("activities").dataset.sectionState).toBe("loading");
    fireEvent.click(retry("activities"));
    await waitFor(() =>
      expect(stateOf("activities")).toBe(
        "2 recent activities. Listed in the timeline above.",
      )
    );
    await act(async () => {
      older.resolve(page("activity", 1, "Older retry"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stateOf("activities")).toBe(
      "2 recent activities. Listed in the timeline above.",
    );
    expect(section("activities").dataset.sectionState).toBe("ready");
    expect(section("notes").dataset.sectionState).toBe("ready");
  });

  it("returns only the retried profile section from loading to error", async () => {
    shell();
    const retried = deferred<Response>();
    let activityCalls = 0;
    stubApi({
      [REPORT]: ({ url }) => {
        if (url.searchParams.get("kind") === "note") return report([]);
        activityCalls += 1;
        return activityCalls === 2 ? retried.promise : problemResponse(503);
      },
    });
    await mount();
    expect(section("activities").dataset.sectionState).toBe("error");
    expect(section("notes").dataset.sectionState).toBe("ready");
    fireEvent.click(retry("activities"));
    expect(section("activities").dataset.sectionState).toBe("loading");
    expect(section("notes").dataset.sectionState).toBe("ready");
    retried.resolve(problemResponse(503, { detail: "still offline" }));
    await waitFor(() =>
      expect(section("activities").dataset.sectionState).toBe("error")
    );
    expect(section("notes").dataset.sectionState).toBe("ready");
  });

  it("prevents an older overlapping profile projection from replacing both newer sections", async () => {
    shell();
    const olderActivity = deferred<Response>();
    const olderNote = deferred<Response>();
    let calls = 0;
    stubApi({
      [REPORT]: ({ url }) => {
        const kind = url.searchParams.get("kind") as "activity" | "note";
        calls += 1;
        if (calls === 3) return olderActivity.promise;
        if (calls === 4) return olderNote.promise;
        return page(kind, calls <= 2 ? 1 : 2);
      },
    });
    await mount();
    created();
    await waitFor(() => expect(calls).toBe(4));
    created();
    await waitFor(() =>
      expect(stateOf("activities")).toBe(
        "2 recent activities. Listed in the timeline above.",
      )
    );
    await waitFor(() =>
      expect(stateOf("notes")).toBe(
        "2 recent notes. Listed in the timeline above.",
      )
    );
    await act(async () => {
      olderActivity.resolve(page("activity", 3));
      olderNote.resolve(page("note", 3));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stateOf("activities")).toBe(
      "2 recent activities. Listed in the timeline above.",
    );
    expect(stateOf("notes")).toBe(
      "2 recent notes. Listed in the timeline above.",
    );
  });

  it("hides each disabled profile interaction card and keeps the other intended action", async () => {
    shell();
    const api = stubApi({ [REPORT]: report([]) });
    await mount({ hidden: ["activities"] });
    wire();
    expect(section("activities").hidden).toBe(true);
    expect(section("activities").dataset.sectionState).toBe("hidden");
    expect(stateOf("activities")).toBe(
      "Activities are hidden by workspace personalization.",
    );
    expect(section("notes").hidden).toBe(false);
    expect(section("notes").dataset.sectionState).toBe("ready");
    for (const where of ["header", "main"] as const) {
      expect(shortcut(where, "activity").hidden).toBe(true);
      expect(shortcut(where, "note").hidden).toBe(false);
    }
    expect(api.calls()).toEqual([
      `GET /api/v1/people/${personId}/activity-report?kind=note&limit=20`,
    ]);
    created();
    await waitFor(() => expect(api.calls()).toHaveLength(2));
    expect(api.calls()[1]).toContain("kind=note");
  });

  it("keeps profile interaction shortcuts aligned with matching lifecycle events", async () => {
    shell();
    stubApi({ [REPORT]: report([]) });
    await mount({ hidden: ["notes"] });
    wire();
    const otherId = "00000000-0000-4000-8000-000000000101";
    const activityShortcuts = () =>
      (["header", "main"] as const).map((where) => shortcut(where, "activity"));
    const noteShortcuts = () =>
      (["header", "main"] as const).map((where) => shortcut(where, "note"));
    // This island owns whether a shortcut shows; Quick capture owns
    // whether it works.
    const state = (buttons: readonly HTMLButtonElement[]) =>
      buttons.map((button) => button.hidden);
    expect(state(activityShortcuts())).toEqual([false, false]);
    expect(state(noteShortcuts())).toEqual([true, true]);
    lifecycle(otherId, true);
    expect(state(activityShortcuts())).toEqual([false, false]);
    lifecycle(personId, true);
    lifecycle(personId, true);
    expect(state(activityShortcuts())).toEqual([true, true]);
    expect(state(noteShortcuts())).toEqual([true, true]);
    lifecycle(personId, false);
    expect(state(activityShortcuts())).toEqual([false, false]);
    expect(state(noteShortcuts())).toEqual([true, true]);
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { personId },
        }),
      );
    });
    expect(state(activityShortcuts())).toEqual([false, false]);
  });

  it("keeps a shortcut disabled until Quick capture has wired it, and never writes disabled itself", async () => {
    shell();
    stubApi({ [REPORT]: report([]) });
    await mount();
    expect(shortcut("header", "activity").hidden).toBe(false);
    expect(shortcut("header", "activity").disabled).toBe(true);
    expect(shortcut("main", "note").disabled).toBe(true);
    wire();
    expect(shortcut("header", "activity").disabled).toBe(false);
    lifecycle(personId, true);
    expect(shortcut("header", "activity").hidden).toBe(true);
    // Quick capture's observer, not this island, disables a hidden opener.
    expect(shortcut("header", "activity").disabled).toBe(false);
  });

  it("contains person projection outages without replacing saved data", async () => {
    shell();
    stubApi({ [REPORT]: unreachable });
    await mount();
    expect(stateOf("activities")).toBe(
      "Activities could not be loaded. Saved activity is unchanged.",
    );
    expect(stateOf("notes")).toBe(
      "Notes could not be loaded. Saved notes are unchanged.",
    );
  });

  it("reads both cards again whenever Quick capture records an interaction", async () => {
    shell();
    let calls = 0;
    stubApi({
      [REPORT]: ({ url }) => {
        calls += 1;
        return page(url.searchParams.get("kind") as "activity" | "note", 1);
      },
    });
    await mount();
    expect(calls).toBe(2);
    created();
    await waitFor(() => expect(calls).toBe(4));
    created();
    await waitFor(() => expect(calls).toBe(6));
    await waitFor(() =>
      expect(stateOf("activities")).toBe(
        "1 recent activity. Listed in the timeline above.",
      )
    );
  });
});
