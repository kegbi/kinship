/**
 * A person's gifts and debts: the pilot island of ADR 0006 (GAP-026).
 *
 * The profile shows gifts and debts as two sibling cards, and one API answer
 * carries both collections, each paging on its own cursor. One component owns
 * that state for both cards: it renders the gift card into the root the
 * section already is and the debt card into its sibling through a portal, so
 * there is exactly one list request, one save in flight, and one refresh after
 * it — the serialization `lib/person-gifts.ts` kept with module flags.
 *
 * Both cards keep the markup the static shell drew (the section element, its
 * heading, glyph, badge, and state line) and the classes the person
 * stylesheet targets, so the page looks the same before and after hydration.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
  type GiftDebtPageInput,
  type GiftStatus,
  listPeople,
  listPersonFiles,
  listPersonGifts,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  formActionsVariants,
  skeletonLinesVariants,
  skeletonVariants,
} from "@/components/ui/variants.ts";
import type { StatusRegionProps } from "../../features/person/status-region.ts";
import { SECTION_ICON_PATHS } from "../../lib/section-icons.ts";
import {
  LoadMore,
  settle,
  useDocumentEvent,
  useLatestRequest,
} from "../core/index.ts";
import { DebtEditor, GiftEditor, type SaveOutcome } from "./forms.tsx";
import {
  attachmentChoices,
  countText,
  debtDetail,
  debtStatusOptions,
  debtTitle,
  type EditorOptions,
  EMPTY_RECORDS,
  foldPage,
  type GiftDebtRecords,
  giftDetail,
  giftStatusOptions,
  recipientChoices,
  type RecordType,
  SURFACES,
  withoutCursors,
} from "./records.ts";

export interface PersonGiftsProps {
  readonly archived: boolean;
  /** Called once, when the first list answer has settled either way. */
  readonly onSettled?: () => void;
  readonly personId: string;
  /** The two server-rendered cards; the gift card is the island's root. */
  readonly sections: { readonly debt: HTMLElement; readonly gift: HTMLElement };
  /** What each card's state line spreads to be a live region, if anything. */
  readonly statusRegion?: StatusRegionProps;
  readonly workspaceId: string;
}

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly detail: string };

type OptionsState =
  | { readonly status: "idle" | "loading" | "failed" }
  | { readonly status: "ready"; readonly value: EditorOptions };

type PerSurface<T> = { readonly debt: T; readonly gift: T };

const OPTIONS_LOADING = "Loading gift and debt form options…";
const OPTIONS_FAILED =
  "Gift and debt form options could not be loaded. Close and reopen the editor to try again.";
const LIST_UNAVAILABLE = "Gifts and debts are temporarily unavailable.";
const CLOSED: PerSurface<boolean> = { debt: false, gift: false };

