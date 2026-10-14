/**
 * The personal journal as one island (JOURNAL-001, GAP-033), serving the
 * `/app/journal` timeline and one item's page.
 *
 * `pages/app/journal/index.astro` and `pages/internal/journal-item-shell.astro`
 * draw the surface in its loading state; `mountJournal` renders this island
 * over it, and on the timeline renders Add item into the page heading in
 * place of the disabled copy the page drew. Every read — the timeline, its
 * next page, one item, and the refresh after a write — goes through one
 * latest-request slot, and its state moves through `journalReducer`
 * (`journal.ts`). Add item stays disabled until the surface knows the
 * workspace it writes to, and while a save holds the form.
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  type ApiResult,
  createJournalPost,
  deleteJournalItem,
  getJournalItem,
  type JournalItemType,
  type JournalLinkableActivity,
  type JournalTimelineItem,
  linkJournalActivity,
  listJournal,
  saveJournalDayRating,
  updateJournalPost,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import {
  LoadMore,
  mountIsland,
  settle,
  useLatestRequest,
} from "../../islands/core/index.ts";
import {
  loadTimePreferences,
  type TimePreferences,
} from "../../lib/time-presentation.ts";
import { resolveWorkspaceSession } from "../../lib/workspace-context.ts";
import {
  activityChoice,
  initialJournalState,
  journalBody,
  journalBusy,
  type JournalEditor,
  journalHeading,
  journalReducer,
  journalStatus,
  journalWhen,
  localDateTimeValue,
  parseLocalDateTime,
} from "./journal.ts";

export const JOURNAL_ISLAND = "journal-surface";

const LIST_ID = "journal-timeline";
const UNREACHABLE = "The journal could not be reached. Try again.";

interface Page {
  readonly items: readonly JournalTimelineItem[];
  readonly nextCursor?: string | undefined;
  readonly activities?: readonly JournalLinkableActivity[] | undefined;
  readonly workspaceId: string;
  readonly preferences: TimePreferences | undefined;
}

export interface JournalProps {
  /** The one item the item page shows; the timeline has none. */
  readonly itemId?: string | undefined;
  /** The page heading Add item renders into, on the timeline. */
  readonly heading?: HTMLElement | undefined;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

