/**
 * The person hero's state and every change to it, as one pure reducer
 * (GAP-028).
 *
 * The hero runs its kinds of work — saving the identity editor, archiving
 * or restoring, reading the deletion impact, deleting, changing the avatar,
 * and starring (GAP-053) — and each moves
 * the same few facts: who the person is, the revision a write must name, the
 * lifecycle, which control surface is open, and what the status line says.
 * Folding them here keeps one owner of that state and lets each transition
 * be tested without a DOM.
 */

import type {
  PersonAvatar,
  PersonLifecycleIdentity,
  PersonProfileIdentity,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import type { MergePerson } from "../../features/people/merge/merge-state.ts";

/** The identity the hero shows: the profile's, updated by each save. */
export type HeroIdentity = PersonProfileIdentity;

export type DeleteDialogState =
  | { readonly phase: "closed" }
  /** Asking for the impact; nothing can be confirmed yet. */
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly confirmation: string }
  | { readonly phase: "submitting"; readonly confirmation: string }
  /** The impact or the delete was refused; `detail` says why. */
  | {
    readonly phase: "failed";
    readonly detail: string;
    readonly confirmation?: string;
  };

export interface HeroState {
  readonly identity: HeroIdentity;
  /** The revision the next write must name (`expectedUpdatedAt`). */
  readonly updatedAt: string;
  readonly archived: boolean;
  /** An archive or restore is in flight; the lifecycle actions wait. */
  readonly transitioning: boolean;
  readonly menuOpen: boolean;
  readonly editing: boolean;
  /** The avatar editor is open (GAP-045). */
  readonly avatarEditing: boolean;
  /** An avatar upload or removal is in flight; its controls wait. */
  readonly avatarBusy: boolean;
  /** The lifecycle status line, which the avatar editor also speaks on. */
  readonly status: string;
  readonly deletion: DeleteDialogState;
  /** The merge dialog is open (GAP-049); it owns its own steps. */
  readonly merging: boolean;
  /**
   * A star change is in flight (GAP-053); the toggle waits. The identity
   * already shows the star asked for, and a refusal puts it back.
   */
  readonly starBusy: boolean;
}

export type HeroAction =
  | { readonly type: "menu-toggled" }
  | { readonly type: "menu-closed" }
  | { readonly type: "edit-opened" }
  | { readonly type: "edit-cancelled" }
  | { readonly type: "edit-failed"; readonly detail: string }
  | {
    readonly type: "edit-saved";
    readonly person: PersonLifecycleIdentity;
    /** The name of the gender option the edit chose, when it chose one. */
    readonly gender?: string | undefined;
  }
  | { readonly type: "revision-changed"; readonly updatedAt: string }
  | { readonly type: "transition-started" }
  | { readonly type: "transition-failed"; readonly detail: string }
  | {
    readonly type: "transition-succeeded";
    readonly archived: boolean;
    readonly person: PersonLifecycleIdentity;
  }
  | { readonly type: "delete-opened" }
  | {
    readonly type: "delete-impact-loaded";
    readonly confirmation: string;
    readonly updatedAt: string;
  }
  | { readonly type: "delete-failed"; readonly detail: string }
  | { readonly type: "delete-submitted" }
  | { readonly type: "delete-cancelled" }
  | { readonly type: "delete-finished" }
  | { readonly type: "merge-opened" }
  | { readonly type: "merge-cancelled" }
  | { readonly type: "avatar-opened" }
  | { readonly type: "avatar-cancelled" }
  | { readonly type: "avatar-started"; readonly removing: boolean }
  | { readonly type: "avatar-failed"; readonly detail: string }
  | {
    readonly type: "avatar-changed";
    readonly avatar: PersonAvatar;
    readonly removed: boolean;
  }
  | { readonly type: "star-started"; readonly starred: boolean }
  | { readonly type: "star-saved"; readonly starred: boolean }
  | { readonly type: "star-failed"; readonly detail: string };