export function PersonGifts(props: PersonGiftsProps) {
  const { personId, sections, workspaceId } = props;
  const [archived, setArchived] = useState(props.archived);
  const [records, setRecords] = useState<GiftDebtRecords>(EMPTY_RECORDS);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [editors, setEditors] = useState<PerSurface<boolean>>(CLOSED);
  const [options, setOptions] = useState<OptionsState>({ status: "idle" });
  const [notices, setNotices] = useState<Partial<PerSurface<string>>>({});
  const request = useLatestRequest();
  // One save or status change at a time, across both cards.
  const mutating = useRef(false);
  const optionsLoad = useRef<Promise<boolean> | undefined>(undefined);
  const settled = useRef(props.onSettled);

  const notify = useCallback(
    (type: RecordType, notice: string | undefined) =>
      setNotices((current) => ({ ...current, [type]: notice })),
    [],
  );

  /**
   * Asks for the first page, or continues one collection, and applies the
   * answer if it is still the latest. Answers whether the list is now ready.
   */
  const refresh = useCallback(
    (continued: GiftDebtPageInput = {}): Promise<boolean> =>
      request(() => listPersonGifts(personId, workspaceId, continued)).then(
        (answer) => {
          if (!answer) return false;
          setNotices({});
          if (answer.status !== "ready" || !answer.data) {
            setRecords(withoutCursors);
            setList({
              detail: answer.problem?.detail ?? LIST_UNAVAILABLE,
              status: "error",
            });
            return false;
          }
          const page = answer.data;
          setRecords((current) => foldPage(current, page, continued));
          setList({ status: "ready" });
          return true;
        },
      ),
    [personId, request, workspaceId],
  );

  useEffect(() => {
    void refresh().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, [refresh]);

  useLayoutEffect(() => {
    for (const type of ["gift", "debt"] as const) {
      const count = type === "gift"
        ? records.gifts.length
        : records.debts.length;
      sections[type].setAttribute(
        "data-section-state",
        list.status === "ready" ? count === 0 ? "empty" : "ready" : list.status,
      );
    }
  }, [list.status, records.debts.length, records.gifts.length, sections]);

  useDocumentEvent<CustomEvent<{ archived?: boolean; personId?: string }>>(
    "person-lifecycle-changed",
    (event) => {
      const detail = event.detail;
      if (
        detail?.personId !== personId || typeof detail.archived !== "boolean"
      ) return;
      setArchived(detail.archived);
      setEditors(CLOSED);
      setNotices({});
    },
  );

  const loadOptions = useCallback((): Promise<boolean> => {
    optionsLoad.current ??= (async () => {
      setOptions({ status: "loading" });
      const [people, files] = await Promise.all([
        settle(() => listPeople({ limit: 50 }, workspaceId)),
        settle(() => listPersonFiles(personId, workspaceId, { limit: 50 })),
      ]);
      if (people.data && files.data) {
        setOptions({
          status: "ready",
          value: { files: files.data.files, people: people.data.people },
        });
        return true;
      }
      optionsLoad.current = undefined;
      setOptions({ status: "failed" });
      return false;
    })();
    return optionsLoad.current;
  }, [personId, workspaceId]);

  const openEditor = async (type: RecordType) => {
    setEditors((current) => ({ ...current, [type]: true }));
    if (options.status !== "ready") notify(type, OPTIONS_LOADING);
    const loaded = await loadOptions();
    notify(type, loaded ? undefined : OPTIONS_FAILED);
  };

  const closeEditor = (type: RecordType) =>
    setEditors((current) => ({ ...current, [type]: false }));

  const save = async (
    type: RecordType,
    input: object,
  ): Promise<SaveOutcome> => {
    if (mutating.current) return undefined;
    mutating.current = true;
    notify(type, type === "gift" ? "Saving gift…" : "Saving debt…");
    const answer = await settle<unknown>(() =>
      type === "gift"
        ? createGift(personId, input as GiftCreateInput, workspaceId)
        : createDebt(personId, input as DebtCreateInput, workspaceId)
    );
    mutating.current = false;
    if (answer.status !== "ready") {
      notify(type, answer.problem?.detail ?? "The record could not be saved.");
      return answer.problem;
    }
    closeEditor(type);
    if (await refresh()) {
      notify(type, type === "gift" ? "Gift saved." : "Debt saved.");
    }
    return undefined;
  };

  const changeStatus = async (type: RecordType, id: string, next: string) => {
    if (mutating.current) return;
    mutating.current = true;
    const answer = await settle<unknown>(() =>
      type === "gift"
        ? changeGiftStatus(personId, id, next as GiftStatus, workspaceId)
        : changeDebtStatus(personId, id, next as DebtStatus, workspaceId)
    );
    mutating.current = false;
    if (answer.status !== "ready") {
      notify(
        type,
        answer.problem?.detail ?? "The status could not be changed.",
      );
      return;
    }
    if (await refresh()) notify(type, "Status changed.");
  };

  const surface = (type: RecordType, items: ReactNode, count: number) => (
    <Surface
      archived={archived}
      count={count}
      editor={editors[type]
        ? type === "gift"
          ? (
            <GiftEditor
              attachments={options.status === "ready"
                ? attachmentChoices(options.value)
                : []}
              currencies={records.currencies}
              gated={options.status !== "ready"}
              onCancel={() => closeEditor("gift")}
              onSave={(input) => save("gift", input)}
              recipients={options.status === "ready"
                ? recipientChoices(options.value)
                : []}
            />
          )
          : (
            <DebtEditor
              currencies={records.currencies}
              gated={options.status !== "ready"}
              onCancel={() => closeEditor("debt")}
              onSave={(input) => save("debt", input)}
            />
          )
        : null}
      list={list}
      nextCursor={type === "gift"
        ? records.nextGiftCursor
        : records.nextDebtCursor}
      notice={notices[type]}
      onAdd={() => void openEditor(type)}
      onLoadMore={(cursor) =>
        refresh(
          type === "gift" ? { giftCursor: cursor } : {
            debtCursor: cursor,
          },
        )}
      onRetry={() => void refresh()}
      statusRegion={props.statusRegion}
      type={type}
    >
      {items}
    </Surface>
  );

  return (
    <>
      {surface(
        "gift",
        records.gifts.map((gift) => (
          <GiftItem
            archived={archived}
            gift={gift}
            key={gift.id}
            onChange={(next) => changeStatus("gift", gift.id, next)}
          />
        )),
        records.gifts.length,
      )}
      {createPortal(
        surface(
          "debt",
          records.debts.map((debt) => (
            <DebtItem
              archived={archived}
              debt={debt}
              key={debt.id}
              onChange={(next) => changeStatus("debt", debt.id, next)}
            />
          )),
          records.debts.length,
        ),
        sections.debt,
      )}
    </>
  );
}

function Surface(
  props: {
    readonly archived: boolean;
    readonly children: ReactNode;
    readonly count: number;
    readonly editor: ReactNode;
    readonly list: ListState;
    readonly nextCursor: string | undefined;
    readonly notice: string | undefined;
    readonly onAdd: () => void;
    readonly onLoadMore: (cursor: string) => Promise<unknown>;
    readonly onRetry: () => void;
    readonly statusRegion?: StatusRegionProps | undefined;
    readonly type: RecordType;
  },
) {
  const { id, plural, title } = SURFACES[props.type];
  const listId = `${id}-list`;
  const badge = props.list.status === "loading"
    ? "Loading"
    : props.list.status === "error"
    ? "Unavailable"
    : `${props.count} saved`;
  const state = props.notice ??
    (props.list.status === "error"
      ? props.list.detail
      : props.list.status === "ready"
      ? countText(props.type, props.count)
      : undefined);
  return (
    <>
      <header className="profile-section-heading">
        <span
          aria-hidden="true"
          className="section-icon profile-section-glyph"
          data-section-icon={id}
        >
          <svg
            dangerouslySetInnerHTML={{ __html: SECTION_ICON_PATHS[id] }}
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            viewBox="0 0 24 24"
          />
        </span>
        <div className="profile-section-title">
          <h3 id={`profile-section-${id}-heading`}>{title}</h3>
          <Badge data-gift-badge="" variant="status">
            {badge}
          </Badge>
        </div>
        <Button
          className="profile-section-cta"
          data-gift-add=""
          hidden={props.archived || props.editor !== null}
          onClick={props.onAdd}
          type="button"
        >
          Add {props.type}
        </Button>
      </header>
      {
        /* The profile promotes every state line drawn during its first
          fan-out to a polite live region once that settles (UXD-003B), so the
          loads are not read out; a card mounted after that brings its own
          region (REL-052). */
      }
      <p className="section-state" data-gift-state="" {...props.statusRegion}>
        {state ?? <LoadingState plural={plural} />}
      </p>
      <Button
        data-gift-retry=""
        hidden={props.list.status !== "error"}
        onClick={props.onRetry}
        type="button"
        variant="outline"
      >
        Retry loading
      </Button>
      <ul
        aria-label={`Saved ${plural}`}
        className="person-file-list"
        data-gift-list=""
        id={listId}
      >
        {props.children}
      </ul>
      <LoadMore
        controls={listId}
        cursor={props.nextCursor}
        label={`Load more ${plural}`}
        list={id}
        onLoad={props.onLoadMore}
      />
      {props.editor}
    </>
  );
}

/** The skeleton the static shell drew, kept until the first answer. */
function LoadingState(props: { readonly plural: string }) {
  return (
    <>
      <span className="sr-only">Loading {props.plural}…</span>
      <span aria-hidden="true" className={skeletonLinesVariants}>
        {(["line", "line-80", "line-60"] as const).map((shape) => (
          <span
            aria-hidden="true"
            className={skeletonVariants({ shape })}
            data-slot="skeleton"
            key={shape}
          />
        ))}
      </span>
    </>
  );
}

/** The next-status picker and its button, shown while a step remains. */
function StatusChange(
  props: {
    readonly label: string;
    readonly onChange: (next: string) => Promise<void>;
    readonly options: readonly string[];
    readonly selectData: Record<string, string>;
    readonly saveData: Record<string, string>;
  },
) {
  const [next, setNext] = useState(props.options[0] ?? "");
  return (
    <div className={formActionsVariants({ className: "person-file-actions" })}>
      <select
        {...props.selectData}
        aria-label={`Next status for ${props.label}`}
        onChange={(event) =>
          setNext(event.target.value)}
        value={next}
      >
        {props.options.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
      <Button
        {...props.saveData}
        onClick={() => void props.onChange(next)}
        type="button"
        variant="outline"
      >
        Change status
      </Button>
    </div>
  );
}

function GiftItem(
  props: {
    readonly archived: boolean;
    readonly gift: Gift;
    readonly onChange: (next: string) => Promise<void>;
  },
) {
  const { gift } = props;
  const options = giftStatusOptions(gift.status);
  return (
    <li data-gift-id={gift.id}>
      <strong>{gift.name}</strong>
      <p>{giftDetail(gift)}</p>
      {!props.archived && options.length > 0
        ? (
          <StatusChange
            key={gift.status}
            label={gift.name}
            onChange={props.onChange}
            options={options}
            saveData={{ "data-gift-status-save": gift.id }}
            selectData={{ "data-gift-status": gift.id }}
          />
        )
        : null}
    </li>
  );
}

function DebtItem(
  props: {
    readonly archived: boolean;
    readonly debt: Debt;
    readonly onChange: (next: string) => Promise<void>;
  },
) {
  const { debt } = props;
  const options = debtStatusOptions(debt.status);
  return (
    <li data-debt-id={debt.id}>
      <strong>{debtTitle(debt)}</strong>
      <p>{debtDetail(debt)}</p>
      {!props.archived && options.length > 0
        ? (
          <StatusChange
            key={debt.status}
            label={debtTitle(debt)}
            onChange={props.onChange}
            options={options}
            saveData={{ "data-debt-status-save": debt.id }}
            selectData={{ "data-debt-status": debt.id }}
          />
        )
        : null}
    </li>
  );
}
