/**
 * The person hero (GAP-028): who this person is and what can be done to
 * them — the breadcrumb, avatar, name, state badges, and description; the
 * person menu and its lifecycle actions (edit, archive, restore, merge,
 * delete); the vital stats, stay-in-touch due state, and tag preview; and the
 * identity section's editor, and the avatar the person is drawn with and its
 * editor (GAP-045). Merge (GAP-049) opens the people feature's merge dialog,
 * which the hero only opens and closes. The star toggle (GAP-053) sets the
 * person's workspace-shared star optimistically and puts it back on refusal.
 *
 * The page's static hero keeps its layout, so the island renders its root —
 * the identity — in place and every other part through a portal into the
 * slot the shell reserved for it. Parts other owners still draw stay theirs:
 * Quick capture's two buttons (interactions) and the tags editor (profile
 * facts) sit beside the slots, never inside them.
 *
 * The facts behind the vitals and tags arrive from the sections that own them
 * as document events (`features/person/profile-summary.ts`), folded by a
 * store the mount starts before the first render. Every lifecycle
 * transition goes through one pure reducer (`hero-state.ts`); the island
 * announces each change the rest of the page reacts to
 * (`person-lifecycle-changed`, `person-revision-changed`) and asks the page's
 * section navigation for Audit history (`person-section-requested`).
 *
 * The static controls are disabled until this renders, so a click before the
 * island is wired waits rather than landing on nothing (REL-039).
 */

import {
  type SubmitEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  archivePerson,
  deletePerson,
  editPerson,
  getPersonDeletionImpact,
  type PersonDueInformation,
  type PersonEditInput,
  type PersonGenderOption,
  type PersonLifecycleIdentity,
  removePersonAvatar,
  replacePersonAvatar,
  type ResolvedMemberPreferences,
  restorePerson,
  setPersonStar,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Avatar } from "@/components/ui/avatar.tsx";
import { badgeVariants, breadcrumbVariants } from "@/components/ui/variants.ts";
import { displayPersonName } from "../../lib/person-name.ts";
import { showToast } from "../../features/shell/toasts/toasts.ts";
import {
  markFormSaved,
  saveWithLockedForm,
} from "../../lib/unsaved-changes.ts";
import {
  type HeroFacts,
  requestImportantDate,
  type SummaryStore,
} from "../../features/person/profile-summary.ts";
import { SECTION_REQUEST_EVENT } from "../../features/person/sections.ts";
import { settle, useContractForm, useDocumentEvent } from "../core/index.ts";
import { MergeDialog } from "../../features/people/merge/merge-dialog.tsx";
import { AvatarEditor } from "./avatar-editor.tsx";
import {
  ArchivedBanner,
  DeleteDialog,
  deletionForm,
  type DeletionOutput,
  IdentityEditor,
  identityForm,
  type IdentityOutput,
  identityValues,
  PersonMenu,
  TagList,
  VitalStats,
} from "./hero-parts.tsx";
import {
  deletionMessage,
  type HeroIdentity,
  heroReducer,
  initialHeroState,
  initials,
  mergeAnchor,
} from "./hero-state.ts";

/** The slots in the static hero each part renders into. */
export interface HeroSlots {
  readonly menu: HTMLElement;
  readonly vitals: HTMLElement;
  readonly tags: HTMLElement;
  readonly lifecycle: HTMLElement;
  readonly archived: HTMLElement;
  readonly miniAvatar?: HTMLElement | undefined;
  readonly miniName?: HTMLElement | undefined;
}

export interface PersonHeroProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly identity: HeroIdentity;
  readonly dueInformation: PersonDueInformation;
  readonly archived: boolean;
  readonly tagsHidden: boolean;
  /** The workspace's gender options the identity editor offers (GAP-047). */
  readonly genderOptions: readonly PersonGenderOption[];
  /** The sections the workspace turned off, whose vitals stay out. */
  readonly hiddenSections: ReadonlySet<string>;
  readonly preferences?: ResolvedMemberPreferences | undefined;
  readonly slots: HeroSlots;
  /**
   * The vitals and tag preview: the profile's, with every change the
   * sections published since the mount started listening.
   */
  readonly facts: SummaryStore<HeroFacts>;
  /** Where a deleted person's page goes next. */
  readonly navigate?: (path: string) => void;
}

type FocusTarget =
  | "avatar-open"
  | "heading"
  | "edit-field"
  | "edit-open"
  | "delete-open"
  | "confirmation";

