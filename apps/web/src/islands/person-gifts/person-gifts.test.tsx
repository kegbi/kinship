// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountGiftsIsland } from "./mount.tsx";

const personId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const giftId = "00000000-0000-4000-8000-000000000003";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => resolve = done);
  return { promise, resolve };
}

/** The two cards as the static person shell draws them before hydration. */
function markup(): void {
  document.body.innerHTML = [["gifts", "gift"], ["debts", "debt"]].map((
    [id, type],
  ) =>
    `<section id="profile-section-${id}" class="profile-section-card person-files-card" data-profile-section="${id}" data-person-gifts="${type}" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-${id}-heading">
      <header class="profile-section-heading"><div class="profile-section-title"><h3 id="profile-section-${id}-heading">${
      id === "gifts" ? "Gifts" : "Debts"
    }</h3><span data-gift-badge class="state-badge">Loading</span></div></header>
      <p data-gift-state class="section-state">Loading…</p>
    </section>`
  ).join("") + '<ol id="app-toasts"></ol>';
}

const section = (type: "gift" | "debt") =>
  document.querySelector<HTMLElement>(`[data-person-gifts="${type}"]`)!;
const card = (type: "gift" | "debt") => within(section(type));
const stateLine = (type: "gift" | "debt") =>
  section(type).querySelector("[data-gift-state]")?.textContent;

const mounted: Array<() => void> = [];

async function mount(archived = false): Promise<void> {
  await act(async () => {
    mounted.push(
      await mountGiftsIsland({ archived, personId, workspaceId }),
    );
  });
}

function unmountAll(): void {
  act(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });
}

