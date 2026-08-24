// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPersonGifts } from "./person-gifts.ts";

const personId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const giftId = "00000000-0000-4000-8000-000000000003";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function markup() {
  document.body.innerHTML = ["gift", "debt"].map((type) => `
    <section data-person-gifts="${type}">
      <span data-gift-badge></span><p data-gift-state></p>
      <button data-gift-retry hidden></button><ul data-gift-list></ul>
      <button data-gift-add>Add</button><form data-gift-form hidden>
        ${
    type === "gift"
      ? '<input name="name"><select name="status"><option value="idea">idea</option></select><select name="currencyCode"></select><select name="recipientPersonId"></select><select name="attachmentFileId"></select>'
      : '<input name="amount"><select name="currencyCode"></select><select name="direction"><option value="they_owe">they owe</option></select><select name="status"><option value="open">open</option></select>'
  }
        <button type="submit">Save</button><button data-gift-cancel type="button">Cancel</button>
      </form>
    </section>`).join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("GIFTS-001 person gifts and debts", () => {
  it("does nothing without both complete person sections", async () => {
    document.body.innerHTML = '<section data-person-gifts="gift"></section>';
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonGifts({ archived: false, personId, workspaceId });
    expect(fetchMock).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(response(empty))
      .mockResolvedValueOnce(response({ people: [], status: "ready" }))
      .mockResolvedValueOnce(response({ files: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonGifts({ archived: false, personId, workspaceId });
    expect(document.querySelector(`[data-gift-id="${giftId}"]`)?.textContent)
      .toContain("Amount unknown");
    expect(document.querySelector(`[data-gift-id="${giftId}"]`)?.textContent)
      .toContain("No recipient");
    document.querySelector<HTMLElement>(
      '[data-person-gifts="gift"] [data-gift-add]',
    )?.click();
    const form = document.querySelector<HTMLFormElement>(
      '[data-person-gifts="gift"] form',
    )!;
    (form.elements.namedItem("name") as HTMLInputElement).value = "Tickets";
    form.requestSubmit();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("POST");
    expect(
      document.querySelector('[data-person-gifts="gift"] [data-gift-state]')
        ?.textContent,
    ).toBe("Gift saved.");
  });

  it("keeps archived sections read-only and exposes refresh failures", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(response({ detail: "Access lost" }, 403))
      ),
    );
    await mountPersonGifts({ archived: true, personId, workspaceId });
    expect(document.querySelectorAll("[data-gift-add]:not([hidden])"))
      .toHaveLength(0);
    expect(
      document.querySelector('[data-person-gifts="gift"] [data-gift-state]')
        ?.textContent,
    ).toContain("Access lost");
    document.querySelector<HTMLButtonElement>(
      '[data-person-gifts="gift"] [data-gift-retry]',
    )?.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-gifts="gift"] [data-gift-state]')
          ?.textContent,
      ).toContain("Access lost")
    );
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
    const replies = [
      records,
      people,
      files,
      { status: "saved" },
      records,
      people,
      files,
      { status: "saved" },
      records,
      people,
      files,
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(response(replies.shift()))
      ),
    );
    await mountPersonGifts({ archived: false, personId, workspaceId });
    expect(
      document.querySelector<HTMLSelectElement>(
        'select[name="recipientPersonId"]',
      )?.options,
    ).toHaveLength(2);
    expect(
      document.querySelector<HTMLSelectElement>(
        'select[name="attachmentFileId"]',
      )?.options,
    ).toHaveLength(2);
    expect(
      [...document.querySelectorAll<HTMLSelectElement>(
        'select[name="currencyCode"]',
      )].map((select) => [...select.options].map((value) => value.value)),
    ).toEqual([["", "EUR", "USD"], ["EUR", "USD"]]);
    expect(
      document.querySelector(`[data-gift-id="${giftId}"] select`)?.children,
    ).toHaveLength(4);
    expect(document.querySelector('[data-gift-id$="5"] select')?.children)
      .toHaveLength(1);
    expect(document.querySelector('[data-gift-id$="7"] select')).toBeNull();
    const giftStatus = document.querySelector<HTMLButtonElement>(
      `[data-gift-status-save="${giftId}"]`,
    )!;
    expect(giftStatus.classList.contains("button-secondary")).toBe(true);
    giftStatus.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-gifts="gift"] [data-gift-state]')
          ?.textContent,
      ).toBe("Status changed.")
    );
    const debtId = records.debts[0]!.id;
    document.querySelector<HTMLButtonElement>(
      `[data-debt-status-save="${debtId}"]`,
    )?.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-gifts="debt"] [data-gift-state]')
          ?.textContent,
      ).toBe("Status changed.")
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
    const okReplies = [
      empty,
      { people: [], status: "ready" },
      { files: [], status: "ready" },
      { debt: {}, status: "created" },
      empty,
      { people: [], status: "ready" },
      { files: [], status: "ready" },
    ];
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(response(okReplies.shift()))
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonGifts({ archived: false, personId, workspaceId });
    const debt = document.querySelector<HTMLElement>(
      '[data-person-gifts="debt"]',
    )!;
    debt.querySelector<HTMLButtonElement>("[data-gift-add]")?.click();
    const form = debt.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("amount") as HTMLInputElement).value = "12";
    (form.elements.namedItem("currencyCode") as HTMLSelectElement).value =
      "EUR";
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(debt.querySelector("[data-gift-state]")?.textContent).toBe(
        "Debt saved.",
      )
    );

    markup();
    const failedReplies = [empty, { people: [], status: "ready" }, {
      files: [],
      status: "ready",
    }, { detail: "Invalid transition" }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const value = failedReplies.shift();
        return Promise.resolve(
          response(value, value && "detail" in value ? 409 : 200),
        );
      }),
    );
    await mountPersonGifts({ archived: false, personId, workspaceId });
    const gift = document.querySelector<HTMLElement>(
      '[data-person-gifts="gift"]',
    )!;
    gift.querySelector<HTMLButtonElement>("[data-gift-add]")?.click();
    const giftForm = gift.querySelector<HTMLFormElement>("form")!;
    (giftForm.elements.namedItem("name") as HTMLInputElement).value = "Book";
    giftForm.requestSubmit();
    await vi.waitFor(() =>
      expect(gift.querySelector("[data-gift-state]")?.textContent).toBe(
        "Invalid transition",
      )
    );
    gift.querySelector<HTMLButtonElement>("[data-gift-cancel]")?.click();
    expect(gift.querySelector<HTMLFormElement>("form")?.hidden).toBe(true);
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
    const replies = [records, { people: [], status: "ready" }, {
      files: [],
      status: "ready",
    }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(response(replies.shift()))
      ),
    );
    await mountPersonGifts({ archived: false, personId, workspaceId });
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: true, personId },
      }),
    );
    expect(document.querySelectorAll("[data-gift-add]:not([hidden])"))
      .toHaveLength(0);
    expect(
      document.querySelectorAll(
        "[data-gift-status-save], [data-debt-status-save]",
      ),
    ).toHaveLength(0);
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false, personId },
      }),
    );
    expect(document.querySelectorAll("[data-gift-add]:not([hidden])"))
      .toHaveLength(2);
  });
});
