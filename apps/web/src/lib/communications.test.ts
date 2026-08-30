// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountCommunications } from "./communications.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const channelTypeId = "00000000-0000-4000-8000-000000000200";
const contactMethodId = "00000000-0000-4000-8000-000000000300";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function markup(kind: "call" | "conversation") {
  return `<li><a data-section-link="${
    kind === "call" ? "calls" : "conversations"
  }"></a></li>
  <section data-communication-kind="${kind}" data-profile-section="${
    kind === "call" ? "calls" : "conversations"
  }">
    <span data-communication-badge></span><p data-communication-state></p><button data-communication-load-retry type="button" hidden>Retry loading communications</button><ul data-communication-list></ul>
    <button data-communication-add>${
    kind === "call" ? "Log call" : "Log conversation"
  }</button>
    <form data-communication-form hidden novalidate>
      <input name="happenedAt" type="datetime-local">
      ${
    kind === "call"
      ? `<select name="callDirection"><option value="contact">They called me</option><option value="member">I called them</option></select><textarea name="content"></textarea><select name="emotionIds" multiple></select>`
      : `<select name="channelTypeId"></select><select name="contactMethodId"></select><input name="title"><div data-message-rows></div><button data-add-message type="button">Add message</button>`
  }
      <p data-communication-form-state role="alert" tabindex="-1"></p><button type="submit">Save</button><button data-communication-cancel type="button">Cancel</button><button data-communication-refresh type="button" hidden>Retry refresh</button>
    </form>
  </section>`;
}

function communicationGet(
  url: URL,
  items: readonly unknown[] = [],
): Response | undefined {
  if (url.pathname.endsWith("/communication-options")) {
    return response({
      availability: { call: true, conversation: true },
      channelTypes: [{ id: channelTypeId, name: "Email" }],
      emotions: [],
      status: "ready",
    });
  }
  if (url.pathname.includes("/facts/contact-methods")) {
    return response({
      options: [],
      personUpdatedAt: new Date().toISOString(),
      records: [],
      status: "ready",
    });
  }
  if (url.pathname.endsWith("/communications")) {
    return response({ items, status: "ready" });
  }
  return undefined;
}

