// @vitest-environment happy-dom

import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatInstant } from "../../../lib/time-presentation.ts";
import { mountUnsavedChangesGuard } from "../../../lib/unsaved-changes.ts";
import {
  type ApiAnswer,
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  type StubbedApi,
  unreachable,
} from "../../../testing/api.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  ids,
  personProfile,
  preferences,
  profileSummary,
  sectionProps,
} from "../../../testing/fixtures.ts";
import {
  chooseOptions,
  drawShell,
  element,
  mountPending,
  mountSection,
} from "../../../testing/render.tsx";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import { mountPersonCommunications } from "./mount.tsx";

const personId = ids.person;
const channelTypeId = "00000000-0000-4000-8000-000000000200";
const contactMethodId = "00000000-0000-4000-8000-000000000300";
const emotionId = "00000000-0000-4000-8000-000000000400";
const HISTORY = "GET /api/v1/people/:personId/communications";
const OPTIONS = "GET /api/v1/communication-options";
const CONTACTS = "GET /api/v1/people/:personId/facts/contact-methods";
const SAVE = "POST /api/v1/interactions";
const utc = { effectiveTimezone: "UTC", locale: "en" };

// The hero's last contact is the hero island's: this surface publishes it.
let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => {
  summary.stop();
});

/** Both cards as the static shell draws them before the island hydrates. */
function shell(): void {
  drawShell(`
    <nav><ul>
      <li><a data-section-link="calls"></a></li>
      <li><a data-section-link="conversations"></a></li>
    </ul></nav>
    <main>
      ${
    (["call", "conversation"] as const).map((kind) => {
      const id = kind === "call" ? "calls" : "conversations";
      return `<section id="profile-section-${id}" class="profile-section-card communication-section-card" data-profile-section="${id}" data-communication-kind="${kind}" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-${id}-heading">
          <header class="profile-section-heading"><div class="profile-section-title"><h3 id="profile-section-${id}-heading">${
        kind === "call" ? "Calls" : "Conversations"
      }</h3><span data-communication-badge>Loading</span></div><button data-communication-add type="button" hidden>Log ${kind}</button></header>
          <p data-communication-state class="section-state">Loading ${id}…</p>
          <form data-communication-form hidden novalidate></form>
        </section>`;
    }).join("")
  }
    </main>`);
}

const history = (items: readonly unknown[] = []) =>
  jsonResponse({ items, status: "ready" });

const communicationOptions = (emotions: readonly unknown[] = []) =>
  jsonResponse({
    availability: { call: true, conversation: true },
    channelTypes: [{ id: channelTypeId, name: "Email" }],
    emotions,
    status: "ready",
  });

const contactMethods = (records: readonly unknown[] = []) =>
  jsonResponse({
    options: [],
    personUpdatedAt: new Date().toISOString(),
    records,
    status: "ready",
  });

const emailMethod = {
  id: contactMethodId,
  section: "contact-methods",
  updatedAt: new Date().toISOString(),
  value: {
    isPrimary: true,
    labelIds: [],
    section: "contact-methods",
    typeId: channelTypeId,
    value: "ada@example.test",
  },
};

const callRecord = (extra: Record<string, unknown> = {}) => ({
  calledAt: "2026-08-16T18:15:00.000Z",
  contactWasCaller: true,
  createdAt: "2026-08-16T18:15:00.000Z",
  emotions: [],
  id: crypto.randomUUID(),
  kind: "call",
  person: { id: personId, name: "Ada" },
  ...extra,
});

const conversationRecord = (extra: Record<string, unknown> = {}) => ({
  channelType: { id: channelTypeId, name: "Email" },
  createdAt: "2026-08-16T19:15:00.000Z",
  happenedAt: "2026-08-16T19:15:00.000Z",
  id: crypto.randomUUID(),
  kind: "conversation",
  messages: [],
  person: { id: personId, name: "Ada" },
  ...extra,
});

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

const created = (record: unknown) =>
  jsonResponse({ record, status: "created" }, 201);

function stub(routes: Record<string, ApiAnswer | readonly ApiAnswer[]>) {
  return stubApi({
    [CONTACTS]: contactMethods(),
    [HISTORY]: history(),
    [OPTIONS]: communicationOptions(),
    ...routes,
  });
}

