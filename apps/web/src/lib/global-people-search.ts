import {
  getMemberPreferences,
  getPerson,
  getTodayRecentPeople,
  listPeople,
  type PeopleDirectoryPerson,
  type SessionContext,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { groups } from "./settings-destinations.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import { displayPersonName, type PersonNameOrder } from "./person-name.ts";

type Navigate = (path: string) => void;

const browserNavigate: Navigate = (path) => globalThis.location.assign(path);
const SEARCH_DEBOUNCE_MS = 200;

interface SearchElements {
  readonly close: HTMLButtonElement;
  readonly dialog: HTMLDialogElement;
  readonly empty: HTMLElement;
  readonly home: HTMLElement;
  readonly input: HTMLInputElement;
  readonly inputSlot: HTMLElement;
  readonly list: HTMLUListElement;
  readonly openButtons: readonly HTMLButtonElement[];
  readonly problem?: HTMLElement;
  readonly status: HTMLElement;
}

interface SearchPerson {
  readonly archived: boolean;
  readonly formalNames?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly nickname?: string;
}

type MemberRole = SessionContext["member"]["role"];

interface SearchContext {
  readonly commands: readonly PaletteCommand[];
  readonly nameOrder: PersonNameOrder;
  readonly workspaceId: string;
}

interface PaletteCommand {
  readonly command?: "log-interaction";
  readonly label: string;
  readonly path?: string;
}

const primaryCommands: readonly PaletteCommand[] = [
  { command: "log-interaction", label: "Log interaction" },
  { label: "Add person", path: "/app/people/new" },
  { label: "Add task", path: "/app/tasks" },
  { label: "Today", path: "/app" },
  { label: "People", path: "/app/people" },
  { label: "Tasks", path: "/app/tasks" },
  { label: "Journal", path: "/app/journal" },
  { label: "Settings", path: "/app/settings" },
];

const accessRank: Readonly<Record<MemberRole, number>> = {
  admin: 1,
  member: 0,
  owner: 2,
};

function commandIndex(role: MemberRole): readonly PaletteCommand[] {
  const settingsCommands = groups.flatMap((group) =>
    group.destinations
      .filter((destination) =>
        accessRank[role] >= accessRank[destination.access]
      )
      .map((destination) => ({
        label: `${group.label} · ${destination.label}`,
        path: destination.href,
      }))
  );
  return [...primaryCommands, ...settingsCommands];
}

function matchingCommands(
  commands: readonly PaletteCommand[],
  filter: string,
): readonly PaletteCommand[] {
  const normalizedFilter = filter.toLocaleLowerCase();
  return commands.filter((command) =>
    command.label.toLocaleLowerCase().includes(normalizedFilter)
  );
}

function commandOption(
  command: PaletteCommand,
  index: number,
): HTMLLIElement {
  const option = document.createElement("li");
  option.id = `global-people-search-option-command-${index}`;
  if (command.path) option.dataset.path = command.path;
  if (command.command) option.dataset.command = command.command;
  option.className = "people-search-add-option";
  option.setAttribute("aria-selected", "false");
  option.setAttribute("role", "option");
  const avatar = document.createElement("span");
  avatar.className = "people-search-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = ">";
  const label = document.createElement("strong");
  label.textContent = command.label;
  option.append(avatar, label);
  return option;
}

function searchElements(): SearchElements | undefined {
  const close = document.querySelector<HTMLButtonElement>(
    "[data-global-people-search-close]",
  );
  const dialog = document.querySelector<HTMLDialogElement>(
    "#global-people-search-dialog",
  );
  const empty = document.querySelector<HTMLElement>(
    "#global-people-search-empty",
  );
  const input = document.querySelector<HTMLInputElement>(
    "#global-people-search-input",
  );
  const inputSlot = document.querySelector<HTMLElement>(
    "[data-global-people-search-input-slot]",
  );
  const list = document.querySelector<HTMLUListElement>(
    "#global-people-search-results",
  );
  const openButtons = [...document.querySelectorAll<HTMLButtonElement>(
    "[data-global-people-search-open]",
  )];
  const status = document.querySelector<HTMLElement>(
    "#global-people-search-status",
  );
  const home = input?.parentElement;
  if (
    !close || !dialog || !empty || !home || !input || !inputSlot || !list ||
    openButtons.length === 0 || !status
  ) return undefined;
  const problem = document.querySelector<HTMLElement>(
    "#global-people-search-problem",
  ) ?? undefined;
  return {
    close,
    dialog,
    empty,
    home,
    input,
    inputSlot,
    list,
    openButtons,
    ...(problem ? { problem } : {}),
    status,
  };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return `${words[0]![0] ?? ""}${
    words.length > 1 ? words.at(-1)?.[0] ?? "" : ""
  }`.toLocaleUpperCase();
}

function directorySearchPerson(
  person: PeopleDirectoryPerson,
  nameOrder: PersonNameOrder,
): SearchPerson {
  return {
    archived: person.lifecycle === "archived",
    formalNames: [
      displayPersonName({ ...person, nickname: "" }, "given_family_nickname"),
      displayPersonName({ ...person, nickname: "" }, "family_given_nickname"),
    ],
    id: person.id,
    name: displayPersonName(person, nameOrder),
    ...(person.nickname ? { nickname: person.nickname } : {}),
  };
}

function personOption(person: SearchPerson): HTMLLIElement {
  const option = document.createElement("li");
  option.id = `global-people-search-option-person-${person.id}`;
  option.dataset.path = `/app/people/${encodeURIComponent(person.id)}`;
  option.setAttribute("aria-selected", "false");
  option.setAttribute("role", "option");

  const avatar = document.createElement("span");
  avatar.className = "people-search-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = initials(person.name);
  const identity = document.createElement("span");
  identity.className = "people-search-identity";
  const name = document.createElement("strong");
  name.textContent = person.name;
  identity.append(name);
  option.append(avatar, identity);
  if (person.archived) {
    const archived = document.createElement("span");
    archived.className = "state-badge calm";
    archived.textContent = "Archived";
    option.append(archived);
  }
  return option;
}

function addPersonPath(query: string): string {
  const firstSpace = query.indexOf(" ");
  const givenName = firstSpace === -1 ? query : query.slice(0, firstSpace);
  const familyName = firstSpace === -1
    ? ""
    : query.slice(firstSpace + 1).trim();
  const parameters = new URLSearchParams({ givenName });
  if (familyName) parameters.set("familyName", familyName);
  return `/app/people/new?${parameters.toString()}`;
}

function addPersonOption(query: string): HTMLLIElement {
  const option = document.createElement("li");
  option.id = "global-people-search-option-add";
  option.dataset.path = addPersonPath(query);
  option.className = "people-search-add-option";
  option.setAttribute("aria-selected", "false");
  option.setAttribute("role", "option");
  const avatar = document.createElement("span");
  avatar.className = "people-search-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "+";
  const label = document.createElement("strong");
  label.textContent = `Add "${query}" as a new person`;
  option.append(avatar, label);
  return option;
}

function isEditable(element: Element | null): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) return true;
  const editable = element?.closest<HTMLElement>("[contenteditable]");
  return Boolean(editable && editable.contentEditable !== "false");
}