describe("INTERACTION-002 person communications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("loads contact methods only when the conversation editor opens", async () => {
    document.body.innerHTML = markup("call") + markup("conversation");
    let editorOpened = false;
    let contactCalls = 0;
    let releaseContacts!: (value: Response) => void;
    const contacts = new Promise<Response>((resolve) => {
      releaseContacts = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.includes("/facts/contact-methods")) {
          contactCalls += 1;
          if (!editorOpened) return Promise.resolve(communicationGet(url)!);
          return contactCalls === 1
            ? contacts
            : Promise.resolve(communicationGet(url)!);
        }
        const ready = communicationGet(url);
        if (ready) return Promise.resolve(ready);
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );

    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });

    expect(contactCalls).toBe(0);
    const conversation = document.querySelector<HTMLElement>(
      '[data-communication-kind="conversation"]',
    )!;
    const form = conversation.querySelector<HTMLFormElement>("form")!;
    const method = form.elements.namedItem(
      "contactMethodId",
    ) as HTMLSelectElement;
    editorOpened = true;
    conversation.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    await vi.waitFor(() => expect(contactCalls).toBe(1));
    expect(method.disabled).toBe(true);
    releaseContacts(response({
      detail: "Contact methods unavailable",
      status: 503,
      title: "Unavailable",
      type: "about:blank",
    }, 503));
    await vi.waitFor(() =>
      expect(
        form.querySelector("[data-communication-form-state]")?.textContent,
      ).toContain("could not be loaded")
    );
    expect(method.disabled).toBe(true);
    expect(conversation.dataset.sectionState).toBe("ready");
    conversation.querySelector<HTMLButtonElement>(
      "[data-communication-cancel]",
    )!.click();
    conversation.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    await vi.waitFor(() => expect(method.disabled).toBe(false));
    expect(contactCalls).toBe(2);
    conversation.querySelector<HTMLButtonElement>(
      "[data-communication-cancel]",
    )!.click();
    conversation.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    await Promise.resolve();
    expect(contactCalls).toBe(2);
  });

  it("records a call with source direction/emotion and refreshes its embedded projection", async () => {
    document.body.innerHTML = markup("call") + markup("conversation");
    let saved = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/communication-options")) {
        return Promise.resolve(
          response({
            availability: { call: true, conversation: true },
            channelTypes: [{ id: channelTypeId, name: "Email" }],
            emotions: [{ id: channelTypeId, name: "Joy" }],
            status: "ready",
          }),
        );
      }
      if (url.pathname.includes("/facts/contact-methods")) {
        return Promise.resolve(response({
          options: [],
          personUpdatedAt: new Date().toISOString(),
          records: [{
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
          }],
          status: "ready",
        }));
      }
      if (url.pathname.endsWith("/communications")) {
        return Promise.resolve(response({
          items: saved
            ? [{
              calledAt: "2026-08-16T18:15:00.000Z",
              contactWasCaller: true,
              content: "Planned visit",
              createdAt: new Date().toISOString(),
              emotions: [{ id: channelTypeId, name: "Joy" }],
              id: crypto.randomUUID(),
              kind: "call",
              person: { id: personId, name: "Ada" },
            }]
            : [],
          status: "ready",
        }));
      }
      if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({
          contactWasCaller: true,
          kind: "call",
          personId,
        });
        saved = true;
        return Promise.resolve(
          response({
            record: {
              ...body,
              createdAt: new Date().toISOString(),
              emotions: [],
              id: crypto.randomUUID(),
              person: { id: personId, name: "Ada" },
            },
            status: "created",
          }, 201),
        );
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    document.querySelector<HTMLButtonElement>(
      '[data-communication-kind="call"] [data-communication-add]',
    )!.click();
    const form = document.querySelector<HTMLFormElement>(
      '[data-communication-kind="call"] form',
    )!;
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    (form.elements.namedItem("content") as HTMLTextAreaElement).value =
      "Planned visit";
    (form.elements.namedItem("emotionIds") as HTMLSelectElement).options[0]!
      .selected = true;
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-communication-kind="call"] [data-communication-list]',
        )?.textContent,
      ).toContain("Incoming call")
    );
    expect(
      document.querySelector(
        '[data-communication-kind="call"] [data-communication-list]',
      )?.textContent,
    ).toContain("Joy");
  });

  it("submits multiple directed messages and permits an unknown-direction empty thread", async () => {
    document.body.innerHTML = markup("call") + markup("conversation");
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/communication-options")) {
          return Promise.resolve(
            response({
              availability: { call: true, conversation: true },
              channelTypes: [{ id: channelTypeId, name: "Email" }],
              emotions: [],
              status: "ready",
            }),
          );
        }
        if (url.pathname.includes("/facts/contact-methods")) {
          return Promise.resolve(
            response({
              options: [],
              personUpdatedAt: new Date().toISOString(),
              records: [],
              status: "ready",
            }),
          );
        }
        if (url.pathname.endsWith("/communications")) {
          return Promise.resolve(response({ items: [], status: "ready" }));
        }
        if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return Promise.resolve(response({
            record: {
              channelType: { id: channelTypeId, name: "Email" },
              createdAt: new Date().toISOString(),
              happenedAt: new Date().toISOString(),
              id: crypto.randomUUID(),
              kind: "conversation",
              messages: [],
              person: { id: personId, name: "Ada" },
            },
            status: "created",
          }, 201));
        }
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    const section = document.querySelector<HTMLElement>(
      '[data-communication-kind="conversation"]',
    )!;
    section.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    const form = section.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    (form.elements.namedItem("channelTypeId") as HTMLSelectElement).value =
      channelTypeId;
    form.requestSubmit();
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    await vi.waitFor(() =>
      expect(
        form.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      )
        .toBe(false)
    );
    expect(bodies[0]).toMatchObject({ kind: "conversation", messages: [] });
    section.querySelector<HTMLButtonElement>("[data-add-message]")!.click();
    section.querySelector<HTMLButtonElement>("[data-add-message]")!.click();
    const rows = [
      ...section.querySelectorAll<HTMLElement>("[data-message-row]"),
    ];
    expect(
      rows.every((row) =>
        row.querySelector("button")?.classList.contains("button-danger")
      ),
    ).toBe(true);
    rows[0]!.querySelector<HTMLTextAreaElement>("textarea")!.value = "Hello";
    rows[1]!.querySelector<HTMLTextAreaElement>("textarea")!.value = "Hi";
    rows[1]!.querySelector<HTMLSelectElement>("select")!.value = "inbound";
    form.requestSubmit();
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect((bodies[1] as { messages: unknown[] }).messages).toHaveLength(2);
  });

  it("serializes a delayed double-submit and reuses its request key after failure", async () => {
    document.body.innerHTML = markup("call");
    const bodies: Array<{ readonly requestId: string }> = [];
    const releases: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const ready = communicationGet(url);
        if (ready) return ready;
        if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          await new Promise<void>((resolve) => releases.push(resolve));
          return response({
            detail: "Try again.",
            status: 503,
            title: "Unavailable",
            type: "https://kinship.test/problems/unavailable",
          }, 503);
        }
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    const section = document.querySelector<HTMLElement>(
      '[data-communication-kind="call"]',
    )!;
    section.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    const form = section.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    form.requestSubmit();
    form.requestSubmit();
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    await Promise.resolve();
    const concurrentRequests = bodies.length;
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() =>
      expect(
        section.querySelector("[data-communication-form-state]")?.textContent,
      )
        .toContain("Try again")
    );
    form.requestSubmit();
    await vi.waitFor(() => expect(bodies.length).toBe(concurrentRequests + 1));
    releases.splice(0).forEach((release) => release());
    expect(concurrentRequests).toBe(1);
    expect(bodies[1]?.requestId).toBe(bodies[0]?.requestId);
  });

  it("refreshes authoritative last contact for backdated occurrences and later messages", async () => {
    document.body.innerHTML =
      `<dd data-profile-last-contact>${
        new Date("2026-08-20T12:00:00.000Z").toLocaleString()
      }</dd>` + markup("conversation");
    let saves = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const ready = communicationGet(url);
        if (ready) return Promise.resolve(ready);
        if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
          saves += 1;
          return Promise.resolve(response({
            record: {
              channelType: { id: channelTypeId, name: "Email" },
              createdAt: new Date().toISOString(),
              happenedAt: "2026-08-16T18:15:00.000Z",
              id: crypto.randomUUID(),
              kind: "conversation",
              messages: [],
              person: { id: personId, name: "Ada" },
            },
            status: "created",
          }, 201));
        }
        if (url.pathname.endsWith(`/people/${personId}`)) {
          return Promise.resolve(response({
            dueInformation: { status: "not-due" },
            person: {
              id: personId,
              lastContactAt: saves === 1
                ? "2026-08-20T12:00:00.000Z"
                : "2026-08-22T12:00:00.000Z",
            },
            status: "ready",
          }));
        }
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    const section = document.querySelector<HTMLElement>(
      '[data-communication-kind="conversation"]',
    )!;
    section.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    const form = section.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("channelTypeId") as HTMLSelectElement).value =
      channelTypeId;
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    form.requestSubmit();
    await vi.waitFor(() => expect(saves).toBe(1));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-profile-last-contact]")?.textContent)
        .toBe(new Date("2026-08-20T12:00:00.000Z").toLocaleString())
    );
    await vi.waitFor(() =>
      expect(
        form.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      )
        .toBe(false)
    );
    section.querySelector<HTMLButtonElement>("[data-add-message]")!.click();
    const row = section.querySelector<HTMLElement>("[data-message-row]")!;
    row.querySelector<HTMLTextAreaElement>("textarea")!.value = "Later";
    row.querySelector<HTMLInputElement>("[name=messageWrittenAt]")!.value =
      "2026-08-22T12:00";
    form.requestSubmit();
    await vi.waitFor(() => expect(saves).toBe(2));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-profile-last-contact]")?.textContent)
        .toBe(new Date("2026-08-22T12:00:00.000Z").toLocaleString())
    );
  });

  it("renders imported conversation history whose channel is unknown", async () => {
    document.body.innerHTML = markup("conversation");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const ready = communicationGet(url, [{
          createdAt: "2026-08-16T18:15:00.000Z",
          happenedAt: "2026-08-16T18:15:00.000Z",
          id: crypto.randomUUID(),
          kind: "conversation",
          messages: [],
          person: { id: personId, name: "Ada" },
        }]);
        if (ready) return Promise.resolve(ready);
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    expect(
      document.querySelector("[data-communication-list]")?.textContent,
    ).toContain("Unknown channel");
  });

  it("retries a rejected initial load from a visible section control without duplicate handlers", async () => {
    document.body.innerHTML = markup("call") + markup("conversation");
    const requests = new Map<string, number>();
    const history = [{
      calledAt: "2026-08-16T18:15:00.000Z",
      contactWasCaller: true,
      createdAt: "2026-08-16T18:15:00.000Z",
      emotions: [],
      id: crypto.randomUUID(),
      kind: "call",
      person: { id: personId, name: "Ada" },
    }, {
      channelType: { id: channelTypeId, name: "Email" },
      createdAt: "2026-08-16T19:15:00.000Z",
      happenedAt: "2026-08-16T19:15:00.000Z",
      id: crypto.randomUUID(),
      kind: "conversation",
      messages: [],
      person: { id: personId, name: "Ada" },
    }];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        requests.set(url.pathname, (requests.get(url.pathname) ?? 0) + 1);
        if (url.pathname.endsWith("/communication-options")) {
          return requests.get(url.pathname) === 1
            ? Promise.reject(new Error("offline"))
            : Promise.resolve(communicationGet(url)!);
        }
        const ready = communicationGet(url, history);
        if (ready) return Promise.resolve(ready);
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );

    await expect(
      mountCommunications(personId, workspaceId, false, {
        calls: false,
        conversations: false,
      }),
    ).resolves.toBeUndefined();
    for (
      const state of document.querySelectorAll<HTMLElement>(
        "[data-communication-state]",
      )
    ) {
      expect(state.textContent).toContain("could not be loaded");
    }
    const retries = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[data-communication-load-retry]",
      ),
    ];
    expect(retries).toHaveLength(2);
    expect(retries.every((retry) => !retry.hidden)).toBe(true);
    retries[0]!.focus();
    expect(document.activeElement).toBe(retries[0]);
    retries[0]!.click();
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll<HTMLElement>(
          "[data-communication-kind]",
        )].every((section) => section.dataset.sectionState === "ready"),
      ).toBe(true)
    );
    expect(document.body.textContent).toContain("Incoming call");
    expect(document.body.textContent).toContain("Email");
    expect(retries.every((retry) => retry.hidden)).toBe(true);
    const optionsPath = [...requests.keys()].find((path) =>
      path.endsWith("/communication-options")
    )!;
    const communicationsPath = [...requests.keys()].find((path) =>
      path.endsWith("/communications")
    )!;
    retries[0]!.hidden = false;
    retries[0]!.click();
    await vi.waitFor(() => expect(requests.get(optionsPath)).toBe(3));
    expect(requests.get(communicationsPath)).toBe(3);
  });

  it("keeps the request key and focuses a retry state after an unknown POST outcome", async () => {
    document.body.innerHTML = markup("call");
    const bodies: Array<{ readonly requestId: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const ready = communicationGet(url);
        if (ready) return Promise.resolve(ready);
        if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return bodies.length === 1
            ? Promise.reject(new Error("connection lost"))
            : Promise.resolve(response({
              detail: "Try again.",
              status: 503,
              title: "Unavailable",
              type: "https://kinship.test/problems/unavailable",
            }, 503));
        }
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    const section = document.querySelector<HTMLElement>(
      '[data-communication-kind="call"]',
    )!;
    section.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    const form = section.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    form.requestSubmit();
    const state = section.querySelector<HTMLElement>(
      "[data-communication-form-state]",
    )!;
    await vi.waitFor(() => expect(state.textContent).toContain("unknown"));
    expect(document.activeElement).toBe(state);
    form.requestSubmit();
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.requestId).toBe(bodies[0]?.requestId);
  });

  it.each([
    ["history", true, false],
    ["profile", false, true],
    ["history and profile", true, true],
  ])(
    "reports a saved-but-degraded state when %s refresh fails",
    async (_label, failHistory, failProfile) => {
      document.body.innerHTML = markup("call");
      let saved = false;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), "http://localhost");
          if (url.pathname.endsWith("/communication-options")) {
            return Promise.resolve(communicationGet(url)!);
          }
          if (url.pathname.includes("/facts/contact-methods")) {
            return Promise.resolve(communicationGet(url)!);
          }
          if (url.pathname.endsWith("/communications")) {
            return saved && failHistory
              ? Promise.reject(new Error("history refresh failed"))
              : Promise.resolve(response({ items: [], status: "ready" }));
          }
          if (
            url.pathname.endsWith("/interactions") && init?.method === "POST"
          ) {
            saved = true;
            return Promise.resolve(response({
              record: {
                calledAt: "2026-08-16T18:15:00.000Z",
                contactWasCaller: false,
                createdAt: new Date().toISOString(),
                emotions: [],
                id: crypto.randomUUID(),
                kind: "call",
                person: { id: personId, name: "Ada" },
              },
              status: "created",
            }, 201));
          }
          if (url.pathname.endsWith(`/people/${personId}`)) {
            return failProfile
              ? Promise.reject(new Error("profile refresh failed"))
              : Promise.resolve(response({
                dueInformation: { status: "not-due" },
                person: { id: personId, lastContactAt: null },
                status: "ready",
              }));
          }
          throw new Error(`unexpected ${url.pathname}`);
        }),
      );
      await mountCommunications(personId, workspaceId, false, {
        calls: false,
        conversations: false,
      });
      const section = document.querySelector<HTMLElement>(
        '[data-communication-kind="call"]',
      )!;
      section.querySelector<HTMLButtonElement>("[data-communication-add]")!
        .click();
      const form = section.querySelector<HTMLFormElement>("form")!;
      (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
        "2026-08-16T18:15";
      form.requestSubmit();
      const state = section.querySelector<HTMLElement>(
        "[data-communication-form-state]",
      )!;
      await vi.waitFor(() =>
        expect(state.textContent).toMatch(/saved.*refresh/i)
      );
      expect(document.activeElement).toBe(state);
      expect(
        section.querySelector<HTMLButtonElement>("[data-communication-refresh]")
          ?.hidden,
      ).toBe(false);
    },
  );

  it("reports invalid occurrence and message timestamps without calling the API", async () => {
    document.body.innerHTML = markup("call") + markup("conversation");
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const ready = communicationGet(url);
        if (ready) return Promise.resolve(ready);
        if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
          posts += 1;
          return Promise.resolve(response({}, 201));
        }
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    const call = document.querySelector<HTMLElement>(
      '[data-communication-kind="call"]',
    )!;
    call.querySelector<HTMLButtonElement>("[data-communication-add]")!.click();
    const callForm = call.querySelector<HTMLFormElement>("form")!;
    (callForm.elements.namedItem("happenedAt") as HTMLInputElement).value = "";
    callForm.requestSubmit();
    await vi.waitFor(() =>
      expect(call.querySelector("[data-communication-form-state]")?.textContent)
        .toContain("valid occurrence")
    );
    const conversation = document.querySelector<HTMLElement>(
      '[data-communication-kind="conversation"]',
    )!;
    conversation.querySelector<HTMLButtonElement>("[data-communication-add]")!
      .click();
    const conversationForm = conversation.querySelector<HTMLFormElement>(
      "form",
    )!;
    (conversationForm.elements.namedItem("happenedAt") as HTMLInputElement)
      .value = "2026-08-16T18:15";
    (conversationForm.elements.namedItem("channelTypeId") as HTMLSelectElement)
      .value = channelTypeId;
    conversation.querySelector<HTMLButtonElement>("[data-add-message]")!
      .click();
    const row = conversation.querySelector<HTMLElement>("[data-message-row]")!;
    row.querySelector<HTMLTextAreaElement>("textarea")!.value = "Hello";
    row.querySelector<HTMLInputElement>("[name=messageWrittenAt]")!.value = "";
    conversationForm.requestSubmit();
    await vi.waitFor(() =>
      expect(
        conversation.querySelector("[data-communication-form-state]")
          ?.textContent,
      ).toContain("valid message time")
    );
    expect(posts).toBe(0);
  });

  it("tracks matching in-page lifecycle changes without duplicate listeners", async () => {
    document.body.innerHTML = markup("call") + markup("conversation");
    const bodies: Array<{ readonly requestId: string }> = [];
    let rejectPost!: (reason?: unknown) => void;
    const pendingPost = new Promise<Response>((_resolve, reject) => {
      rejectPost = reject;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const ready = communicationGet(url);
        if (ready) return Promise.resolve(ready);
        if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return bodies.length === 1 ? pendingPost : Promise.resolve(response({
            detail: "Person is active but the retry was rejected.",
            status: 409,
            title: "Conflict",
            type: "https://kinship.local/problems/conflict",
          }, 409));
        }
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    const call = document.querySelector<HTMLElement>(
      '[data-communication-kind="call"]',
    )!;
    const conversation = document.querySelector<HTMLElement>(
      '[data-communication-kind="conversation"]',
    )!;
    const callAdd = call.querySelector<HTMLButtonElement>(
      "[data-communication-add]",
    )!;
    const conversationAdd = conversation.querySelector<HTMLButtonElement>(
      "[data-communication-add]",
    )!;
    const callForm = call.querySelector<HTMLFormElement>(
      "[data-communication-form]",
    )!;
    const conversationForm = conversation.querySelector<HTMLFormElement>(
      "[data-communication-form]",
    )!;
    callAdd.click();
    (callForm.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    callForm.requestSubmit();
    conversationAdd.click();
    expect(callForm.hidden).toBe(false);
    expect(conversationForm.hidden).toBe(false);

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived: true,
          personId: "00000000-0000-4000-8000-000000000999",
        },
      }),
    );
    expect(callForm.hidden).toBe(false);
    expect(conversationForm.hidden).toBe(false);

    let archivedReads = 0;
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          get archived() {
            archivedReads += 1;
            return true;
          },
          personId,
        },
      }),
    );
    expect(archivedReads).toBe(1);
    expect(callForm.hidden).toBe(true);
    expect(conversationForm.hidden).toBe(true);
    expect(callAdd.hidden).toBe(true);
    expect(callAdd.disabled).toBe(true);
    expect(conversationAdd.hidden).toBe(true);
    expect(conversationAdd.disabled).toBe(true);

    rejectPost(new Error("response was lost"));
    await vi.waitFor(() =>
      expect(call.querySelector("[data-communication-form-state]")?.textContent)
        .toContain("unknown")
    );
    expect(callAdd.hidden).toBe(true);
    expect(callAdd.disabled).toBe(true);

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false, personId },
      }),
    );
    expect(callAdd.hidden).toBe(false);
    expect(callAdd.disabled).toBe(false);
    expect(conversationAdd.hidden).toBe(false);
    expect(conversationAdd.disabled).toBe(false);
    callAdd.click();
    callForm.requestSubmit();
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.requestId).toBe(bodies[0]?.requestId);

    document.body.innerHTML = "";
    await mountCommunications(personId, workspaceId, false, {
      calls: false,
      conversations: false,
    });
    let cleanupReads = 0;
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          get archived() {
            cleanupReads += 1;
            return true;
          },
          personId,
        },
      }),
    );
    expect(cleanupReads).toBe(0);
  });
});