afterEach(() => {
  unmountAll();
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("GAP-023 gift and debt paging", () => {
  it("extends one card without disturbing the other", async () => {
    markup();
    const gift = {
      createdAt: "2026-08-23T08:00:00.000Z",
      id: giftId,
      name: "First gift",
      personId,
      status: "idea",
      updatedAt: "2026-08-23T08:00:00.000Z",
    };
    const debt = {
      amount: "5.0000",
      createdAt: "2026-08-23T08:00:00.000Z",
      direction: "they_owe",
      id: "00000000-0000-4000-8000-000000000008",
      personId,
      reason: "Lunch",
      status: "open",
      updatedAt: "2026-08-23T08:00:00.000Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        debts: [debt],
        gifts: [gift],
        nextGiftCursor: "gift-cursor",
        status: "ready",
        supportedCurrencyCodes: ["EUR"],
      }))
      .mockResolvedValueOnce(response({
        debts: [],
        gifts: [{
          ...gift,
          id: "00000000-0000-4000-8000-000000000007",
          name: "Second gift",
        }],
        status: "ready",
        supportedCurrencyCodes: ["EUR"],
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const moreGifts = card("gift").getByRole("button", {
      name: "Load more gifts",
    });
    expect(
      section("debt").querySelector<HTMLElement>('[data-load-more="debts"]')
        ?.hidden,
    ).toBe(true);
    await userEvent.setup().click(moreGifts);
    await waitFor(() =>
      expect(card("gift").getByText("Second gift")).toBeTruthy()
    );
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "giftCursor=gift-cursor",
    );
    expect(card("gift").getByText("First gift")).toBeTruthy();
    // The debt card keeps the page it already had rather than being replaced.
    expect(card("debt").getByText("Lunch")).toBeTruthy();
    expect(moreGifts.hidden).toBe(true);
    // The control that hid while focused handed focus to the list it extends.
    expect(document.activeElement).toBe(
      card("gift").getByRole("list", { name: "Saved gifts" }),
    );
  });

  it("extends the debt card and leaves the gift card and its control alone", async () => {
    markup();
    const gift = {
      createdAt: "2026-08-23T08:00:00.000Z",
      id: giftId,
      name: "Only gift",
      personId,
      status: "idea",
      updatedAt: "2026-08-23T08:00:00.000Z",
    };
    const debt = {
      amount: "5.0000",
      createdAt: "2026-08-23T08:00:00.000Z",
      direction: "they_owe",
      id: "00000000-0000-4000-8000-000000000008",
      personId,
      reason: "Lunch",
      status: "open",
      updatedAt: "2026-08-23T08:00:00.000Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        debts: [debt],
        gifts: [gift],
        nextDebtCursor: "debt-cursor",
        nextGiftCursor: "gift-cursor",
        status: "ready",
        supportedCurrencyCodes: ["EUR"],
      }))
      .mockResolvedValueOnce(response({
        debts: [{
          ...debt,
          id: "00000000-0000-4000-8000-000000000009",
          reason: "Dinner",
        }],
        gifts: [gift],
        nextGiftCursor: "gift-cursor",
        status: "ready",
        supportedCurrencyCodes: ["EUR"],
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const moreDebts = card("debt").getByRole("button", {
      name: "Load more debts",
    });
    await userEvent.setup().click(moreDebts);
    await waitFor(() => expect(card("debt").getByText("Dinner")).toBeTruthy());
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "debtCursor=debt-cursor",
    );
    expect(card("debt").getByText("Lunch")).toBeTruthy();
    // The gift page that came back with the debts is not appended again.
    expect(card("gift").getAllByText("Only gift")).toHaveLength(1);
    expect(moreDebts.hidden).toBe(true);
    expect(
      card("gift").getByRole("button", { name: "Load more gifts" }).hidden,
    ).toBe(false);
  });
});

describe("GIFTS-001 person gifts and debts", () => {
  it("does nothing without both complete person sections", async () => {
    document.body.innerHTML = '<section data-person-gifts="gift"></section>';
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(section("gift").hasAttribute("data-island")).toBe(false);
  });

  it("hydrates in place, keeping each section and marking the island ready", async () => {
    markup();
    const list = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => list.promise));
    const mounting = mountGiftsIsland({
      archived: false,
      personId,
      workspaceId,
    });
    const gift = section("gift");
    expect(gift.dataset.island).toBe("person-gifts");
    expect(gift.hasAttribute("data-island-ready")).toBe(true);
    expect(gift.getAttribute("aria-labelledby")).toBe(
      "profile-section-gifts-heading",
    );
    expect(gift.dataset.sectionState).toBe("loading");
    expect(
      card("gift").getByRole("heading", { name: "Gifts" }).id,
    ).toBe("profile-section-gifts-heading");
    expect(card("debt").getByRole("heading", { name: "Debts" }).id).toBe(
      "profile-section-debts-heading",
    );
    expect(card("gift").getByText("Loading gifts…")).toBeTruthy();
    expect(section("debt").querySelector("[data-section-icon=debts] svg"))
      .not.toBeNull();
    // The shell's own skeleton was replaced, not left beside the island's.
    expect(section("debt").querySelectorAll("[data-gift-state]")).toHaveLength(
      1,
    );
    await act(async () => {
      list.resolve(response({
        debts: [],
        gifts: [],
        status: "ready",
        supportedCurrencyCodes: ["EUR"],
      }));
      mounted.push(await mounting);
    });
    expect(stateLine("gift")).toBe("No gifts saved.");
    expect(stateLine("debt")).toBe("No debts saved.");
    expect(gift.dataset.sectionState).toBe("empty");
    expect(
      section("gift").querySelector("[data-gift-badge]")?.textContent,
    ).toBe("0 saved");
  });

  it("renders records before lazily gating and reusing editor options", async () => {
    markup();
    const people = deferred<Response>();
    const files = deferred<Response>();
    let editorOpened = false;
    let peopleCalls = 0;
    let fileCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/gifts")) {
          return Promise.resolve(response({
            debts: [],
            gifts: [{ id: giftId, name: "Tickets", personId, status: "idea" }],
            status: "ready",
            supportedCurrencyCodes: ["EUR"],
          }));
        }
        if (url.pathname.endsWith("/people")) {
          peopleCalls += 1;
          return editorOpened
            ? people.promise
            : Promise.reject(new Error("people unavailable"));
        }
        if (url.pathname.endsWith("/files")) {
          fileCalls += 1;
          return editorOpened
            ? files.promise
            : Promise.reject(new Error("files unavailable"));
        }
        throw new Error(`unexpected ${url.pathname}`);
      }),
    );

    await mount();

    expect(
      section("gift").querySelector(`[data-gift-id="${giftId}"]`)?.textContent,
    ).toContain("Tickets");
    expect([peopleCalls, fileCalls]).toEqual([0, 0]);
    editorOpened = true;
    const user = userEvent.setup();
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    await waitFor(() => expect([peopleCalls, fileCalls]).toEqual([1, 1]));
    const form = section("gift").querySelector<HTMLFormElement>("form")!;
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(card("gift").getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(card("gift").getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(stateLine("gift")).toBe("Loading gift and debt form options…");
    await act(async () => {
      people.resolve(response({ people: [], status: "ready" }));
      files.resolve(response({ files: [], status: "ready" }));
      await Promise.all([people.promise, files.promise]);
    });
    await waitFor(() =>
      expect(card("gift").getByRole("button", { name: "Save" })).toHaveProperty(
        "disabled",
        false,
      )
    );
    expect(stateLine("gift")).toBe("1 gift saved.");
    await user.click(card("gift").getByRole("button", { name: "Cancel" }));
    expect(section("gift").querySelector("form")).toBeNull();
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    expect([peopleCalls, fileCalls]).toEqual([1, 1]);
    expect(card("gift").getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("reports options that cannot load and retries when the editor reopens", async () => {
    markup();
    let peopleCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/gifts")) {
          return Promise.resolve(response({
            debts: [],
            gifts: [],
            status: "ready",
            supportedCurrencyCodes: ["EUR"],
          }));
        }
        if (url.pathname.endsWith("/people")) {
          peopleCalls += 1;
          return Promise.resolve(response({ detail: "Denied" }, 403));
        }
        return Promise.resolve(response({ files: [], status: "ready" }));
      }),
    );
    await mount();
    const user = userEvent.setup();
    await user.click(card("debt").getByRole("button", { name: "Add debt" }));
    await waitFor(() =>
      expect(stateLine("debt")).toBe(
        "Gift and debt form options could not be loaded. Close and reopen the editor to try again.",
      )
    );
    expect(card("debt").getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(card("debt").getByRole("button", { name: "Cancel" }));
    await user.click(card("debt").getByRole("button", { name: "Add debt" }));
    await waitFor(() => expect(peopleCalls).toBe(2));
  });

  it("renders unknown amount/no recipient and serializes create through authoritative refresh", async () => {
    markup();
    const empty = {
      debts: [],
      gifts: [{ id: giftId, name: "Tickets", personId, status: "idea" }],
      status: "ready",
      supportedCurrencyCodes: ["EUR", "USD"],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(empty))
      .mockResolvedValueOnce(response({ people: [], status: "ready" }))
      .mockResolvedValueOnce(response({ files: [], status: "ready" }))
      .mockResolvedValueOnce(
        response({ gift: empty.gifts[0], status: "created" }, 201),
      )
      .mockResolvedValueOnce(response(empty));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const item = section("gift").querySelector(`[data-gift-id="${giftId}"]`);
    expect(item?.textContent).toContain("Amount unknown");
    expect(item?.textContent).toContain("No recipient");
    const user = userEvent.setup();
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    const save = card("gift").getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    await user.type(card("gift").getByLabelText("Gift name"), "Tickets");
    await user.selectOptions(
      card("gift").getByLabelText("Currency (with amount)"),
      "USD",
    );
    await user.type(card("gift").getByLabelText("Amount (optional)"), "12");
    await user.type(
      card("gift").getByLabelText("Event time (optional)"),
      "2026-09-01T10:30",
    );
    await user.click(save);
    await waitFor(() => expect(stateLine("gift")).toBe("Gift saved."));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [, init] = fetchMock.mock.calls[3]!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: "12",
      currencyCode: "USD",
      eventAt: new Date("2026-09-01T10:30").toISOString(),
      name: "Tickets",
      status: "idea",
    });
    expect(section("gift").querySelector("form")).toBeNull();
    expect(card("gift").getByRole("button", { name: "Add gift" }).hidden).toBe(
      false,
    );
  });

  it("validates the editor with the contract schema before saving", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        debts: [],
        gifts: [],
        status: "ready",
        supportedCurrencyCodes: ["EUR"],
      }))
      .mockResolvedValueOnce(response({ people: [], status: "ready" }))
      .mockResolvedValueOnce(response({ files: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const user = userEvent.setup();
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    const save = card("gift").getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    await user.type(
      card("gift").getByLabelText("Amount (optional)"),
      "1.23456",
    );
    await user.click(save);
    const name = card("gift").getByLabelText(/^Gift name/);
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
    expect(
      document.getElementById(name.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Required.");
    expect(
      card("gift").getByLabelText(/^Amount \(optional\)/).getAttribute(
        "aria-invalid",
      ),
    ).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps archived sections read-only and exposes refresh failures", async () => {
    markup();
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(response({ detail: "Access lost" }, 403))
    );
    vi.stubGlobal("fetch", fetchMock);
    await mount(true);
    expect(card("gift").queryByRole("button", { name: "Add gift" })).toBeNull();
    expect(card("debt").queryByRole("button", { name: "Add debt" })).toBeNull();
    expect(stateLine("gift")).toContain("Access lost");
    expect(stateLine("debt")).toContain("Access lost");
    expect(section("gift").dataset.sectionState).toBe("error");
    expect(
      section("gift").querySelector("[data-gift-badge]")?.textContent,
    ).toBe("Unavailable");
    await userEvent.setup().click(
      card("gift").getByRole("button", { name: "Retry loading" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(stateLine("gift")).toContain("Access lost");
  });

  it("says the list is unavailable when the API cannot be reached", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await mount();
    expect(stateLine("gift")).toBe(
      "Gifts and debts are temporarily unavailable.",
    );
    expect(card("gift").getByRole("button", { name: "Retry loading" }).hidden)
      .toBe(false);
  });

  it("renders lifecycle choices and refreshes after gift and debt status changes", async () => {
    markup();
    const records = {
      gifts: [
        { id: giftId, name: "Idea", personId, status: "idea" },
        {
          id: `${giftId.slice(0, -1)}4`,
          name: "Plan",
          personId,
          status: "planned",
          amount: "2",
          currencyCode: "EUR",
          recipientPersonId: personId,
          attachmentFileId: giftId,
        },
        {
          id: `${giftId.slice(0, -1)}5`,
          name: "Given",
          personId,
          status: "given",
        },
        {
          id: `${giftId.slice(0, -1)}6`,
          name: "Received",
          personId,
          status: "received",
        },
        {
          id: `${giftId.slice(0, -1)}7`,
          name: "Archived",
          personId,
          status: "archived",
        },
      ],
      debts: [
        {
          amount: "3",
          direction: "i_owe",
          id: `${giftId.slice(0, -1)}8`,
          personId,
          reason: "Coffee",
          status: "open",
        },
        {
          amount: "4",
          direction: "they_owe",
          id: `${giftId.slice(0, -1)}9`,
          personId,
          status: "settled",
        },
        {
          amount: "5",
          direction: "they_owe",
          id: `${giftId.slice(0, -2)}10`,
          personId,
          status: "cancelled",
        },
      ],
      status: "ready",
      supportedCurrencyCodes: ["EUR", "USD"],
    };
    const people = {
      people: [{
        givenName: "Ada",
        id: personId,
        isPartial: false,
        isStarred: false,
        lifecycle: "active",
        tagCount: 0,
        tags: [],
      }, {
        givenName: "Old",
        id: giftId,
        isPartial: false,
        isStarred: false,
        lifecycle: "archived",
        tagCount: 0,
        tags: [],
      }],
      status: "ready",
    };
    const files = {
      files: [{
        byteSize: 4,
        createdAt: "now",
        fileId: giftId,
        filename: "gift.pdf",
        kind: "document",
        mimeType: "application/pdf",
        personId,
        status: "available",
        title: "Receipt",
      }, {
        byteSize: 4,
        createdAt: "now",
        fileId: personId,
        filename: "lost.pdf",
        kind: "document",
        mimeType: "application/pdf",
        personId,
        status: "missing",
        title: "Lost",
      }],
      status: "ready",
    };
    const replies: unknown[] = [
      records,
      people,
      files,
      { status: "saved" },
      records,
      { status: "saved" },
      records,
    ];
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(response(replies.shift()))
    );
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const user = userEvent.setup();
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    const recipient = card("gift").getByLabelText<HTMLSelectElement>(
      "Recipient (optional)",
    );
    await waitFor(() => expect(recipient.disabled).toBe(false));
    expect([...recipient.options].map((option) => option.textContent)).toEqual([
      "No recipient",
      "Ada",
    ]);
    expect(
      [
        ...card("gift").getByLabelText<HTMLSelectElement>(
          "Existing attachment (optional)",
        ).options,
      ].map((option) => option.textContent),
    ).toEqual(["No attachment", "Receipt"]);
    expect(
      [
        card("gift").getByLabelText<HTMLSelectElement>(
          "Currency (with amount)",
        ),
      ].map((select) => [...select.options].map((option) => option.value)),
    ).toEqual([["", "EUR", "USD"]]);
    expect(
      card("gift").getByRole("combobox", { name: "Next status for Idea" })
        .children,
    ).toHaveLength(4);
    expect(
      card("gift").getByRole("combobox", { name: "Next status for Given" })
        .children,
    ).toHaveLength(1);
    expect(
      card("gift").queryByRole("combobox", {
        name: "Next status for Archived",
      }),
    ).toBeNull();
    expect(
      section("gift").querySelector(`[data-gift-id$="4"]`)?.textContent,
    ).toContain("planned · 2 EUR · Recipient selected · Attachment linked");
    await user.click(card("gift").getByRole("button", { name: "Cancel" }));
    const ideaStatus = within(
      section("gift").querySelector<HTMLElement>(`[data-gift-id="${giftId}"]`)!,
    );
    const giftStatus = ideaStatus.getByRole("button", {
      name: "Change status",
    });
    expect(giftStatus.classList.contains("button-secondary")).toBe(true);
    await user.selectOptions(
      ideaStatus.getByRole("combobox", { name: "Next status for Idea" }),
      "given",
    );
    await user.click(giftStatus);
    await waitFor(() => expect(stateLine("gift")).toBe("Status changed."));
    const [statusUrl, statusInit] = fetchMock.mock.calls[3]!;
    expect(String(statusUrl)).toContain(`/gifts/${giftId}/status`);
    expect(JSON.parse(String(statusInit?.body))).toEqual({ status: "given" });
    // The row reads exactly as the vanilla one did, currency gap included.
    expect(
      [...section("debt").querySelectorAll("li > p")].map((row) =>
        row.textContent
      ),
    ).toEqual([
      "I owe · 3  · open",
      "They owe · 4  · settled",
      "They owe · 5  · cancelled",
    ]);
    const coffee = within(
      section("debt").querySelector<HTMLElement>(
        `[data-debt-id="${records.debts[0]!.id}"]`,
      )!,
    );
    expect(
      coffee.getByRole("combobox", { name: "Next status for Coffee" })
        .children,
    ).toHaveLength(2);
    await user.click(coffee.getByRole("button", { name: "Change status" }));
    await waitFor(() => expect(stateLine("debt")).toBe("Status changed."));
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      status: "settled",
    });
    expect(card("debt").queryAllByRole("combobox")).toHaveLength(1);
  });

  it("reports a status change the server refuses or never answers", async () => {
    markup();
    const records = {
      debts: [{
        amount: "2",
        direction: "i_owe",
        id: giftId,
        personId,
        status: "open",
      }],
      gifts: [{ id: giftId, name: "Book", personId, status: "idea" }],
      status: "ready",
      supportedCurrencyCodes: ["EUR"],
    };
    const replies = [
      () => Promise.resolve(response(records)),
      () => Promise.resolve(response({ detail: "Invalid transition" }, 409)),
      () => Promise.reject(new Error("offline")),
    ];
    vi.stubGlobal("fetch", vi.fn(() => replies.shift()!()));
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("gift").getByRole("button", { name: "Change status" }),
    );
    await waitFor(() => expect(stateLine("gift")).toBe("Invalid transition"));
    await user.click(
      card("debt").getByRole("button", { name: "Change status" }),
    );
    await waitFor(() =>
      expect(stateLine("debt")).toBe("The status could not be changed.")
    );
  });

  it("creates a debt and retains mutation errors without replacing them", async () => {
    markup();
    const empty = {
      debts: [],
      gifts: [],
      status: "ready",
      supportedCurrencyCodes: ["EUR", "USD"],
    };
    const okReplies: unknown[] = [
      empty,
      { people: [], status: "ready" },
      { files: [], status: "ready" },
      { debt: {}, status: "created" },
      empty,
    ];
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(response(okReplies.shift()))
    );
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const user = userEvent.setup();
    await user.click(card("debt").getByRole("button", { name: "Add debt" }));
    const save = card("debt").getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    await user.type(card("debt").getByLabelText("Amount"), "12");
    await user.selectOptions(card("debt").getByLabelText("Currency"), "USD");
    await user.type(card("debt").getByLabelText("Reason (optional)"), "Lunch");
    await user.click(save);
    await waitFor(() => expect(stateLine("debt")).toBe("Debt saved."));
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      amount: "12",
      currencyCode: "USD",
      direction: "they_owe",
      reason: "Lunch",
      status: "open",
    });

    unmountAll();
    markup();
    const failedReplies: Array<() => Promise<Response>> = [
      () => Promise.resolve(response(empty)),
      () => Promise.resolve(response({ people: [], status: "ready" })),
      () => Promise.resolve(response({ files: [], status: "ready" })),
      () =>
        Promise.resolve(
          response({
            code: "invalid_request",
            detail: "Invalid transition",
            errors: { name: "Already taken." },
            status: 409,
            title: "Conflict",
            type: "https://kinship.test/problems/invalid_request",
          }, 409),
        ),
      () => Promise.reject(new Error("offline")),
    ];
    vi.stubGlobal("fetch", vi.fn(() => failedReplies.shift()!()));
    await mount();
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    const giftSave = card("gift").getByRole("button", { name: "Save" });
    await waitFor(() => expect(giftSave).toHaveProperty("disabled", false));
    await user.type(card("gift").getByLabelText("Gift name"), "Book");
    await user.click(giftSave);
    await waitFor(() => expect(stateLine("gift")).toBe("Invalid transition"));
    const name = card("gift").getByLabelText(/^Gift name/);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(name.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Already taken.");
    await user.click(giftSave);
    await waitFor(() =>
      expect(stateLine("gift")).toBe("The record could not be saved.")
    );
    await user.click(card("gift").getByRole("button", { name: "Cancel" }));
    expect(section("gift").querySelector("form")).toBeNull();
  });

  it("runs one save at a time across both cards", async () => {
    markup();
    const created = deferred<Response>();
    const replies: Array<() => Promise<Response>> = [
      () =>
        Promise.resolve(response({
          debts: [],
          gifts: [{ id: giftId, name: "Book", personId, status: "idea" }],
          status: "ready",
          supportedCurrencyCodes: ["EUR"],
        })),
      () => Promise.resolve(response({ people: [], status: "ready" })),
      () => Promise.resolve(response({ files: [], status: "ready" })),
      () => created.promise,
    ];
    const fetchMock = vi.fn(() => replies.shift()!());
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const user = userEvent.setup();
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    const save = card("gift").getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    await user.type(card("gift").getByLabelText("Gift name"), "Pen");
    await user.click(save);
    await waitFor(() => expect(stateLine("gift")).toBe("Saving gift…"));
    await user.click(
      card("gift").getByRole("button", { name: "Change status" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("switches existing gift and debt actions to read-only on lifecycle events", async () => {
    markup();
    const records = {
      debts: [{
        amount: "2",
        direction: "i_owe",
        id: giftId,
        personId,
        status: "open",
      }],
      gifts: [{ id: giftId, name: "Book", personId, status: "idea" }],
      status: "ready",
      supportedCurrencyCodes: ["EUR", "USD"],
    };
    const replies: unknown[] = [records, { people: [], status: "ready" }, {
      files: [],
      status: "ready",
    }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(response(replies.shift()))
      ),
    );
    await mount();
    await userEvent.setup().click(
      card("gift").getByRole("button", { name: "Add gift" }),
    );
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId: workspaceId },
        }),
      );
    });
    expect(section("gift").querySelector("form")).not.toBeNull();
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId },
        }),
      );
    });
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    expect(section("gift").querySelector("form")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Change status" }))
      .toHaveLength(0);
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false, personId },
        }),
      );
    });
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(2);
  });
});
