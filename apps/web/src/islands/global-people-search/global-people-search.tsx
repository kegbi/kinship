/**
 * The global people search and command palette (GAP-027).
 *
 * The header draws a search field and, on a narrow screen, a Search button.
 * Typing, an arrow key or Enter in the field, the button, Ctrl/Cmd+K, or `/`
 * opens the palette: a modal dialog holding the same field, the list of
 * matches, and a polite status line. The field is one component rendered in
 * one place at a time, in the header while the palette is closed and in the
 * dialog while it is open, so it keeps its id, its value, and the focus the
 * reader gave it.
 *
 * What the list shows is `search.ts`'s work: recent people for an empty
 * query, the member's commands after `>`, and a workspace people search
 * otherwise. The field is bound before the session and preferences load
 * (REL-039): the palette opens at once and fills in when they arrive.
 */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getMemberPreferences,
  getPerson,
  getTodayRecentPeople,
  listPeople,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Avatar } from "@/components/ui/avatar.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Command, CommandItem, CommandList } from "@/components/ui/command.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  displayPersonName,
  type PersonNameOrder,
} from "../../lib/person-name.ts";
import { resolveWorkspaceSession } from "../../lib/workspace-context.ts";
import { settle, useDocumentEvent } from "../core/index.ts";
import {
  commandAnswer,
  commandIndex,
  directorySearchPerson,
  initials,
  type PaletteAnswer,
  type PaletteCommand,
  type PaletteRow,
  peopleAnswer,
  type SearchPerson,
  UNAVAILABLE_ANSWER,
} from "./search.ts";

export const SEARCH_DEBOUNCE_MS = 200;
const DIALOG_ID = "global-people-search-dialog";
const INPUT_ID = "global-people-search-input";
const RESULTS_ID = "global-people-search-results";
const LABEL = "Find a person";

interface SearchContext {
  readonly commands: readonly PaletteCommand[];
  readonly nameOrder: PersonNameOrder;
  readonly workspaceId: string;
}

type ContextState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly context: SearchContext }
  | { readonly status: "unavailable" };

/** One query the palette is answering. */
interface Request {
  readonly context: SearchContext;
  readonly query: string;
}

/** Who opened the palette, and so takes the focus back when it closes. */
type Opener = HTMLElement | "field" | undefined;

export interface GlobalPeopleSearchProps {
  /** Whether the header field had the focus before the island mounted. */
  readonly initialFocus: boolean;
  /** What was typed into the header field before the island mounted. */
  readonly initialQuery: string;
  readonly navigate: (path: string) => void;
}

async function recentAnswer(
  { commands, nameOrder, workspaceId }: SearchContext,
  signal: AbortSignal,
): Promise<PaletteAnswer> {
  const recent = await settle(
    () => getTodayRecentPeople(workspaceId),
    signal,
  );
  if (recent.status !== "ready") return UNAVAILABLE_ANSWER;
  const identities = await Promise.all(
    recent.data!.people.map(
      async (person): Promise<SearchPerson | undefined> => {
        const identity = await settle(
          () => getPerson(person.id, workspaceId, "summary"),
          signal,
        );
        return identity.status === "ready"
          ? {
            archived: identity.data!.status === "archived",
            ...(identity.data!.person.avatar
              ? { avatar: identity.data!.person.avatar }
              : {}),
            id: person.id,
            name: displayPersonName(identity.data!.person, nameOrder),
          }
          : undefined;
      },
    ),
  );
  const found = identities.filter((person) => person !== undefined);
  const answer = peopleAnswer(found, commands);
  return found.length < identities.length
    ? { ...answer, problem: true, status: "Some recent people are unavailable" }
    : answer;
}

async function searchAnswer(
  { commands, nameOrder, workspaceId }: SearchContext,
  query: string,
  signal: AbortSignal,
): Promise<PaletteAnswer> {
  const result = await settle(
    () => listPeople({ limit: 8, search: query }, workspaceId),
    signal,
  );
  if (result.status !== "ready") return UNAVAILABLE_ANSWER;
  return peopleAnswer(
    result.data!.people.map((person) =>
      directorySearchPerson(person, nameOrder)
    ),
    commands,
    query,
  );
}

function isEditable(element: Element | null): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) return true;
  const editable = element?.closest<HTMLElement>("[contenteditable]");
  return Boolean(editable && editable.contentEditable !== "false");
}

/**
 * Clicks Quick capture's header opener, waiting until its module has wired it
 * (`data-interaction-capture-ready` stops being `"false"`). Answers the
 * function that stops waiting.
 */
function openQuickCapture(): () => void {
  const opener = document.querySelector<HTMLButtonElement>(
    "header [data-quick-capture]",
  );
  if (!opener) return () => undefined;
  if (opener.dataset.interactionCaptureReady !== "false") {
    opener.click();
    return () => undefined;
  }
  const handoff = new MutationObserver(() => {
    if (opener.dataset.interactionCaptureReady === "false") return;
    handoff.disconnect();
    opener.click();
  });
  handoff.observe(opener, {
    attributeFilter: ["data-interaction-capture-ready"],
  });
  return () => handoff.disconnect();
}

