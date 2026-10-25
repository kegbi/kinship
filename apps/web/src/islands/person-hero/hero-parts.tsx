/**
 * The person hero's parts: the person menu, the vital stats, the tag
 * preview, the identity editor, the delete dialog, and the archived banner
 * (GAP-028). The avatar editor (GAP-045) is its own file beside these, and
 * the merge dialog (GAP-049) is the people feature's, shared with the
 * directory's duplicate review. Each renders what `PersonHero` hands it and reports every
 * action back; none owns state of its own.
 *
 * They keep the ids, labels, roles, and `data-*` hooks the static shell drew
 * and the end-to-end journeys read — `#person-menu-toggle`, the menu's
 * buttons, `[data-person-vital-value]`, `#person-profile-due-state`,
 * `#person-profile-tags`, `#person-edit-form`, the "Delete this person?"
 * dialog — so the page reads the same before and after it hydrates.
 */

import {
  type Ref,
  type RefObject,
  type SubmitEvent,
  useEffect,
  useRef,
} from "react";
import type { PersonGenderOption } from "../../../../../packages/contracts/generated/auth-client.ts";
import type { FieldError } from "react-hook-form";
import type { z } from "zod";
import {
  personDeleteInput,
  personEditInput,
} from "../../../../../packages/contracts/schemas/people.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  firstMeetingText,
  type HeroFacts,
  type TagPreview,
} from "../../features/person/profile-summary.ts";
import type { ContractForm } from "../core/index.ts";
import type { HeroIdentity } from "./hero-state.ts";

// --- The person menu -------------------------------------------------------

export interface PersonMenuProps {
  readonly open: boolean;
  readonly archived: boolean;
  /** An archive or restore is in flight; the lifecycle actions wait. */
  readonly busy: boolean;
  readonly vcardHref: string;
  readonly editRef: Ref<HTMLButtonElement>;
  readonly avatarRef: Ref<HTMLButtonElement>;
  readonly deleteRef: Ref<HTMLButtonElement>;
  readonly mergeRef: Ref<HTMLButtonElement>;
  readonly onToggle: () => void;
  readonly onDismiss: () => void;
  /** Any item chosen: the menu closes before the item acts. */
  readonly onItem: () => void;
  readonly onEdit: () => void;
  /** Change avatar (GAP-045); it opens the avatar editor. */
  readonly onAvatar: () => void;
  readonly onArchive: () => void;
  readonly onAuditHistory: () => void;
  readonly onDelete: () => void;
  /** Merge with another person (GAP-049); it opens the merge dialog. */
  readonly onMerge: () => void;
}

export function PersonMenu(
  {
    archived,
    avatarRef,
    busy,
    deleteRef,
    editRef,
    mergeRef,
    onArchive,
    onAvatar,
    onAuditHistory,
    onDelete,
    onDismiss,
    onEdit,
    onItem,
    onMerge,
    onToggle,
    open,
    vcardHref,
  }: PersonMenuProps,
) {
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const root = container.current;
    if (!open || !root) return;
    const document = root.ownerDocument;
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(root)) onDismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss();
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onDismiss]);
  const item = (act: () => void) => () => {
    onItem();
    act();
  };
  return (
    <div
      aria-label="Person menu"
      className="person-menu"
      ref={container}
      role="group"
    >
      <Button
        aria-controls="person-menu"
        aria-expanded={open}
        aria-label="Open person menu"
        id="person-menu-toggle"
        onClick={onToggle}
        ref={trigger}
        type="button"
        variant="outline"
      >
        <span aria-hidden="true">…</span>
      </Button>
      <div className="person-menu-popover" hidden={!open} id="person-menu">
        <Button
          disabled={busy}
          hidden={archived}
          id="person-edit-open"
          onClick={item(onEdit)}
          ref={editRef}
          type="button"
          variant="outline"
        >
          Edit person
        </Button>
        <Button
          disabled={busy}
          hidden={archived}
          id="person-avatar-open"
          onClick={item(onAvatar)}
          ref={avatarRef}
          type="button"
          variant="outline"
        >
          Change avatar
        </Button>
        <a
          className={buttonVariants({ variant: "outline" })}
          download
          href={vcardHref}
          id="person-export-vcard"
          onClick={onItem}
        >
          Export vCard
        </a>
        <Button
          disabled={busy}
          hidden={archived}
          id="person-archive"
          onClick={item(onArchive)}
          type="button"
          variant="outline"
        >
          Archive person
        </Button>
        <Button
          id="person-audit-history"
          onClick={item(onAuditHistory)}
          type="button"
          variant="outline"
        >
          Audit history
        </Button>
        <Button
          disabled={busy}
          hidden={archived}
          id="person-merge-open"
          onClick={item(onMerge)}
          ref={mergeRef}
          type="button"
          variant="outline"
        >
          Merge with another person…
        </Button>
        <Button
          className="person-menu-danger"
          disabled={busy}
          id="person-delete-open"
          onClick={item(onDelete)}
          ref={deleteRef}
          type="button"
          variant="destructive"
        >
          Delete person
        </Button>
      </div>
    </div>
  );
}

