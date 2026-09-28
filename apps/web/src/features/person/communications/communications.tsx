/**
 * A person's calls and conversations cards (GAP-031).
 *
 * The records themselves are listed in the unified timeline above, so each
 * card reports how many recent ones there are and offers an editor that logs
 * a new one: a call with its direction, details, and emotions; a
 * conversation with its channel, the specific contact method it used, a
 * title, and any number of directed messages. The contact methods load only
 * when a conversation editor first opens.
 *
 * One component owns both cards — the calls card is the island's root, the
 * conversations card a portal — because one read answers both: the history
 * and the options. Every read, the first, a retry, and the refresh after a
 * save, goes through one latest-request slot; every transition goes through
 * `communicationsReducer` (`communications-state.ts`). A save is never
 * optimistic: it locks its form, and only an authoritative refresh — the
 * history and the person, whose last contact the hero shows — says it is
 * current. The forms stay the same elements for the section's life, so the
 * page's unsaved-changes guard (`lib/unsaved-changes.ts`) keeps tracking them.
 */

import {
  type ReactNode,
  type SubmitEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getPerson,
  listCommunicationOptions,
  listPersonCommunications,
  listProfileFacts,
  recordInteraction,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  badgeVariants,
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";
import {
  markFormSaved,
  saveWithLockedForm,
} from "../../../lib/unsaved-changes.ts";
import {
  settle,
  useDocumentEvent,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  localDateTime,
  parseLocalInstant,
  PERSON_TIMELINE_CHANGED_EVENT,
} from "../../interactions/shared.ts";
import { setLastContact } from "../profile-summary.ts";
import { SectionGlyph } from "../section-glyph.tsx";
import { SectionLoading } from "../section-loading.tsx";
import type { StatusRegionProps } from "../status-region.ts";
import {
  COMMUNICATION_MESSAGES,
  type CommunicationKind,
  communicationsReducer,
  type CommunicationsState,
  type EditorState,
  initialCommunicationsState,
  writable,
} from "./communications-state.ts";

export interface PersonCommunicationsProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly archived: boolean;
  /** Which cards the workspace turned off when the page loaded. */
  readonly hidden: { readonly calls: boolean; readonly conversations: boolean };
  readonly timePreferences?: TimePreferences | undefined;
  /** The two server-rendered cards; the calls card is the root. */
  readonly sections: {
    readonly call: HTMLElement;
    readonly conversation: HTMLElement;
  };
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
  /** What each card's state line spreads to be a live region, if anything. */
  readonly statusRegion?: StatusRegionProps;
}

const CARDS = {
  call: {
    add: "Log call",
    empty: "No calls recorded yet.",
    one: "call",
    section: "calls",
    title: "Calls",
  },
  conversation: {
    add: "Log conversation",
    empty: "No conversations recorded yet.",
    one: "conversation",
    section: "conversations",
    title: "Conversations",
  },
} as const;