export function Journal(props: JournalProps) {
  const { itemId } = props;
  const detail = itemId !== undefined;
  const [state, dispatch] = useReducer(journalReducer, initialJournalState);
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);
  /** Whether any write — a save or a removal — is in flight. */
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  /** Reads the timeline from its start, the page after `cursor`, or the item. */
  const load = async (cursor?: string): Promise<void> => {
    if (!cursor) dispatch({ type: "loading" });
    const answer = await request<Page | undefined>(async () => {
      const session = await resolveWorkspaceSession();
      if (session.status !== "ready") return { ok: true, value: undefined };
      const workspaceId = session.session.workspace.id;
      const [result, preferences] = await Promise.all([
        itemId
          ? getJournalItem(itemId, workspaceId)
          : listJournal(workspaceId, cursor ? { cursor } : {}),
        loadTimePreferences(workspaceId),
      ]);
      if (!result.ok) return result;
      return {
        ok: true,
        value: "item" in result.value
          ? { items: [result.value.item], preferences, workspaceId }
          : {
            activities: result.value.activities,
            items: result.value.items,
            nextCursor: result.value.nextCursor,
            preferences,
            workspaceId,
          },
      };
    });
    if (!answer) return;
    if (answer.status === "ready" && answer.data) {
      dispatch({
        ...answer.data,
        append: cursor !== undefined,
        type: "loaded",
      });
    } else if (answer.status === "ready") dispatch({ type: "no-session" });
    else {
      dispatch({
        problem: answer.problem?.detail ?? UNREACHABLE,
        type: "failed",
      });
    }
    settled.current?.();
    settled.current = undefined;
  };

  const first = useEffectEvent(() => void load());
  useEffect(() => first(), []);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (target === "add") addButton.current?.focus();
    else if (target === "type" || target === "body") {
      form.current?.querySelector<HTMLElement>(
        target === "type" ? "[name=type]" : "textarea[name=body]",
      )?.focus();
    }
  }, [state.focus]);

  /** The save's lock: the guard and the rendered flag move together. */
  const lock = (value: boolean) => {
    busy.current = value;
    dispatch({ saving: value, type: "saving" });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = form.current;
    const { editor, workspaceId } = state;
    // One write at a time: a removal in flight refuses a save.
    if (!element || !editor || !workspaceId || busy.current) return;
    const data = new FormData(element);
    const text = (name: string) => String(data.get(name) ?? "");
    let save: () => Promise<ApiResult<unknown>>;
    if (editor.type === "post") {
      const occurredAt = parseLocalDateTime(text("occurredAt"));
      if (!occurredAt) {
        dispatch({
          text: "Choose a valid date and time.",
          type: "form-notice",
        });
        return;
      }
      const input = {
        body: text("body"),
        occurredAt,
        ...(text("title").trim() ? { title: text("title") } : {}),
      };
      const postId = editor.post?.post.id;
      save = () =>
        postId
          ? updateJournalPost(postId, input, workspaceId)
          : createJournalPost(input, workspaceId);
    } else if (editor.type === "day-rating") {
      const input = {
        ...(text("comment").trim() ? { comment: text("comment") } : {}),
        ratedOn: text("ratedOn"),
        rating: Number(text("rating")),
      };
      save = () => saveJournalDayRating(input, workspaceId);
    } else {
      const activityId = text("activityId");
      if (!activityId) {
        dispatch({ text: "Choose an activity to link.", type: "form-notice" });
        return;
      }
      save = () => linkJournalActivity(activityId, workspaceId);
    }
    dispatch({ text: "Saving…", type: "form-notice" });
    lock(true);
    const answer = await settle(save);
    if (answer.status !== "ready") {
      lock(false);
      dispatch({
        text: answer.problem?.detail ?? UNREACHABLE,
        type: "form-notice",
      });
      return;
    }
    dispatch({ type: "saved" });
    // The save holds the controls and the timeline until its refresh lands.
    try {
      await load();
    } finally {
      lock(false);
    }
  };

  const remove = async (item: JournalTimelineItem) => {
    const { workspaceId } = state;
    if (!workspaceId || busy.current) return;
    busy.current = true;
    dispatch({ itemId: item.id, type: "removing" });
    const answer = await settle(() => deleteJournalItem(item.id, workspaceId));
    if (answer.status !== "ready") {
      busy.current = false;
      dispatch({
        notice: answer.problem?.detail ?? UNREACHABLE,
        type: "remove-refused",
      });
      return;
    }
    try {
      await load();
    } finally {
      busy.current = false;
      dispatch({ itemId: undefined, type: "removing" });
    }
  };

  const writing = state.saving || state.removing !== undefined;
  const failed = state.status === "failed" || state.status === "no-session";
  const addControl = (
    <button
      className={buttonVariants()}
      data-journal-add=""
      disabled={!state.workspaceId || writing}
      onClick={() => dispatch({ type: "open" })}
      ref={addButton}
      type="button"
    >
      Add item
    </button>
  );
  return (
    <>
      {props.heading ? createPortal(addControl, props.heading) : null}
      <p
        aria-live="polite"
        className="section-state"
        data-journal-state=""
        role="status"
      >
        {journalStatus(
          state,
          detail ? "Loading journal item…" : "Loading journal…",
        )}
      </p>
      <button
        className={buttonVariants({ variant: "outline" })}
        data-journal-retry=""
        hidden={!failed}
        onClick={() => void load()}
        type="button"
      >
        {detail ? "Retry item" : "Retry journal"}
      </button>
      {detail ? null : (
        <form
          className="profile-fact-form journal-form"
          data-journal-form=""
          hidden={state.editor === undefined}
          method="post"
          noValidate
          onSubmit={(event) => void submit(event)}
          ref={form}
        >
          <h2>Journal item</h2>
          {state.editor
            ? (
              <JournalFields
                activities={state.activities}
                editor={state.editor}
                key={state.editor.generation}
                onType={(itemType) => dispatch({ itemType, type: "item-type" })}
                preferences={state.preferences}
                saving={writing}
              />
            )
            : null}
          <p
            aria-live="polite"
            className="section-state"
            data-journal-form-state=""
            role="status"
          >
            {state.formNotice}
          </p>
          <div className={formActionsVariants()}>
            <button
              className={buttonVariants()}
              disabled={writing}
              type="submit"
            >
              Save item
            </button>
            <button
              className={buttonVariants()}
              data-journal-cancel=""
              disabled={writing}
              onClick={() => dispatch({ type: "close" })}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <ol
        aria-label={detail ? "Journal item" : "Journal timeline"}
        className="journal-list"
        data-journal-list=""
        {...(detail ? {} : { id: LIST_ID })}
      >
        {state.items.map((item) => {
          const when = journalWhen(item, state.preferences);
          return (
            <li
              data-journal-item-id={item.id}
              data-journal-item-type={item.type}
              key={item.id}
            >
              <h2>
                <a href={`/app/journal/${item.id}`}>{journalHeading(item)}</a>
              </h2>
              <time dateTime={when.dateTime}>{when.text}</time>
              {item.type === "activity" && item.activity.participants.length > 0
                ? (
                  <p>
                    With:{" "}
                    {item.activity.participants.map((person, index) => (
                      <span key={person.id}>
                        {index > 0 ? ", " : ""}
                        <a href={`/app/people/${person.id}`}>{person.name}</a>
                      </span>
                    ))}
                  </p>
                )
                : <p>{journalBody(item)}</p>}
              <div className={formActionsVariants()}>
                {item.type === "post" && !detail
                  ? (
                    <button
                      className={buttonVariants()}
                      disabled={writing}
                      onClick={() => dispatch({ post: item, type: "open" })}
                      type="button"
                    >
                      Edit
                    </button>
                  )
                  : null}
                <button
                  className={buttonVariants()}
                  disabled={writing}
                  onClick={() => void remove(item)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {detail ? null : (
        <LoadMore
          controls={LIST_ID}
          // A write's refresh owns the timeline until it lands.
          cursor={journalBusy(state) ? undefined : state.nextCursor}
          label="Load more journal items"
          list="journal"
          onLoad={(cursor) => load(cursor)}
        />
      )}
    </>
  );
}

/**
 * The editor's fields, drawn from the opened item. They stay the form's own
 * until it is submitted; only the item type is the reducer's, since it
 * decides which fields show and what a save sends.
 */
function JournalFields(
  props: {
    readonly editor: JournalEditor;
    readonly activities: readonly JournalLinkableActivity[] | undefined;
    readonly preferences: TimePreferences | undefined;
    readonly saving: boolean;
    readonly onType: (type: JournalItemType) => void;
  },
) {
  const { activities, editor } = props;
  const { post } = editor;
  const now = new Date();
  return (
    <>
      <label>
        Item type{" "}
        <select
          disabled={post !== undefined || props.saving}
          name="type"
          onChange={(event) =>
            props.onType(event.target.value as JournalItemType)}
          value={editor.type}
        >
          <option value="post">Post</option>
          <option value="day-rating">Day rating</option>
          <option value="activity">Linked activity</option>
        </select>
      </label>
      <label data-journal-post="" hidden={editor.type !== "post"}>
        When{" "}
        <input
          defaultValue={localDateTimeValue(
            post ? new Date(post.occurredAt) : now,
          )}
          name="occurredAt"
          type="datetime-local"
        />
      </label>
      <label data-journal-post="" hidden={editor.type !== "post"}>
        Title (optional){" "}
        <input
          defaultValue={post?.post.title ?? ""}
          maxLength={500}
          name="title"
        />
      </label>
      <label data-journal-post="" hidden={editor.type !== "post"}>
        Entry{" "}
        <textarea
          defaultValue={post?.post.body ?? ""}
          maxLength={50000}
          name="body"
          rows={6}
        />
      </label>
      <label data-journal-rating="" hidden={editor.type !== "day-rating"}>
        Date{" "}
        <input
          defaultValue={localDateTimeValue(now).slice(0, 10)}
          name="ratedOn"
          type="date"
        />
      </label>
      <label data-journal-rating="" hidden={editor.type !== "day-rating"}>
        Rating{" "}
        <select defaultValue="5" name="rating">
          <option value="5">5 — Excellent</option>
          <option value="4">4 — Good</option>
          <option value="3">3 — Neutral</option>
          <option value="2">2 — Difficult</option>
          <option value="1">1 — Very difficult</option>
        </select>
      </label>
      <label data-journal-rating="" hidden={editor.type !== "day-rating"}>
        Comment (optional){" "}
        <textarea maxLength={10000} name="comment" rows={3} />
      </label>
      <label data-journal-activity="" hidden={editor.type !== "activity"}>
        Activity{" "}
        <select defaultValue="" name="activityId" required>
          <option disabled value="">
            {activities === undefined
              ? "Loading activities…"
              : activities.length === 0
              ? "No unlinked activities available"
              : "Select an activity"}
          </option>
          {activities?.map((activity) => (
            <option key={activity.id} value={activity.id}>
              {activityChoice(activity, props.preferences)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/**
 * Mounts the journal over the surface the page drew and resolves, once its
 * first read has settled, with the function that unmounts it. The item page
 * names its item in the path (`/app/journal/:itemId`).
 */
export function mountJournal(
  root: ParentNode = document,
  pathname: string = globalThis.location.pathname,
): Promise<() => void> {
  const surface = root.querySelector<HTMLElement>("[data-journal-surface]");
  if (!surface) return Promise.resolve(() => undefined);
  const itemId = surface.dataset.journalSurface === "item"
    ? pathname.split("/").filter(Boolean).at(-1)
    : undefined;
  const staticAdd = root.querySelector<HTMLElement>("[data-journal-add]");
  const heading = staticAdd?.parentElement ?? undefined;
  staticAdd?.remove();
  return new Promise((resolve) => {
    const unmount = mountIsland(
      surface,
      JOURNAL_ISLAND,
      <Journal
        heading={heading}
        itemId={itemId}
        onSettled={() => resolve(unmount)}
      />,
    );
  });
}
