// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    defaultCurrencyCode: "EUR",
    gifts: [],
    recurringDebts: [],
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

describe("GIFTS-001 debt reopening and permanent removal", () => {
  it("disables history during reopening and its authoritative refresh, then opens on the next click", async () => {
    markup();
    const reopening = deferred<Response>();
    const refreshing = deferred<Response>();
    stubApi({
      [GIFTS]: [
        page({ debts: [{ ...lunch, status: "settled" }] }),
        refreshing.promise,
      ],
      "PATCH /api/v1/people/:personId/debts/:debtId/status": reopening.promise,
      "GET /api/v1/people/:personId/debts/:debtId/settlements": jsonResponse({
        status: "ready",
        settlements: [{
          id: giftId,
          settledAt: stamped.createdAt,
          reason: "Paid cash",
        }],
        nextCursor: "older",
      }),
    });
    await mount();
    const user = userEvent.setup();
    const historyButton = () =>
      card("debt").getByRole("button", {
        name: "Settlement history for Lunch",
      });
    await user.click(historyButton());
    await screen.findByText("Paid cash");
    await user.click(
      card("debt").getByRole("button", { name: "Reopen Lunch" }),
    );
    expect(historyButton().hasAttribute("disabled")).toBe(true);
    expect(
      card("debt").getByRole("button", { name: "Load older settlements" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => {
      reopening.resolve(jsonResponse({ status: "saved" }));
      await Promise.resolve();
    });
    expect(historyButton().hasAttribute("disabled")).toBe(true);
    await act(async () => {
      refreshing.resolve(page({ debts: [lunch] }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(historyButton().hasAttribute("disabled")).toBe(false)
    );
    expect(card("debt").queryByRole("button", { name: "Reopen Lunch" }))
      .toBeNull();
    await user.click(historyButton());
    expect(await screen.findByText("Paid cash")).toBeTruthy();
  });
  it("reports an already-committed settlement without claiming edited retry details were saved", async () => {
    markup();
    stubApi({
      [GIFTS]: [
        page({ debts: [lunch] }),
        page({ debts: [{ ...lunch, status: "settled" }] }),
      ],
      "PATCH /api/v1/people/:personId/debts/:debtId/status": [
        unreachable,
        jsonResponse({ status: "unchanged" }),
      ],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("debt").getByRole("button", { name: "Change status" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Settle this debt" }),
    );
    await user.type(
      dialog.getByLabelText("Settlement reason (optional)"),
      "Original reason",
    );
    await user.click(dialog.getByRole("button", { name: "Settle debt" }));
    await waitFor(() =>
      expect(dialog.getByRole("status").textContent).toContain(
        "could not be confirmed",
      )
    );
    await user.clear(dialog.getByLabelText("Settlement reason (optional)"));
    await user.type(
      dialog.getByLabelText("Settlement reason (optional)"),
      "Edited after uncertain response",
    );
    await user.click(dialog.getByRole("button", { name: "Settle debt" }));
    await waitFor(() =>
      expect(stateLine("debt")).toBe(
        "Debt was already settled. Its existing history is unchanged.",
      )
    );
  });
  it("asks for optional settlement details without changing status on cancel", async () => {
    markup();
    const api = stubApi({ [GIFTS]: page({ debts: [lunch] }) });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("debt").getByRole("button", { name: "Change status" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Settle this debt",
    });
    expect(within(dialog).getByLabelText("Settlement reason (optional)"))
      .toBeTruthy();
    expect(within(dialog).getByLabelText("Settlement photo (optional)"))
      .toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.requests()).toHaveLength(1);
  });
  it("uploads once, retains its photo on ambiguous failure, blocks pending dismissal, and saves optional details", async () => {
    markup();
    const pending = deferred<Response>();
    const photoId = giftId;
    const api = stubApi({
      [GIFTS]: [
        page({ debts: [lunch] }),
        page({ debts: [{ ...lunch, status: "settled" }] }),
      ],
      "POST /api/v1/people/:personId/files": jsonResponse({
        status: "created",
        file: { fileId: photoId, status: "available" },
      }),
      "PATCH /api/v1/people/:personId/debts/:debtId/status": [
        unreachable,
        pending.promise,
      ],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("debt").getByRole("button", { name: "Change status" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Settle this debt" }),
    );
    await user.type(
      dialog.getByLabelText("Settlement reason (optional)"),
      "Paid at lunch",
    );
    await user.upload(
      dialog.getByLabelText("Settlement photo (optional)"),
      new File(["image"], "payment.png", { type: "image/png" }),
    );
    await user.click(dialog.getByRole("button", { name: "Settle debt" }));
    await waitFor(() =>
      expect(dialog.getByRole("status").textContent).toContain(
        "Your uploaded photo stays in Photos.",
      )
    );
    expect(api.requests().filter((request) => request.method === "DELETE"))
      .toHaveLength(0);
    await user.click(dialog.getByRole("button", { name: "Settle debt" }));
    expect(
      dialog.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"),
    ).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Settle debt" }));
    expect(
      api.requests().filter((request) =>
        request.url.pathname.endsWith("/files")
      ),
    ).toHaveLength(1);
    expect(api.requests().filter((request) => request.method === "PATCH"))
      .toHaveLength(2);
    expect(api.requests()[3]?.body).toEqual({
      status: "settled",
      settlementReason: "Paid at lunch",
      settlementPhotoFileId: photoId,
    });
    await act(async () => {
      pending.resolve(jsonResponse({ status: "saved" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(stateLine("debt")).toBe(
      "Debt settled. Details saved in settlement history.",
    );
  });

  it.each(["failed", "quarantined"])(
    "never settles after a %s photo upload",
    async (outcome) => {
      markup();
      const api = stubApi({
        [GIFTS]: page({ debts: [lunch] }),
        "POST /api/v1/people/:personId/files": outcome === "failed"
          ? unreachable
          : jsonResponse({
            file: { fileId: giftId, status: "quarantined" },
            status: "created",
          }),
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        card("debt").getByRole("button", { name: "Change status" }),
      );
      const dialog = within(await screen.findByRole("dialog"));
      await user.upload(
        dialog.getByLabelText("Settlement photo (optional)"),
        new File(["x"], "photo.png", { type: "image/png" }),
      );
      await user.click(dialog.getByRole("button", { name: "Settle debt" }));
      await waitFor(() =>
        expect(dialog.getByRole("status").textContent).toContain(
          "debt remains open",
        )
      );
      expect(api.requests().some((request) => request.method === "PATCH")).toBe(
        false,
      );
    },
  );

  it("pages persistent history, reports missing photos, and retries failed history reads", async () => {
    markup();
    const event = {
      id: giftId,
      settledAt: stamped.createdAt,
      reason: "Paid cash",
      photoFileId: giftId,
      photoFilename: "payment.png",
      photoAvailable: true,
    };
    const api = stubApi({
      [GIFTS]: page({ debts: [lunch] }),
      "GET /api/v1/people/:personId/debts/:debtId/settlements": [
        problemResponse(503, { detail: "Try again" }),
        jsonResponse({
          status: "ready",
          settlements: [event],
          nextCursor: "older",
        }),
        jsonResponse({
          status: "ready",
          settlements: [{
            ...event,
            id: lunch.id,
            reason: undefined,
            photoAvailable: false,
          }],
        }),
      ],
    });
    await mount(true);
    const user = userEvent.setup();
    await user.click(
      card("debt").getByRole("button", {
        name: "Settlement history for Lunch",
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry history" }),
    );
    expect(await screen.findByText("Paid cash")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open settlement photo: payment.png" })
        .getAttribute("href"),
    ).toContain(`/files/${giftId}/content`);
    await user.click(
      screen.getByRole("button", { name: "Load older settlements" }),
    );
    expect(await screen.findByText("No settlement reason supplied."))
      .toBeTruthy();
    expect(screen.getByText("Settlement photo unavailable: payment.png"))
      .toBeTruthy();
    expect(api.requests().at(-1)?.url.searchParams.get("cursor")).toBe("older");
    await user.click(
      card("debt").getByRole("button", {
        name: "Settlement history for Lunch",
      }),
    );
    expect(screen.queryByText("Paid cash")).toBeNull();
  });

  it("opens a named modal, focuses Keep it, and returns focus after cancellation or Escape", async () => {
    markup();
    const api = stubApi({ [GIFTS]: page({ debts: [lunch] }) });
    await mount();
    const user = userEvent.setup();
    const opener = card("debt").getByRole("button", { name: "Delete Lunch" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", {
      name: "Permanently delete this debt?",
    });
    expect(section("debt").contains(dialog)).toBe(false);
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    const keep = within(dialog).getByRole("button", { name: "Keep it" });
    await waitFor(() => expect(document.activeElement).toBe(keep));
    await user.click(keep);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    await user.click(opener);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(api.requests()).toHaveLength(1);
  });

  it.each(["open", "settled"])(
    "groups every %s debt action under the compact file-action style",
    async (status) => {
      markup();
      stubApi({ [GIFTS]: page({ debts: [{ ...lunch, status }] }) });
      await mount();
      const row = element(`[data-debt-id="${lunch.id}"]`);
      const actions = row.querySelector(":scope > .person-file-actions");
      expect(actions).not.toBeNull();
      expect(
        Array.from(row.querySelectorAll("button")).every((button) =>
          button.parentElement === actions
        ),
      ).toBe(true);
    },
  );

  it("explains recurring charge deletion, reports refusals, and keeps the shared save slot through refresh", async () => {
    markup();
    const deleting = deferred<Response>();
    const refreshing = deferred<Response>();
    const api = stubApi({
      [GIFTS]: [
        page({
          debts: [{ ...lunch, recurringDebtId: giftId }],
          gifts: [firstGift("Book")],
        }),
        refreshing.promise,
      ],
      "DELETE /api/v1/people/:personId/debts/:debtId": [
        problemResponse(409, { detail: "Restore the person first." }),
        unreachable,
        deleting.promise,
      ],
    });
    await mount();
    const user = userEvent.setup();
    const giftStatus = card("gift").getByRole("button", {
      name: "Change status",
    });
    await user.click(
      card("debt").getByRole("button", { name: "Delete Lunch" }),
    );
    expect(
      within(screen.getByRole("dialog")).getByText(
        /recurring schedule continues.*Changing the schedule later/,
      ),
    ).toBeTruthy();
    const remove = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete debt permanently",
    });
    await user.click(remove);
    await waitFor(() =>
      expect(stateLine("debt")).toBe("Restore the person first.")
    );
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent)
      .toBe("Restore the person first.");
    await user.click(remove);
    await waitFor(() =>
      expect(stateLine("debt")).toBe("The debt could not be deleted.")
    );
    await user.click(remove);
    await user.click(remove);
    expect(remove.hasAttribute("disabled")).toBe(true);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Keep it",
      }).hasAttribute("disabled"),
    )
      .toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(giftStatus);
    expect(api.requests()).toHaveLength(4);
    await act(async () =>
      await deleting.resolve(
        jsonResponse({ debtId: lunch.id, status: "deleted" }),
      )
    );
    await waitFor(() => expect(api.requests()).toHaveLength(5));
    fireEvent.click(giftStatus);
    expect(api.requests()).toHaveLength(5);
    await act(async () =>
      await refreshing.resolve(page({ gifts: [firstGift("Book")] }))
    );
    await waitFor(() =>
      expect(stateLine("debt")).toBe("Debt permanently deleted.")
    );
  });

  it("clears deletion confirmation and hides reopen/delete after archiving", async () => {
    markup();
    const api = stubApi({
      [GIFTS]: page({ debts: [{ ...lunch, status: "settled" }] }),
    });
    await mount();
    await userEvent.setup().click(
      card("debt").getByRole("button", { name: "Delete Lunch" }),
    );
    act(() =>
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { personId, archived: true },
        }),
      )
    );
    expect(
      screen.queryByRole("dialog"),
    ).toBeNull();
    expect(card("debt").queryByRole("button", { name: "Reopen Lunch" }))
      .toBeNull();
    act(() =>
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { personId, archived: false },
        }),
      )
    );
    expect(card("debt").getByRole("button", { name: "Delete Lunch" }))
      .toBeTruthy();
    expect(api.requests()).toHaveLength(1);
  });

  it("leaves a refresh failure visible after successful deletion", async () => {
    markup();
    stubApi({
      [GIFTS]: [
        page({ debts: [lunch] }),
        problemResponse(503, { detail: "Refresh unavailable." }),
      ],
      "DELETE /api/v1/people/:personId/debts/:debtId": jsonResponse({
        debtId: lunch.id,
        status: "deleted",
      }),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card("debt").getByRole("button", { name: "Delete Lunch" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete debt permanently" }),
    );
    await waitFor(() => expect(stateLine("debt")).toBe("Refresh unavailable."));
  });

  it("reopens a settled debt and refreshes its authoritative state", async () => {
    markup();
    const api = stubApi({
      [GIFTS]: [
        page({
          debts: [{
            ...lunch,
            status: "settled",
            settledAt: stamped.createdAt,
          }],
        }),
        page({ debts: [lunch] }),
      ],
      "PATCH /api/v1/people/:personId/debts/:debtId/status": jsonResponse({
        status: "saved",
      }),
    });
    await mount();
    await userEvent.setup().click(
      card("debt").getByRole("button", { name: "Reopen Lunch" }),
    );
    await waitFor(() => expect(stateLine("debt")).toBe("Status changed."));
    expect(api.requests()[1]?.body).toEqual({ status: "open" });
    expect(card("debt").getByText(/They owe.*open/)).toBeTruthy();
  });

  it.each(["open", "settled", "cancelled"])(
    "confirms permanent deletion of a %s debt and permits keeping it",
    async (status) => {
      markup();
      const api = stubApi({
        [GIFTS]: [page({ debts: [{ ...lunch, status }] }), page()],
        "DELETE /api/v1/people/:personId/debts/:debtId": jsonResponse({
          debtId: lunch.id,
          status: "deleted",
        }),
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        card("debt").getByRole("button", { name: "Delete Lunch" }),
      );
      expect(
        screen.getByRole("dialog", { name: "Permanently delete this debt?" }),
      )
        .toBeTruthy();
      expect(api.requests()).toHaveLength(1);
      await user.click(screen.getByRole("button", { name: "Keep it" }));
      expect(api.requests()).toHaveLength(1);
      await user.click(
        card("debt").getByRole("button", { name: "Delete Lunch" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Delete debt permanently" }),
      );
      await waitFor(() =>
        expect(stateLine("debt")).toBe("Debt permanently deleted.")
      );
      expect(card("debt").queryByText("Lunch")).toBeNull();
      expect(api.requests()[1]?.method).toBe("DELETE");
      expect(api.requests()[1]?.headers.get("X-Workspace-Id")).toBe(
        workspaceId,
      );
    },
  );
});

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
    await user.click(
      within(await screen.findByRole("dialog", { name: "Settle this debt" }))
        .getByRole("button", { name: "Settle debt" }),
    );
    await waitFor(() =>
      expect(stateLine("debt")).toBe(
        "Debt settled. Details saved in settlement history.",
      )
    );
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
    await user.selectOptions(card("debt").getByRole("combobox"), "cancelled");
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
    // Add gift, Add debt, and Add recurring debt come back.
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(3);
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

describe("GIFTS-001 default currency and recurring debts", () => {
  const RECURRING = "POST /api/v1/people/:personId/recurring-debts";
  const RECURRING_ONE =
    "/api/v1/people/:personId/recurring-debts/:recurringDebtId";
  const ruleId = "00000000-0000-4000-8000-000000000010";
  const rent = {
    ...stamped,
    active: true,
    amount: "500.0000",
    currencyCode: "EUR",
    dayOfMonth: 31,
    direction: "they_owe",
    id: ruleId,
    intervalMonths: 1,
    nextOccurrenceOn: "2026-09-30",
    reason: "Rent share",
    startsOn: "2026-05-31",
  };
  const charged = {
    ...lunch,
    id: "00000000-0000-4000-8000-000000000011",
    occurrenceOn: "2026-08-31",
    reason: "Rent share",
    recurringDebtId: ruleId,
  };
  const recurringCard = () => within(element("[data-recurring-debts]"));

  it("starts the debt and gift currency on the member's preferred one", async () => {
    markup();
    stubApi({
      [GIFTS]: page({
        defaultCurrencyCode: "USD",
        supportedCurrencyCodes: ["EUR", "USD"],
      }),
      ...OPTIONS,
    });
    await mount();
    const user = userEvent.setup();
    await user.click(card("debt").getByRole("button", { name: "Add debt" }));
    expect(
      card("debt").getByLabelText<HTMLSelectElement>("Currency").value,
    ).toBe("USD");
    await user.click(card("gift").getByRole("button", { name: "Add gift" }));
    expect(
      card("gift").getByLabelText<HTMLSelectElement>("Currency (with amount)")
        .value,
    ).toBe("USD");
  });

  it("lists rules beside the debts they charged and creates a rule", async () => {
    markup();
    const api = stubApi({
      [GIFTS]: [
        page({ debts: [charged], recurringDebts: [rent] }),
        page({ debts: [charged], recurringDebts: [rent] }),
      ],
      [RECURRING]: jsonResponse(
        { charged: 3, recurringDebt: rent, status: "created" },
        201,
      ),
    });
    await mount();
    expect(card("debt").getByText(/Recurring, due 2026-08-31/)).toBeTruthy();
    const rules = recurringCard().getByRole("list", {
      name: "Recurring debts",
    });
    expect(within(rules).getByText("Rent share")).toBeTruthy();
    expect(
      within(rules).getByText(
        "They owe · 500 EUR · Monthly on day 31 · Next 2026-09-30",
      ),
    ).toBeTruthy();

    const user = userEvent.setup();
    await user.click(
      recurringCard().getByRole("button", { name: "Add recurring debt" }),
    );
    const form = within(
      recurringCard().getByRole("form", { name: "Add recurring debt" }),
    );
    expect(form.getByLabelText<HTMLSelectElement>("Currency").value).toBe(
      "EUR",
    );
    expect(
      element("[data-recurring-debts] [data-recurring-debt-add]").hidden,
    ).toBe(true);
    await user.type(form.getByLabelText("Amount"), "40");
    await user.clear(form.getByLabelText(/^Day of month/));
    await user.type(form.getByLabelText(/^Day of month/), "31");
    await user.clear(form.getByLabelText("Starts on"));
    await user.type(form.getByLabelText("Starts on"), "2026-05-31");
    await user.type(form.getByLabelText("Reason (optional)"), "Gym");
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(stateLine("debt")).toBe(
        "Recurring debt saved. 3 debts charged.",
      )
    );
    const created = api.requests().find((request) => request.method === "POST");
    expect(created?.body).toEqual({
      amount: "40",
      currencyCode: "EUR",
      dayOfMonth: 31,
      direction: "they_owe",
      intervalMonths: 1,
      reason: "Gym",
      startsOn: "2026-05-31",
    });
    expect(api.calls().filter((call) => call.includes("/gifts")))
      .toHaveLength(2);
    expect(element("[data-recurring-debts]").querySelector("form"))
      .toBeNull();
  });

  it("refuses an impossible day before saving and shows a refused save", async () => {
    markup();
    const api = stubApi({
      [GIFTS]: page(),
      [RECURRING]: problemResponse(409, {
        code: "recurring_debt_limit_reached",
        detail: "This person already has 50 recurring debts.",
        title: "Too many recurring debts",
        type: "about:blank",
      }),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      recurringCard().getByRole("button", { name: "Add recurring debt" }),
    );
    const form = within(
      recurringCard().getByRole("form", { name: "Add recurring debt" }),
    );
    await user.type(form.getByLabelText("Amount"), "40");
    await user.clear(form.getByLabelText(/^Day of month/));
    await user.type(form.getByLabelText(/^Day of month/), "32");
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        form.getByLabelText(/^Day of month/).getAttribute("aria-invalid"),
      ).toBe("true")
    );
    expect(api.requests().some((request) => request.method === "POST"))
      .toBe(false);
    await user.clear(form.getByLabelText(/^Day of month/));
    await user.type(form.getByLabelText(/^Day of month/), "5");
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(stateLine("debt")).toBe(
        "This person already has 50 recurring debts.",
      )
    );
    expect(
      recurringCard().getByRole("form", { name: "Add recurring debt" }),
    ).toBeTruthy();
    await user.click(form.getByRole("button", { name: "Cancel" }));
    expect(element("[data-recurring-debts]").querySelector("form"))
      .toBeNull();
  });

  it("pauses, edits, and deletes a rule through one refresh each", async () => {
    markup();
    const paused = { ...rent, active: false };
    const api = stubApi({
      [GIFTS]: [
        page({ recurringDebts: [rent] }),
        page({ recurringDebts: [paused] }),
        page({ recurringDebts: [paused] }),
        page(),
      ],
      [`PATCH ${RECURRING_ONE}`]: [
        jsonResponse({ charged: 0, recurringDebt: paused, status: "saved" }),
        jsonResponse({ charged: 0, recurringDebt: paused, status: "saved" }),
      ],
      [`DELETE ${RECURRING_ONE}`]: jsonResponse({
        recurringDebtId: ruleId,
        status: "deleted",
      }),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      recurringCard().getByRole("button", { name: "Pause Rent share" }),
    );
    await waitFor(() =>
      expect(stateLine("debt")).toBe("Recurring debt paused.")
    );
    expect(api.requests().at(-2)?.body).toEqual({ active: false });
    expect(recurringCard().getByText("Paused")).toBeTruthy();
    expect(
      recurringCard().getByRole("button", { name: "Resume Rent share" }),
    ).toBeTruthy();

    await user.click(
      recurringCard().getByRole("button", { name: "Edit Rent share" }),
    );
    const form = within(
      recurringCard().getByRole("form", { name: "Edit recurring debt" }),
    );
    expect(form.getByLabelText<HTMLInputElement>("Amount").value).toBe(
      "500.0000",
    );
    await user.clear(form.getByLabelText("Amount"));
    await user.type(form.getByLabelText("Amount"), "550");
    await user.clear(form.getByLabelText("Reason (optional)"));
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(stateLine("debt")).toBe("Recurring debt saved.")
    );
    const edit = api.requests().filter((request) => request.method === "PATCH")
      .at(-1);
    expect(edit?.params.recurringDebtId).toBe(ruleId);
    expect(edit?.body).toEqual({
      amount: "550",
      currencyCode: "EUR",
      dayOfMonth: 31,
      direction: "they_owe",
      endsOn: null,
      intervalMonths: 1,
      reason: null,
      startsOn: "2026-05-31",
    });

    await user.click(
      recurringCard().getByRole("button", { name: "Delete Rent share" }),
    );
    await user.click(recurringCard().getByRole("button", { name: "Keep it" }));
    expect(api.requests().some((request) => request.method === "DELETE"))
      .toBe(false);
    await user.click(
      recurringCard().getByRole("button", { name: "Delete Rent share" }),
    );
    await user.click(
      recurringCard().getByRole("button", { name: "Delete recurring debt" }),
    );
    await waitFor(() =>
      expect(stateLine("debt")).toBe(
        "Recurring debt deleted. The debts it charged stay.",
      )
    );
    expect(recurringCard().getByText("No recurring debts.")).toBeTruthy();
  });

  it("keeps an archived person's rules read-only", async () => {
    markup();
    stubApi({ [GIFTS]: page({ recurringDebts: [rent] }) });
    await mount(true);
    expect(recurringCard().getByText("Rent share")).toBeTruthy();
    expect(recurringCard().queryByRole("button", { name: /Rent share/ }))
      .toBeNull();
    expect(
      element("[data-recurring-debts] [data-recurring-debt-add]").hidden,
    ).toBe(true);
  });
});