/** The glyph an add or command row shows where a person row has an avatar. */
const AVATAR =
  "grid aspect-square w-10 place-items-center rounded-full bg-(--positive) text-[.75rem] font-bold text-(--ink-inverse)";

function PaletteOption(
  props: {
    readonly onSelect: (row: PaletteRow) => void;
    readonly row: PaletteRow;
  },
) {
  const { row } = props;
  return (
    <CommandItem
      className={row.kind === "person"
        ? undefined
        : "grid-cols-[2.5rem_minmax(0,1fr)]"}
      onSelect={() => props.onSelect(row)}
      value={row.key}
    >
      {row.kind === "person"
        ? <Avatar avatar={row.avatar} initials={initials(row.label)} />
        : (
          <span aria-hidden="true" className={AVATAR}>
            {row.kind === "add" ? "+" : ">"}
          </span>
        )}
      {row.kind === "person"
        ? (
          <span className="grid min-w-0 wrap-anywhere">
            <strong>{row.label}</strong>
          </span>
        )
        : <strong>{row.label}</strong>}
      {row.kind === "person" && row.archived
        ? <Badge variant="secondary">Archived</Badge>
        : null}
    </CommandItem>
  );
}

export function GlobalPeopleSearch(props: GlobalPeopleSearchProps) {
  const { navigate } = props;
  const opensAtOnce = props.initialFocus && props.initialQuery !== "";
  const [open, setOpen] = useState(opensAtOnce);
  const [query, setQuery] = useState(props.initialQuery);
  const [contextState, setContextState] = useState<ContextState>({
    status: "loading",
  });
  const fieldRef = useRef<HTMLInputElement>(null);
  const paletteFieldRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Opener>(opensAtOnce ? "field" : undefined);
  const handingOff = useRef(false);
  const stopHandoff = useRef<() => void>(() => undefined);
  const unavailable = contextState.status === "unavailable";

  const openPalette = useCallback((by: Opener) => {
    if (unavailable) return;
    if (open) {
      paletteFieldRef.current?.focus();
      return;
    }
    opener.current = by;
    setOpen(true);
  }, [open, unavailable]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // The session and preferences load once, after every handler is bound.
  useEffect(() => {
    let live = true;
    void (async () => {
      const session = await resolveWorkspaceSession();
      if (session.status !== "ready") {
        if (live) setContextState({ status: "unavailable" });
        return;
      }
      const workspaceId = session.session.workspace.id;
      const preferences = await getMemberPreferences(workspaceId)
        .catch(() => undefined);
      if (!live) return;
      setContextState({
        context: {
          commands: commandIndex(session.session.member.role),
          nameOrder: preferences?.ok
            ? preferences.value.preferences.contactNameOrder
            : "given_family_nickname",
          workspaceId,
        },
        status: "ready",
      });
    })();
    return () => {
      live = false;
    };
  }, []);

  // A palette opened early closes when the session turns out unavailable.
  if (unavailable && open) close();

  useEffect(() => () => stopHandoff.current(), []);

  useLayoutEffect(() => {
    if (props.initialFocus && !opensAtOnce) fieldRef.current?.focus();
    // Only the first render replays what happened before the island mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The field moves into the dialog in the same commit that opens it.
  useLayoutEffect(() => {
    if (open) paletteFieldRef.current?.focus();
  }, [open]);

  useDocumentEvent<KeyboardEvent>("keydown", (event) => {
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
    fieldRef.current?.focus();
  });

  const context = contextState.status === "ready"
    ? contextState.context
    : undefined;
  const trimmed = query.trim();
  const request = useMemo<Request | undefined>(
    () => open && context ? { context, query: trimmed } : undefined,
    [context, open, trimmed],
  );
  const commandsAnswer = useMemo(
    () =>
      request?.query.startsWith(">")
        ? commandAnswer(request.context.commands, request.query.slice(1).trim())
        : undefined,
    [request],
  );
  const [remote, setRemote] = useState<
    { readonly answer: PaletteAnswer; readonly request: Request }
  >();
  useEffect(() => {
    if (!request || request.query.startsWith(">")) return;
    const controller = new AbortController();
    const load = async () => {
      const answer = request.query
        ? await searchAnswer(request.context, request.query, controller.signal)
        : await recentAnswer(request.context, controller.signal);
      if (!controller.signal.aborted) setRemote({ answer, request });
    };
    const timer = request.query
      ? setTimeout(() => void load(), SEARCH_DEBOUNCE_MS)
      : undefined;
    if (!timer) void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [request]);
  const answer: PaletteAnswer = commandsAnswer ??
    (remote && remote.request === request ? remote.answer : {
      problem: false,
      rows: [],
      status: request?.query ? "Searching people" : "",
    });

  // The first option is active whenever the options change.
  const [picked, setPicked] = useState<
    { readonly rows: readonly PaletteRow[]; readonly value: string }
  >();
  const active = picked && picked.rows === answer.rows
    ? picked.value
    : answer.rows[0]?.key ?? "";

  // The field names the listbox and its active option; cmdk generates both
  // ids, so they are read once the list has drawn.
  useLayoutEffect(() => {
    const field = paletteFieldRef.current;
    const list = listRef.current;
    if (!field || !list) return;
    field.setAttribute("aria-controls", list.id);
    const option = [...list.querySelectorAll<HTMLElement>("[cmdk-item]")]
      .find((item) => item.dataset.value === active);
    if (option) field.setAttribute("aria-activedescendant", option.id);
    else field.removeAttribute("aria-activedescendant");
  });

  const activate = (row: PaletteRow) => {
    if (row.kind === "command" && row.command === "log-interaction") {
      handingOff.current = true;
      close();
      return;
    }
    if (row.path) {
      close();
      navigate(row.path);
    }
  };

  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      openPalette("field");
    }
  };

  const field = (inPalette: boolean) => (
    <input
      aria-autocomplete={inPalette ? "list" : undefined}
      // The closed field controls the palette; the open one, its results
      // (the listbox inside, once cmdk has drawn it and named it).
      aria-controls={inPalette ? RESULTS_ID : DIALOG_ID}
      aria-expanded={inPalette}
      aria-label={LABEL}
      autoComplete="off"
      className="global-people-search-input"
      id={INPUT_ID}
      maxLength={200}
      onChange={(event) => {
        setQuery(event.target.value);
        if (!inPalette) openPalette("field");
      }}
      onKeyDown={inPalette ? undefined : onFieldKeyDown}
      placeholder="Search people…"
      ref={inPalette ? paletteFieldRef : fieldRef}
      role="combobox"
      type="search"
      value={query}
    />
  );

  return (
    <>
      {open ? null : field(false)}
      <button
        aria-controls={DIALOG_ID}
        aria-expanded={open}
        aria-label={LABEL}
        className={buttonVariants({
          className: "global-people-search-open",
          variant: "outline",
        })}
        data-global-people-search-open=""
        onClick={(event) => openPalette(event.currentTarget)}
        type="button"
      >
        <span>Search</span>
      </button>
      <Dialog
        onOpenChange={(next) => {
          if (!next) close();
        }}
        onOpenChangeComplete={(isOpen) => {
          if (isOpen || !handingOff.current) return;
          handingOff.current = false;
          stopHandoff.current();
          stopHandoff.current = openQuickCapture();
        }}
        open={open}
      >
        <DialogContent
          className="max-[760px]:max-h-[calc(100dvh-1rem)] max-[760px]:p-(--space-4)"
          finalFocus={() => {
            if (handingOff.current) return false;
            const by = opener.current;
            opener.current = undefined;
            if (by === "field") return fieldRef.current ?? false;
            return by?.isConnected ? by : false;
          }}
          id={DIALOG_ID}
          initialFocus={paletteFieldRef}
          keepMounted
        >
          {open
            ? (
              <>
                <header className="flex items-start justify-between gap-(--space-4)">
                  <div>
                    {/* The section kicker's look, without the page margin it carries. */}
                    <p className="m-0 text-[.7rem] font-bold tracking-[.12em] text-(--accent-hover) uppercase">
                      People
                    </p>
                    <DialogTitle className="text-[1.5rem] leading-[normal]">
                      {LABEL}
                    </DialogTitle>
                  </div>
                  <DialogClose
                    className={buttonVariants({ variant: "outline" })}
                    data-global-people-search-close=""
                  >
                    Close
                  </DialogClose>
                </header>
                <Command
                  loop
                  onValueChange={(value) =>
                    setPicked({ rows: answer.rows, value })}
                  shouldFilter={false}
                  value={active}
                  vimBindings={false}
                >
                  {field(true)}
                  {answer.empty
                    ? (
                      <p
                        className="m-0 p-(--space-3) text-muted-foreground"
                        id="global-people-search-empty"
                      >
                        {answer.empty}
                      </p>
                    )
                    : null}
                  {answer.problem
                    ? (
                      <p
                        className="m-0 p-(--space-3) text-muted-foreground"
                        id="global-people-search-problem"
                      >
                        People search is temporarily unavailable. Try again.
                      </p>
                    )
                    : null}
                  <div id={RESULTS_ID}>
                    <CommandList label="People search results" ref={listRef}>
                      {answer.rows.map((row) => (
                        <PaletteOption
                          key={row.key}
                          onSelect={activate}
                          row={row}
                        />
                      ))}
                    </CommandList>
                  </div>
                </Command>
                <p
                  aria-live="polite"
                  className="sr-only"
                  id="global-people-search-status"
                  role="status"
                >
                  {answer.status}
                </p>
              </>
            )
            : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
