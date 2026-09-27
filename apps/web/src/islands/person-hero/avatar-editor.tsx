/**
 * The hero's avatar editor (GAP-045, PEOPLE-007): choose an image and upload
 * it, remove the image the person has, or cancel.
 *
 * It renders what `PersonHero` hands it and reports every action back; the
 * hero's reducer owns whether it is open, whether a write is in flight, and
 * what the status line says. The image is checked by the server — type, size,
 * and the file scan — so a refusal comes back as the problem's own words
 * rather than as a second, client-side copy of those rules.
 */

import type { Ref, SubmitEvent } from "react";
import { Button } from "@/components/ui/button.tsx";

export interface AvatarEditorProps {
  readonly open: boolean;
  /** An upload or removal is in flight; every control waits. */
  readonly busy: boolean;
  /** The person has an image to remove. */
  readonly removable: boolean;
  readonly formRef: Ref<HTMLFormElement>;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}

/** The images the server stores as an avatar, as the picker offers them. */
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

export function AvatarEditor(
  {
    busy,
    formRef,
    inputRef,
    onCancel,
    onRemove,
    onSubmit,
    open,
    removable,
  }: AvatarEditorProps,
) {
  return (
    <form
      aria-label="Change avatar"
      className="person-lifecycle-form"
      hidden={!open}
      id="person-avatar-form"
      method="post"
      noValidate
      onSubmit={onSubmit}
      ref={formRef}
    >
      <label>
        Avatar image{" "}
        <input
          accept={AVATAR_ACCEPT}
          aria-describedby="person-avatar-hint"
          disabled={busy}
          name="avatar"
          ref={inputRef}
          type="file"
        />
      </label>
      <p className="form-hint" id="person-avatar-hint">
        A JPEG, PNG, or WebP image of 1 MB or less.
      </p>
      <div className="person-lifecycle-buttons">
        <Button disabled={busy} type="submit">Upload avatar</Button>
        {removable
          ? (
            <Button
              disabled={busy}
              onClick={onRemove}
              type="button"
              variant="outline"
            >
              Remove avatar
            </Button>
          )
          : null}
        <Button
          disabled={busy}
          id="person-avatar-cancel"
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