export function initialHeroState(
  identity: HeroIdentity,
  archived: boolean,
): HeroState {
  return {
    archived,
    avatarBusy: false,
    avatarEditing: false,
    deletion: { phase: "closed" },
    editing: false,
    identity,
    menuOpen: false,
    merging: false,
    starBusy: false,
    status: "",
    transitioning: false,
    updatedAt: identity.updatedAt,
  };
}

/**
 * The profile identity with the fields a lifecycle answer carries. The answer
 * names the gender option but not its name: an unchanged option keeps the
 * name the profile read, and a new one takes `gender`, the name the editor
 * chose it by (GAP-047).
 */
function merged(
  identity: HeroIdentity,
  person: PersonLifecycleIdentity,
  gender?: string,
): HeroIdentity {
  const {
    description: _description,
    familyName: _familyName,
    gender: previousGender,
    genderOptionId: previousOption,
    middleName: _middleName,
    nickname: _nickname,
    ...rest
  } = identity;
  const genderName = person.genderOptionId === previousOption
    ? previousGender
    : person.genderOptionId === undefined
    ? undefined
    : gender;
  return {
    ...rest,
    ...(person.description === undefined
      ? {}
      : { description: person.description }),
    ...(genderName === undefined ? {} : { gender: genderName }),
    ...(person.genderOptionId === undefined
      ? {}
      : { genderOptionId: person.genderOptionId }),
    givenName: person.givenName,
    isDeceased: person.isDeceased,
    isPartial: person.isPartial,
    updatedAt: person.updatedAt,
    ...(person.familyName === undefined
      ? {}
      : { familyName: person.familyName }),
    ...(person.middleName === undefined
      ? {}
      : { middleName: person.middleName }),
    ...(person.nickname === undefined ? {} : { nickname: person.nickname }),
  };
}

