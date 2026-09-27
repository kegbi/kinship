/**
 * The merge confirmation (GAP-049, PEOPLE-008): which of two people to keep,
 * what the server's merge preview says moves and is discarded, and that a
 * merge cannot be undone.
 *
 * Two surfaces open it. The directory's duplicate review hands it both people
 * of a pair; a person's menu hands it that person alone, and the dialog first
 * searches for the other. Its state is one pure reducer (`merge-state.ts`),
 * its form is validated by the merge route's own contract, and while the
 * merge is in flight every control waits. A merged pair lands on the person
 * who was kept; a refused one says why and changes nothing.
 */

import {
  type KeyboardEvent,
  type RefObject,
  type SubmitEvent,
  useEffect,
  useReducer,
  useRef,
} from "react";
import {
  listPeople,
  mergePeople,
  type PersonMerged,
  previewPeopleMerge,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { personMergeInput } from "../../../../../../packages/contracts/schemas/people.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  settle,
  useContractForm,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  displayPersonName,
  type PersonNameOrder,
} from "../../../lib/person-name.ts";
import {
  initialMergeState,
  type MergePerson,
  mergeReducer,
  mergeRequest,
  mergeSummary,
} from "./merge-state.ts";

export interface MergeDialogProps {
  /** The person the dialog was opened for, kept unless the member swaps. */
  readonly anchor: MergePerson;
  /** The other person, when the opener already knows them. */
  readonly other?: MergePerson | undefined;
  /** How each person is told apart when their names are the same. */
  readonly roles: { readonly anchor: string; readonly other: string };
  readonly workspaceId: string;
  readonly nameOrder: PersonNameOrder;
  /** Where focus returns when the dialog closes: the control that opened it. */
  readonly finalFocus: RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
  readonly onMerged: (merged: PersonMerged) => void;
}

const SEARCH_LIMIT = 10;
/** Refusals that mean the preview the merge was confirmed against is old. */
const OUTDATED: ReadonlySet<string> = new Set([
  "merge_conflicts_changed",
  "person_stale",
]);

