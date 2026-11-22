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

/** The areas the token form groups its grants by, in the order it shows them. */
export const API_TOKEN_SCOPE_GROUPS = [
  { id: "people", title: "People" },
  { id: "relationships", title: "Relationships" },
  { id: "interactions", title: "Interactions" },
  { id: "planning", title: "Tasks and reminders" },
  { id: "journal", title: "Journal" },
  { id: "gifts", title: "Gifts and debts" },
  { id: "files", title: "Files" },
  { id: "overview", title: "Search and Today" },
  { id: "vocabularies", title: "Vocabularies" },
] as const;

export type ScopeGroupId =
  | (typeof API_TOKEN_SCOPE_GROUPS)[number]["id"]
  | "other";

/**
 * What a grant lets a token do with what it admits: read it, or change it.
 * A grant the server offers that this page does not describe is `unknown`.
 */
export type ScopeAccess = "read" | "write" | "unknown";

/** Why a grant deserves a second look, said in words beside its checkbox. */
export type ScopeCaution =
  | "destructive"
  | "broad"
  | "financial"
  | "administrative";

export interface ScopeChoice {
  readonly scope: string;
  readonly label: string;
  readonly detail: string;
  readonly group: ScopeGroupId;
  readonly access: ScopeAccess;
  readonly caution?: ScopeCaution;
}

interface KnownScope extends Omit<ScopeChoice, "scope" | "access"> {
  readonly access: "read" | "write";
}

/**
 * Every grant the contract defines, keyed so the compiler refuses a scope
 * without a description. Within a group, reads come before writes.
 */
const SCOPES = {
  "people:read": {
    access: "read",
    detail: "The people directory and its tag filters; names and list entries.",
    group: "people",
    label: "Read people",
  },
  "people:profile:read": {
    access: "read",
    detail:
      "Identity, profile facts, important dates, life events, and their lookup options.",
    group: "people",
    label: "Read person profiles",
  },
  "people:write": {
    access: "write",
    detail:
      "Create, rename, archive, restore, and star people, and change their profile facts, important dates, and life events; no deleting or merging.",
    group: "people",
    label: "Edit people",
  },
  "people:delete": {
    access: "write",
    caution: "destructive",
    detail:
      "Preview and permanently delete a person and everything recorded about them.",
    group: "people",
    label: "Delete people",
  },
  "people:merge": {
    access: "write",
    caution: "destructive",
    detail:
      "Review possible duplicates, dismiss them, and merge two people into one.",
    group: "people",
    label: "Merge people",
  },
  "relationships:read": {
    access: "read",
    detail: "Person relationships and relationship types.",
    group: "relationships",
    label: "Read relationships",
  },
  "relationships:write": {
    access: "write",
    detail: "Add, change, and remove relationships between people.",
    group: "relationships",
    label: "Edit relationships",
  },
  "interactions:read": {
    access: "read",
    detail:
      "A person's notes, activities, calls, and conversations, and the activity report.",
    group: "interactions",
    label: "Read interactions",
  },
  "interactions:create": {
    access: "write",
    detail:
      "Record notes, activities, calls, and conversations, with their capture options; no reading, editing, or deleting historic content.",
    group: "interactions",
    label: "Record interactions",
  },
  "interactions:write": {
    access: "write",
    detail:
      "Edit and delete existing notes, activities, calls, and conversations; no recording new ones.",
    group: "interactions",
    label: "Edit interactions",
  },
  "tasks:read": {
    access: "read",
    detail: "Task lists and individual task details.",
    group: "planning",
    label: "Read tasks",
  },
  "reminders:read": {
    access: "read",
    detail: "A person's reminders.",
    group: "planning",
    label: "Read reminders",
  },
  "tasks:create": {
    access: "write",
    detail: "New tasks only; no reading or editing existing tasks.",
    group: "planning",
    label: "Create tasks",
  },
  "tasks:write": {
    access: "write",
    detail:
      "Edit, complete, and reopen existing tasks; no reading or creating.",
    group: "planning",
    label: "Edit and complete tasks",
  },
  "reminders:write": {
    access: "write",
    detail:
      "Create, pause, resume, and change reminders and stay-in-touch cadences.",
    group: "planning",
    label: "Edit reminders",
  },
  "journal:read": {
    access: "read",
    detail: "The workspace journal: posts, day ratings, and linked activities.",
    group: "journal",
    label: "Read journal",
  },
  "journal:write": {
    access: "write",
    detail:
      "Write, edit, and delete any journal post or day rating in the workspace, not only your own.",
    group: "journal",
    label: "Edit journal",
  },
  "gifts:read": {
    access: "read",
    caution: "financial",
    detail: "A person's gifts, debts, recurring debts, and debt settlements.",
    group: "gifts",
    label: "Read gifts and debts",
  },
  "gifts:write": {
    access: "write",
    caution: "financial",
    detail:
      "Create and change gifts, debts, and recurring debts, and record settlements.",
    group: "gifts",
    label: "Edit gifts and debts",
  },
  "files:read": {
    access: "read",
    detail: "List the files attached to a person and download them.",
    group: "files",
    label: "Read files",
  },
  "files:write": {
    access: "write",
    detail: "Upload files to a person and remove them.",
    group: "files",
    label: "Edit files",
  },
  "search:read": {
    access: "read",
    caution: "broad",
    detail:
      "Search results across areas: people and matching text from notes, activities, journal posts, tasks, and reminders.",
    group: "overview",
    label: "Search the workspace",
  },
  "today:read": {
    access: "read",
    caution: "broad",
    detail:
      "The Today page across areas: people due for contact, recent people, reminders, important dates, tasks, favorite notes, and recent activity.",
    group: "overview",
    label: "Read Today",
  },
  "vocabularies:read": {
    access: "read",
    detail:
      "The workspace's personalization lists, such as relationship, activity, and contact types.",
    group: "vocabularies",
    label: "Read vocabularies",
  },
  "vocabularies:write": {
    access: "write",
    caution: "administrative",
    detail: "Add, rename, and remove personalization entries.",
    group: "vocabularies",
    label: "Edit vocabularies",
  },
} as const satisfies Record<ApiTokenScope, KnownScope>;