export function PersonCommunications(props: PersonCommunicationsProps) {
  const { personId, sections, timePreferences, workspaceId } = props;
  const [state, dispatch] = useReducer(
    communicationsReducer,
    props.archived,
    initialCommunicationsState,
  );
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);
  // One save at a time per card, even before its render says so.
  const saving = useRef<Record<CommunicationKind, boolean>>({
    call: false,
    conversation: false,
  });
  const contactsLoad = useRef<Promise<void> | undefined>(undefined);

  /** Reads the history and the options, as the cards first did. */
  const load = useCallback(
    (): Promise<void> =>
      request(async () => {
        const [history, options] = await Promise.all([
          listPersonCommunications(personId, workspaceId),
          listCommunicationOptions(workspaceId),
        ]);
        if (!history.ok) return history;
        if (!options.ok) return options;
        return {
          ok: true as const,
          value: { history: history.value, options: options.value },
        };
      }).then((answer) => {
        if (!answer) return;
        if (answer.status === "ready" && answer.data) {
          dispatch({ ...answer.data, type: "loaded" });
        } else dispatch({ type: "load-failed" });
      }),
    [personId, request, workspaceId],
  );

  const firstLoad = useEffectEvent(() => load());
  useEffect(() => {
    void firstLoad().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  /**
   * Reads the history and the person again, shows what answered, and says
   * whether both did. A newer read under way will show its own answer.
   */
  const refresh = async (): Promise<boolean> => {
    const answer = await request(async () => {
      const [history, profile] = await Promise.all([
        settle(() => listPersonCommunications(personId, workspaceId)),
        settle(() => getPerson(personId, workspaceId)),
      ]);
      return { ok: true as const, value: { history, profile } };
    });
    if (!answer?.data) return true;
    const { history, profile } = answer.data;
    if (history.data) dispatch({ history: history.data, type: "history" });
    // The hero shows the last contact (GAP-028).
    if (profile.data) {
      const last = profile.data.person.lastContactAt;
      setLastContact(
        last ? formatInstant(last, timePreferences) : "None recorded",
      );
    }
    return history.status === "ready" && profile.status === "ready";
  };

  useDocumentEvent<CustomEvent<{ archived?: unknown; personId?: unknown }>>(
    "person-lifecycle-changed",
    (event) => {
      const detail = event.detail;
      if (detail?.personId !== personId) return;
      const archived = detail.archived;
      if (typeof archived === "boolean") {
        dispatch({ archived, type: "archived" });
      }
    },
  );

  const loadContacts = () => {
    contactsLoad.current ??= settle(() =>
      listProfileFacts(personId, "contact-methods", {}, workspaceId)
    ).then((answer) => {
      const records = answer.data?.records
        .filter((record) => record.section === "contact-methods")
        .map((record) => ({
          id: record.id,
          typeId: record.value.typeId,
          value: record.value.value,
        }));
      if (!records) contactsLoad.current = undefined;
      dispatch({ records, type: "contacts-settled" });
    });
  };

  const open = (kind: CommunicationKind) => {
    const current = state;
    if (!writable(current, kind) || current.editors[kind].pending) return;
    dispatch({ kind, requestId: crypto.randomUUID(), type: "open" });
    if (kind !== "conversation") return;
    dispatch({ type: "contacts-loading" });
    if (current.contacts.status !== "ready") loadContacts();
  };

  const save = async (kind: CommunicationKind, form: HTMLFormElement) => {
    const current = state;
    const editor = current.editors[kind];
    if (saving.current[kind] || editor.pending || current.archived) return;
    const data = new FormData(form);
    const happenedAt = parseLocalInstant(data.get("happenedAt"));
    if (!happenedAt) {
      dispatch({
        kind,
        notice: COMMUNICATION_MESSAGES.invalidOccurrence,
        type: "notice",
      });
      return;
    }
    const written = data.getAll("messageWrittenAt").map(parseLocalInstant);
    if (written.some((instant) => !instant)) {
      dispatch({
        kind,
        notice: COMMUNICATION_MESSAGES.invalidMessage,
        type: "notice",
      });
      return;
    }
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const contents = data.getAll("messageContent");
    const directions = data.getAll("messageDirection");
    const requestId = editor.requestId ?? crypto.randomUUID();
    const input = kind === "call"
      ? {
        calledAt: happenedAt,
        contactWasCaller: data.get("callDirection") === "contact",
        ...(text("content") ? { content: text("content") } : {}),
        emotionIds: data.getAll("emotionIds").map(String),
        kind: "call" as const,
        personId,
        requestId,
      }
      : {
        channelTypeId: String(data.get("channelTypeId")),
        ...(text("contactMethodId")
          ? { contactMethodId: text("contactMethodId") }
          : {}),
        happenedAt,
        kind: "conversation" as const,
        messages: written.map((writtenAt, index) => ({
          content: String(contents[index] ?? "").trim(),
          direction: directions[index] === "inbound"
            ? "inbound" as const
            : "outbound" as const,
          writtenAt: writtenAt!,
        })),
        personId,
        requestId,
        ...(text("title") ? { title: text("title") } : {}),
      };
    saving.current[kind] = true;
    dispatch({ kind, requestId, type: "saving" });
    const answer = await saveWithLockedForm(
      form,
      () => settle(() => recordInteraction(input, workspaceId)),
    );
    if (answer.status !== "ready") {
      saving.current[kind] = false;
      dispatch({
        kind,
        notice: answer.problem?.detail ?? COMMUNICATION_MESSAGES.unknown,
        type: "save-failed",
      });
      return;
    }
    markFormSaved(form);
    document.dispatchEvent(
      new CustomEvent(PERSON_TIMELINE_CHANGED_EVENT, {
        detail: { personIds: [personId] },
      }),
    );
    const now = await refresh();
    saving.current[kind] = false;
    dispatch({ current: now, kind, type: "saved" });
  };

  const retryRefresh = async (kind: CommunicationKind) => {
    dispatch({ kind, type: "refreshing" });
    const now = await refresh();
    dispatch({ current: now, kind, type: "refreshed" });
  };

  const card = (kind: CommunicationKind, section: HTMLElement) => (
    <CommunicationCard
      hidden={kind === "call" ? props.hidden.calls : props.hidden.conversations}
      kind={kind}
      onCancel={() => dispatch({ kind, type: "cancel" })}
      onOpen={() => open(kind)}
      onRefresh={() => void retryRefresh(kind)}
      onRetry={() => {
        dispatch({ type: "loading" });
        void load();
      }}
      onSave={(form) => void save(kind, form)}
      section={section}
      state={state}
      statusRegion={props.statusRegion}
    >
      {kind === "call"
        ? <CallFields draft={state.editors.call.draft} state={state} />
        : (
          <ConversationFields
            dispatch={dispatch}
            editor={state.editors.conversation}
            state={state}
          />
        )}
    </CommunicationCard>
  );

  return (
    <>
      {card("call", sections.call)}
      {createPortal(
        card("conversation", sections.conversation),
        sections.conversation,
      )}
    </>
  );
}

function CommunicationCard(
  props: {
    readonly kind: CommunicationKind;
    readonly hidden: boolean;
    readonly section: HTMLElement;
    readonly state: CommunicationsState;
    readonly children: ReactNode;
    readonly onOpen: () => void;
    readonly onCancel: () => void;
    readonly onSave: (form: HTMLFormElement) => void;
    readonly onRefresh: () => void;
    readonly onRetry: () => void;
    readonly statusRegion?: StatusRegionProps | undefined;
  },
) {
  const { hidden, kind, section, state } = props;
  const editor = state.editors[kind];
  const wording = CARDS[kind];
  const { list } = state;
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const unavailable = !writable(state, kind);

  useLayoutEffect(() => {
    section.setAttribute("data-section-state", list.status);
    section.toggleAttribute("hidden", hidden);
  }, [hidden, list.status, section]);

  // A discarded draft's fields start over; the reset tells the page's
  // unsaved-changes guard the form holds nothing now.
  const draft = editor.draft;
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    form.current?.reset();
  }, [draft]);

  const applyFocus = useEffectEvent(() => {
    const target = editor.focus?.target === "field"
      ? form.current?.querySelector<HTMLElement>("[name=happenedAt]")
      : editor.focus?.target === "notice"
      ? notice.current
      : add.current;
    if (target && !target.closest("[hidden]")) target.focus();
  });
  useLayoutEffect(() => {
    if (editor.focus) applyFocus();
  }, [editor.focus]);

  const count = list.status === "ready" ? list.counts[kind] : 0;
  const listId = `${wording.section}-communication-list`;
  return (
    <>
      <header className="profile-section-heading">
        <SectionGlyph
          className="profile-section-glyph"
          name={wording.section}
        />
        <div className="profile-section-title">
          <h3 id={`profile-section-${wording.section}-heading`}>
            {wording.title}
          </h3>
          <span
            className={badgeVariants({ variant: "status" })}
            data-communication-badge=""
          >
            {list.status === "loading"
              ? "Loading"
              : list.status === "error"
              ? "Unavailable"
              : count
              ? `${count} recent`
              : "Empty"}
          </span>
        </div>
        <button
          className={buttonVariants({ className: "profile-section-cta" })}
          data-communication-add=""
          disabled={unavailable || editor.pending}
          hidden={unavailable || editor.pending || editor.open}
          onClick={props.onOpen}
          ref={add}
          type="button"
        >
          {wording.add}
        </button>
      </header>
      <p
        className="section-state"
        data-communication-state=""
        {...props.statusRegion}
      >
        {list.status === "loading"
          ? state.options
            ? `Loading ${wording.section}…`
            : <SectionLoading label={`Loading ${wording.section}…`} />
          : list.status === "error"
          ? COMMUNICATION_MESSAGES.unavailable
          : count
          ? `${count} recent ${wording.one}${
            count === 1 ? "" : "s"
          }. Listed in the timeline above.`
          : wording.empty}
      </p>
      <button
        className={buttonVariants({ variant: "outline" })}
        data-communication-load-retry=""
        hidden={list.status !== "error"}
        onClick={props.onRetry}
        type="button"
      >
        Retry loading communications
      </button>
      {/* The records are listed in the timeline; this list stays empty. */}
      <ul
        aria-label={`Recent ${wording.section}`}
        className="interaction-list"
        data-communication-list=""
        hidden
        id={listId}
      />
      <form
        className="profile-fact-form"
        data-communication-form=""
        hidden={!editor.open}
        method="post"
        noValidate
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          props.onSave(event.currentTarget);
        }}
        ref={form}
      >
        {props.children}
        <p
          className="section-state"
          data-communication-form-state=""
          ref={notice}
          role="alert"
          tabIndex={-1}
        >
          {editor.notice}
        </p>
        <div className={formActionsVariants()} data-form-actions="">
          <button
            className={buttonVariants()}
            disabled={state.archived || editor.pending}
            type="submit"
          >
            Save {wording.one}
          </button>
          <button
            className={buttonVariants({ variant: "outline" })}
            data-communication-cancel=""
            disabled={state.archived || editor.pending}
            onClick={props.onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className={buttonVariants({ variant: "outline" })}
            data-communication-refresh=""
            disabled={editor.refresh === "busy"}
            hidden={editor.refresh === "hidden"}
            onClick={props.onRefresh}
            type="button"
          >
            Retry refresh
          </button>
        </div>
      </form>
    </>
  );
}

