/**
 * The API access page's state (GAP-033): every personal API token of the
 * workspace, each with who created it (SECT-07), the one-time secret of the
 * token just created, the page's one status line, and the one token change
 * that may run at a time. A pure reducer with the words the page shows;
 * `api-access.tsx` renders it.
 *
 * The secret lives only here, in memory, until it is dismissed or the page
 * is left; it never reaches the list.
 */

import type {
  ApiTokenListEntry,
  ApiTokenRecord,
  ApiTokenScope,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";

export interface ApiAccessState {
  readonly phase: "loading" | "ready" | "no-session" | "member";
  readonly records: readonly ApiTokenListEntry[] | undefined;
  readonly scopes: readonly ApiTokenScope[] | undefined;
  readonly timePreferences: TimePreferences | undefined;
  readonly secret: string | undefined;
  readonly status: string;
  readonly busy: boolean;
}

export type ApiAccessAction =
  | {
    readonly type: "context";
    readonly timePreferences: TimePreferences | undefined;
  }
  | { readonly type: "no-session" }
  | { readonly type: "member" }
  | {
    readonly type: "loaded";
    readonly records: readonly ApiTokenListEntry[];
    readonly scopes: readonly ApiTokenScope[];
  }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "busy"; readonly busy: boolean; readonly message?: string }
  | { readonly type: "created"; readonly secret: string }
  | { readonly type: "dismissed" };

export const initialApiAccess: ApiAccessState = {
  busy: false,
  phase: "loading",
  records: undefined,
  scopes: undefined,
  secret: undefined,
  status: "",
  timePreferences: undefined,
};

export function apiAccessReducer(
  state: ApiAccessState,
  action: ApiAccessAction,
): ApiAccessState {
  switch (action.type) {
    case "context":
      return {
        ...state,
        phase: "ready",
        timePreferences: action.timePreferences,
      };
    case "no-session":
      return {
        ...state,
        phase: "no-session",
        status: "Your session could not be confirmed.",
      };
    case "member":
      return {
        ...state,
        phase: "member",
        status:
          "API token management requires workspace owner or administrator access.",
      };
    case "loaded":
      return {
        ...state,
        records: action.records,
        scopes: action.scopes,
        status: "API tokens are current.",
      };
    case "status":
      return { ...state, status: action.message };
    case "busy":
      return {
        ...state,
        busy: action.busy,
        ...(action.message === undefined ? {} : { status: action.message }),
      };
    case "created":
      return {
        ...state,
        secret: action.secret,
        status: "API token created. Copy the secret now.",
      };
    case "dismissed":
      return {
        ...state,
        secret: undefined,
        status: "The one-time secret has been dismissed.",
      };
  }
}

