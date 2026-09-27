/**
 * Quick capture: one dialog that records an activity or a note from any
 * protected page (GAP-031).
 *
 * Every button marked `data-quick-capture` opens it — the header's, the
 * person hero's and its notes and activities cards', the activity report's,
 * and the reconnect buttons Today adds as its list renders. Those openers
 * belong to the surfaces that draw them, which decide whether one shows
 * (`hidden`); this island decides whether one works. It keeps every opener on
 * the page disabled, with `data-interaction-capture-ready="false"`, until the
 * session and the member's name order have loaded and its handlers are wired
 * (REL-039), and while a save is in flight; it watches the page for openers
 * added or hidden later, and handles their clicks and keys by delegation.
 *
 * Opening loads the options once — the first page of people, activity types,
 * and emotions, and which kinds the workspace turned on — and later opens
 * reuse them. A Today reconnect opener names the person it asks about; the
 * dialog checks that person is still active before it offers the save, and
 * degrades rather than recording against anyone else. Everything the dialog
 * does is a transition of `captureReducer` (`capture-state.ts`); its reads
 * go through one latest-request slot, and a save is one frozen intent that
 * an uncertain outcome replays exactly.
 *
 * A saved interaction is announced with `INTERACTION_CREATED_EVENT`, the
 * person timeline is told which people changed, and a saved reconnect closes
 * the dialog and tells Today (`TODAY_RECONNECT_RECORDED_EVENT`).
 */

