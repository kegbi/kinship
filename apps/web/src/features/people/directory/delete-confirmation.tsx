import { useEffect, useEffectEvent, useReducer } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { useLatestRequest } from "../../../islands/core/index.ts";
import { type DeletionPreview } from "./delete-selection.ts";

/** A short-lived preview surface, canceled when its dialog closes. */
export function DeleteConfirmation(props: {
  readonly personIds: readonly string[];
  readonly names: ReadonlyMap<string, string>;
  readonly read: (
    signal: AbortSignal,
    progress: (completed: number) => void,
  ) => Promise<readonly DeletionPreview[]>;
  readonly onCancel: () => void;
  readonly onConfirm: (previews: readonly DeletionPreview[]) => void;
}) {
  const [{ preview, completed, confirmation }, dispatch] = useReducer(
    (
      state: {
        preview: readonly DeletionPreview[] | undefined;
        completed: number;
        confirmation: string;
      },
      action: { type: "preview"; preview: readonly DeletionPreview[] } | {
        type: "progress";
        completed: number;
      } | { type: "confirmation"; confirmation: string },
    ) => {
      switch (action.type) {
        case "preview":
          return { ...state, preview: action.preview };
        case "progress":
          return { ...state, completed: action.completed };
        case "confirmation":
          return { ...state, confirmation: action.confirmation };
      }
    },
    { preview: undefined, completed: 0, confirmation: "" },
  );
  const request = useLatestRequest();
  const read = useEffectEvent(async () => {
    const answer = await request(async (signal) => ({
      ok: true as const,
      value: await props.read(
        signal,
        (completed) => dispatch({ type: "progress", completed }),
      ),
    }));
    if (answer) dispatch({ type: "preview", preview: answer.data! });
  });
  useEffect(() => {
    void read();
  }, []);
  const deletable = preview?.filter((item) => item.impact).length ?? 0;
  return (
    <Dialog disablePointerDismissal onOpenChange={props.onCancel} open>
      <DialogContent className="w-[min(30rem,calc(100%-2rem))]">
        <DialogTitle>
          Delete {props.personIds.length} selected people?
        </DialogTitle>
        <DialogDescription>
          Deleted people disappear from your workspace and cannot be restored
          here. Related records are retained. Review the selected people, then
          type DELETE to confirm.
        </DialogDescription>
        <ul
          className="max-h-48 overflow-y-auto"
          aria-label="People selected for deletion"
        >
          {props.personIds.map((id) => <li key={id}>{props.names.get(id)}</li>)}
        </ul>
        <p role="status" aria-live="polite">
          {preview
            ? `${deletable} ready to delete. ${
              preview.length - deletable
            } could not be checked and will not be deleted.`
            : `Checking ${completed} of ${props.personIds.length} people…`}
        </p>
        <label htmlFor="people-delete-confirmation">
          Type DELETE to confirm
        </label>
        <input
          id="people-delete-confirmation"
          autoComplete="off"
          value={confirmation}
          onChange={(event) =>
            dispatch({
              type: "confirmation",
              confirmation: event.target.value,
            })}
        />
        <div className="flex flex-wrap justify-end gap-(--space-2)">
          <DialogClose
            render={<Button type="button" variant="outline">Cancel</Button>}
          />
          <Button
            type="button"
            variant="destructive"
            disabled={!preview || confirmation !== "DELETE"}
            onClick={() => preview && props.onConfirm(preview)}
          >
            {deletable > 0
              ? `Delete ${deletable} ${deletable === 1 ? "person" : "people"}`
              : "Show results"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