/** The occurrence field, which starts at the time its draft began. */
function OccurrenceField() {
  const [started] = useState(localDateTime);
  return (
    <label>
      When it happened{" "}
      <input
        defaultValue={started}
        name="happenedAt"
        required
        type="datetime-local"
      />
    </label>
  );
}

function CallFields(
  props: { readonly draft: number; readonly state: CommunicationsState },
) {
  return (
    <>
      <OccurrenceField key={props.draft} />
      <label>
        Call direction{" "}
        <select name="callDirection" required>
          <option value="contact">They called me</option>
          <option value="member">I called them</option>
        </select>
      </label>
      <label>
        Details (optional) <textarea maxLength={10_000} name="content" />
      </label>
      <label>
        Emotions (optional){" "}
        <select multiple name="emotionIds">
          {props.state.options?.emotions.map((emotion) => (
            <option key={emotion.id} value={emotion.id}>{emotion.name}</option>
          ))}
        </select>
      </label>
    </>
  );
}

function ConversationFields(
  props: {
    readonly editor: EditorState;
    readonly state: CommunicationsState;
    readonly dispatch: (
      action: Parameters<typeof communicationsReducer>[1],
    ) => void;
  },
) {
  const { dispatch, editor, state } = props;
  const contacts = state.contacts.status === "ready"
    ? state.contacts.records
    : undefined;
  return (
    <>
      <OccurrenceField key={editor.draft} />
      <label>
        Channel{" "}
        <select
          name="channelTypeId"
          onChange={(event) =>
            dispatch({ channel: event.currentTarget.value, type: "channel" })}
          required
          value={editor.channel}
        >
          <option value="">Select channel</option>
          {state.options?.channelTypes.map((channel) => (
            <option key={channel.id} value={channel.id}>{channel.name}</option>
          ))}
        </select>
      </label>
      <label>
        Specific contact method (optional){" "}
        <select
          defaultValue=""
          disabled={!contacts}
          key={editor.channel}
          name="contactMethodId"
        >
          <option value="">No specific method</option>
          {contacts?.filter((method) => method.typeId === editor.channel).map((
            method,
          ) => <option key={method.id} value={method.id}>{method.value}
          </option>)}
        </select>
      </label>
      <label>
        Title (optional) <input maxLength={500} name="title" />
      </label>
      <div data-message-rows="">
        {editor.messages.map((key) => (
          <MessageRow
            key={key}
            onRemove={() => dispatch({ key, type: "remove-message" })}
          />
        ))}
      </div>
      <button
        className={buttonVariants({ variant: "outline" })}
        data-add-message=""
        onClick={() =>
          dispatch({ key: crypto.randomUUID(), type: "add-message" })}
        type="button"
      >
        Add message
      </button>
    </>
  );
}

function MessageRow(props: { readonly onRemove: () => void }) {
  const [started] = useState(localDateTime);
  return (
    <fieldset data-message-row="">
      <legend>Message</legend>
      <label>
        Direction{" "}
        <select name="messageDirection">
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
      </label>
      <label>
        Written at{" "}
        <input
          defaultValue={started}
          name="messageWrittenAt"
          required
          type="datetime-local"
        />
      </label>
      <label>
        Message <textarea maxLength={10_000} name="messageContent" required />
      </label>
      <button
        className={buttonVariants({ variant: "destructive" })}
        onClick={props.onRemove}
        type="button"
      >
        Remove message
      </button>
    </fieldset>
  );
}