const mount = (
  archived = false,
  hidden: readonly string[] = [],
  counted?: { readonly calls: number; readonly conversations: number },
  lastContactAt?: string,
) =>
  mountSection(
    mountPersonCommunications,
    sectionProps({
      archived,
      initial: personProfile({
        person: {
          ...(lastContactAt ? { lastContactAt } : {}),
          profileSections: hidden.map((id) => ({
            id: id as "calls",
            status: "hidden" as const,
          })),
        },
        ...(counted
          ? {
            summary: profileSummary({
              sectionCounts: [
                { count: counted.calls, id: "calls", status: "ready" },
                {
                  count: counted.conversations,
                  id: "conversations",
                  status: "ready",
                },
              ],
            }),
          }
          : {}),
      }),
      preferences: {
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        measurementSystem: "metric",
        reminderDelivery: "in_app",
        temperatureScale: "celsius",
        ...utc,
      },
    }),
  );

const card = (kind: "call" | "conversation") =>
  element(`[data-communication-kind="${kind}"]`);
const view = (kind: "call" | "conversation") => within(card(kind));
const cardForm = (kind: "call" | "conversation") =>
  element<HTMLFormElement>("form", card(kind));
const input = <T extends HTMLElement>(
  kind: "call" | "conversation",
  name: string,
) => element<T>(`[name="${name}"]`, cardForm(kind));
const add = (kind: "call" | "conversation") =>
  element<HTMLButtonElement>("[data-communication-add]", card(kind));
const cancel = (kind: "call" | "conversation") =>
  element<HTMLButtonElement>("[data-communication-cancel]", card(kind));
const notice = (kind: "call" | "conversation") =>
  element("[data-communication-form-state]", card(kind));
const stateLine = (kind: "call" | "conversation") =>
  element("[data-communication-state]", card(kind)).textContent;
const set = (target: HTMLElement, value: string) =>
  fireEvent.change(target, { target: { value } });
const submit = (kind: "call" | "conversation") =>
  fireEvent.submit(cardForm(kind));
const posts = (api: StubbedApi) =>
  api.requests().filter((request) => request.method === "POST").map((
    request,
  ) => request.body as Record<string, unknown>);
const count = (api: StubbedApi, suffix: string) =>
  api.requests().filter((request) => request.url.pathname.endsWith(suffix))
    .length;
const lifecycle = (detail: Record<string, unknown>) =>
  act(() => {
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", { detail }),
    );
  });

