// @vitest-environment happy-dom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mountGiftsIsland } from "./mount.tsx";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../testing/api.ts";
import { ids, sectionProps } from "../../testing/fixtures.ts";
import { TOAST_REGION } from "../../testing/shell.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../testing/render.tsx";

const { person: personId, workspace: workspaceId } = ids;
const giftId = "00000000-0000-4000-8000-000000000003";

const GIFTS = "GET /api/v1/people/:personId/gifts";
const PEOPLE = "GET /api/v1/people";
const FILES = "GET /api/v1/people/:personId/files";
const NO_PEOPLE = jsonResponse({ people: [], status: "ready" });
const NO_FILES = jsonResponse({ files: [], status: "ready" });
/** The editor's options, answered empty. */
const OPTIONS = { [PEOPLE]: NO_PEOPLE, [FILES]: NO_FILES };

/** A list answer: nothing saved unless the test says so. */
const page = (fields: Record<string, unknown> = {}) =>
  jsonResponse({
    debts: [],
    gifts: [],
    status: "ready",
    supportedCurrencyCodes: ["EUR"],
    ...fields,
  });

const stamped = {
  createdAt: "2026-08-23T08:00:00.000Z",
  personId,
  updatedAt: "2026-08-23T08:00:00.000Z",
};
const firstGift = (name: string) => ({
  ...stamped,
  id: giftId,
  name,
  status: "idea",
});
const lunch = {
  ...stamped,
  amount: "5.0000",
  direction: "they_owe",
  id: "00000000-0000-4000-8000-000000000008",
  reason: "Lunch",
  status: "open",
};

/** The two cards as the static person shell draws them before hydration. */
function markup(): void {
  drawShell(
    [["gifts", "gift"], ["debts", "debt"]].map(([id, type]) =>
      `<section id="profile-section-${id}" class="profile-section-card person-files-card" data-profile-section="${id}" data-person-gifts="${type}" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-${id}-heading">
      <header class="profile-section-heading"><div class="profile-section-title"><h3 id="profile-section-${id}-heading">${
        id === "gifts" ? "Gifts" : "Debts"
      }</h3><span data-gift-badge class="state-badge">Loading</span></div></header>
      <p data-gift-state class="section-state">Loading…</p>
    </section>`
    ).join("") + TOAST_REGION,
  );
}

const section = (type: "gift" | "debt") =>
  element(`[data-person-gifts="${type}"]`);
const card = (type: "gift" | "debt") => within(section(type));
const stateLine = (type: "gift" | "debt") =>
  section(type).querySelector("[data-gift-state]")?.textContent;

const mount = (archived = false) =>
  mountSettled(() => mountGiftsIsland(sectionProps({ archived })));