const browserNavigate = (path: string) => globalThis.location.assign(path);

/**
 * What the editor saves: every field it holds, less the gender option when it
 * still names `savedOption`, the option the person already has (GAP-047).
 */
function savedValues(
  values: IdentityOutput,
  savedOption: string,
): Omit<PersonEditInput, "expectedUpdatedAt"> {
  const { genderOptionId, ...rest } = values as Omit<
    PersonEditInput,
    "expectedUpdatedAt"
  >;
  const chosen = genderOptionId ?? "";
  return chosen === savedOption ? rest : { ...rest, genderOptionId: chosen };
}

export function PersonHero(props: PersonHeroProps) {
  const { personId, preferences, slots, workspaceId } = props;
  const { genderOptions } = props;
  const navigate = props.navigate ?? browserNavigate;
  const [state, dispatch] = useReducer(
    heroReducer,
    initialHeroState(props.identity, props.archived),
  );
  const facts = useSyncExternalStore(props.facts.subscribe, props.facts.get);
  const editor = useContractForm(identityForm, {
    defaultValues: identityValues(props.identity),
  });
  const deletion = useContractForm(deletionForm, {
    defaultValues: { confirmation: "" },
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const editForm = useRef<HTMLFormElement>(null);
  const editOpen = useRef<HTMLButtonElement>(null);
  const deleteOpen = useRef<HTMLButtonElement>(null);
  const mergeOpen = useRef<HTMLButtonElement>(null);
  const avatarOpen = useRef<HTMLButtonElement>(null);
  const avatarForm = useRef<HTMLFormElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const focus = useRef<FocusTarget | undefined>(undefined);
  // The latest state, for work that settles after a later render: the undo
  // toast and every write name the revision current when they run.
  const latest = useRef(state);
  const impactRequest = useRef(0);
  const deleting = useRef(false);

  const nameOrder = preferences?.contactNameOrder ?? "given_family_nickname";
  const name = displayPersonName(state.identity, nameOrder);
  const { identity } = state;

  useLayoutEffect(() => {
    latest.current = state;
    const target = focus.current;
    focus.current = undefined;
    if (target === "heading") heading.current?.focus();
    else if (target === "edit-open") editOpen.current?.focus();
    else if (target === "delete-open") deleteOpen.current?.focus();
    else if (target === "avatar-open") avatarOpen.current?.focus();
    else if (target === "confirmation") deletion.setFocus("confirmation");
    else if (target === "edit-field") editor.setFocus("givenName");
  }, [deletion, editor, state]);

  // The title changes in the same commit as the heading, never a task later.
  useLayoutEffect(() => {
    document.title = `${name} — Kinship`;
  }, [name]);

  useDocumentEvent<CustomEvent<{ readonly personUpdatedAt?: unknown }>>(
    "person-revision-changed",
    (event) => {
      const updatedAt = event.detail?.personUpdatedAt;
      if (typeof updatedAt === "string") {
        dispatch({ type: "revision-changed", updatedAt });
      }
    },
  );

  const announceRevision = (updatedAt: string) =>
    document.dispatchEvent(
      new CustomEvent("person-revision-changed", {
        detail: { personUpdatedAt: updatedAt },
      }),
    );

  const openEditor = () => {
    editor.reset(identityValues(latest.current.identity));
    focus.current = "edit-field";
    dispatch({ type: "edit-opened" });
  };

  const cancelEditor = () => {
    // The native reset is the explicit discard the unsaved-changes guard
    // listens for (APR-001); the editor then holds the saved identity again.
    editForm.current?.reset();
    editor.reset(identityValues(latest.current.identity));
    focus.current = "edit-open";
    dispatch({ type: "edit-cancelled" });
  };

  const saveIdentity = async (values: IdentityOutput): Promise<void> => {
    const form = editForm.current!;
    const answer = await saveWithLockedForm(
      form,
      () =>
        settle(() =>
          editPerson(personId, {
            // The editor validates with this route's own schema and always
            // holds the description and deceased state, so each is saved as
            // it stands (GAP-047). The gender option is sent only when the
            // member changed it: the route keeps one left out, so an option
            // the list could not show is never cleared by another edit.
            ...(savedValues(
              values,
              latest.current.identity.genderOptionId ?? "",
            )),
            expectedUpdatedAt: latest.current.updatedAt,
            familyName: values.familyName ?? "",
            givenName: values.givenName,
            isPartial: values.isPartial,
            middleName: values.middleName ?? "",
            nickname: values.nickname ?? "",
          }, workspaceId)
        ),
    );
    if (answer.status !== "ready" || !answer.data) {
      if (answer.problem) editor.applyProblem(answer.problem);
      dispatch({
        detail: answer.problem?.detail ??
          "Person update is temporarily unavailable.",
        type: "edit-failed",
      });
      return;
    }
    const person = answer.data.person;
    const wasDeceased = latest.current.identity.isDeceased;
    markFormSaved(form);
    announceRevision(person.updatedAt);
    // Newly marked deceased with no date of death recorded, the important
    // dates open their editor on one and take focus there; the date is saved
    // through their own route (GAP-047).
    const askForDate = person.isDeceased && !wasDeceased &&
      props.facts.get().deceased === undefined;
    focus.current = askForDate ? undefined : "heading";
    flushSync(() =>
      dispatch({
        gender: genderOptions.find((option) =>
          option.id === person.genderOptionId
        )?.name,
        person,
        type: "edit-saved",
      })
    );
    // An editor that could not open leaves focus on the renamed heading
    // rather than on the body the closed form dropped it to.
    if (askForDate && !requestImportantDate("deceased")) {
      heading.current?.focus();
    }
  };

  // The file field takes focus inside the opening click, so a keyboard user
  // keeps their focus ring (REL-051).
  const openAvatarEditor = () => {
    avatarForm.current?.reset();
    flushSync(() => dispatch({ type: "avatar-opened" }));
    avatarInput.current?.focus();
  };

  const cancelAvatarEditor = () => {
    // The native reset is the explicit discard the unsaved-changes guard
    // listens for (APR-001).
    avatarForm.current?.reset();
    focus.current = "avatar-open";
    dispatch({ type: "avatar-cancelled" });
  };

  const changeAvatar = async (
    removing: boolean,
    call: () => ReturnType<typeof removePersonAvatar>,
  ): Promise<void> => {
    const form = avatarForm.current!;
    dispatch({ removing, type: "avatar-started" });
    const answer = await saveWithLockedForm(form, () => settle(call));
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        detail: answer.problem?.detail ??
          "The avatar could not be changed right now.",
        held: answer.problem?.code === "avatar_quarantined",
        type: "avatar-failed",
      });
      return;
    }
    form.reset();
    markFormSaved(form);
    focus.current = "heading";
    dispatch({
      avatar: answer.data.avatar,
      removed: removing,
      type: "avatar-changed",
    });
  };

  const uploadAvatar = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (latest.current.avatarBusy) return;
    const file = avatarInput.current?.files?.[0];
    if (!file) {
      dispatch({ detail: "Choose an image to upload.", type: "avatar-failed" });
      return;
    }
    void changeAvatar(
      false,
      () => replacePersonAvatar(personId, file, workspaceId),
    );
  };

  const removeAvatar = () => {
    if (latest.current.avatarBusy) return;
    void changeAvatar(true, () => removePersonAvatar(personId, workspaceId));
  };

  // The star shows at once and the toggle waits for the answer; a refusal
  // puts it back (GAP-053). It is the workspace's star, not the member's.
  // The toggle is disabled while a change runs and for an archived person,
  // so a click always starts from a settled star.
  const toggleStar = async (): Promise<void> => {
    const starred = !latest.current.identity.isStarred;
    dispatch({ starred, type: "star-started" });
    const answer = await settle(() =>
      setPersonStar(personId, starred, workspaceId)
    );
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        detail: answer.problem?.detail ??
          "The star could not be changed right now.",
        type: "star-failed",
      });
      return;
    }
    dispatch({ starred: answer.data.isStarred, type: "star-saved" });
  };

  const transition = async (action: "archive" | "restore"): Promise<void> => {
    dispatch({ type: "transition-started" });
    const input = { expectedUpdatedAt: latest.current.updatedAt };
    const answer = await settle<{ readonly person: PersonLifecycleIdentity }>(
      () =>
        action === "archive"
          ? archivePerson(personId, input, workspaceId)
          : restorePerson(personId, input, workspaceId),
    );
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        detail: answer.problem?.detail ??
          `Person ${action} is temporarily unavailable.`,
        type: "transition-failed",
      });
      return;
    }
    const person = answer.data.person;
    const archived = action === "archive";
    focus.current = "heading";
    dispatch({ archived, person, type: "transition-succeeded" });
    announceRevision(person.updatedAt);
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived,
          personId,
          personUpdatedAt: person.updatedAt,
          state: archived ? "archived" : "active",
        },
      }),
    );
    showToast(
      archived
        ? {
          action: { label: "Undo", onSelect: () => void transition("restore") },
          message: "Person archived. They now appear in Archived people.",
          tone: "success",
        }
        : {
          message: "Person restored. They now appear in People.",
          tone: "success",
        },
    );
  };

  const openDeletion = () => {
    const request = ++impactRequest.current;
    deleting.current = false;
    deletion.reset({ confirmation: "" });
    dispatch({ type: "delete-opened" });
    void settle(() => getPersonDeletionImpact(personId, workspaceId)).then(
      (answer) => {
        if (request !== impactRequest.current) return;
        if (answer.status !== "ready" || !answer.data) {
          dispatch({
            detail: answer.problem?.detail ??
              "Deletion impact is temporarily unavailable.",
            type: "delete-failed",
          });
          return;
        }
        const { impact } = answer.data;
        focus.current = "confirmation";
        dispatch({
          confirmation: impact.confirmation,
          type: "delete-impact-loaded",
          updatedAt: impact.person.updatedAt,
        });
      },
    );
  };

  const cancelDeletion = () => {
    impactRequest.current += 1;
    deleting.current = false;
    focus.current = "delete-open";
    dispatch({ type: "delete-cancelled" });
  };

  const confirmDeletion = async (
    { confirmation }: DeletionOutput,
  ): Promise<void> => {
    if (deleting.current) return;
    deleting.current = true;
    dispatch({ type: "delete-submitted" });
    const answer = await settle(() =>
      deletePerson(personId, {
        confirmation,
        expectedUpdatedAt: latest.current.updatedAt,
      }, workspaceId)
    );
    if (answer.status !== "ready" || !answer.data) {
      deleting.current = false;
      focus.current = "confirmation";
      dispatch({
        detail: answer.problem?.detail ??
          "Person deletion is temporarily unavailable.",
        type: "delete-failed",
      });
      return;
    }
    impactRequest.current += 1;
    dispatch({ type: "delete-finished" });
    navigate(answer.data.next);
  };

  // The dialog opens inside the click, so its search field takes focus while
  // the click is still being handled (REL-051).
  const openMerge = () => flushSync(() => dispatch({ type: "merge-opened" }));

  const requestAuditHistory = () =>
    document.dispatchEvent(
      new CustomEvent(SECTION_REQUEST_EVENT, {
        detail: { sectionId: "audit-summary", view: "admin" },
      }),
    );

  const busy = state.transitioning;
  const confirmable = state.deletion.phase === "ready" ||
    (state.deletion.phase === "failed" &&
      state.deletion.confirmation !== undefined);

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className={`${breadcrumbVariants.list} person-profile-breadcrumb`}
      >
        <a className={breadcrumbVariants.link} href="/app/people">People</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" data-person-breadcrumb-name="">{name}</span>
      </nav>
      <Avatar
        avatar={identity.avatar}
        className="person-profile-avatar"
        id="person-profile-avatar"
        initials={initials(identity)}
        size="custom"
      />
      <div className="person-profile-heading">
        <div className="person-profile-title">
          <h1 id="person-profile-name" ref={heading} tabIndex={-1}>{name}</h1>
          <button
            aria-pressed={identity.isStarred}
            className="person-profile-star"
            disabled={state.archived || state.starBusy}
            id="person-profile-star"
            onClick={() => void toggleStar()}
            title={identity.isStarred
              ? "Starred for everyone in this workspace"
              : "Star for everyone in this workspace"}
            type="button"
          >
            <span aria-hidden="true">{identity.isStarred ? "★" : "☆"}</span>
            {" "}
            Star
          </button>
          <p hidden id="person-profile-nickname">
            {identity.nickname ? `“${identity.nickname}”` : ""}
          </p>
        </div>
        <div
          aria-label="Person states"
          className="person-profile-badges"
          role="group"
        >
          <p
            className={badgeVariants({ variant: "secondary" })}
            id="person-profile-saved-state"
          >
            Identity saved
          </p>
          <p
            className={badgeVariants({ variant: "warning" })}
            hidden={!identity.isStarred}
            id="person-profile-favorite"
          >
            Favorite
          </p>
          <p
            className={badgeVariants({ variant: "secondary" })}
            hidden={!identity.isSelf}
            id="person-profile-self"
          >
            Your person record
          </p>
          <p
            className={badgeVariants()}
            hidden={!identity.isDeceased}
            id="person-profile-deceased"
          >
            Deceased
          </p>
          <p
            className={badgeVariants({ variant: "secondary" })}
            hidden={!identity.isDeceased || facts.deceased === undefined}
            id="person-profile-deceased-date"
          >
            {facts.deceased ? `Date of death: ${facts.deceased}` : ""}
          </p>
          <p
            className={badgeVariants({ variant: "warning" })}
            hidden={!state.archived}
            id="person-profile-archived"
          >
            Archived person · read-only
          </p>
          <p
            className={badgeVariants()}
            hidden={!identity.isPartial}
            id="person-profile-partial"
          >
            Partial identity · unknown values preserved
          </p>
        </div>
        <p className="person-profile-description" data-profile-description="">
          {identity.description || "No description saved."}
        </p>
      </div>
      {createPortal(
        <PersonMenu
          archived={state.archived}
          avatarRef={avatarOpen}
          busy={busy}
          deleteRef={deleteOpen}
          editRef={editOpen}
          mergeRef={mergeOpen}
          onArchive={() => void transition("archive")}
          onAvatar={openAvatarEditor}
          onAuditHistory={requestAuditHistory}
          onDelete={openDeletion}
          onEdit={openEditor}
          onItem={() => dispatch({ type: "menu-closed" })}
          onMerge={openMerge}
          onToggle={() => dispatch({ type: "menu-toggled" })}
          open={state.menuOpen}
          vcardHref={`/api/v1/people/${
            encodeURIComponent(personId)
          }/vcard?workspaceId=${encodeURIComponent(workspaceId)}`}
        />,
        slots.menu,
      )}
      {createPortal(
        <VitalStats facts={facts} hiddenSections={props.hiddenSections} />,
        slots.vitals,
      )}
      {createPortal(<TagList tags={facts.tags} />, slots.tags)}
      {createPortal(
        <>
          <p
            aria-live="polite"
            className="section-state person-lifecycle-status"
            id="person-lifecycle-status"
            role="status"
          >
            {state.status}
          </p>
          <IdentityEditor
            form={editor}
            formRef={editForm}
            genderOptions={genderOptions}
            identity={identity}
            onCancel={cancelEditor}
            onSubmit={(event: SubmitEvent<HTMLFormElement>) =>
              void editor.handleSubmit(saveIdentity)(event)}
            open={state.editing}
          />
          <AvatarEditor
            busy={state.avatarBusy}
            formRef={avatarForm}
            inputRef={avatarInput}
            onCancel={cancelAvatarEditor}
            onRemove={removeAvatar}
            onSubmit={uploadAvatar}
            open={state.avatarEditing && !state.archived}
            held={Boolean(
              identity.avatar?.hasStoredImage && !identity.avatar.imageUrl,
            )}
            removable={Boolean(
              identity.avatar?.imageUrl || identity.avatar?.hasStoredImage,
            )}
          />
          <DeleteDialog
            confirmable={confirmable}
            finalFocus={deleteOpen}
            form={deletion}
            message={deletionMessage(state.deletion)}
            onCancel={cancelDeletion}
            onSubmit={(event: SubmitEvent<HTMLFormElement>) =>
              void deletion.handleSubmit(confirmDeletion)(event)}
            open={state.deletion.phase !== "closed"}
          />
          {state.merging && !state.archived
            ? (
              <MergeDialog
                anchor={mergeAnchor(state, personId)}
                finalFocus={mergeOpen}
                nameOrder={nameOrder}
                onCancel={() => dispatch({ type: "merge-cancelled" })}
                onMerged={(merged) => navigate(merged.next)}
                roles={{ anchor: "this person", other: "chosen person" }}
                workspaceId={workspaceId}
              />
            )
            : null}
        </>,
        slots.lifecycle,
      )}
      {createPortal(
        <ArchivedBanner
          archived={state.archived}
          busy={busy}
          onRestore={() => void transition("restore")}
        />,
        slots.archived,
      )}
      {slots.miniAvatar && createPortal(initials(identity), slots.miniAvatar)}
      {slots.miniName && createPortal(name, slots.miniName)}
    </>
  );
}