export function MergeDialog(props: MergeDialogProps) {
  const { anchor, nameOrder, roles, workspaceId } = props;
  const [state, dispatch] = useReducer(
    mergeReducer,
    { anchor, ...(props.other ? { other: props.other } : {}) },
    initialMergeState,
  );
  const searchRequest = useLatestRequest();
  const previewRequest = useLatestRequest();
  const search = useRef<HTMLInputElement>(null);
  const firstChoice = useRef<HTMLInputElement>(null);
  const request = mergeRequest(state);
  // Without a preview of the current choice the values cannot validate, so
  // nothing is ever submitted before the member has read one.
  const form = useContractForm(personMergeInput, {
    values: request?.body ?? {
      confirmed: true,
      conflictsDigest: "",
      duplicateId: "",
      duplicateRevision: "",
      primaryRevision: "",
    },
  });
  const name = (person: MergePerson) => displayPersonName(person, nameOrder);
  const summary = mergeSummary(state, name);
  const anchorName = name(anchor);

  const findOther = async (): Promise<void> => {
    // The search field is drawn whenever a search can be asked for.
    const text = search.current!.value.trim();
    dispatch({ type: "search-started" });
    const answer = await searchRequest(() =>
      listPeople({
        excludePersonId: anchor.id,
        limit: SEARCH_LIMIT,
        ...(text ? { search: text } : {}),
      }, workspaceId)
    );
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ type: "search-failed" });
      return;
    }
    dispatch({ candidates: answer.data.people, type: "search-answered" });
  };

  // Every choice of the pair and its primary asks the server what that merge
  // would keep, discard, and move, and which revisions it would be confirmed
  // against; only the latest answer lands.
  const otherId = state.other?.id;
  const { previewRound, primaryId } = state;
  useEffect(() => {
    if (!otherId) return;
    const duplicateId = primaryId === otherId ? anchor.id : otherId;
    dispatch({ type: "preview-started" });
    void previewRequest(() =>
      previewPeopleMerge(primaryId, duplicateId, workspaceId)
    ).then((answer) => {
      if (!answer) return;
      if (answer.status !== "ready" || !answer.data) {
        dispatch({
          detail: answer.problem?.detail ??
            "What this merge would change could not be read. Try again.",
          primaryId,
          type: "preview-failed",
        });
        return;
      }
      dispatch({ preview: answer.data, primaryId, type: "preview-answered" });
    });
  }, [
    anchor.id,
    otherId,
    previewRequest,
    previewRound,
    primaryId,
    workspaceId,
  ]);

  const searchOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void findOther();
  };

  const confirm = async (): Promise<void> => {
    // The form validates only once both people are known — the contract needs
    // the duplicate's identifier — so a submission always has its request.
    const { body, primaryId } = request!;
    dispatch({ type: "merge-started" });
    const answer = await settle(() =>
      mergePeople(primaryId, body, workspaceId)
    );
    if (answer.status !== "ready" || !answer.data) {
      const detail = answer.problem?.detail ?? "Nothing was merged. Try again.";
      // Out of date: what the member read is not what is true now, so the
      // preview is read again and they confirm what it says.
      dispatch({
        detail,
        type: OUTDATED.has(answer.problem?.code ?? "")
          ? "merge-outdated"
          : "merge-failed",
      });
      return;
    }
    props.onMerged(answer.data);
  };

  const cancel = () => {
    if (!state.saving) props.onCancel();
  };

  return (
    <Dialog
      disablePointerDismissal
      // The dialog is open for as long as it is drawn, so any change is a
      // request to close it: Escape.
      onOpenChange={cancel}
      open
    >
      <DialogContent
        className="w-[min(36rem,calc(100%-2rem))]"
        finalFocus={props.finalFocus}
        initialFocus={state.other ? firstChoice : search}
      >
        <form
          aria-labelledby="person-merge-title"
          className="grid gap-(--space-4)"
          id="person-merge-form"
          method="post"
          noValidate
          onSubmit={(event: SubmitEvent<HTMLFormElement>) =>
            void form.handleSubmit(confirm)(event)}
        >
          <DialogTitle id="person-merge-title">Merge two people?</DialogTitle>
          {state.other
            ? (
              <>
                <fieldset
                  className="grid gap-(--space-2)"
                  disabled={state.saving}
                >
                  <legend className="font-bold">Keep which record?</legend>
                  {[
                    [anchor, roles.anchor] as const,
                    [state.other, roles.other] as const,
                  ].map(([person, role], index) => (
                    <label className="person-merge-choice" key={person.id}>
                      <input
                        checked={state.primaryId === person.id}
                        name="person-merge-primary"
                        onChange={() =>
                          dispatch({
                            personId: person.id,
                            type: "primary-chosen",
                          })}
                        ref={index === 0 ? firstChoice : undefined}
                        type="radio"
                        value={person.id}
                      />{" "}
                      Keep {name(person)} ({role})
                    </label>
                  ))}
                </fieldset>
                <DialogDescription id="person-merge-impact">
                  {summary?.moves ??
                    (state.previewing
                      ? "Checking what this merge would change…"
                      : state.previewError)}
                </DialogDescription>
                {summary && summary.conflicts.length > 0
                  ? (
                    <ul
                      aria-label="What is kept and discarded"
                      className="person-merge-conflicts"
                      id="person-merge-conflicts"
                    >
                      {summary.conflicts.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )
                  : null}
                <p className="person-merge-warning" id="person-merge-warning">
                  <strong>A merge cannot be undone.</strong>
                </p>
                {props.other ? null : (
                  <Button
                    disabled={state.saving}
                    onClick={() => dispatch({ type: "other-cleared" })}
                    type="button"
                    variant="outline"
                  >
                    Choose someone else
                  </Button>
                )}
              </>
            )
            : (
              <fieldset className="grid gap-(--space-2)">
                <legend className="font-bold">
                  Who else is {anchorName}?
                </legend>
                <label
                  className="grid gap-(--space-2)"
                  htmlFor="person-merge-search"
                >
                  Find the person to merge with
                </label>
                <div className="flex gap-(--space-2)">
                  <Input
                    autoComplete="off"
                    id="person-merge-search"
                    maxLength={200}
                    onKeyDown={searchOnEnter}
                    placeholder="Name or nickname"
                    ref={search}
                    type="search"
                  />
                  <Button
                    disabled={state.searching}
                    onClick={() => void findOther()}
                    type="button"
                    variant="outline"
                  >
                    Search
                  </Button>
                </div>
                <p
                  aria-live="polite"
                  id="person-merge-search-status"
                  role="status"
                >
                  {state.searchStatus}
                </p>
                {state.candidates.length > 0
                  ? (
                    <ul
                      aria-label="Matching people"
                      className="grid gap-(--space-2)"
                    >
                      {state.candidates.map((person) => (
                        <li key={person.id}>
                          <Button
                            onClick={() =>
                              dispatch({ person, type: "other-chosen" })}
                            type="button"
                            variant="outline"
                          >
                            Merge with {name(person)}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )
                  : null}
              </fieldset>
            )}
          <p aria-live="polite" id="person-merge-status" role="status">
            {state.saving ? "Merging…" : state.error}
          </p>
          <div className="person-lifecycle-buttons">
            <Button
              disabled={!request || state.saving}
              type="submit"
              variant="destructive"
            >
              Merge people
            </Button>
            <Button
              disabled={state.saving}
              id="person-merge-cancel"
              onClick={cancel}
              type="button"
              variant="outline"
            >
              Cancel merge
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
