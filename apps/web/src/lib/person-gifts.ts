import {
  changeDebtStatus,
  changeGiftStatus,
  createDebt,
  createGift,
  type Debt,
  type DebtCreateInput,
  type DebtStatus,
  type Gift,
  type GiftCreateInput,
  type GiftStatus,
  listPeople,
  listPersonFiles,
  listPersonGifts,
  type PeopleDirectoryPerson,
  type PersonFile,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { mountLoadMore } from "./load-more.ts";
interface Surface {
  readonly add: HTMLButtonElement;
  readonly badge: HTMLElement;
  readonly cancel: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly list: HTMLUListElement;
  readonly retry: HTMLButtonElement;
  readonly root: HTMLElement;
  readonly state: HTMLElement;
  readonly type: "debt" | "gift";
}

function option(label: string, value: string): HTMLOptionElement {
  const item = document.createElement("option");
  item.textContent = label;
  item.value = value;
  return item;
}

function surfaces(): readonly Surface[] {
  return [...document.querySelectorAll<HTMLElement>("[data-person-gifts]")]
    .flatMap((root) => {
      const type = root.dataset.personGifts;
      const add = root.querySelector<HTMLButtonElement>("[data-gift-add]");
      const badge = root.querySelector<HTMLElement>("[data-gift-badge]");
      const cancel = root.querySelector<HTMLButtonElement>(
        "[data-gift-cancel]",
      );
      const form = root.querySelector<HTMLFormElement>("[data-gift-form]");
      const list = root.querySelector<HTMLUListElement>("[data-gift-list]");
      const retry = root.querySelector<HTMLButtonElement>("[data-gift-retry]");
      const state = root.querySelector<HTMLElement>("[data-gift-state]");
      return (type === "gift" || type === "debt") && add && badge && cancel &&
          form && list && retry && state
        ? [{ add, badge, cancel, form, list, retry, root, state, type }]
        : [];
    });
}

function statusOptions(current: GiftStatus): readonly GiftStatus[] {
  if (current === "idea") return ["planned", "given", "received", "archived"];
  if (current === "planned") return ["given", "received", "archived"];
  if (current === "given" || current === "received") return ["archived"];
  return [];
}

function debtOptions(current: DebtStatus): readonly DebtStatus[] {
  return current === "open" ? ["settled", "cancelled"] : [];
}

function renderGift(
  surface: Surface,
  gifts: readonly Gift[],
  archived: boolean,
) {
  surface.list.replaceChildren();
  surface.badge.textContent = `${gifts.length} saved`;
  surface.root.dataset.sectionState = gifts.length === 0 ? "empty" : "ready";
  surface.add.hidden = archived;
  surface.state.textContent = gifts.length === 0
    ? "No gifts saved."
    : `${gifts.length} gift${gifts.length === 1 ? "" : "s"} saved.`;
  for (const gift of gifts) {
    const item = document.createElement("li");
    item.dataset.giftId = gift.id;
    const title = document.createElement("strong");
    title.textContent = gift.name;
    const detail = document.createElement("p");
    detail.textContent = [
      gift.status,
      gift.amount
        ? `${gift.amount} ${gift.currencyCode ?? ""}`.trim()
        : "Amount unknown",
      gift.recipientPersonId ? "Recipient selected" : "No recipient",
      gift.attachmentFileId ? "Attachment linked" : undefined,
    ].filter(Boolean).join(" · ");
    item.append(title, detail);
    const options = statusOptions(gift.status);
    if (!archived && options.length > 0) {
      const actions = document.createElement("div");
      actions.className = "form-actions";
      const select = document.createElement("select");
      select.dataset.giftStatus = gift.id;
      select.setAttribute("aria-label", `Next status for ${gift.name}`);
      for (const status of options) select.add(option(status, status));
      const save = document.createElement("button");
      save.type = "button";
      save.className = "button-secondary";
      save.dataset.giftStatusSave = gift.id;
      save.textContent = "Change status";
      actions.append(select, save);
      item.append(actions);
    }
    surface.list.append(item);
  }
}

function renderDebt(
  surface: Surface,
  debts: readonly Debt[],
  archived: boolean,
) {
  surface.list.replaceChildren();
  surface.badge.textContent = `${debts.length} saved`;
  surface.root.dataset.sectionState = debts.length === 0 ? "empty" : "ready";
  surface.add.hidden = archived;
  surface.state.textContent = debts.length === 0
    ? "No debts saved."
    : `${debts.length} debt${debts.length === 1 ? "" : "s"} saved.`;
  for (const debt of debts) {
    const item = document.createElement("li");
    item.dataset.debtId = debt.id;
    const title = document.createElement("strong");
    title.textContent = debt.reason ?? "Debt";
    const detail = document.createElement("p");
    detail.textContent = `${
      debt.direction === "i_owe" ? "I owe" : "They owe"
    } · ${debt.amount} ${debt.currencyCode ?? ""} · ${debt.status}`;
    item.append(title, detail);
    const options = debtOptions(debt.status);
    if (!archived && options.length > 0) {
      const actions = document.createElement("div");
      actions.className = "form-actions";
      const select = document.createElement("select");
      select.dataset.debtStatus = debt.id;
      select.setAttribute("aria-label", `Next status for ${title.textContent}`);
      for (const status of options) select.add(option(status, status));
      const save = document.createElement("button");
      save.type = "button";
      save.className = "button-secondary";
      save.dataset.debtStatusSave = debt.id;
      save.textContent = "Change status";
      actions.append(select, save);
      item.append(actions);
    }
    surface.list.append(item);
  }
}

function populateCurrencyOptions(
  surfaces: readonly Surface[],
  supportedCurrencyCodes: readonly string[],
) {
  for (const surface of surfaces) {
    const currencies = surface.form.elements.namedItem("currencyCode") as
      | HTMLSelectElement
      | null;
    if (!currencies) continue;
    currencies.replaceChildren();
    if (surface.type === "gift") {
      currencies.add(option("Select currency", ""));
    }
    for (const code of supportedCurrencyCodes) {
      currencies.add(option(code, code));
    }
  }
}

function populateEditorOptions(
  surfaces: readonly Surface[],
  people: readonly PeopleDirectoryPerson[],
  files: readonly PersonFile[],
) {
  for (const surface of surfaces.filter((value) => value.type === "gift")) {
    const recipients = surface.form.elements.namedItem("recipientPersonId") as
      | HTMLSelectElement
      | null;
    if (recipients) {
      recipients.replaceChildren(option("No recipient", ""));
      for (
        const person of people.filter((person) => person.lifecycle === "active")
      ) {
        const name =
          [person.givenName, person.familyName].filter(Boolean).join(" ") ||
          person.nickname || "Unnamed person";
        recipients.add(option(name, person.id));
      }
    }
    const attachments = surface.form.elements.namedItem("attachmentFileId") as
      | HTMLSelectElement
      | null;
    if (attachments) {
      attachments.replaceChildren(option("No attachment", ""));
      for (const file of files.filter((file) => file.status === "available")) {
        attachments.add(option(file.title, file.fileId));
      }
    }
  }
}

export async function mountPersonGifts(options: {
  readonly archived: boolean;
  readonly personId: string;
  readonly workspaceId: string;
}): Promise<void> {
  const mounted = surfaces();
  if (mounted.length !== 2) return;
  let archived = options.archived;
  for (const surface of mounted) surface.add.hidden = archived;
  let gifts: Gift[] = [];
  let debts: Debt[] = [];
  // Each loader is looked up when its control is pressed, by which time
  // `refresh` below exists.
  const moreGifts = mountLoadMore(
    "gifts",
    (giftCursor) => refresh({ giftCursor }),
  );
  const moreDebts = mountLoadMore(
    "debts",
    (debtCursor) => refresh({ debtCursor }),
  );
  let mutating = false;
  let editorOptionsReady = false;
  let editorOptionsPromise: Promise<boolean> | undefined;

  const loadEditorOptions = (): Promise<boolean> => {
    if (editorOptionsReady) return Promise.resolve(true);
    if (editorOptionsPromise) return editorOptionsPromise;
    editorOptionsPromise = (async () => {
      const [people, files] = await Promise.all([
        listPeople({ limit: 50 }, options.workspaceId).catch(() => undefined),
        listPersonFiles(options.personId, options.workspaceId, { limit: 50 })
          .catch(() => undefined),
      ]);
      if (!people?.ok || !files?.ok) {
        editorOptionsPromise = undefined;
        return false;
      }
      populateEditorOptions(mounted, people.value.people, files.value.files);
      editorOptionsReady = true;
      return true;
    })();
    return editorOptionsPromise;
  };

  const gateEditor = (surface: Surface, ready: boolean) => {
    surface.form.toggleAttribute("aria-busy", !ready);
    for (const control of [...surface.form.elements]) {
      if (
        control instanceof HTMLButtonElement &&
        control.matches("[data-gift-cancel]")
      ) continue;
      (control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement)
        .disabled = !ready;
    }
  };

  const restoreSurfaceState = (surface: Surface) => {
    const count = surface.type === "gift" ? gifts.length : debts.length;
    surface.state.textContent = count === 0
      ? `No ${surface.type}s saved.`
      : `${count} ${surface.type}${count === 1 ? "" : "s"} saved.`;
  };

  const refresh = async (
    continued: { readonly debtCursor?: string; readonly giftCursor?: string } =
      {},
  ): Promise<boolean> => {
    const records = await listPersonGifts(
      options.personId,
      options.workspaceId,
      continued,
    ).catch(() => undefined);
    if (!records?.ok) {
      moreGifts.present(undefined);
      moreDebts.present(undefined);
      const detail = records && !records.ok
        ? records.problem.detail
        : "Gifts and debts are temporarily unavailable.";
      for (const surface of mounted) {
        surface.badge.textContent = "Unavailable";
        surface.root.dataset.sectionState = "error";
        surface.state.textContent = detail;
        surface.retry.hidden = false;
      }
      return false;
    }
    const value = records.value;
    // Each half continues on its own. One answer always carries both, so
    // extending the gift card appends its page and leaves the debts exactly as
    // they were rather than replacing them with their first page again.
    if (continued.giftCursor) gifts = [...gifts, ...value.gifts];
    else if (!continued.debtCursor) gifts = [...value.gifts];
    if (continued.debtCursor) debts = [...debts, ...value.debts];
    else if (!continued.giftCursor) debts = [...value.debts];
    if (!continued.debtCursor) moreGifts.present(value.nextGiftCursor);
    if (!continued.giftCursor) moreDebts.present(value.nextDebtCursor);
    populateCurrencyOptions(mounted, value.supportedCurrencyCodes);
    for (const surface of mounted) {
      surface.retry.hidden = true;
      if (surface.type === "gift") renderGift(surface, gifts, archived);
      else renderDebt(surface, debts, archived);
    }
    return true;
  };

  for (const surface of mounted) {
    surface.add.addEventListener("click", async () => {
      surface.form.hidden = false;
      surface.add.hidden = true;
      gateEditor(surface, false);
      surface.state.textContent = "Loading gift and debt form options…";
      const loaded = await loadEditorOptions();
      if (!loaded) {
        surface.state.textContent =
          "Gift and debt form options could not be loaded. Close and reopen the editor to try again.";
        return;
      }
      gateEditor(surface, true);
      restoreSurfaceState(surface);
    });
    surface.cancel.addEventListener("click", () => {
      surface.form.reset();
      surface.form.hidden = true;
      surface.add.hidden = archived;
    });
    surface.retry.addEventListener("click", () => void refresh());
    surface.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (mutating) return;
      mutating = true;
      const data = new FormData(surface.form);
      const body = Object.fromEntries(
        [...data.entries()].filter(([, value]) => String(value).trim() !== ""),
      );
      if (typeof body.eventAt === "string") {
        body.eventAt = new Date(body.eventAt).toISOString();
      }
      surface.state.textContent = surface.type === "gift"
        ? "Saving gift…"
        : "Saving debt…";
      const result = await (surface.type === "gift"
        ? createGift(
          options.personId,
          body as unknown as GiftCreateInput,
          options.workspaceId,
        )
        : createDebt(
          options.personId,
          body as unknown as DebtCreateInput,
          options.workspaceId,
        )).catch(() => undefined);
      mutating = false;
      if (!result?.ok) {
        surface.state.textContent = result?.problem.detail ??
          "The record could not be saved.";
        return;
      }
      surface.form.reset();
      surface.form.hidden = true;
      if (!(await refresh())) return;
      surface.state.textContent = surface.type === "gift"
        ? "Gift saved."
        : "Debt saved.";
    });
    surface.list.addEventListener("click", async (event) => {
      const button = (event.target as Element | null)?.closest<
        HTMLButtonElement
      >("[data-gift-status-save], [data-debt-status-save]");
      if (!button || mutating) return;
      const giftId = button.dataset.giftStatusSave;
      const debtId = button.dataset.debtStatusSave;
      const id = giftId ?? debtId;
      const select = id &&
        surface.list.querySelector<HTMLSelectElement>(
          giftId ? `[data-gift-status="${id}"]` : `[data-debt-status="${id}"]`,
        );
      if (!id || !select) return;
      mutating = true;
      const result = await (giftId
        ? changeGiftStatus(
          options.personId,
          id,
          select.value as GiftStatus,
          options.workspaceId,
        )
        : changeDebtStatus(
          options.personId,
          id,
          select.value as DebtStatus,
          options.workspaceId,
        )).catch(() => undefined);
      mutating = false;
      if (!result?.ok) {
        surface.state.textContent = result?.problem.detail ??
          "The status could not be changed.";
        return;
      }
      if (!(await refresh())) return;
      surface.state.textContent = "Status changed.";
    });
  }
  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail =
      (event as CustomEvent<{ archived?: boolean; personId?: string }>).detail;
    if (
      detail?.personId !== options.personId ||
      typeof detail.archived !== "boolean"
    ) return;
    archived = detail.archived;
    for (const surface of mounted) {
      surface.form.hidden = true;
      if (surface.type === "gift") renderGift(surface, gifts, archived);
      else renderDebt(surface, debts, archived);
    }
  });
  await refresh();
}