function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") dialog.close();
  else {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  }
}

export async function mountGlobalPeopleSearch(
  navigate: Navigate = browserNavigate,
): Promise<() => void> {
  const ui = searchElements();
  if (!ui) return () => {};
  // Every listener is bound before the startup reads (REL-039): a shortcut,
  // click, or query that arrives while the session and preferences load opens
  // the palette at once and is rendered when `context` is known.
  let context: SearchContext | undefined = undefined;

  let activeIndex = -1;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let lastOpener: HTMLElement | undefined;
  let requestAbort: AbortController | undefined;
  let quickCaptureHandoff: MutationObserver | undefined;

  const options = (): HTMLElement[] => [
    ...ui.list.querySelectorAll<HTMLElement>('[role="option"]'),
  ];
  const setExpanded = (expanded: boolean): void => {
    ui.input.setAttribute("aria-expanded", String(expanded));
    for (const button of ui.openButtons) {
      button.setAttribute("aria-expanded", String(expanded));
    }
  };
  const setActive = (index: number): void => {
    const rows = options();
    activeIndex = rows.length === 0 ? -1 : (index + rows.length) % rows.length;
    for (const [rowIndex, row] of rows.entries()) {
      row.setAttribute("aria-selected", String(rowIndex === activeIndex));
    }
    const active = rows[activeIndex];
    if (!active) {
      ui.input.removeAttribute("aria-activedescendant");
      return;
    }
    ui.input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView?.({ block: "nearest" });
  };
  const clearResults = (): void => {
    ui.list.replaceChildren();
    ui.empty.hidden = true;
    if (ui.problem) ui.problem.hidden = true;
    setActive(-1);
  };
  const renderPeople = (
    people: readonly SearchPerson[],
    query?: string,
  ): void => {
    const normalizedQuery = query?.trim().toLocaleLowerCase();
    const hasExactMatch = normalizedQuery
      ? people.some((person) =>
        person.name.toLocaleLowerCase() === normalizedQuery ||
        person.formalNames?.some((name) =>
          name.toLocaleLowerCase() === normalizedQuery
        ) ||
        person.nickname?.toLocaleLowerCase() === normalizedQuery
      )
      : true;
    const rows = people.map(personOption);
    if (query && !hasExactMatch) rows.push(addPersonOption(query));
    if (query && people.length === 0 && context) {
      rows.push(
        ...matchingCommands(context.commands, query).map(commandOption),
      );
    }
    ui.list.replaceChildren(...rows);
    ui.empty.textContent = "No people match";
    ui.empty.hidden = people.length > 0 || !query;
    if (ui.problem) ui.problem.hidden = true;
    ui.status.textContent = `${people.length} ${
      people.length === 1 ? "person" : "people"
    } found`;
    setActive(0);
  };
  const renderCommands = (
    commands: readonly PaletteCommand[],
    filter: string,
  ): void => {
    const matches = matchingCommands(commands, filter);
    ui.list.replaceChildren(...matches.map(commandOption));
    ui.empty.textContent = "No commands match";
    ui.empty.hidden = matches.length > 0;
    if (ui.problem) ui.problem.hidden = true;
    ui.status.textContent = `${matches.length} ${
      matches.length === 1 ? "command" : "commands"
    } found`;
    setActive(0);
  };
  const isLatest = (controller: AbortController): boolean =>
    requestAbort === controller && !controller.signal.aborted;
  const loadRecent = async (
    controller: AbortController,
    { nameOrder, workspaceId }: SearchContext,
  ): Promise<void> => {
    const result = await getTodayRecentPeople(workspaceId)
      .catch(() => undefined);
    if (!isLatest(controller)) return;
    if (!result?.ok) {
      clearResults();
      if (ui.problem) ui.problem.hidden = false;
      ui.status.textContent = "People search is temporarily unavailable";
      return;
    }
    const identities = await Promise.all(
      result.value.people.map(async (person) => {
        const identity = await getPerson(person.id, workspaceId, "summary")
          .catch(() => undefined);
        return identity?.ok
          ? {
            archived: identity.value.status === "archived",
            id: person.id,
            name: displayPersonName(identity.value.person, nameOrder),
          }
          : undefined;
      }),
    );
    if (!isLatest(controller)) return;
    renderPeople(identities.filter((person) => person !== undefined));
    if (identities.some((person) => !person)) {
      if (ui.problem) ui.problem.hidden = false;
      ui.status.textContent = "Some recent people are unavailable";
    }
  };
  const loadSearch = async (
    query: string,
    controller: AbortController,
    { nameOrder, workspaceId }: SearchContext,
  ): Promise<void> => {
    const result = await listPeople({ limit: 8, search: query }, workspaceId)
      .catch(() => undefined);
    if (!isLatest(controller)) return;
    if (!result?.ok) {
      clearResults();
      if (ui.problem) ui.problem.hidden = false;
      ui.status.textContent = "People search is temporarily unavailable";
      return;
    }
    renderPeople(
      result.value.people.map((person) =>
        directorySearchPerson(person, nameOrder)
      ),
      query,
    );
  };
  const queue = (value: string): void => {
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    requestAbort?.abort();
    requestAbort = undefined;
    const query = value.trim();
    clearResults();
    // Until the startup reads finish the query waits; they queue it again.
    const ready = context;
    if (!ready) return;
    if (query.startsWith(">")) {
      renderCommands(ready.commands, query.slice(1).trim());
      return;
    }
    const controller = new AbortController();
    requestAbort = controller;
    if (!query) {
      void loadRecent(controller, ready);
      return;
    }
    ui.status.textContent = "Searching people";
    debounce = setTimeout(
      () => void loadSearch(query, controller, ready),
      SEARCH_DEBOUNCE_MS,
    );
  };
  const openPalette = (opener?: HTMLElement): void => {
    if (ui.dialog.open) {
      ui.input.focus();
      return;
    }
    lastOpener = opener;
    ui.inputSlot.append(ui.input);
    setExpanded(true);
    showDialog(ui.dialog);
    ui.input.focus();
    queue(ui.input.value);
  };
  const restore = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    requestAbort?.abort();
    requestAbort = undefined;
    clearResults();
    ui.status.textContent = "";
    ui.input.value = "";
    ui.home.insertBefore(ui.input, ui.openButtons[0] ?? null);
    setExpanded(false);
    const opener = lastOpener;
    lastOpener = undefined;
    if (opener?.isConnected) opener.focus();
  };
  // Quick capture wires its header opener after its own startup reads and
  // marks it `data-interaction-capture-ready="false"` until then, so the
  // request is handed over once it is wired instead of clicking a disabled
  // control.
  const openQuickCapture = (): void => {
    quickCaptureHandoff?.disconnect();
    quickCaptureHandoff = undefined;
    const opener = document.querySelector<HTMLButtonElement>(
      "header [data-quick-capture]",
    );
    if (!opener) return;
    if (opener.dataset.interactionCaptureReady !== "false") {
      opener.click();
      return;
    }
    const handoff = new MutationObserver(() => {
      if (opener.dataset.interactionCaptureReady === "false") return;
      handoff.disconnect();
      if (quickCaptureHandoff === handoff) quickCaptureHandoff = undefined;
      opener.click();
    });
    handoff.observe(opener, {
      attributeFilter: ["data-interaction-capture-ready"],
    });
    quickCaptureHandoff = handoff;
  };
  const activate = (option?: HTMLElement): void => {
    if (option?.dataset.command === "log-interaction") {
      closeDialog(ui.dialog);
      openQuickCapture();
      return;
    }
    const path = option?.dataset.path;
    if (path) {
      closeDialog(ui.dialog);
      navigate(path);
    }
  };
  const onInput = (): void => {
    if (!ui.dialog.open) {
      openPalette(ui.input);
      return;
    }
    queue(ui.input.value);
  };
  const onInputKeydown = (event: KeyboardEvent): void => {
    if (!ui.dialog.open) {
      if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        event.preventDefault();
        openPalette(ui.input);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(options()[activeIndex]);
    }
  };
  const onDocumentKeydown = (event: KeyboardEvent): void => {
    if (
      (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k"
    ) {
      event.preventDefault();
      const active = document.activeElement;
      openPalette(
        active instanceof HTMLElement && active !== document.body
          ? active
          : undefined,
      );
      return;
    }
    if (
      event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey ||
      isEditable(document.activeElement)
    ) return;
    event.preventDefault();
    ui.input.focus();
  };
  const onListClick = (event: MouseEvent): void => {
    const option = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[role="option"]')
      : undefined;
    activate(option ?? undefined);
  };
  const onCloseClick = (): void => closeDialog(ui.dialog);
  const openHandlers = ui.openButtons.map((button) => {
    const handler = () => openPalette(button);
    button.addEventListener("click", handler);
    return { button, handler };
  });

  ui.input.addEventListener("input", onInput);
  ui.input.addEventListener("keydown", onInputKeydown);
  ui.list.addEventListener("click", onListClick);
  ui.close.addEventListener("click", onCloseClick);
  ui.dialog.addEventListener("close", restore);
  document.addEventListener("keydown", onDocumentKeydown);

  const unmount = (): void => {
    quickCaptureHandoff?.disconnect();
    quickCaptureHandoff = undefined;
    if (ui.dialog.open) closeDialog(ui.dialog);
    else restore();
    ui.input.removeEventListener("input", onInput);
    ui.input.removeEventListener("keydown", onInputKeydown);
    ui.list.removeEventListener("click", onListClick);
    ui.close.removeEventListener("click", onCloseClick);
    ui.dialog.removeEventListener("close", restore);
    document.removeEventListener("keydown", onDocumentKeydown);
    for (const { button, handler } of openHandlers) {
      button.removeEventListener("click", handler);
    }
  };
  // A query typed into the focused field before this script ran fired no bound
  // `input` event. The field has autocomplete off, so its value was typed.
  if (ui.input.value && document.activeElement === ui.input) {
    openPalette(ui.input);
  }

  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    unmount();
    return () => {};
  }
  const preferences = await getMemberPreferences(session.session.workspace.id)
    .catch(() => undefined);
  context = {
    commands: commandIndex(session.session.member.role),
    nameOrder: preferences?.ok
      ? preferences.value.preferences.contactNameOrder
      : "given_family_nickname",
    workspaceId: session.session.workspace.id,
  };
  if (ui.dialog.open) queue(ui.input.value);
  return unmount;
}
