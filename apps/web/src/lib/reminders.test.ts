// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPersonReminders, mountTodayReminders } from "./reminders.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const reminderId = "00000000-0000-4000-8000-000000000900";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function personMarkup(): void {
  document.body.innerHTML = `
    <p data-reminder-state></p><ul data-reminder-list></ul>
    <form data-reminder-form><input name="title"><input name="anchorOn"><input name="sendTime"><select name="recurrenceUnit"><option value="month">month</option></select><input name="recurrenceInterval"><button type="submit">Save</button></form>
    <p data-cadence-state></p><ul data-cadence-list></ul>
    <form data-cadence-form><input name="intervalCount"><select name="intervalUnit"><option value="month">month</option></select><button type="submit">Save</button></form>`;
}

function todayMarkup(): void {
  document.body.innerHTML = `
    <p id="today-reminders-state"></p><ul id="today-reminders-list"></ul><button id="today-reminders-retry" hidden>Retry</button>
    <p id="today-cadences-state"></p><ul id="today-cadences-list"></ul>`;
  sessionStorage.setItem(
    "kinship.workspace.session",
    JSON.stringify({
      member: { id: "member", role: "member" },
      principal: { userId: "user" },
      status: "authenticated",
      workspace: { id: workspaceId, name: "Circle" },
      workspaces: [{ id: workspaceId, name: "Circle" }],
    }),
  );
}

const reminder = {
  anchorOn: "2026-08-20",
  createdAt: "2026-08-18T10:00:00.000Z",
  id: reminderId,
  isActive: true,
  nextOccurrence: {
    attemptCount: 0,
    deliverAt: "2026-08-20T07:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000901",
    occursOn: "2026-08-20",
    status: "pending",
  },
  personId,
  recurrenceInterval: 1,
  recurrenceUnit: "month",
  sendTime: "09:00:00",
  title: "Call Ada",
  updatedAt: "2026-08-18T10:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("PLANNING-002 reminder browser behavior", () => {
  it("loads reminder and cadence and keeps archived mutations disabled", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [{
          id: "cadence",
          intervalCount: 1,
          intervalUnit: "month",
          nextDueAt: "2026-09-18T10:00:00.000Z",
          personId,
        }],
        reminders: [{
          ...reminder,
          nextOccurrence: {
            ...reminder.nextOccurrence,
            status: "sent",
            visibleAt: "2026-08-20T07:00:01.000Z",
          },
        }],
        status: "ready",
      })),
    );
    await mountPersonReminders({ archived: true, personId, workspaceId });
    expect(document.querySelector("[data-reminder-list]")?.textContent)
      .toContain("Call Ada");
    expect(document.querySelector("[data-reminder-list]")?.textContent)
      .toContain("Notification visible");
    expect(document.querySelector("[data-cadence-list]")?.textContent)
      .toContain("Every 1 month");
    expect(document.querySelectorAll("[data-reminder-list] button"))
      .toHaveLength(0);
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-reminder-form] [type=submit]",
      )?.disabled,
    ).toBe(true);
  });

  it("reuses the reminder request id after an ambiguous create failure", async () => {
    personMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ cadences: [], reminders: [], status: "ready" }),
      )
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(response({ reminder, status: "created" }, 201))
      .mockResolvedValueOnce(
        response({ cadences: [], reminders: [reminder], status: "ready" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonReminders({ archived: false, personId, workspaceId });
    const form = document.querySelector<HTMLFormElement>(
      "[data-reminder-form]",
    )!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Call Ada";
    (form.elements.namedItem("anchorOn") as HTMLInputElement).value =
      "2026-08-20";
    (form.elements.namedItem("sendTime") as HTMLInputElement).value = "09:00";
    (form.elements.namedItem("recurrenceInterval") as HTMLInputElement).value =
      "1";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[data-reminder-state]")?.textContent)
        .toContain("could not")
    );
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const posts = fetchMock.mock.calls.filter((call) =>
      call[1]?.method === "POST"
    );
    expect(posts).toHaveLength(2);
    expect(JSON.parse(String(posts[1]?.[1]?.body)).requestId).toBe(
      JSON.parse(String(posts[0]?.[1]?.body)).requestId,
    );
  });

  it("becomes read-only immediately when the person lifecycle changes", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [],
        reminders: [reminder],
        status: "ready",
      })),
    );
    await mountPersonReminders({ archived: false, personId, workspaceId });

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: true, personId, state: "archived" },
      }),
    );

    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-reminder-form] [type=submit]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-cadence-form] [type=submit]",
      )?.disabled,
    ).toBe(true);
    expect(document.querySelectorAll("[data-reminder-list] button"))
      .toHaveLength(0);
  });

  it("shows manual-attention delivery and independent cadence state on Today", async () => {
    todayMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          member: { id: "member", role: "member" },
          principal: { userId: "user" },
          status: "authenticated",
          workspace: { id: workspaceId, name: "Circle" },
          workspaces: [{ id: workspaceId, name: "Circle" }],
        }))
        .mockResolvedValueOnce(response({
          cadences: [{
            dueAt: "2026-08-18T08:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000903",
            person: { archived: false, id: personId, name: "Ada Lovelace" },
          }],
          reminders: [{
            attemptCount: 3,
            deliverAt: "2026-08-18T08:00:00.000Z",
            id: reminderId,
            person: { archived: false, id: personId, name: "Ada Lovelace" },
            status: "manual_attention",
            title: "Call Ada",
          }, {
            attemptCount: 1,
            deliverAt: "2026-08-18T09:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000902",
            person: { archived: false, id: personId, name: "Ada Lovelace" },
            status: "sent",
            title: "Visible reminder",
            visibleAt: "2026-08-18T09:00:01.000Z",
          }],
          status: "ready",
          timezone: "Europe/Belgrade",
        })),
    );
    await mountTodayReminders();
    expect(document.querySelector("#today-reminders-list")?.textContent)
      .toContain("Delivery needs manual attention");
    expect(document.querySelector("#today-reminders-list")?.textContent)
      .toContain("Notification visible");
    expect(document.querySelector("#today-cadences-list")?.textContent)
      .toContain("Ada Lovelace");
  });
});