import {
  type SubmitEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  getMemberPreferences,
  type Interaction,
  listInteractionOptions,
  listPeople,
  type PeopleDirectoryPage,
  recordInteraction,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.tsx";
import {
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import {
  displayPersonName,
  type PersonNameOrder,
} from "../../lib/person-name.ts";
import {
  resolveWorkspaceSession,
  WORKSPACE_CHANGE_REQUEST_EVENT,
} from "../../lib/workspace-context.ts";
import {
  type ApiCall,
  settle,
  useLatestRequest,
} from "../../islands/core/index.ts";
import {
  captureControls,
  type CaptureIntent,
  type CaptureKind,
  type CaptureOptions,
  captureReducer,
  captureSubmission,
  type DraftPatch,
  type FocusTarget,
  initialCaptureState,
  kindBlocked,
  type OptionPage,
} from "./capture-state.ts";
import { OptionPicker } from "./option-picker.tsx";
import {
  canonicalUuid,
  INTERACTION_CREATED_EVENT,
  localDateTime,
  PERSON_TIMELINE_CHANGED_EVENT,
  TODAY_RECONNECT_RECORDED_EVENT,
} from "./shared.ts";

export interface QuickCaptureProps {
  /** The person the page is about, chosen in every fresh draft. */
  readonly preferredId?: string | undefined;
}

const OPENER = "button[data-quick-capture]";
const PAGE_SIZE = 20;
const DISCARD = "Discard this unsaved interaction?";

function openerOf(target: EventTarget | null): HTMLButtonElement | undefined {
  const opener = target instanceof Element
    ? target.closest<HTMLButtonElement>(OPENER)
    : null;
  return opener && !opener.disabled ? opener : undefined;
}

function intendedKind(opener: HTMLElement): CaptureKind | undefined {
  const kind = opener.dataset.interactionIntendedKind;
  return kind === "activity" || kind === "note" ? kind : undefined;
}

function peoplePage(
  page: PeopleDirectoryPage,
  order: PersonNameOrder,
): OptionPage {
  return {
    cursor: page.nextCursor,
    records: [
      ...page.people,
      ...(page.selected ? [page.selected] : []),
    ].map((person) => ({
      id: person.id,
      name: displayPersonName(person, order),
    })),
  };
}

/** The people a saved interaction appears for on their timelines. */
function timelinePeople(record: Interaction): readonly string[] {
  if (record.kind === "activity") {
    return record.participants.map((participant) => participant.id);
  }
  return record.kind === "note" && record.person ? [record.person.id] : [];
}

export function QuickCapture(props: QuickCaptureProps) {
  const { preferredId } = props;
  const [state, dispatch] = useReducer(
    captureReducer,
    preferredId,
    (preferred) =>
      initialCaptureState({
        happenedAt: localDateTime(),
        preferredId: preferred,
        requestId: crypto.randomUUID(),
      }),
  );
  const controls = captureControls(state);
  const request = useLatestRequest();
  // Handlers outside React's events read the state they act on here.
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);
  const activeOpener = useRef<HTMLButtonElement | undefined>(undefined);
  // The open in progress; an answer for an earlier open is dropped.
  const currentOpen = useRef<object | undefined>(undefined);
  const returnFocus = useRef<HTMLElement | undefined>(undefined);
  const saving = useRef(false);
  const happenedAtField = useRef<HTMLInputElement>(null);
  const kindField = useRef<HTMLSelectElement>(null);
  const participantsField = useRef<HTMLSelectElement>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const summaryField = useRef<HTMLInputElement>(null);
  const focusTarget = (target: FocusTarget | undefined): HTMLElement | null => {
    switch (target) {
      case "happenedAt":
        return happenedAtField.current;
      case "kind":
        return kindField.current;
      case "participants":
        return participantsField.current;
      case "status":
        return statusLine.current;
      case "submit":
        return submitButton.current;
      case "summary":
        return summaryField.current;
      default:
        return null;
    }
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const resolved = await resolveWorkspaceSession();
      if (!live) return;
      if (resolved.status !== "ready") {
        dispatch({ session: { status: resolved.status }, type: "session" });
        return;
      }
      const workspaceId = resolved.session.workspace.id;
      const preferences = await settle(() => getMemberPreferences(workspaceId));
      if (!live) return;
      dispatch({
        session: {
          nameOrder: preferences.data?.preferences.contactNameOrder ??
            "given_family_nickname",
          status: "ready",
          workspaceId,
        },
        type: "session",
      });
    })();
    return () => {
      live = false;
    };
  }, []);

  // Every opener on the page, including ones added or hidden later.
  const openersDisabled = controls.openers;
  const wired = state.session.status === "ready";
  useLayoutEffect(() => {
    const configure = () => {
      for (
        const opener of document.querySelectorAll<HTMLButtonElement>(OPENER)
      ) {
        // Only a changed value is written, so a mutation batch that did not
        // touch an opener leaves its attributes alone.
        const disabled = openersDisabled || opener.hasAttribute("hidden");
        if (opener.disabled !== disabled) opener.disabled = disabled;
        const ready = wired ? "true" : "false";
        if (opener.dataset.interactionCaptureReady !== ready) {
          opener.dataset.interactionCaptureReady = ready;
        }
      }
    };
    configure();
    const observer = new MutationObserver(configure);
    observer.observe(document.body, {
      attributeFilter: ["hidden"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [openersDisabled, wired]);

  const loadOptions = (
    workspaceId: string,
    order: PersonNameOrder,
  ): ApiCall<CaptureOptions> =>
  async () => {
    const [people, vocabulary] = await Promise.all([
      listPeople({
        limit: PAGE_SIZE,
        ...(preferredId ? { selectedPersonId: preferredId } : {}),
      }, workspaceId),
      listInteractionOptions({ limit: PAGE_SIZE }, workspaceId),
    ]);
    if (!people.ok) return people;
    if (!vocabulary.ok) return vocabulary;
    return {
      ok: true,
      value: {
        activityTypes: {
          cursor: vocabulary.value.activityTypesNextCursor,
          records: vocabulary.value.activityTypes,
        },
        availability: vocabulary.value.availability,
        emotions: {
          cursor: vocabulary.value.emotionsNextCursor,
          records: vocabulary.value.emotions,
        },
        people: peoplePage(people.value, order),
      },
    };
  };

  const openCapture = async (opener: HTMLButtonElement) => {
    const current = latest.current;
    if (current.intent || current.session.status !== "ready") return;
    if (current.open && activeOpener.current === opener) return;
    const { nameOrder, workspaceId } = current.session;
    const open = {};
    activeOpener.current = opener;
    currentOpen.current = open;
    const live = () => currentOpen.current === open;
    const intended = intendedKind(opener);
    dispatch({ type: "open" });
    let options = current.options.status === "ready"
      ? current.options.value
      : undefined;
    if (!options) {
      const answer = await request(loadOptions(workspaceId, nameOrder));
      if (!answer) return;
      options = answer.data;
      dispatch({ happenedAt: localDateTime(), options, type: "options" });
      if (!options || !live()) return;
    }
    if (!live()) return;
    dispatch({ intended, type: "opened" });
    if (
      opener.dataset.todayReconnectCapture === undefined ||
      kindBlocked(options.availability, intended)
    ) return;
    const personId = canonicalUuid(opener.dataset.interactionPersonId ?? "");
    if (!personId) {
      dispatch({ type: "reconnect-settled" });
      return;
    }
    dispatch({ type: "reconnect-checking" });
    const answer = await request(() =>
      listPeople({ limit: 1, selectedPersonId: personId }, workspaceId)
    );
    if (!answer || !live()) return;
    const selected = answer.data?.selected;
    dispatch({
      person: selected && canonicalUuid(selected.id) === personId &&
          selected.lifecycle === "active"
        ? { id: personId, name: displayPersonName(selected, nameOrder) }
        : undefined,
      type: "reconnect-settled",
    });
  };

  // Openers are matched when they are used, so later ones need no wiring.
  const onOpener = useEffectEvent((opener: HTMLButtonElement) => {
    void openCapture(opener);
  });
  useLayoutEffect(() => {
    const click = (event: MouseEvent) => {
      const opener = openerOf(event.target);
      if (opener) onOpener(opener);
    };
    const key = (event: KeyboardEvent) => {
      if (![" ", "Enter", "Spacebar"].includes(event.key)) return;
      const opener = openerOf(event.target);
      if (!opener) return;
      event.preventDefault();
      if (!event.repeat) onOpener(opener);
    };
    document.addEventListener("click", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", key);
    };
  }, []);

  // A workspace switch waits while a draft or a save would be lost.
  useEffect(() => {
    const guard = (event: Event) => {
      if (latest.current.dirty || latest.current.intent) event.preventDefault();
    };
    globalThis.addEventListener(WORKSPACE_CHANGE_REQUEST_EVENT, guard);
    return () =>
      globalThis.removeEventListener(WORKSPACE_CHANGE_REQUEST_EVENT, guard);
  }, []);

  // The tick makes a request for the same target a new request.
  const applyFocus = useEffectEvent(() => {
    const target = focusTarget(state.focus?.target);
    if (target && !target.closest("[hidden]")) target.focus();
  });
  useLayoutEffect(() => applyFocus(), [state.focus]);

  const dismiss = () => {
    const current = latest.current;
    if (current.intent || saving.current) return;
    if (current.dirty && !globalThis.confirm(DISCARD)) return;
    returnFocus.current = activeOpener.current;
    activeOpener.current = undefined;
    currentOpen.current = undefined;
    dispatch({
      happenedAt: localDateTime(),
      requestId: crypto.randomUUID(),
      type: "dismiss",
    });
  };

  const persist = async (intent: CaptureIntent, workspaceId: string) => {
    saving.current = true;
    dispatch({ intent, type: "save" });
    const answer = await settle(() =>
      recordInteraction(intent.input, workspaceId)
    );
    saving.current = false;
    if (answer.status === "ready" && answer.data) {
      const { record } = answer.data;
      const reconnected = intent.reconnectPersonId;
      if (reconnected) {
        returnFocus.current = undefined;
        activeOpener.current = undefined;
        currentOpen.current = undefined;
      }
      dispatch({
        happenedAt: localDateTime(),
        kind: record.kind,
        requestId: crypto.randomUUID(),
        type: "saved",
      });
      globalThis.dispatchEvent(
        new CustomEvent(INTERACTION_CREATED_EVENT, { detail: record }),
      );
      document.dispatchEvent(
        new CustomEvent(PERSON_TIMELINE_CHANGED_EVENT, {
          detail: { personIds: timelinePeople(record) },
        }),
      );
      if (reconnected) {
        globalThis.dispatchEvent(
          new CustomEvent(TODAY_RECONNECT_RECORDED_EVENT, {
            detail: { personId: reconnected, record },
          }),
        );
      }
      return;
    }
    if (answer.problem && answer.problem.status < 500) {
      dispatch({
        detail: answer.problem.detail,
        requestId: crypto.randomUUID(),
        type: "refused",
      });
      return;
    }
    dispatch({ type: "uncertain" });
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = latest.current;
    if (saving.current || current.session.status !== "ready") return;
    const next = captureSubmission(current);
    if (next.type === "focus") dispatch({ target: next.target, type: "focus" });
    else if (next.type === "invalid") {
      dispatch({ reason: next.reason, type: "invalid" });
    } else if (next.type === "send") {
      void persist(next.intent, current.session.workspaceId);
    }
  };

  const session = state.session.status === "ready" ? state.session : undefined;
  const people =
    (search: string, cursor?: string): ApiCall<OptionPage> => async () => {
      const answer = await listPeople({
        ...(cursor ? { cursor } : {}),
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(preferredId ? { selectedPersonId: preferredId } : {}),
      }, session?.workspaceId);
      return answer.ok
        ? {
          ok: true,
          value: peoplePage(
            answer.value,
            session?.nameOrder ?? "given_family_nickname",
          ),
        }
        : answer;
    };
  const vocabulary =
    (target: "activity-type" | "emotion") =>
    (search: string, cursor?: string): ApiCall<OptionPage> =>
    async () => {
      const answer = await listInteractionOptions({
        ...(target === "activity-type"
          ? {
            ...(cursor ? { activityTypeCursor: cursor } : {}),
            ...(search ? { activityTypeSearch: search } : {}),
          }
          : {
            ...(cursor ? { emotionCursor: cursor } : {}),
            ...(search ? { emotionSearch: search } : {}),
          }),
        limit: PAGE_SIZE,
      }, session?.workspaceId);
      if (!answer.ok) return answer;
      return {
        ok: true,
        value: target === "activity-type"
          ? {
            cursor: answer.value.activityTypesNextCursor,
            records: answer.value.activityTypes,
          }
          : {
            cursor: answer.value.emotionsNextCursor,
            records: answer.value.emotions,
          },
      };
    };

  const { draft } = state;
  const note = draft.kind === "note";
  const loaded = state.options.status === "ready"
    ? state.options.value
    : undefined;
  const empty: OptionPage = { records: [] };
  const edit = (patch: DraftPatch) => dispatch({ patch, type: "edit" });

  return (
    <Dialog
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key") dismiss();
      }}
      open={state.open}
    >
      <DialogContent
        className="interaction-capture-dialog"
        finalFocus={() => {
          const target = returnFocus.current;
          returnFocus.current = undefined;
          return target?.isConnected ? target : false;
        }}
        id="interaction-capture-dialog"
        initialFocus={() => focusTarget(latest.current.focus?.target) ?? true}
        keepMounted
      >
        <form
          aria-busy={controls.busy || undefined}
          id="interaction-capture-form"
          method="dialog"
          noValidate
          onInput={() => {
            if (!latest.current.dirty) edit({});
          }}
          onSubmit={submit}
        >
          <header>
            <p className="section-kicker">Quick capture</p>
            <DialogTitle id="interaction-capture-heading">
              Record an activity or note
            </DialogTitle>
          </header>
          <label>
            What are you recording?
            <select
              disabled={controls.kind}
              name="kind"
              onChange={(event) =>
                dispatch({
                  kind: event.currentTarget.value as CaptureKind,
                  type: "kind",
                })}
              ref={kindField}
              value={draft.kind}
            >
              <option
                disabled={!controls.availability.activity}
                value="activity"
              >
                Activity
              </option>
              <option disabled={!controls.availability.note} value="note">
                Note
              </option>
            </select>
          </label>
          <OptionPicker
            chosen={draft.participants}
            disabled={controls.fields}
            initial={loaded?.people ?? empty}
            key={`people-${state.generation}`}
            load={people}
            more={{ data: "participants-more", label: "Load more people" }}
            multiple={!note}
            onChoose={(participants) => edit({ participants })}
            search={{
              id: "interaction-participant-search",
              label: "Search participants",
              maxLength: 200,
              name: "participantSearch",
              placeholder: "Search people",
            }}
            select={{
              describedBy: "interaction-participants-hint",
              id: "interaction-participants",
              label: "Participants",
              name: "participantIds",
              required: true,
              size: 5,
            }}
            selectRef={participantsField}
          />
          <p className="form-hint" id="interaction-participants-hint">
            Choose up to 50 people. Notes belong to one selected person.
          </p>
          <label data-interaction-occurrence="" hidden={note}>
            When it happened
            <input
              aria-describedby="interaction-happened-at-error"
              aria-invalid={state.occurrenceError ? true : undefined}
              disabled={controls.happenedAt}
              name="happenedAt"
              onChange={(event) =>
                edit({ happenedAt: event.currentTarget.value })}
              ref={happenedAtField}
              required={!note}
              type="datetime-local"
              value={draft.happenedAt}
            />
          </label>
          <small className="field-error" id="interaction-happened-at-error">
            {state.occurrenceError}
          </small>
          <div data-interaction-kind="activity" hidden={note}>
            <label>
              Summary{" "}
              <input
                disabled={controls.fields}
                maxLength={500}
                name="summary"
                onChange={(event) =>
                  edit({ summary: event.currentTarget.value })}
                ref={summaryField}
                required
                value={draft.summary}
              />
            </label>
            <OptionPicker
              blank="No category"
              chosen={draft.activityType ? [draft.activityType] : []}
              disabled={controls.fields}
              initial={loaded?.activityTypes ?? empty}
              key={`activity-types-${state.generation}`}
              load={vocabulary("activity-type")}
              more={{
                data: "activity-types-more",
                label: "Load more categories",
              }}
              multiple={false}
              onChoose={([activityType]) => edit({ activityType })}
              search={{
                id: "interaction-activity-type-search",
                label: "Search activity types",
                maxLength: 100,
                name: "activityTypeSearch",
                placeholder: "Search categories",
              }}
              select={{
                id: "interaction-activity-type",
                label: "Activity type",
                name: "activityTypeId",
              }}
            />
            <label>
              Details (optional){" "}
              <textarea
                disabled={controls.fields}
                maxLength={10_000}
                name="description"
                onChange={(event) =>
                  edit({ description: event.currentTarget.value })}
                rows={4}
                value={draft.description}
              />
            </label>
            <OptionPicker
              chosen={draft.emotions}
              disabled={controls.fields}
              initial={loaded?.emotions ?? empty}
              key={`emotions-${state.generation}`}
              load={vocabulary("emotion")}
              more={{ data: "emotions-more", label: "Load more emotions" }}
              multiple
              onChoose={(emotions) => edit({ emotions })}
              search={{
                id: "interaction-emotion-search",
                label: "Search emotions",
                maxLength: 100,
                name: "emotionSearch",
                placeholder: "Search emotions",
              }}
              select={{
                id: "interaction-emotions",
                label: "Emotions (optional)",
                name: "emotionIds",
                size: 4,
              }}
            />
          </div>
          <div data-interaction-kind="note" hidden={!note}>
            <label>
              Note{" "}
              <textarea
                disabled={controls.fields}
                maxLength={10_000}
                name="body"
                onChange={(event) => edit({ body: event.currentTarget.value })}
                rows={5}
                value={draft.body}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={draft.isFavorited}
                disabled={controls.fields}
                name="isFavorited"
                onChange={(event) =>
                  edit({ isFavorited: event.currentTarget.checked })}
                type="checkbox"
              />{" "}
              Keep this note in Today favorites
            </label>
          </div>
          <p
            aria-live="polite"
            className="section-state"
            id="interaction-capture-status"
            ref={statusLine}
            role="status"
            tabIndex={-1}
          >
            {state.status}
          </p>
          <div className={formActionsVariants()}>
            <button
              className={buttonVariants()}
              disabled={controls.submit}
              ref={submitButton}
              type="submit"
            >
              Save interaction
            </button>
            <button
              className={buttonVariants()}
              data-interaction-cancel=""
              disabled={controls.cancel}
              onClick={dismiss}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