/** Displayed before hydration too; the loaded authority decides which are offered. */
export const API_TOKEN_SCOPE_CHOICES: readonly (ScopeChoice & {
  readonly scope: ApiTokenScope;
})[] = Object.entries(SCOPES).map(([scope, choice]) => ({
  scope: scope as ApiTokenScope,
  ...choice,
}));

const KNOWN = new Map<string, ScopeChoice>(
  API_TOKEN_SCOPE_CHOICES.map((choice) => [choice.scope, choice]),
);

/** A grant this page does not describe: shown by its own name, never hidden. */
function unknownScope(scope: string): ScopeChoice {
  return {
    access: "unknown",
    detail:
      "This server offers a grant this page does not describe yet. Check the API reference before granting it.",
    group: "other",
    label: scope,
    scope,
  };
}

/** The word a grant's access is marked with. */
export const ACCESS_TEXT: Readonly<Record<ScopeAccess, string>> = {
  read: "Read",
  unknown: "Unclassified",
  write: "Write",
};

/** The words a grant's caution is marked with; never colour alone. */
export function cautionText(caution: ScopeCaution): string {
  switch (caution) {
    case "destructive":
      return "Destructive: cannot be undone.";
    case "broad":
      return "Broad: returns content from several areas.";
    case "financial":
      return "Financial information.";
    case "administrative":
      return "Owners and administrators only.";
  }
}

/** A grant's label, or the grant itself when this page does not know it. */
export function scopeLabel(scope: string): string {
  return KNOWN.get(scope)?.label ?? scope;
}

export interface ScopeGroup {
  readonly id: ScopeGroupId;
  readonly title: string;
  readonly choices: readonly ScopeChoice[];
}

/**
 * The offered grants by area, empty areas left out, and any grant the page
 * does not describe under "Other grants". Before the authority has answered
 * (`offered` undefined) every known grant is shown.
 */
export function scopeGroups(
  offered: readonly string[] | undefined,
): readonly ScopeGroup[] {
  const shown = offered === undefined
    ? API_TOKEN_SCOPE_CHOICES
    : API_TOKEN_SCOPE_CHOICES.filter(({ scope }) => offered.includes(scope));
  const groups: ScopeGroup[] = API_TOKEN_SCOPE_GROUPS.map(({ id, title }) => ({
    choices: shown.filter((choice) => choice.group === id),
    id,
    title,
  }));
  groups.push({
    choices: (offered ?? []).filter((scope) => !KNOWN.has(scope)).map(
      unknownScope,
    ),
    id: "other",
    title: "Other grants",
  });
  return groups.filter(({ choices }) => choices.length > 0);
}

export interface ScopePreset {
  readonly id: "read-only" | "full";
  readonly label: string;
  readonly detail: string;
  readonly scopes: readonly ApiTokenScope[];
}

/** A grant no preset ticks: it must be chosen deliberately. */
const optIn = (choice: ScopeChoice) =>
  choice.caution === "destructive" || choice.caution === "administrative";

/** One-click starting points that only tick checkboxes. */
export const SCOPE_PRESETS: readonly ScopePreset[] = [
  {
    detail: "Ticks every read grant and no write grant.",
    id: "read-only",
    label: "Read-only agent",
    scopes: API_TOKEN_SCOPE_CHOICES.filter(({ access }) => access === "read")
      .map(({ scope }) => scope),
  },
  {
    detail:
      "Ticks every read and write grant except deleting people, merging people, and editing vocabularies, which stay opt-in.",
    id: "full",
    label: "Full CRM agent",
    scopes: API_TOKEN_SCOPE_CHOICES.filter((choice) => !optIn(choice)).map((
      { scope },
    ) => scope),
  },
];

/** What the static configuration text shows instead of a token. */
export const TOKEN_PLACEHOLDER = "<your-api-token>";

/** The MCP endpoint behind this page's own public origin. */
export function mcpEndpoint(origin: string): string {
  return `${origin}/api/v1/mcp`;
}

export interface AgentConfigurations {
  readonly claudeCode: string;
  readonly json: string;
}

/** The configuration blocks the page shows, each named for its copy button. */
export function configurationBlocks(
  configurations: AgentConfigurations,
): readonly {
  readonly heading: string;
  readonly name: string;
  readonly text: string;
}[] {
  return [
    {
      heading: "Claude Code",
      name: "Claude Code command",
      text: configurations.claudeCode,
    },
    {
      heading: "Other MCP clients",
      name: "JSON configuration",
      text: configurations.json,
    },
  ];
}

/**
 * Ready-to-paste client configuration for the endpoint, carrying `token`
 * when one is given and the placeholder otherwise.
 */
export function agentConfigurations(
  endpoint: string,
  token: string = TOKEN_PLACEHOLDER,
): AgentConfigurations {
  const authorization = `Bearer ${token}`;
  return {
    claudeCode:
      `claude mcp add --transport http kinship ${endpoint} --header "Authorization: ${authorization}"`,
    json: JSON.stringify(
      {
        mcpServers: {
          kinship: {
            type: "http",
            url: endpoint,
            headers: { Authorization: authorization },
          },
        },
      },
      null,
      2,
    ),
  };
}

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