describe("GAP-023 gift and debt paging", () => {
  it("extends one card without disturbing the other", async () => {
    markup();
    const gift = firstGift("First gift");
    const api = stubApi({
      [GIFTS]: [
        page({
          debts: [lunch],
          gifts: [gift],
          nextGiftCursor: "gift-cursor",
        }),
        page({
          gifts: [{
            ...gift,
            id: "00000000-0000-4000-8000-000000000007",
            name: "Second gift",
          }],
        }),
      ],
    });
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
    expect(api.calls().at(-1)).toContain("giftCursor=gift-cursor");
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
    const gift = firstGift("Only gift");
    const api = stubApi({
      [GIFTS]: [
        page({
          debts: [lunch],
          gifts: [gift],
          nextDebtCursor: "debt-cursor",
          nextGiftCursor: "gift-cursor",
        }),
        page({
          debts: [{
            ...lunch,
            id: "00000000-0000-4000-8000-000000000009",
            reason: "Dinner",
          }],
          gifts: [gift],
          nextGiftCursor: "gift-cursor",
        }),
      ],
    });
    await mount();
    const moreDebts = card("debt").getByRole("button", {
      name: "Load more debts",
    });
    await userEvent.setup().click(moreDebts);
    await waitFor(() => expect(card("debt").getByText("Dinner")).toBeTruthy());
    expect(api.calls().at(-1)).toContain("debtCursor=debt-cursor");
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
    drawShell('<section data-person-gifts="gift"></section>');
    const api = stubApi();
    await mount();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(section("gift").hasAttribute("data-island")).toBe(false);
  });

  it("hydrates in place, keeping each section and marking the island ready", async () => {
    markup();
    const list = deferred<Response>();
    stubApi({ [GIFTS]: list.promise });
    const mounting = mountPending(() =>
      mountGiftsIsland(sectionProps({ archived: false }))
    );
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
      list.resolve(page());
      await mounting;
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
    let peopleCalls = 0;
    let fileCalls = 0;
    stubApi({
      [GIFTS]: page({
        gifts: [{ id: giftId, name: "Tickets", personId, status: "idea" }],
      }),
      [PEOPLE]: () => {
        peopleCalls += 1;
        return people.promise;
      },
      [FILES]: () => {
        fileCalls += 1;
        return files.promise;
      },
    });

    await mount();

    expect(
      section("gift").querySelector(`[data-gift-id="${giftId}"]`)?.textContent,
    ).toContain("Tickets");
    expect([peopleCalls, fileCalls]).toEqual([0, 0]);
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
      people.resolve(NO_PEOPLE);
      files.resolve(NO_FILES);
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
    stubApi({
      [GIFTS]: page(),
      [PEOPLE]: () => {
        peopleCalls += 1;
        return problemResponse(403, { detail: "Denied" });
      },
      [FILES]: NO_FILES,
    });
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
    const tickets = { id: giftId, name: "Tickets", personId, status: "idea" };
    const api = stubApi({
      [GIFTS]: page({
        gifts: [tickets],
        supportedCurrencyCodes: ["EUR", "USD"],
      }),
      ...OPTIONS,
      "POST /api/v1/people/:personId/gifts": jsonResponse(
        { gift: tickets, status: "created" },
        201,
      ),
    });
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
    expect(api.fetch).toHaveBeenCalledTimes(5);
    const created = api.requests()[3]!;
    expect(created.method).toBe("POST");
    expect(created.body).toEqual({
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
    const api = stubApi({ [GIFTS]: page(), ...OPTIONS });
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
    expect(api.fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps archived sections read-only and exposes refresh failures", async () => {
    markup();
    const api = stubApi({
      [GIFTS]: problemResponse(403, { detail: "Access lost" }),
    });
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
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(stateLine("gift")).toContain("Access lost");
  });

  it("says the list is unavailable when the API cannot be reached", async () => {
    markup();
    stubApi({ [GIFTS]: unreachable });
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
      supportedCurrencyCodes: ["EUR", "USD"],
    };
    const person = {
      isPartial: false,
      isStarred: false,
      tagCount: 0,
      tags: [],
    };
    const file = {
      byteSize: 4,
      createdAt: "now",
      kind: "document",
      mimeType: "application/pdf",
      personId,
    };
    const saved = jsonResponse({ status: "saved" });
    const api = stubApi({
      [GIFTS]: page(records),
      [PEOPLE]: jsonResponse({
        people: [
          { ...person, givenName: "Ada", id: personId, lifecycle: "active" },
          { ...person, givenName: "Old", id: giftId, lifecycle: "archived" },
        ],
        status: "ready",
      }),
      [FILES]: jsonResponse({
        files: [{
          ...file,
          fileId: giftId,
          filename: "gift.pdf",
          status: "available",
          title: "Receipt",
        }, {
          ...file,
          fileId: personId,
          filename: "lost.pdf",
          status: "missing",
          title: "Lost",
        }],
        status: "ready",
      }),
      "PATCH /api/v1/people/:personId/gifts/:giftId/status": saved,
      "PATCH /api/v1/people/:personId/debts/:debtId/status": saved,
    });
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
      element(`[data-gift-id="${giftId}"]`, section("gift")),
    );
    const giftStatus = ideaStatus.getByRole("button", {
      name: "Change status",
    });
    expect(giftStatus.className).toBe(buttonVariants({ variant: "outline" }));
    await user.selectOptions(
      ideaStatus.getByRole("combobox", { name: "Next status for Idea" }),
      "given",
    );
    await user.click(giftStatus);
    await waitFor(() => expect(stateLine("gift")).toBe("Status changed."));
    const statusChange = api.requests()[3]!;
    expect(statusChange.url.pathname).toContain(`/gifts/${giftId}/status`);
    expect(statusChange.body).toEqual({ status: "given" });
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
      element(`[data-debt-id="${records.debts[0]!.id}"]`, section("debt")),
    );
    expect(
      coffee.getByRole("combobox", { name: "Next status for Coffee" })
        .children,
    ).toHaveLength(2);
    await user.click(coffee.getByRole("button", { name: "Change status" }));
    await waitFor(() => expect(stateLine("debt")).toBe("Status changed."));
    expect(api.requests()[5]?.body).toEqual({ status: "settled" });
    expect(card("debt").queryAllByRole("combobox")).toHaveLength(1);
  });

  it("reports a status change the server refuses or never answers", async () => {
    markup();
    stubApi({
      [GIFTS]: page({
        debts: [{
          amount: "2",
          direction: "i_owe",
          id: giftId,
          personId,
          status: "open",
        }],
        gifts: [{ id: giftId, name: "Book", personId, status: "idea" }],
      }),
      "PATCH /api/v1/people/:personId/gifts/:giftId/status": problemResponse(
        409,
        { detail: "Invalid transition" },
      ),
      "PATCH /api/v1/people/:personId/debts/:debtId/status": unreachable,
    });
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
    const api = stubApi({
      [GIFTS]: page({ supportedCurrencyCodes: ["EUR", "USD"] }),
      ...OPTIONS,
      "POST /api/v1/people/:personId/debts": jsonResponse({
        debt: {},
        status: "created",
      }),
      "POST /api/v1/people/:personId/gifts": [
        problemResponse(409, {
          code: "invalid_request",
          detail: "Invalid transition",
          errors: { name: "Already taken." },
          title: "Conflict",
          type: "https://kinship.test/problems/invalid_request",
        }),
        unreachable,
      ],
    });
    const unmount = await mount();
    const user = userEvent.setup();
    await user.click(card("debt").getByRole("button", { name: "Add debt" }));
    const save = card("debt").getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    await user.type(card("debt").getByLabelText("Amount"), "12");
    await user.selectOptions(card("debt").getByLabelText("Currency"), "USD");
    await user.type(card("debt").getByLabelText("Reason (optional)"), "Lunch");
    await user.click(save);
    await waitFor(() => expect(stateLine("debt")).toBe("Debt saved."));
    expect(api.requests()[3]?.body).toEqual({
      amount: "12",
      currencyCode: "USD",
      direction: "they_owe",
      reason: "Lunch",
      status: "open",
    });

    unmount();
    markup();
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
    const api = stubApi({
      [GIFTS]: page({
        gifts: [{ id: giftId, name: "Book", personId, status: "idea" }],
      }),
      ...OPTIONS,
      "POST /api/v1/people/:personId/gifts": deferred<Response>().promise,
    });
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
    expect(api.fetch).toHaveBeenCalledTimes(4);
  });

  it("switches existing gift and debt actions to read-only on lifecycle events", async () => {
    markup();
    stubApi({
      [GIFTS]: page({
        debts: [{
          amount: "2",
          direction: "i_owe",
          id: giftId,
          personId,
          status: "open",
        }],
        gifts: [{ id: giftId, name: "Book", personId, status: "idea" }],
        supportedCurrencyCodes: ["EUR", "USD"],
      }),
      ...OPTIONS,
    });
    await mount();
    await userEvent.setup().click(
      card("gift").getByRole("button", { name: "Add gift" }),
    );
    const lifecycle = (archived: boolean, person: string = personId) =>
      act(() => {
        document.dispatchEvent(
          new CustomEvent("person-lifecycle-changed", {
            detail: { archived, personId: person },
          }),
        );
      });
    lifecycle(true, workspaceId);
    expect(section("gift").querySelector("form")).not.toBeNull();
    lifecycle(true);
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    expect(section("gift").querySelector("form")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Change status" }))
      .toHaveLength(0);
    lifecycle(false);
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(2);
  });
});

describe("REL-052 gift and debt status lines", () => {
  // Mounted during the initial fan-out, the line waits for the workspace's
  // promotion (UXD-003B); mounted after it, the line is its own live region
  // from the first commit.
  it.each([false, true])(
    "owns each card's live region from its first commit only once states are live (%s)",
    async (live) => {
      markup();
      const list = deferred<Response>();
      stubApi({ [GIFTS]: list.promise });
      const settled = mountPending(() =>
        mountGiftsIsland(sectionProps({ statesLive: () => live }))
      );
      const lines = (["gift", "debt"] as const).map((type) =>
        element("[data-gift-state]", section(type))
      );
      for (const line of lines) {
        expect(line.getAttribute("role")).toBe(live ? "status" : null);
        expect(line.getAttribute("aria-live")).toBe(live ? "polite" : null);
      }
      await act(async () => {
        list.resolve(page());
        await settled;
      });
      expect(lines.map((line) => line.isConnected)).toEqual([true, true]);
    },
  );
});
