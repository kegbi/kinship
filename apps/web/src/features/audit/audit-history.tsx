/**
 * The full audit history pages as one island (GAP-033): a person's
 * (`/app/people/:personId/audit`) and the workspace's
 * (`/app/settings/audit`). It replaces `lib/audit-history.ts`.
 *
 * The filters are a GET form, as they were, because their fields are opaque
 * ids, an action name, and dates (REL-041); the island answers every
 * submission itself. Its state moves through `auditHistoryReducer`, and every
 * read — the first page, a new search, a continuation, a retry — goes through
 * one latest-request slot, so only the newest answer lands. While a page is
 * in flight, Load older events stays visible but unavailable. A person
 * history names its person in the page heading and the breadcrumb, which the
 * static page drew outside the island.
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  type AuditHistory as AuditHistoryPage,
  listPersonAudit,
  listWorkspaceAudit,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  useLatestRequest,
} from "../../islands/core/index.ts";
import { readStaticForm } from "../../lib/static-form.ts";
import { type TimePreferences } from "../../lib/time-presentation.ts";
import { resolveWorkspaceSession } from "../../lib/workspace-context.ts";
import {
  type AuditFailure,
  auditFailure,
  type AuditFilterValues,
  auditHistoryReducer,
  filterInput,
  initialAuditHistory,
} from "./audit.ts";
import { AuditEventItem } from "./audit-event.tsx";

export const AUDIT_HISTORY_ISLAND = "audit-history";

export interface AuditHistoryProps {
  /** The person whose history this is; none is the workspace's history. */
  readonly personId?: string | undefined;
  /** What the static form held when the island took over. */
  readonly defaults?: AuditFilterValues;
  /** The page heading, which a person history names its person in. */
  readonly heading?: HTMLElement | undefined;
  /** The breadcrumb's person link, on a person history. */
  readonly crumb?: HTMLAnchorElement | undefined;
  /** Called once, when the first page has settled either way. */
  readonly onSettled?: () => void;
}

type Read =
  | { readonly failure: AuditFailure }
  | {
    readonly page: AuditHistoryPage;
    readonly preferences: TimePreferences | undefined;
  };

/** The session, the member's time presentation, and one page, in order. */
async function readPage(
  personId: string | undefined,
  values: AuditFilterValues,
  cursor: string | undefined,
): Promise<Read> {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    return {
      failure: session.status === "access-lost"
        ? "session-lost"
        : "unavailable",
    };
  }
  const workspaceId = session.session.workspace.id;
  const preferences = session.session.preferences;
  const input = filterInput(values, cursor);
  const answer = await settle(() =>
    personId
      ? listPersonAudit(personId, input, workspaceId)
      : listWorkspaceAudit(input, workspaceId)
  );
  if (answer.status === "ready" && answer.data) {
    return { page: answer.data, preferences };
  }
  return {
    failure: answer.status === "problem"
      ? auditFailure(answer.problem?.status)
      : "unavailable",
  };
}