export function heroReducer(state: HeroState, action: HeroAction): HeroState {
  switch (action.type) {
    case "menu-toggled":
      return { ...state, menuOpen: !state.menuOpen };
    case "menu-closed":
      return { ...state, menuOpen: false };
    case "edit-opened":
      return { ...state, editing: true, menuOpen: false };
    case "edit-cancelled":
      // Focus returns to Edit person, inside the menu it was opened from.
      return {
        ...state,
        editing: false,
        menuOpen: true,
        status: "Edit cancelled. No changes were saved.",
      };
    case "edit-failed":
      return { ...state, status: action.detail };
    case "edit-saved":
      return {
        ...state,
        editing: false,
        identity: merged(state.identity, action.person, action.gender),
        status: "Person identity updated.",
        updatedAt: action.person.updatedAt,
      };
    case "revision-changed":
      return { ...state, updatedAt: action.updatedAt };
    case "transition-started":
      return { ...state, menuOpen: false, transitioning: true };
    case "transition-failed":
      return { ...state, status: action.detail, transitioning: false };
    case "transition-succeeded":
      return {
        ...state,
        archived: action.archived,
        avatarEditing: false,
        editing: false,
        identity: merged(state.identity, action.person),
        transitioning: false,
        updatedAt: action.person.updatedAt,
      };
    case "delete-opened":
      return { ...state, deletion: { phase: "loading" }, menuOpen: false };
    case "delete-impact-loaded":
      return state.deletion.phase === "loading"
        ? {
          ...state,
          deletion: { confirmation: action.confirmation, phase: "ready" },
          updatedAt: action.updatedAt,
        }
        : state;
    case "delete-failed": {
      if (state.deletion.phase === "closed") return state;
      const confirmation = "confirmation" in state.deletion
        ? state.deletion.confirmation
        : undefined;
      return {
        ...state,
        deletion: {
          detail: action.detail,
          phase: "failed",
          ...(confirmation === undefined ? {} : { confirmation }),
        },
      };
    }
    case "delete-submitted":
      return "confirmation" in state.deletion &&
          state.deletion.confirmation !== undefined
        ? {
          ...state,
          deletion: {
            confirmation: state.deletion.confirmation,
            phase: "submitting",
          },
        }
        : state;
    case "delete-cancelled":
      // Focus returns to Delete person, inside the menu it was opened from.
      return {
        ...state,
        deletion: { phase: "closed" },
        menuOpen: true,
        status: "Delete cancelled. No changes were made.",
      };
    case "delete-finished":
      return { ...state, deletion: { phase: "closed" } };
    case "merge-opened":
      return { ...state, menuOpen: false, merging: true };
    case "merge-cancelled":
      // Focus returns to the merge action, inside the menu it was opened from.
      return {
        ...state,
        menuOpen: true,
        merging: false,
        status: "Merge cancelled. No changes were made.",
      };
    case "avatar-opened":
      return { ...state, avatarEditing: true, menuOpen: false };
    case "avatar-cancelled":
      // Focus returns to Change avatar, inside the menu it was opened from.
      return {
        ...state,
        avatarEditing: false,
        menuOpen: true,
        status: "Avatar unchanged.",
      };
    case "avatar-started":
      return {
        ...state,
        avatarBusy: true,
        status: action.removing ? "Removing avatar…" : "Uploading avatar…",
      };
    case "avatar-failed":
      return { ...state, avatarBusy: false, status: action.detail };
    case "avatar-changed":
      // An avatar is not part of the person's revision: `updatedAt` stays.
      return {
        ...state,
        avatarBusy: false,
        avatarEditing: false,
        identity: { ...state.identity, avatar: action.avatar },
        status: action.removed
          ? "Avatar removed. Initials are shown instead."
          : "Avatar updated.",
      };
    case "star-started":
      // Optimistic: the star shows at once. A star is not part of the
      // person's revision, so `updatedAt` stays (GAP-053).
      return {
        ...state,
        identity: { ...state.identity, isStarred: action.starred },
        starBusy: true,
        status: action.starred ? "Starring…" : "Removing star…",
      };
    case "star-saved":
      return {
        ...state,
        identity: { ...state.identity, isStarred: action.starred },
        starBusy: false,
        status: action.starred
          ? "Starred. Everyone in this workspace sees the star."
          : "Star removed.",
      };
    case "star-failed":
      // Only one change runs at a time, so the star before it is the
      // opposite of the one shown.
      return {
        ...state,
        identity: { ...state.identity, isStarred: !state.identity.isStarred },
        starBusy: false,
        status: action.detail,
      };
  }
}

/** Up to two initials for the avatar, from the names the person has. */
export function initials(
  person: {
    readonly givenName?: string;
    readonly familyName?: string;
    readonly nickname?: string;
  },
): string {
  const values = [person.givenName, person.familyName].flatMap((value) =>
    value ? [value] : []
  );
  const source = values.length > 0 ? values : [person.nickname ?? "?"];
  return source.map((value) => value.trim().at(0) ?? "").join("").slice(0, 2)
    .toLocaleUpperCase();
}

/** What the delete dialog's status line says in `deletion`. */
export function deletionMessage(deletion: DeleteDialogState): string {
  switch (deletion.phase) {
    case "failed":
      return deletion.detail;
    case "ready":
    case "submitting":
      return `This person will be hidden from Kinship. Related records are retained. Enter ${deletion.confirmation} to continue.`;
    default:
      return "Loading deletion impact…";
  }
}

/**
 * The person as the merge dialog shows them (GAP-049): the names they have
 * and their avatar. The revisions a merge is confirmed against come from the
 * server's merge preview, never from what the hero holds.
 */
export function mergeAnchor(state: HeroState, personId: string): MergePerson {
  const { avatar, familyName, givenName, middleName, nickname } =
    state.identity;
  return {
    ...(avatar ? { avatar } : {}),
    ...(familyName ? { familyName } : {}),
    givenName,
    id: personId,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}
