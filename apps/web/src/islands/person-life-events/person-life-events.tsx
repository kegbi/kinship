/**
 * The person's life-events card (GAP-028).
 *
 * The events themselves are listed in the unified timeline above, so the card
 * reports how many there are and keeps a failure local: a refused or
 * unreachable read says so here, with a retry when retrying can help, while
 * every other section stays usable. A workspace that turned the module off
 * sees no card and no request is made; a module turned off since the page
 * loaded hides the card and tells the section navigation.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { listPersonLifeEvents } from "../../../../../packages/contracts/generated/auth-client.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { SectionGlyph } from "../../features/person/section-glyph.tsx";
import { SectionLoading } from "../../features/person/section-loading.tsx";
import { SECTION_HIDDEN_EVENT } from "../../features/person/sections.ts";
import { useLatestRequest } from "../core/index.ts";

export interface PersonLifeEventsProps {
  readonly personId: string;
  readonly workspaceId: string;
  /** Whether the workspace had the module off when the page loaded. */
  readonly hidden: boolean;
  /** The card the island renders into; it carries the section state. */
  readonly section: HTMLElement;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

type LifeEventsState =
  | { readonly status: "loading"; readonly initial: boolean }
  | { readonly status: "ready" | "empty"; readonly count: number }
  | { readonly status: "hidden" }
  | {
    readonly status: "error" | "forbidden" | "not-found";
    readonly detail: string;
  };

const UNAVAILABLE =
  "Life events are temporarily unavailable. Other person sections remain available.";

function badge(state: LifeEventsState): string {
  switch (state.status) {
    case "loading":
      return "Loading";
    case "ready":
      return "Ready";
    case "empty":
      return "Empty";
    case "hidden":
      return "Hidden";
    case "forbidden":
      return "Forbidden";
    default:
      return "Unavailable";
  }
}

function statusLine(state: LifeEventsState) {
  switch (state.status) {
    case "loading":
      return state.initial
        ? <SectionLoading label="Loading life events…" />
        : "Loading life events…";
    case "ready":
      return `${state.count} life event${
        state.count === 1 ? "" : "s"
      }. Listed in the timeline above.`;
    case "empty":
      return "No life events saved.";
    case "hidden":
      return "";
    default:
      return state.detail;
  }
}

export function PersonLifeEvents(props: PersonLifeEventsProps) {
  const { personId, section, workspaceId } = props;
  const [state, setState] = useState<LifeEventsState>(
    props.hidden ? { status: "hidden" } : { initial: true, status: "loading" },
  );
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);

  /** Reads the history and applies the answer if it is still the latest. */
  const read = useCallback(
    (): Promise<void> =>
      request(() => listPersonLifeEvents(personId, workspaceId)).then(
        (answer) => {
          if (!answer) return;
          if (answer.status === "ready" && answer.data) {
            if (answer.data.status === "hidden") {
              setState({ status: "hidden" });
              document.dispatchEvent(
                new CustomEvent(SECTION_HIDDEN_EVENT, {
                  detail: { sectionId: "life-events" },
                }),
              );
              return;
            }
            const count = answer.data.events.length;
            setState({ count, status: count === 0 ? "empty" : "ready" });
            return;
          }
          const status = answer.problem?.status ?? 503;
          setState({
            detail: answer.problem?.detail ?? UNAVAILABLE,
            status: status === 403
              ? "forbidden"
              : status === 404
              ? "not-found"
              : "error",
          });
        },
      ),
    [personId, request, workspaceId],
  );

  // The first read starts in the loading state the island mounted with.
  useEffect(() => {
    const first = props.hidden ? Promise.resolve() : read();
    void first.finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, [props.hidden, read]);

  useLayoutEffect(() => {
    section.setAttribute("data-section-state", state.status);
    section.toggleAttribute("hidden", state.status === "hidden");
  }, [section, state.status]);

  const retry = () => {
    setState({ initial: false, status: "loading" });
    void read();
  };
  const retryable = state.status === "error";

  return (
    <>
      <header className="profile-section-heading">
        <SectionGlyph className="profile-section-glyph" name="life-events" />
        <div className="profile-section-title">
          <h3 id="profile-section-life-events-heading">Life events</h3>
          <Badge data-life-event-badge="" variant="status">
            {badge(state)}
          </Badge>
        </div>
      </header>
      <p className="section-state" data-life-event-state="">
        {statusLine(state)}
      </p>
      <Button
        data-life-event-retry=""
        hidden={!retryable}
        onClick={retry}
        type="button"
        variant="outline"
      >
        Retry life events
      </Button>
      {/* The events are listed in the timeline; this list stays empty. */}
      <ol
        aria-label="Saved life events"
        className="life-event-list"
        data-life-event-list=""
        hidden
      />
    </>
  );
}