export function AuditHistory(props: AuditHistoryProps) {
  const { crumb, heading, personId } = props;
  const [state, dispatch] = useReducer(
    auditHistoryReducer,
    initialAuditHistory,
  );
  const request = useLatestRequest();
  const form = useRef<HTMLFormElement>(null);
  const settled = useRef(props.onSettled);
  const defaults = useRef(props.defaults ?? {});

  const load = async (cursor?: string): Promise<void> => {
    const values = readStaticForm(form.current).values;
    dispatch({ cursor, type: "loading" });
    const answer = await request<Read>(() =>
      readPage(personId, values, cursor).then((value) => ({
        ok: true as const,
        value,
      }))
    );
    if (!answer) return;
    // `readPage` answers every failure itself; nothing else can settle it.
    const read = answer.data!;
    if ("failure" in read) {
      dispatch({ cursor, failure: read.failure, type: "failed" });
      return;
    }
    dispatch({
      cursor,
      page: read.page,
      preferences: read.preferences,
      type: "loaded",
    });
  };

  // What was typed before the island took over becomes the fields' values,
  // not their defaults, so Clear filters still empties them.
  useLayoutEffect(() => {
    const fields = form.current!.elements;
    for (const [name, value] of Object.entries(defaults.current)) {
      const field = fields.namedItem(name);
      if (field instanceof HTMLInputElement) field.value = value;
    }
  }, []);

  const first = useEffectEvent(() => load());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    const name = state.personName;
    if (name) {
      heading?.replaceChildren(`${name} audit history`);
      if (personId && crumb) {
        crumb.setAttribute(
          "href",
          `/app/people/${encodeURIComponent(personId)}`,
        );
        crumb.replaceChildren(name);
      }
      return;
    }
    if (
      personId && state.personUnknown &&
      crumb?.querySelector('[data-slot="skeleton"]')
    ) {
      crumb.replaceChildren("Person");
    }
  }, [crumb, heading, personId, state.personName, state.personUnknown]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void load();
  };

  const clear = () => {
    form.current?.reset();
    void load();
  };

  const retry = () => void load(state.retryCursor);

  // Load older events is hidden while no page offers a cursor.
  const more = () => void load(state.nextCursor);

  return (
    <>
      <form
        ref={form}
        className="audit-filters"
        data-audit-filters=""
        method="get"
        onSubmit={submit}
      >
        {personId ? null : (
          <label>
            Person ID <input autoComplete="off" name="personId" type="text" />
          </label>
        )}
        <label>
          Actor member ID{" "}
          <input autoComplete="off" name="actorMemberId" type="text" />
        </label>
        <label>
          Action{" "}
          <input
            name="action"
            maxLength={200}
            placeholder="people.person-updated"
            type="search"
          />
        </label>
        <label>
          From <input name="from" type="datetime-local" />
        </label>
        <label>
          Before <input name="to" type="datetime-local" />
        </label>
        <div className={formActionsVariants({ className: "col-span-full" })}>
          <button className={buttonVariants()} type="submit">
            Apply filters
          </button>
          <button
            className={buttonVariants({ variant: "outline" })}
            data-audit-clear=""
            onClick={clear}
            type="button"
          >
            Clear filters
          </button>
        </div>
      </form>
      <p
        aria-live="polite"
        className="section-state"
        data-audit-state=""
        role="status"
      >
        {state.message}
      </p>
      <ol
        aria-label={personId
          ? "Person audit events in immutable newest-first order"
          : "Audit events in immutable newest-first order"}
        className="audit-event-list"
        data-audit-list=""
      >
        {state.events.map((event, index) => (
          <AuditEventItem
            event={event}
            key={`${event.id}-${index}`}
            preferences={state.preferences}
          />
        ))}
      </ol>
      <div className={formActionsVariants()}>
        <button
          className={buttonVariants({ variant: "outline" })}
          data-audit-more=""
          disabled={state.loading}
          hidden={!state.nextCursor}
          onClick={more}
          type="button"
        >
          Load older events
        </button>
        <button
          className={buttonVariants({ variant: "outline" })}
          data-audit-retry=""
          hidden={!state.retryable}
          onClick={retry}
          type="button"
        >
          Retry audit history
        </button>
      </div>
    </>
  );
}

/**
 * Mounts the history over the region the page drew (`[data-audit-history]`)
 * and resolves, once the first page has settled, with the function that
 * unmounts it. Whatever was typed into the static filters carries over.
 */
export function mountAuditHistory(
  personId?: string,
  root: ParentNode = document,
): Promise<() => void> {
  const region = root.querySelector<HTMLElement>("[data-audit-history]");
  if (!region) return Promise.resolve(() => undefined);
  const typed = readStaticForm(
    region.querySelector<HTMLFormElement>("[data-audit-filters]"),
  );
  const heading = root.querySelector<HTMLElement>("[data-audit-heading]") ??
    undefined;
  const crumb = root.querySelector<HTMLAnchorElement>(
    "[data-breadcrumb-person]",
  ) ?? undefined;
  return new Promise((resolve) => {
    const unmount = mountIsland(
      region,
      AUDIT_HISTORY_ISLAND,
      <AuditHistory
        crumb={crumb}
        defaults={typed.values}
        heading={heading}
        onSettled={() => resolve(unmount)}
        personId={personId}
      />,
    );
    typed.restoreFocus(region);
  });
}
