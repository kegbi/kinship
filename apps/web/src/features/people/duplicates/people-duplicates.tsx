/**
 * The duplicate review on `/app/people` (GAP-049, PEOPLE-008), as one island
 * in its own region beside the directory.
 *
 * It reads the workspace's possible duplicates once, says how many pairs
 * there are, and folds the list away until the member asks for it. Each pair
 * offers "Merge…", which opens the merge confirmation for that pair; a merge
 * lands on the person who was kept. With nothing to review, or when the
 * review could not be read, the region stays empty: the directory beside it
 * keeps its own loading and error states, and this never adds a second set.
 *
 * Its state moves through `duplicatesReducer`; it reads once, when it mounts,
 * through the island kit's `settle`.
 */

import {
  type MouseEvent,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  getMemberPreferences,
  listPeopleDuplicates,
  type PeopleDuplicatePair,
  type PeopleDuplicatePerson,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { mountIsland, settle } from "../../../islands/core/index.ts";
import { displayPersonName } from "../../../lib/person-name.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import { MergeDialog } from "../merge/merge-dialog.tsx";
import {
  duplicatesReducer,
  duplicatesSummary,
  initialDuplicates,
  reasonsText,
} from "./duplicates.ts";

export const PEOPLE_DUPLICATES_ISLAND = "people-duplicates";

export interface PeopleDuplicatesProps {
  /** Called once, when the review's read has settled either way. */
  readonly onSettled?: () => void;
  /** Where a merge lands; the browser's own navigation by default. */
  readonly navigate?: (path: string) => void;
}

const browserNavigate = (path: string) => globalThis.location.assign(path);

/** A pair's two people; the contract publishes exactly two. */
function both(pair: PeopleDuplicatePair) {
  return pair.people as unknown as readonly [
    PeopleDuplicatePerson,
    PeopleDuplicatePerson,
  ];
}

export function PeopleDuplicates(props: PeopleDuplicatesProps) {
  const navigate = props.navigate ?? browserNavigate;
  const [state, dispatch] = useReducer(
    duplicatesReducer,
    undefined,
    initialDuplicates,
  );
  const opener = useRef<HTMLElement | null>(null);
  const settled = useRef(props.onSettled);

  const load = async (): Promise<void> => {
    const session = await resolveWorkspaceSession();
    if (session.status !== "ready") {
      dispatch({ type: "failed" });
      return;
    }
    const workspaceId = session.session.workspace.id;
    const preferences = await settle(() => getMemberPreferences(workspaceId));
    const pairs = await settle(() => listPeopleDuplicates(workspaceId));
    if (!pairs.data) {
      dispatch({ type: "failed" });
      return;
    }
    dispatch({
      context: {
        nameOrder: preferences.data?.preferences.contactNameOrder ??
          "given_family_nickname",
        workspaceId,
      },
      pairs: pairs.data.pairs,
      truncated: pairs.data.truncated,
      type: "loaded",
    });
  };

  const first = useEffectEvent(() => load());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  // The dialog opens inside the click, so its first control takes focus
  // while the click is still being handled (REL-051).
  const openMerge = (index: number) => (event: MouseEvent<HTMLElement>) => {
    opener.current = event.currentTarget;
    flushSync(() => dispatch({ index, type: "merge-opened" }));
  };

  const known = state.context;
  const nameOrder = known?.nameOrder ?? "given_family_nickname";
  const name = (person: Parameters<typeof displayPersonName>[0]) =>
    displayPersonName(person, nameOrder);
  const merging = state.merging === undefined
    ? undefined
    : state.pairs[state.merging];

  return (
    <section
      aria-labelledby="people-duplicates-heading"
      className="people-duplicates"
      hidden={state.status !== "ready" || state.pairs.length === 0}
      id="people-duplicates"
    >
      <div className="people-duplicates-summary">
        <h2 id="people-duplicates-heading">Possible duplicates</h2>
        <p>{duplicatesSummary(state.pairs.length, state.truncated)}</p>
        <Button
          aria-controls="people-duplicates-list"
          aria-expanded={state.expanded}
          id="people-duplicates-toggle"
          onClick={() => dispatch({ type: "toggled" })}
          type="button"
          variant="outline"
        >
          {state.expanded
            ? "Hide possible duplicates"
            : "Review possible duplicates"}
        </Button>
      </div>
      <ul
        aria-label="Possible duplicate pairs"
        className="people-duplicates-list"
        hidden={!state.expanded}
        id="people-duplicates-list"
      >
        {state.pairs.map((pair, index) => {
          const [first, second] = both(pair);
          const pairName = `${name(first)} and ${name(second)}`;
          return (
            <li key={`${first.id}:${second.id}`}>
              <p className="people-duplicate-names">{pairName}</p>
              <p className="people-duplicate-reasons">
                {reasonsText(pair.reasons)}
              </p>
              <Button
                aria-label={`Merge ${pairName}…`}
                disabled={state.merging !== undefined}
                onClick={openMerge(index)}
                type="button"
                variant="outline"
              >
                Merge…
              </Button>
            </li>
          );
        })}
      </ul>
      {merging && known
        ? (
          <MergeDialog
            anchor={both(merging)[0]}
            finalFocus={opener}
            nameOrder={nameOrder}
            onCancel={() => dispatch({ type: "merge-closed" })}
            onMerged={(merged) => navigate(merged.next)}
            other={both(merging)[1]}
            roles={{ anchor: "added first", other: "added later" }}
            workspaceId={known.workspaceId}
          />
        )
        : null}
    </section>
  );
}

/**
 * Mounts the review over the region the page drew (`[data-people-duplicates]`)
 * and resolves, once its read has settled, with the function that unmounts it.
 */
export function mountPeopleDuplicates(
  root: ParentNode = document,
): Promise<() => void> {
  const region = root.querySelector<HTMLElement>("[data-people-duplicates]");
  if (!region) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      region,
      PEOPLE_DUPLICATES_ISLAND,
      <PeopleDuplicates onSettled={() => resolve(unmount)} />,
    );
  });
}