// --- The vital stats and tags ----------------------------------------------

const NOT_RECORDED = "Not recorded";

/** What the summary says when a vital has no value (`profile-summary.ts`). */
const UNRECORDED: ReadonlySet<string> = new Set([
  NOT_RECORDED,
  "None recorded",
  "Not set",
]);

/** Marks a vital that shows only its placeholder, so it reads quieter. */
function emptiness(value: string): { readonly "data-vital-empty"?: "" } {
  return UNRECORDED.has(value) ? { "data-vital-empty": "" } : {};
}

/**
 * The vital stats. A vital whose section the workspace turned off is left
 * out, and one that only links to such a section keeps its value without the
 * link (GAP-047), so the hero never points at a section that is not there.
 */
export function VitalStats(
  props: {
    readonly facts: HeroFacts;
    readonly hiddenSections: ReadonlySet<string>;
  },
) {
  const { facts } = props;
  const hidden = props.hiddenSections;
  return (
    <dl className="person-vital-stats" data-person-vital-stats="">
      <div>
        <dt>Age or birthday</dt>
        <dd>
          <a
            data-person-vital-value="birthday"
            href="?section=important-dates"
            {...emptiness(facts.birthday ?? NOT_RECORDED)}
          >
            {facts.birthday ?? NOT_RECORDED}
          </a>
        </dd>
      </div>
      <div>
        <dt>Last contact</dt>
        <dd>
          {hidden.has("activities")
            ? (
              <span
                data-profile-last-contact=""
                {...emptiness(facts.lastContact)}
              >
                {facts.lastContact}
              </span>
            )
            : (
              <a
                data-profile-last-contact=""
                href="?section=activities"
                {...emptiness(facts.lastContact)}
              >
                {facts.lastContact}
              </a>
            )}
        </dd>
      </div>
      <div>
        <dt>Next reminder</dt>
        <dd>
          <a
            data-person-vital-value="next-reminder"
            href="?section=reminders"
            {...emptiness(facts.nextReminder)}
          >
            {facts.nextReminder}
          </a>
        </dd>
      </div>
      <div>
        <dt>Stay in touch</dt>
        <dd>
          <a href="?section=stay-in-touch" {...emptiness(facts.stayInTouch)}>
            <span id="person-profile-due-state" role="status">
              {facts.stayInTouch}
            </span>
          </a>
        </dd>
      </div>
      {hidden.has("work") ? null : (
        <div>
          <dt>Work</dt>
          <dd>
            <a
              data-person-vital-value="work"
              href="?section=work"
              {...emptiness(facts.work ?? NOT_RECORDED)}
            >
              {facts.work ?? NOT_RECORDED}
            </a>
          </dd>
        </div>
      )}
      {hidden.has("first-meeting") ? null : (
        <div>
          <dt>First met</dt>
          <dd>
            <a
              data-person-vital-value="first-meeting"
              href="?section=first-meeting"
              {...emptiness(firstMeetingText(facts) ?? NOT_RECORDED)}
            >
              {firstMeetingText(facts) ?? NOT_RECORDED}
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}

/** The tag preview; hidden with its module. */
export function TagList(props: { readonly tags: TagPreview | undefined }) {
  const { tags } = props;
  return (
    <ul
      aria-label="Person tags"
      className="profile-tag-list"
      hidden={tags === undefined}
      id="person-profile-tags"
    >
      {tags && tags.names.length === 0
        ? <li className="profile-tag-empty">No tags saved</li>
        : tags?.names.map((name, index) => <li key={index}>{name}</li>)}
      {tags && tags.more > 0 ? <li>+{tags.more} more</li> : null}
    </ul>
  );
}

// --- The identity editor ---------------------------------------------------

/** The identity editor validates with the edit route's own contract. */
export const identityForm = personEditInput.omit({ expectedUpdatedAt: true });
export type IdentityValues = z.input<typeof identityForm>;
export type IdentityOutput = z.output<typeof identityForm>;
export type IdentityForm = ContractForm<IdentityValues, IdentityOutput>;

/** The delete dialog validates with the delete route's own contract. */
export const deletionForm = personDeleteInput.omit({ expectedUpdatedAt: true });
export type DeletionValues = z.input<typeof deletionForm>;
export type DeletionOutput = z.output<typeof deletionForm>;
export type DeletionForm = ContractForm<DeletionValues, DeletionOutput>;

/** The editor's fields for `identity`. */
export function identityValues(identity: HeroIdentity): IdentityValues {
  return {
    description: identity.description ?? "",
    familyName: identity.familyName ?? "",
    genderOptionId: identity.genderOptionId ?? "",
    givenName: identity.givenName,
    isDeceased: identity.isDeceased,
    isPartial: identity.isPartial,
    middleName: identity.middleName ?? "",
    nickname: identity.nickname ?? "",
  };
}

function FieldMessage(
  props: { readonly error: FieldError | undefined; readonly id: string },
) {
  return props.error?.message
    ? <small data-field-error="" id={props.id}>{props.error.message}</small>
    : null;
}

type IdentityField = "familyName" | "givenName" | "middleName" | "nickname";

const IDENTITY_FIELDS: readonly {
  readonly name: IdentityField;
  readonly label: string;
}[] = [
  { label: "Given name", name: "givenName" },
  { label: "Middle name", name: "middleName" },
  { label: "Family name", name: "familyName" },
  { label: "Nickname", name: "nickname" },
];

export interface IdentityEditorProps {
  readonly identity: HeroIdentity;
  /**
   * The workspace's gender options (GAP-047): the current ones, and an
   * archived one only while it is the person's own.
   */
  readonly genderOptions: readonly PersonGenderOption[];
  readonly open: boolean;
  readonly form: IdentityForm;
  readonly formRef: Ref<HTMLFormElement>;
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  readonly onCancel: () => void;
}

export function IdentityEditor(
  {
    form,
    formRef,
    genderOptions,
    identity,
    onCancel,
    onSubmit,
    open,
  }: IdentityEditorProps,
) {
  const { errors } = form.formState;
  const described = (name: "description" | "genderOptionId") =>
    errors[name]?.message
      ? {
        "aria-describedby": `person-edit-${name}-error`,
        "aria-invalid": true,
      }
      : {};
  return (
    <form
      aria-label="Edit person"
      className="person-lifecycle-form"
      data-profile-section="identity-summary"
      data-section-state="ready"
      hidden={!open}
      id="person-edit-form"
      method="post"
      noValidate
      onSubmit={onSubmit}
      ref={formRef}
    >
      <dl className="identity-edit-context" hidden>
        {IDENTITY_FIELDS.map((field) => (
          <div key={field.name}>
            <dt>{field.label}</dt>
            <dd data-profile-field={field.name}>
              {identity[field.name] || "Unknown"}
            </dd>
          </div>
        ))}
        <div>
          <dt>Gender</dt>
          <dd data-profile-field="gender">{identity.gender || "Not set"}</dd>
        </div>
      </dl>
      <div className="form-grid">
        {IDENTITY_FIELDS.map((field) => {
          const error = errors[field.name];
          const messageId = `person-edit-${field.name}-error`;
          return (
            <label key={field.name}>
              {field.label}{" "}
              <input
                {...form.register(field.name)}
                {...(error?.message
                  ? { "aria-describedby": messageId, "aria-invalid": true }
                  : {})}
                maxLength={200}
              />
              <FieldMessage error={error} id={messageId} />
            </label>
          );
        })}
      </div>
      <div className="form-grid">
        <label>
          Gender{" "}
          <select
            {...form.register("genderOptionId")}
            {...described("genderOptionId")}
          >
            <option value="">Not set</option>
            {genderOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.archived ? `${option.name} (archived)` : option.name}
              </option>
            ))}
          </select>
          <FieldMessage
            error={errors.genderOptionId}
            id="person-edit-genderOptionId-error"
          />
        </label>
        <label>
          Description{" "}
          <Textarea
            {...form.register("description")}
            {...described("description")}
            maxLength={2000}
            rows={3}
          />
          <FieldMessage
            error={errors.description}
            id="person-edit-description-error"
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input {...form.register("isPartial")} type="checkbox" />{" "}
        This is a partial identity
      </label>
      <label className="checkbox-row">
        <input {...form.register("isDeceased")} type="checkbox" />{" "}
        This person has died
      </label>
      <div className="person-lifecycle-buttons">
        <Button type="submit">Save person</Button>
        <Button
          id="person-edit-cancel"
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel edit
        </Button>
      </div>
    </form>
  );
}

