/**
 * The person workspace's audit summary card as an island (GAP-033). It
 * replaces `mountPersonAuditSummary` from `lib/audit-history.ts`.
 *
 * The card lists the person's three latest audit events and links to the
 * full history. The server decides who may read audit history: a member
 * without owner or administrator access sees the card say so, with a retry
 * and without the link, and every other section stays usable. The link has
 * no `href` until an authorized read has answered, so nothing points at a
 * page the reader may not open. One latest-request slot owns every read.
 */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type AuditEvent,
  listPersonAudit,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  badgeVariants,
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import { mountIsland, useLatestRequest } from "../../../islands/core/index.ts";
import type { TimePreferences } from "../../../lib/time-presentation.ts";
import { AuditEventItem } from "../../audit/audit-event.tsx";
import { SectionGlyph } from "../section-glyph.tsx";
import { SectionLoading } from "../section-loading.tsx";
import type { SectionMount } from "../section-mounts.ts";
import { statusRegion, type StatusRegionProps } from "../status-region.ts";

export const PERSON_AUDIT_SUMMARY_ISLAND = "person-audit-summary";

const LOADING = "Loading authorized audit summary…";

type SummaryState =
  | { readonly status: "loading"; readonly initial: boolean }
  | { readonly status: "ready"; readonly events: readonly AuditEvent[] }
  | { readonly status: "forbidden" | "error" };

export interface PersonAuditSummaryProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly preferences?: TimePreferences | undefined;
  /** The card the island renders into; it carries the section state. */
  readonly section: HTMLElement;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
  /** What the state line spreads to be a live region, if anything. */
  readonly statusRegion?: StatusRegionProps;
}

function badge(state: SummaryState): string {
  if (state.status === "loading") return "Loading";
  if (state.status === "ready") return "Authorized";
  return state.status === "forbidden" ? "Forbidden" : "Unavailable";
}

function statusLine(state: SummaryState) {
  switch (state.status) {
    case "loading":
      return state.initial ? <SectionLoading label={LOADING} /> : LOADING;
    case "ready":
      return state.events.length === 0
        ? "No audit events recorded for this person."
        : `${state.events.length} recent authorized audit event${
          state.events.length === 1 ? "" : "s"
        }.`;
    case "forbidden":
      return "Audit summary requires owner or administrator permission.";
    case "error":
      return "Audit summary could not be loaded. Other profile sections remain available.";
  }
}

export function PersonAuditSummary(props: PersonAuditSummaryProps) {
  const { personId, section, workspaceId } = props;
  const [state, setState] = useState<SummaryState>({
    initial: true,
    status: "loading",
  });
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);

  const load = (): Promise<void> =>
    request(() => listPersonAudit(personId, { limit: 3 }, workspaceId))
      .then((answer) => {
        if (!answer) return;
        if (answer.status === "ready") {
          setState({ events: answer.data!.items, status: "ready" });
          return;
        }
        setState({
          status: answer.problem?.status === 403 ? "forbidden" : "error",
        });
      });

  // The first read starts in the loading state the island mounted with.
  const first = useEffectEvent(() => load());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    section.setAttribute("data-section-state", state.status);
  }, [section, state.status]);

  const ready = state.status === "ready";
  return (
    <>
      <header className="profile-section-heading">
        <SectionGlyph className="profile-section-glyph" name="audit" />
        <div className="profile-section-title">
          <h3 id="profile-section-audit-summary-heading">Audit summary</h3>
          <span
            className={badgeVariants({ variant: "status" })}
            data-person-audit-badge=""
          >
            {badge(state)}
          </span>
        </div>
      </header>
      <p
        className="section-state"
        data-person-audit-state=""
        {...props.statusRegion}
      >
        {statusLine(state)}
      </p>
      <ol
        aria-label="Recent authorized person audit events"
        className="audit-event-list"
        data-person-audit-list=""
      >
        {ready
          ? state.events.map((event, index) => (
            <AuditEventItem
              event={event}
              key={`${event.id}-${index}`}
              preferences={props.preferences}
            />
          ))
          : null}
      </ol>
      <div className={formActionsVariants()} data-form-actions="">
        <a
          className={buttonVariants({ variant: "outline" })}
          data-person-audit-link=""
          hidden={!ready}
          href={ready
            ? `/app/people/${encodeURIComponent(personId)}/audit`
            : undefined}
        >
          Open full audit history
        </a>
        <button
          className={buttonVariants({ variant: "outline" })}
          data-person-audit-retry=""
          hidden={state.status !== "forbidden" && state.status !== "error"}
          onClick={() => {
            setState({ initial: false, status: "loading" });
            void load();
          }}
          type="button"
        >
          Retry audit summary
        </button>
      </div>
    </>
  );
}

/**
 * Mounts the card over the section inside `container` and resolves, once
 * its first read has settled, with the function that unmounts it. Without
 * the card there is nothing to own, and it resolves with a no-op.
 */
export const mountPersonAuditSummary: SectionMount = (container, props) => {
  const section = container.querySelector<HTMLElement>(
    "[data-person-audit-summary]",
  );
  if (!section) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      PERSON_AUDIT_SUMMARY_ISLAND,
      <PersonAuditSummary
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        preferences={props.preferences}
        section={section}
        statusRegion={statusRegion(props)}
        workspaceId={props.workspaceId}
      />,
    );
  });
};