/** Displayed before hydration too; the loaded authority decides which are offered. */
export const API_TOKEN_SCOPE_CHOICES: readonly {
  readonly scope: ApiTokenScope;
  readonly label: string;
  readonly detail: string;
}[] = [
  {
    scope: "people:read",
    label: "Read people",
    detail: "Directory only; names and list entries.",
  },
  {
    scope: "people:profile:read",
    label: "Read person profiles",
    detail:
      "Identity, profile facts, important dates, and their lookup options.",
  },
  {
    scope: "relationships:read",
    label: "Read relationships",
    detail: "Person relationships and relationship types.",
  },
  {
    scope: "tasks:read",
    label: "Read tasks",
    detail: "Task lists and individual task details.",
  },
  {
    scope: "tasks:create",
    label: "Create tasks",
    detail: "New tasks only; no reading or editing existing tasks.",
  },
  {
    scope: "tasks:write",
    label: "Edit and complete tasks",
    detail:
      "Edit, complete, and reopen existing tasks; no reading or creating.",
  },
  {
    scope: "interactions:create",
    label: "Record interactions",
    detail:
      "Record notes, activities, calls, and conversations, with their capture options; no reading, editing, or deleting historic content.",
  },
  {
    scope: "people:write",
    label: "Edit people",
    detail:
      "Create, rename, archive, restore, and star people, and change their profile facts, important dates, and life events; no deleting or merging.",
  },
  {
    scope: "people:delete",
    label: "Delete people",
    detail:
      "Preview and permanently delete a person and everything recorded about them.",
  },
  {
    scope: "people:merge",
    label: "Merge people",
    detail:
      "Review possible duplicates, dismiss them, and merge two people into one.",
  },
  {
    scope: "relationships:write",
    label: "Edit relationships",
    detail: "Add, change, and remove relationships between people.",
  },
  {
    scope: "interactions:read",
    label: "Read interactions",
    detail:
      "A person's notes, activities, calls, and conversations, and their activity report.",
  },
  {
    scope: "interactions:write",
    label: "Edit interactions",
    detail:
      "Edit and delete existing notes, activities, calls, and conversations; no recording new ones.",
  },
  {
    scope: "reminders:read",
    label: "Read reminders",
    detail: "A person's reminders.",
  },
  {
    scope: "reminders:write",
    label: "Edit reminders",
    detail: "Create, pause, and resume reminders and stay-in-touch cadences.",
  },
  {
    scope: "journal:read",
    label: "Read journal",
    detail: "The workspace journal: posts, day ratings, and linked activities.",
  },
  {
    scope: "journal:write",
    label: "Edit journal",
    detail:
      "Write, edit, and delete any journal post or day rating in the workspace, not only your own.",
  },
  {
    scope: "gifts:read",
    label: "Read gifts and debts",
    detail: "A person's gifts, debts, recurring debts, and debt settlements.",
  },
  {
    scope: "gifts:write",
    label: "Edit gifts and debts",
    detail:
      "Create and change gifts, debts, and recurring debts, and record settlements.",
  },
  {
    scope: "files:read",
    label: "Read files",
    detail: "List and download the files attached to a person.",
  },
  {
    scope: "files:write",
    label: "Edit files",
    detail: "Upload files to a person and remove them.",
  },
  {
    scope: "search:read",
    label: "Search the workspace",
    detail:
      "Search results across areas: people and matching text from notes, activities, journal posts, tasks, and reminders.",
  },
  {
    scope: "today:read",
    label: "Read Today",
    detail:
      "The Today page across areas: people due for contact, recent people, reminders, tasks, favorite notes, and recent activity.",
  },
  {
    scope: "vocabularies:read",
    label: "Read vocabularies",
    detail:
      "The workspace's personalization lists, such as relationship, activity, and contact types.",
  },
  {
    scope: "vocabularies:write",
    label: "Edit vocabularies",
    detail:
      "Add, rename, and remove personalization entries; owners and administrators only.",
  },
];

/** A token's scopes and expiry, as its row shows them. */
export function recordScope(
  record: ApiTokenRecord,
  timePreferences: TimePreferences | undefined,
): string {
  const scopes = record.scopes.join(", ");
  return record.expiresAt
    ? `${scopes} · Expires ${formatInstant(record.expiresAt, timePreferences)}`
    : `${scopes} · No expiry`;
}

/** When a token was revoked or last used, as its row shows it. */
export function recordActivity(
  record: ApiTokenRecord,
  timePreferences: TimePreferences | undefined,
): string {
  if (record.revokedAt) {
    return `Revoked ${formatInstant(record.revokedAt, timePreferences)}`;
  }
  if (record.lastUsedAt) {
    return `Last used ${formatInstant(record.lastUsedAt, timePreferences)}`;
  }
  return "Never used";
}

/** Who created a token, so an owner can tell whose credential it is. */
export function recordIssuer(record: ApiTokenListEntry): string {
  const { email, name } = record.issuer;
  return name.trim()
    ? `Created by ${name.trim()} · ${email}`
    : `Created by ${email}`;
}