// --- The delete dialog -----------------------------------------------------

export interface DeleteDialogProps {
  readonly open: boolean;
  readonly message: string;
  /** The confirmation can be submitted: the impact loaded, nothing in flight. */
  readonly confirmable: boolean;
  readonly form: DeletionForm;
  /** Where focus returns when the dialog closes: Delete person. */
  readonly finalFocus: RefObject<HTMLButtonElement | null>;
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  readonly onCancel: () => void;
}

/**
 * The delete confirmation. Opening moves focus to the confirmation field, the
 * dialog's first control; Escape and Cancel delete both cancel.
 */
export function DeleteDialog(
  {
    confirmable,
    finalFocus,
    form,
    message,
    onCancel,
    onSubmit,
    open,
  }: DeleteDialogProps,
) {
  const error = form.formState.errors.confirmation;
  return (
    <Dialog
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      open={open}
    >
      <DialogContent
        className="w-[min(34rem,calc(100%-2rem))]"
        finalFocus={finalFocus}
      >
        <form
          className="grid gap-(--space-4)"
          id="person-delete-form"
          method="post"
          noValidate
          onSubmit={onSubmit}
        >
          <DialogTitle>Delete this person?</DialogTitle>
          <DialogDescription id="person-delete-impact" role="status">
            {message}
          </DialogDescription>
          <label className="grid gap-(--space-2) font-bold">
            Confirmation{" "}
            <Input
              {...form.register("confirmation")}
              {...(error?.message
                ? {
                  "aria-describedby": "person-delete-confirmation-error",
                  "aria-invalid": true,
                }
                : {})}
              autoComplete="off"
              id="person-delete-confirmation"
              required
            />
            <FieldMessage error={error} id="person-delete-confirmation-error" />
          </label>
          <div className="person-lifecycle-buttons">
            <Button disabled={!confirmable} type="submit" variant="destructive">
              Confirm delete
            </Button>
            <Button
              id="person-delete-cancel"
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              Cancel delete
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- The archived banner ---------------------------------------------------

export function ArchivedBanner(
  props: {
    readonly archived: boolean;
    readonly busy: boolean;
    readonly onRestore: () => void;
  },
) {
  return (
    <aside
      className="person-archived-banner"
      data-person-archived-banner=""
      hidden={!props.archived}
    >
      <p>
        <strong>This person is archived.</strong> Editing is disabled.
      </p>
      <Button
        disabled={props.busy}
        id="person-restore"
        onClick={props.onRestore}
        type="button"
        variant="outline"
      >
        Restore person
      </Button>
    </aside>
  );
}
