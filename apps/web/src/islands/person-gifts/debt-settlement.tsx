import { useId, useRef, useState } from "react";
import type { DebtSettlement } from "../../../../../packages/contracts/generated/auth-client.ts";
import { personFileContentUrl } from "../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { formActionsVariants } from "@/components/ui/variants.ts";

export function DebtSettlementDialog(props: {
  readonly open: boolean;
  readonly pending: boolean;
  readonly notice: string | undefined;
  readonly onCancel: () => void;
  readonly onSave: (reason: string, photo: File | undefined) => void;
}) {
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<File>();
  const formId = useId();
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog
      disablePointerDismissal
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onCancel();
      }}
    >
      <DialogContent
        className="w-[min(30rem,calc(100%-2rem))] min-w-0 wrap-anywhere"
        initialFocus={reasonInput}
      >
        <DialogTitle>Settle this debt</DialogTitle>
        <DialogDescription>
          The settlement date, reason, and photo stay in this debt's history if
          you reopen it.
        </DialogDescription>
        <form
          className="profile-fact-form"
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSave(reason.trim(), photo);
          }}
        >
          <label htmlFor={`${formId}-reason`}>
            Settlement reason (optional)<Textarea
              id={`${formId}-reason`}
              ref={reasonInput}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={10000}
              rows={3}
              disabled={props.pending}
            />
          </label>
          <label htmlFor={`${formId}-photo`}>
            Settlement photo (optional)<Input
              id={`${formId}-photo`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setPhoto(event.target.files?.[0])}
              disabled={props.pending}
            />
          </label>
          <p>JPEG, PNG, or WebP. The photo is also saved in Photos.</p>
          {props.notice ? <p role="status">{props.notice}</p> : null}
          <div className={formActionsVariants()}>
            <Button
              type="button"
              variant="outline"
              disabled={props.pending}
              onClick={props.onCancel}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={props.pending}>Settle debt</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface DebtHistoryState {
  readonly debtId: string;
  readonly settlements: readonly DebtSettlement[];
  readonly nextCursor?: string;
  readonly loading: boolean;
  readonly error?: string;
}

export function DebtHistory(
  props: {
    readonly history: DebtHistoryState;
    readonly pending: boolean;
    readonly personId: string;
    readonly onLoad: (cursor?: string) => void;
  },
) {
  const { history } = props;
  return (
    <section aria-label="Settlement history">
      <h5>Settlement history</h5>
      {history.settlements.length === 0 && !history.loading && !history.error
        ? <p>No settlements recorded.</p>
        : null}
      <ol className="m-0 pl-5">
        {history.settlements.map((event) => (
          <li key={event.id} data-debt-settlement={event.id}>
            <p>
              Settled{" "}
              <time dateTime={event.settledAt}>
                {new Date(event.settledAt).toLocaleString()}
              </time>
            </p>
            <p className="whitespace-pre-wrap wrap-anywhere">
              {event.reason ?? "No settlement reason supplied."}
            </p>
            {event.photoAvailable && event.photoFileId
              ? (
                <a
                  href={personFileContentUrl(props.personId, event.photoFileId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open settlement photo: {event.photoFilename}
                </a>
              )
              : event.photoFilename
              ? <p>Settlement photo unavailable: {event.photoFilename}</p>
              : null}
          </li>
        ))}
      </ol>
      {history.loading
        ? <p role="status">Loading settlement history…</p>
        : history.error
        ? (
          <>
            <p role="status">{history.error}</p>
            <Button
              type="button"
              disabled={props.pending}
              variant="outline"
              onClick={() => props.onLoad(history.nextCursor)}
            >
              Retry history
            </Button>
          </>
        )
        : history.nextCursor
        ? (
          <Button
            type="button"
            disabled={props.pending}
            variant="outline"
            onClick={() => props.onLoad(history.nextCursor)}
          >
            Load older settlements
          </Button>
        )
        : null}
    </section>
  );
}