describe("INTERACTION-002 person communications", () => {
  it("FEQ-04 reads nothing for cards the summary counted empty, and loads the options when an editor opens", async () => {
    shell();
    const api = stub({ [SAVE]: created(callRecord()) });
    await mount(false, [], { calls: 0, conversations: 0 });
    expect(api.calls()).toEqual([]);
    expect(stateLine("call")).toBe("No calls recorded yet.");
    expect(stateLine("conversation")).toBe("No conversations recorded yet.");
    expect(card("call").dataset.sectionState).toBe("ready");
    fireEvent.click(add("call"));
    await waitFor(() => expect(notice("call").textContent).toBe(""));
    expect(api.calls()).toEqual(["GET /api/v1/communication-options"]);
    set(input("call", "happenedAt"), "2026-08-16T18:15");
    submit("call");
    await waitFor(() => expect(notice("call").textContent).toBe("Call saved."));
    // FEQ-10: the saved record is counted, and it says when Ada was last in
    // contact, so nothing is read again.
    expect(stateLine("call")).toBe(
      "1 recent call. Listed in the timeline above.",
    );
    expect(summary.vital("last-contact")).toBe(
      formatInstant("2026-08-16T18:15:00.000Z", utc),
    );
    expect(api.calls()).toEqual([
      "GET /api/v1/communication-options",
      "POST /api/v1/interactions",
    ]);
  });

  it("FEQ-10 keeps a later last contact the page already knows", async () => {
    shell();
    const api = stub({ [SAVE]: created(callRecord()) });
    await mount(false, [], undefined, "2026-08-20T12:00:00.000Z");
    expect(api.calls()).toEqual([
      `GET /api/v1/people/${personId}/communications`,
    ]);
    fireEvent.click(add("call"));
    await waitFor(() => expect(notice("call").textContent).toBe(""));
    submit("call");
    await waitFor(() => expect(notice("call").textContent).toBe("Call saved."));
    expect(summary.vital("last-contact")).toBe(
      formatInstant("2026-08-20T12:00:00.000Z", utc),
    );
    expect(count(api, "/communications")).toBe(1);
    expect(count(api, `/people/${personId}`)).toBe(0);
  });

  it("keeps successful communication cards ready while their records are listed in the timeline", async () => {
    shell();
    stub({ [HISTORY]: history([callRecord(), conversationRecord()]) });
    await mount();
    const root = card("call");
    expect(root.dataset.island).toBe("person-communications");
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    for (
      const [kind, text] of [
        ["call", "1 recent call. Listed in the timeline above."],
        [
          "conversation",
          "1 recent conversation. Listed in the timeline above.",
        ],
      ] as const
    ) {
      const list = element<HTMLUListElement>(
        "[data-communication-list]",
        card(kind),
      );
      expect(list.hidden).toBe(true);
      expect(list.children).toHaveLength(0);
      expect(stateLine(kind)).toBe(text);
      expect(card(kind).dataset.sectionState).toBe("ready");
      expect(element("[data-communication-badge]", card(kind)).textContent)
        .toBe("1 recent");
      expect(
        view(kind).getByRole("heading", { level: 3 }).id,
      ).toBe(
        `profile-section-${
          kind === "call" ? "calls" : "conversations"
        }-heading`,
      );
    }
    await expectNoAxeViolations(element("main"));
  });

  it("says a card is empty and hides a card whose module is turned off", async () => {
    shell();
    stub({});
    await mount(false, ["conversations"]);
    expect(stateLine("call")).toBe("No calls recorded yet.");
    expect(element("[data-communication-badge]", card("call")).textContent)
      .toBe("Empty");
    expect(card("call").hidden).toBe(false);
    expect(card("conversation").hidden).toBe(true);
  });

  it("loads contact methods only when the conversation editor opens", async () => {
    shell();
    const contacts = deferred<Response>();
    const api = stub({
      [CONTACTS]: [contacts.promise, contactMethods(), contactMethods()],
    });
    await mount();
    expect(count(api, "/facts/contact-methods")).toBe(0);
    const method = input<HTMLSelectElement>("conversation", "contactMethodId");
    fireEvent.click(
      view("conversation").getByRole("button", {
        name: "Log conversation",
      }),
    );
    await waitFor(() => expect(count(api, "/facts/contact-methods")).toBe(1));
    expect(cardForm("conversation").hidden).toBe(false);
    expect(document.activeElement).toBe(input("conversation", "happenedAt"));
    expect(notice("conversation").textContent).toBe(
      "Loading specific contact methods…",
    );
    expect(method.disabled).toBe(true);
    contacts.resolve(problemResponse(503));
    await waitFor(() =>
      expect(notice("conversation").textContent).toContain(
        "could not be loaded",
      )
    );
    expect(input<HTMLSelectElement>("conversation", "contactMethodId").disabled)
      .toBe(true);
    expect(card("conversation").dataset.sectionState).toBe("ready");
    fireEvent.click(cancel("conversation"));
    expect(document.activeElement).toBe(add("conversation"));
    fireEvent.click(add("conversation"));
    await waitFor(() =>
      expect(
        input<HTMLSelectElement>("conversation", "contactMethodId").disabled,
      ).toBe(false)
    );
    expect(count(api, "/facts/contact-methods")).toBe(2);
    expect(notice("conversation").textContent).toBe("");
    fireEvent.click(cancel("conversation"));
    fireEvent.click(add("conversation"));
    await Promise.resolve();
    expect(count(api, "/facts/contact-methods")).toBe(2);
  });

  it("records a call with source direction/emotion and refreshes its embedded projection", async () => {
    shell();
    let saved = false;
    const timeline: unknown[] = [];
    document.addEventListener(
      "person-timeline-changed",
      (event) => timeline.push((event as CustomEvent).detail),
      { once: true },
    );
    const api = stub({
      [HISTORY]: () =>
        history(
          saved
            ? [callRecord({
              content: "Planned visit",
              emotions: [{ id: emotionId, name: "Joy" }],
            })]
            : [],
        ),
      [OPTIONS]: communicationOptions([{ id: emotionId, name: "Joy" }]),
      [SAVE]: ({ body }) => {
        saved = true;
        return created(callRecord(body as Record<string, unknown>));
      },
    });
    await mount();
    fireEvent.click(view("call").getByRole("button", { name: "Log call" }));
    // The editor's options load when it opens (FEQ-04).
    await waitFor(() => expect(notice("call").textContent).toBe(""));
    const form = within(cardForm("call"));
    set(form.getByLabelText("When it happened"), "2026-08-16T18:15");
    set(form.getByLabelText("Call direction"), "contact");
    set(form.getByLabelText("Details (optional)"), "Planned visit");
    chooseOptions(form.getByLabelText("Emotions (optional)"), [emotionId]);
    submit("call");
    await waitFor(() =>
      expect(stateLine("call")).toBe(
        "1 recent call. Listed in the timeline above.",
      )
    );
    expect(posts(api)[0]).toMatchObject({
      calledAt: new Date("2026-08-16T18:15").toISOString(),
      content: "Planned visit",
      contactWasCaller: true,
      emotionIds: [emotionId],
      kind: "call",
      personId,
    });
    expect(element("[data-communication-badge]", card("call")).textContent)
      .toBe("1 recent");
    await waitFor(() => expect(notice("call").textContent).toBe("Call saved."));
    expect(timeline).toEqual([{ personIds: [personId] }]);
    // The saved call is the person's last contact (FEQ-10).
    expect(summary.vital("last-contact")).toBe(
      formatInstant(new Date("2026-08-16T18:15").toISOString(), utc),
    );
    expect(count(api, `/people/${personId}`)).toBe(0);
    expect(cardForm("call").hidden).toBe(false);
  });

  it("submits multiple directed messages and permits an unknown-direction empty thread", async () => {
    shell();
    const api = stub({
      [CONTACTS]: contactMethods([emailMethod]),
      [SAVE]: created(conversationRecord()),
    });
    await mount();
    fireEvent.click(add("conversation"));
    await waitFor(() =>
      expect(
        input<HTMLSelectElement>("conversation", "contactMethodId").disabled,
      ).toBe(false)
    );
    const form = within(cardForm("conversation"));
    set(form.getByLabelText("When it happened"), "2026-08-16T18:15");
    set(form.getByLabelText("Channel"), channelTypeId);
    set(
      form.getByLabelText("Specific contact method (optional)"),
      contactMethodId,
    );
    set(form.getByLabelText("Title (optional)"), "Travel details");
    submit("conversation");
    await waitFor(() => expect(posts(api)).toHaveLength(1));
    await waitFor(() =>
      expect(
        form.getByRole("button", { name: "Save conversation" }).hasAttribute(
          "disabled",
        ),
      )
        .toBe(false)
    );
    expect(posts(api)[0]).toMatchObject({
      channelTypeId,
      contactMethodId,
      kind: "conversation",
      messages: [],
      title: "Travel details",
    });
    fireEvent.click(form.getByRole("button", { name: "Add message" }));
    fireEvent.click(form.getByRole("button", { name: "Add message" }));
    const rows = [
      ...cardForm("conversation").querySelectorAll<HTMLElement>(
        "[data-message-row]",
      ),
    ];
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) =>
        within(row).getByRole("button", { name: "Remove message" })
          .className === buttonVariants({ variant: "destructive" })
      ),
    ).toBe(true);
    set(within(rows[0]!).getByRole("textbox", { name: "Message" }), "Hello");
    set(within(rows[1]!).getByRole("textbox", { name: "Message" }), " Hi ");
    set(within(rows[1]!).getByLabelText("Direction"), "inbound");
    submit("conversation");
    await waitFor(() => expect(posts(api)).toHaveLength(2));
    expect(posts(api)[1]!["messages"]).toEqual([
      {
        content: "Hello",
        direction: "outbound",
        writtenAt: expect.any(String),
      },
      { content: "Hi", direction: "inbound", writtenAt: expect.any(String) },
    ]);
    expect(posts(api)[1]!["requestId"]).not.toBe(posts(api)[0]!["requestId"]);
    fireEvent.click(
      within(rows[0]!).getByRole("button", { name: "Remove message" }),
    );
    expect(
      cardForm("conversation").querySelectorAll("[data-message-row]"),
    ).toHaveLength(1);
    set(form.getByLabelText("Channel"), "");
    expect(
      form.getByLabelText<HTMLSelectElement>(
        "Specific contact method (optional)",
      ).options,
    ).toHaveLength(1);
  });

  it("serializes a delayed double-submit and reuses its request key after failure", async () => {
    shell();
    const releases: Array<() => void> = [];
    const api = stub({
      [SAVE]: async () => {
        await new Promise<void>((resolve) => releases.push(resolve));
        return problemResponse(503, { detail: "Try again." });
      },
    });
    await mount();
    fireEvent.click(add("call"));
    set(input("call", "happenedAt"), "2026-08-16T18:15");
    submit("call");
    submit("call");
    await waitFor(() => expect(posts(api)).toHaveLength(1));
    await Promise.resolve();
    expect(posts(api)).toHaveLength(1);
    expect(
      view("call").getByRole("button", { name: "Save call" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    releases.splice(0).forEach((release) => release());
    await waitFor(() => expect(notice("call").textContent).toBe("Try again."));
    submit("call");
    await waitFor(() => expect(posts(api)).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    expect(posts(api)[1]!["requestId"]).toBe(posts(api)[0]!["requestId"]);
  });

  it("FEQ-10 takes last contact from the saved record, for backdated occurrences and later messages", async () => {
    shell();
    const api = stub({
      [SAVE]: ({ body }) => {
        const input = body as {
          readonly happenedAt: string;
          readonly messages: readonly { readonly writtenAt: string }[];
        };
        return created(conversationRecord({
          happenedAt: input.happenedAt,
          messages: input.messages.map((message, index) => ({
            content: "Later",
            direction: "outbound",
            id: `message-${index}`,
            writtenAt: message.writtenAt,
          })),
        }));
      },
    });
    await mount(false, [], undefined, "2026-08-20T12:00:00.000Z");
    fireEvent.click(add("conversation"));
    await waitFor(() => expect(notice("conversation").textContent).toBe(""));
    set(input("conversation", "channelTypeId"), channelTypeId);
    set(input("conversation", "happenedAt"), "2026-08-16T18:15");
    submit("conversation");
    await waitFor(() =>
      expect(notice("conversation").textContent).toBe("Conversation saved.")
    );
    // A backdated conversation leaves the later last contact as it was.
    expect(summary.vital("last-contact")).toBe(
      formatInstant("2026-08-20T12:00:00.000Z", utc),
    );
    fireEvent.click(
      view("conversation").getByRole("button", {
        name: "Add message",
      }),
    );
    const row = element("[data-message-row]", card("conversation"));
    set(within(row).getByRole("textbox", { name: "Message" }), "Later");
    set(within(row).getByLabelText("Written at"), "2026-08-22T12:00");
    submit("conversation");
    await waitFor(() =>
      expect(summary.vital("last-contact")).toBe(
        formatInstant(new Date("2026-08-22T12:00").toISOString(), utc),
      )
    );
    expect(count(api, `/people/${personId}`)).toBe(0);
    expect(count(api, "/communications")).toBe(1);
  });

  it("retries a rejected initial load from a visible section control without duplicate handlers", async () => {
    shell();
    const api = stub({
      [HISTORY]: [
        unreachable,
        history([callRecord(), conversationRecord()]),
      ],
    });
    await mount();
    for (const kind of ["call", "conversation"] as const) {
      expect(stateLine(kind)).toBe(
        "Communication could not be loaded. Saved data was not changed.",
      );
      expect(card(kind).dataset.sectionState).toBe("error");
      expect(element("[data-communication-badge]", card(kind)).textContent)
        .toBe("Unavailable");
    }
    const retries = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[data-communication-load-retry]",
      ),
    ];
    expect(retries).toHaveLength(2);
    expect(retries.every((retry) => !retry.hidden)).toBe(true);
    fireEvent.click(retries[0]!);
    expect(stateLine("call")).toBe("Loading calls…");
    await waitFor(() =>
      expect(
        [...document.querySelectorAll<HTMLElement>("[data-communication-kind]")]
          .every((section) => section.dataset.sectionState === "ready"),
      ).toBe(true)
    );
    expect(stateLine("call")).toBe(
      "1 recent call. Listed in the timeline above.",
    );
    expect(stateLine("conversation")).toBe(
      "1 recent conversation. Listed in the timeline above.",
    );
    expect(retries.every((retry) => retry.hidden)).toBe(true);
    expect(count(api, "/communication-options")).toBe(0);
    expect(count(api, "/communications")).toBe(2);
  });

  it("keeps the request key and focuses a retry state after an unknown POST outcome", async () => {
    shell();
    const api = stub({
      [SAVE]: [unreachable, problemResponse(503, { detail: "Try again." })],
    });
    await mount();
    fireEvent.click(add("call"));
    set(input("call", "happenedAt"), "2026-08-16T18:15");
    submit("call");
    await waitFor(() =>
      expect(notice("call").textContent).toBe(
        "Save outcome is unknown. Retry to safely check the same request.",
      )
    );
    expect(document.activeElement).toBe(notice("call"));
    submit("call");
    await waitFor(() => expect(posts(api)).toHaveLength(2));
    expect(posts(api)[1]!["requestId"]).toBe(posts(api)[0]!["requestId"]);
  });

  it.each([["unavailable", false], ["full", true]])(
    "reports a saved-but-degraded state when an %s history's refresh fails",
    async (_label, full) => {
      shell();
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      // A history that failed, or holds a full page, cannot simply count
      // the saved record, so it is read again (FEQ-10).
      let saved = false;
      let healthy = false;
      const api = stub({
        [HISTORY]: () =>
          healthy
            ? history()
            : full && !saved
            ? history(Array.from({ length: 50 }, () => callRecord()))
            : offline(),
        [SAVE]: () => {
          saved = true;
          return created(callRecord({ contactWasCaller: false }));
        },
      });
      await mount();
      fireEvent.click(add("call"));
      await waitFor(() => expect(notice("call").textContent).toBe(""));
      const occurrence = input<HTMLInputElement>("call", "happenedAt");
      occurrence.focus();
      set(occurrence, "2026-08-16T18:15");
      fireEvent.input(cardForm("call"));
      expect(
        globalThis.dispatchEvent(
          new Event("beforeunload", { cancelable: true }),
        ),
      ).toBe(false);
      // The saved form is rebaselined for the page's guard. (happy-dom hands
      // a React-rendered form's fields a different object for their form
      // than the form's own references, so the guard's own reading of it
      // cannot be asserted here.)
      const savedForms: EventTarget[] = [];
      document.body.addEventListener(
        "kinship:form-saved",
        (event) => savedForms.push(event.target!),
      );
      submit("call");
      await waitFor(() =>
        expect(notice("call").textContent).toBe(
          "Call saved, but the current view could not be refreshed. Retry refresh or reload the page.",
        )
      );
      expect(document.activeElement).toBe(notice("call"));
      expect(savedForms).toEqual([cardForm("call")]);
      const refresh = element<HTMLButtonElement>(
        "[data-communication-refresh]",
        card("call"),
      );
      expect(refresh.hidden).toBe(false);
      healthy = true;
      fireEvent.click(refresh);
      await waitFor(() =>
        expect(notice("call").textContent).toBe(
          "Communication view refreshed.",
        )
      );
      expect(refresh.hidden).toBe(true);
      expect(count(api, `/people/${personId}`)).toBe(0);
    },
  );

  it("keeps a failed refresh retry retryable", async () => {
    shell();
    const api = stub({ [HISTORY]: unreachable, [SAVE]: created(callRecord()) });
    await mount();
    fireEvent.click(add("call"));
    await waitFor(() => expect(notice("call").textContent).toBe(""));
    submit("call");
    await waitFor(() =>
      expect(notice("call").textContent).toMatch(/saved, but/)
    );
    const refresh = element<HTMLButtonElement>(
      "[data-communication-refresh]",
      card("call"),
    );
    fireEvent.click(refresh);
    expect(refresh.disabled).toBe(true);
    await waitFor(() =>
      expect(notice("call").textContent).toBe(
        "Saved communication still could not be refreshed. Retry or reload the page.",
      )
    );
    expect(refresh.hidden).toBe(false);
    expect(refresh.disabled).toBe(false);
    expect(document.activeElement).toBe(notice("call"));
    expect(count(api, "/communications")).toBe(3);
  });

  it("reports invalid occurrence and message timestamps without calling the API", async () => {
    shell();
    const api = stub({});
    await mount();
    fireEvent.click(add("call"));
    set(input("call", "happenedAt"), "");
    submit("call");
    await waitFor(() =>
      expect(notice("call").textContent).toBe("Choose a valid occurrence time.")
    );
    expect(document.activeElement).toBe(notice("call"));
    fireEvent.click(add("conversation"));
    set(input("conversation", "happenedAt"), "2026-08-16T18:15");
    set(input("conversation", "channelTypeId"), channelTypeId);
    fireEvent.click(
      view("conversation").getByRole("button", {
        name: "Add message",
      }),
    );
    const row = element("[data-message-row]", card("conversation"));
    set(within(row).getByRole("textbox", { name: "Message" }), "Hello");
    set(within(row).getByLabelText("Written at"), "");
    submit("conversation");
    await waitFor(() =>
      expect(notice("conversation").textContent).toBe(
        "Choose a valid message time.",
      )
    );
    expect(posts(api)).toHaveLength(0);
  });

  it("starts a cancelled draft over", async () => {
    shell();
    stub({});
    await mount();
    fireEvent.click(add("call"));
    set(input("call", "content"), "Not this one");
    fireEvent.click(cancel("call"));
    expect(cardForm("call").hidden).toBe(true);
    fireEvent.click(add("call"));
    expect(input<HTMLTextAreaElement>("call", "content").value).toBe("");
  });

  it("tracks matching in-page lifecycle changes without duplicate listeners", async () => {
    shell();
    const lost = deferred<Response>();
    const api = stub({
      [SAVE]: [
        lost.promise,
        problemResponse(409, {
          detail: "Person is active but the retry was rejected.",
        }),
      ],
    });
    await mount();
    fireEvent.click(add("call"));
    set(input("call", "happenedAt"), "2026-08-16T18:15");
    submit("call");
    fireEvent.click(add("conversation"));
    expect(cardForm("call").hidden).toBe(false);
    expect(cardForm("conversation").hidden).toBe(false);

    lifecycle({
      archived: true,
      personId: "00000000-0000-4000-8000-000000000999",
    });
    lifecycle({ personId });
    expect(cardForm("call").hidden).toBe(false);
    expect(cardForm("conversation").hidden).toBe(false);

    let archivedReads = 0;
    lifecycle({
      get archived() {
        archivedReads += 1;
        return true;
      },
      personId,
    });
    expect(archivedReads).toBe(1);
    for (const kind of ["call", "conversation"] as const) {
      expect(cardForm(kind).hidden).toBe(true);
      expect(add(kind).hidden).toBe(true);
      expect(add(kind).disabled).toBe(true);
    }

    lost.reject(new Error("response was lost"));
    await waitFor(() =>
      expect(notice("call").textContent).toContain("unknown")
    );
    expect(add("call").hidden).toBe(true);
    expect(add("call").disabled).toBe(true);

    lifecycle({ archived: false, personId });
    for (const kind of ["call", "conversation"] as const) {
      expect(add(kind).hidden).toBe(false);
      expect(add(kind).disabled).toBe(false);
    }
    fireEvent.click(add("call"));
    submit("call");
    await waitFor(() => expect(posts(api)).toHaveLength(2));
    expect(posts(api)[1]!["requestId"]).toBe(posts(api)[0]!["requestId"]);
  });

  it("offers no editor while the person is archived", async () => {
    shell();
    const api = stub({});
    await mount(true);
    for (const kind of ["call", "conversation"] as const) {
      expect(add(kind).hidden).toBe(true);
      expect(add(kind).disabled).toBe(true);
    }
    submit("call");
    expect(posts(api)).toHaveLength(0);
  });
});

describe("REL-052 person communications status lines", () => {
  // Mounted during the initial fan-out, the line waits for the workspace's
  // promotion (UXD-003B); mounted after it, the line is its own live region
  // from the first commit.
  it.each([false, true])(
    "owns each card's live region from its first commit only once states are live (%s)",
    async (live) => {
      shell();
      const answer = deferred<Response>();
      stub({ [HISTORY]: answer.promise });
      const settled = mountPending(() =>
        mountPersonCommunications(
          document.body,
          sectionProps({ preferences: preferences(), statesLive: () => live }),
        )
      );
      const lines = (["call", "conversation"] as const).map((kind) =>
        element("[data-communication-state]", card(kind))
      );
      for (const line of lines) {
        expect(line.getAttribute("role")).toBe(live ? "status" : null);
        expect(line.getAttribute("aria-live")).toBe(live ? "polite" : null);
      }
      await act(async () => {
        answer.resolve(history());
        await settled;
      });
      expect(lines.map((line) => line.isConnected)).toEqual([true, true]);
    },
  );
});
