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
 *
 * The debt card also lists the person's recurring debts (GIFTS-001): rules
 * that charge the same debt every period. They arrive with every list answer,
 * and every change to one — create, edit, pause, resume, delete — takes the
 * same one-at-a-time save slot and the same authoritative refresh, which is
 * what brings the debts a rule charged into the list beside it.
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
  type ApiResult,
  changeDebtStatus,
  changeGiftStatus,
  createDebt,
  createGift,
  createRecurringDebt,
  type Debt,
  type DebtCreateInput,
  type DebtStatus,
  deleteDebt,
  deleteRecurringDebt,
  type Gift,
  type GiftCreateInput,
  type GiftDebtPageInput,
  type GiftStatus,
  listPeople,
  listPersonFiles,
  listPersonGifts,
  type RecurringDebt,
  type RecurringDebtCreateInput,
  updateRecurringDebt,
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
import {
  DebtEditor,
  GiftEditor,
  RecurringDebtEditor,
  type SaveOutcome,
} from "./forms.tsx";
import {
  attachmentChoices,
  chargeOrder,
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
  recurringDebtChange,
  recurringDebtDetail,
  recurringDebtTitle,
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
const RECURRING_NOT_SAVED = "The recurring debt could not be saved.";
const CLOSED: PerSurface<boolean> = { debt: false, gift: false };

/** How many debts a save charged at once, said after the save itself. */
function chargedText(charged: number): string {
  return charged === 0
    ? ""
    : ` ${charged} ${charged === 1 ? "debt" : "debts"} charged.`;
}

export function PersonGifts(props: PersonGiftsProps) {
  const { personId, sections, workspaceId } = props;
  const [archived, setArchived] = useState(props.archived);
  const [records, setRecords] = useState<GiftDebtRecords>(EMPTY_RECORDS);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [editors, setEditors] = useState<PerSurface<boolean>>(CLOSED);
  const [options, setOptions] = useState<OptionsState>({ status: "idle" });
  const [notices, setNotices] = useState<Partial<PerSurface<string>>>({});
  /** The open recurring debt editor: `"new"`, a rule's id, or none. */
  const [recurringEditor, setRecurringEditor] = useState<string>();
  /** The rule whose deletion is waiting to be confirmed, if any. */
  const [confirmingDelete, setConfirmingDelete] = useState<string>();
  const [confirmingDebtDelete, setConfirmingDebtDelete] = useState<string>();
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
      setRecurringEditor(undefined);
      setConfirmingDelete(undefined);
      setConfirmingDebtDelete(undefined);
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

  /**
   * One change to a recurring debt, through the same save slot and refresh
   * as every other write. Answers the problem a refused change carries.
   */
  const changeRecurring = async <T,>(
    pending: string,
    call: () => Promise<ApiResult<T>>,
    done: (value: T) => string,
  ): Promise<SaveOutcome> => {
    if (mutating.current) return undefined;
    mutating.current = true;
    notify("debt", pending);
    const answer = await settle<T>(call);
    mutating.current = false;
    if (answer.status !== "ready") {
      notify("debt", answer.problem?.detail ?? RECURRING_NOT_SAVED);
      return answer.problem;
    }
    setRecurringEditor(undefined);
    setConfirmingDelete(undefined);
    if (await refresh()) notify("debt", done(answer.data as T));
    return undefined;
  };

  const saveRecurring = (rule: RecurringDebt | undefined, input: object) =>
    changeRecurring<{ readonly charged: number }>(
      "Saving recurring debt…",
      () =>
        rule
          ? updateRecurringDebt(
            personId,
            rule.id,
            recurringDebtChange(input as RecurringDebtCreateInput),
            workspaceId,
          )
          : createRecurringDebt(
            personId,
            input as RecurringDebtCreateInput,
            workspaceId,
          ),
      (saved) => `Recurring debt saved.${chargedText(saved.charged)}`,
    );

  const toggleRecurring = (rule: RecurringDebt) =>
    void changeRecurring(
      rule.active ? "Pausing recurring debt…" : "Resuming recurring debt…",
      () =>
        updateRecurringDebt(
          personId,
          rule.id,
          { active: !rule.active },
          workspaceId,
        ),
      (saved) =>
        saved.recurringDebt.active
          ? `Recurring debt resumed.${chargedText(saved.charged)}`
          : "Recurring debt paused.",
    );

  const removeRecurring = (rule: RecurringDebt) =>
    void changeRecurring(
      "Deleting recurring debt…",
      () => deleteRecurringDebt(personId, rule.id, workspaceId),
      () => "Recurring debt deleted. The debts it charged stay.",
    );

  const removeDebt = async (debt: Debt) => {
    if (mutating.current) return;
    mutating.current = true;
    notify("debt", "Deleting debt…");
    try {
      const answer = await settle(() =>
        deleteDebt(personId, debt.id, workspaceId)
      );
      if (answer.status !== "ready") {
        notify(
          "debt",
          answer.problem?.detail ?? "The debt could not be deleted.",
        );
        return;
      }
      setConfirmingDebtDelete(undefined);
      if (await refresh()) notify("debt", "Debt permanently deleted.");
    } finally {
      mutating.current = false;
    }
  };

  const editedRule = records.recurringDebts.find((rule) =>
    rule.id === recurringEditor
  );
  // An editor for a rule the latest answer no longer lists is closed.
  const openRecurringEditor = recurringEditor === "new" || editedRule
    ? recurringEditor
    : undefined;
  const recurring = (
    <RecurringDebts
      archived={archived}
      confirmingDelete={confirmingDelete}
      editing={openRecurringEditor}
      editor={openRecurringEditor !== undefined
        ? (
          <RecurringDebtEditor
            currencies={records.currencies}
            defaultCurrency={records.defaultCurrency}
            key={recurringEditor}
            onCancel={() => setRecurringEditor(undefined)}
            onSave={(input) => saveRecurring(editedRule, input)}
            rule={editedRule}
          />
        )
        : null}
      onAdd={() => {
        setConfirmingDelete(undefined);
        setRecurringEditor("new");
      }}
      onCancelDelete={() => setConfirmingDelete(undefined)}
      onConfirmDelete={removeRecurring}
      onDelete={(rule) => {
        setRecurringEditor(undefined);
        setConfirmingDelete(rule.id);
      }}
      onEdit={(rule) => {
        setConfirmingDelete(undefined);
        setRecurringEditor(rule.id);
      }}
      onToggle={toggleRecurring}
      ready={list.status === "ready"}
      rules={records.recurringDebts}
    />
  );

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
              defaultCurrency={records.defaultCurrency}
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
              defaultCurrency={records.defaultCurrency}
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
      recurring={type === "debt" ? recurring : null}
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
          chargeOrder(records.debts).map((debt) => (
            <DebtItem
              archived={archived}
              debt={debt}
              confirmingDelete={confirmingDebtDelete === debt.id}
              key={debt.id}
              onCancelDelete={() => setConfirmingDebtDelete(undefined)}
              onChange={(next) => changeStatus("debt", debt.id, next)}
              onConfirmDelete={() => void removeDebt(debt)}
              onDelete={() => setConfirmingDebtDelete(debt.id)}
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
    /** The recurring debts the debt card lists after its own debts. */
    readonly recurring: ReactNode;
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
      {props.recurring}
    </>
  );
}

/**
 * The debt card's recurring debts: each rule with what it charges and when,
 * and the actions a member may take on it. Deleting asks once more, because
 * it cannot be undone; the debts the rule already charged always stay.
 */
function RecurringDebts(
  props: {
    readonly archived: boolean;
    readonly confirmingDelete: string | undefined;
    readonly editing: string | undefined;
    readonly editor: ReactNode;
    readonly onAdd: () => void;
    readonly onCancelDelete: () => void;
    readonly onConfirmDelete: (rule: RecurringDebt) => void;
    readonly onDelete: (rule: RecurringDebt) => void;
    readonly onEdit: (rule: RecurringDebt) => void;
    readonly onToggle: (rule: RecurringDebt) => void;
    /** Whether the list has answered; nothing is offered before it has. */
    readonly ready: boolean;
    readonly rules: readonly RecurringDebt[];
  },
) {
  if (!props.ready) return null;
  return (
    <section
      aria-labelledby="profile-section-debts-recurring-heading"
      data-recurring-debts=""
    >
      <h4 id="profile-section-debts-recurring-heading">Recurring</h4>
      {props.rules.length === 0
        ? <p className="section-state">No recurring debts.</p>
        : (
          <ul
            aria-label="Recurring debts"
            className="person-file-list"
            data-recurring-debt-list=""
          >
            {props.rules.map((rule) => (
              <li data-recurring-debt-id={rule.id} key={rule.id}>
                <strong>{recurringDebtTitle(rule)}</strong>{" "}
                {rule.active ? null : <Badge variant="warning">Paused</Badge>}
                <p>{recurringDebtDetail(rule)}</p>
                {props.archived || props.editing === rule.id
                  ? null
                  : props.confirmingDelete === rule.id
                  ? (
                    <div
                      className={formActionsVariants({
                        className: "person-file-actions",
                      })}
                      role="group"
                      aria-label={`Delete ${recurringDebtTitle(rule)}`}
                    >
                      <span>
                        Delete this recurring debt? The debts it charged stay.
                      </span>
                      <Button
                        onClick={() => props.onConfirmDelete(rule)}
                        type="button"
                        variant="destructive"
                      >
                        Delete recurring debt
                      </Button>
                      <Button
                        onClick={props.onCancelDelete}
                        type="button"
                        variant="outline"
                      >
                        Keep it
                      </Button>
                    </div>
                  )
                  : (
                    <div
                      className={formActionsVariants({
                        className: "person-file-actions",
                      })}
                    >
                      <Button
                        aria-label={`${rule.active ? "Pause" : "Resume"} ${
                          recurringDebtTitle(rule)
                        }`}
                        onClick={() => props.onToggle(rule)}
                        type="button"
                        variant="outline"
                      >
                        {rule.active ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        aria-label={`Edit ${recurringDebtTitle(rule)}`}
                        onClick={() =>
                          props.onEdit(rule)}
                        type="button"
                        variant="outline"
                      >
                        Edit
                      </Button>
                      <Button
                        aria-label={`Delete ${recurringDebtTitle(rule)}`}
                        onClick={() =>
                          props.onDelete(rule)}
                        type="button"
                        variant="outline"
                      >
                        Delete
                      </Button>
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}
      <Button
        data-recurring-debt-add=""
        hidden={props.archived || props.editing !== undefined}
        onClick={props.onAdd}
        type="button"
        variant="outline"
      >
        Add recurring debt
      </Button>
      {props.editor}
    </section>
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
    readonly confirmingDelete: boolean;
    readonly debt: Debt;
    readonly onCancelDelete: () => void;
    readonly onChange: (next: string) => Promise<void>;
    readonly onConfirmDelete: () => void;
    readonly onDelete: () => void;
  },
) {
  const { debt } = props;
  const options = debtStatusOptions(debt.status);
  return (
    <li data-debt-id={debt.id}>
      <strong>{debtTitle(debt)}</strong>
      <p>{debtDetail(debt)}</p>
      {!props.archived && !props.confirmingDelete && debt.status === "settled"
        ? (
          <Button
            aria-label={`Reopen ${debtTitle(debt)}`}
            onClick={() => void props.onChange("open")}
            type="button"
            variant="outline"
          >
            Reopen
          </Button>
        )
        : null}
      {!props.archived && !props.confirmingDelete &&
          debt.status !== "settled" && options.length > 0
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
      {props.archived ? null : props.confirmingDelete
        ? (
          <div
            className={formActionsVariants({
              className: "person-file-actions",
            })}
            role="group"
            aria-label={`Delete ${debtTitle(debt)}`}
          >
            <span>
              Permanently delete this debt? This cannot be
              undone.{debt.recurringDebtId
                ? " The recurring schedule continues; future charges stay. Changing the schedule later may charge deleted periods again."
                : ""}
            </span>
            <Button
              onClick={props.onConfirmDelete}
              type="button"
              variant="destructive"
            >
              Delete debt permanently
            </Button>
            <Button
              onClick={props.onCancelDelete}
              type="button"
              variant="outline"
            >
              Keep it
            </Button>
          </div>
        )
        : (
          <Button
            aria-label={`Delete ${debtTitle(debt)}`}
            onClick={props.onDelete}
            type="button"
            variant="outline"
          >
            Delete
          </Button>
        )}
    </li>
  );
}
