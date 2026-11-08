/**
 * Test support: typed answers a suite starts from.
 *
 * Each builder answers a complete contract value — the generated client's own
 * types, not a restatement of them — with the fields a test cares about
 * overridden. When the contract gains a required field or changes one, these
 * stop compiling rather than the suites drifting silently.
 */

import type {
  PersonDueInformation,
  PersonGenderOption,
  PersonProfileIdentity,
  PersonProfileSummary,
  ResolvedMemberPreferences,
  SessionContext,
} from "../../../../packages/contracts/generated/auth-client.ts";
import type { SectionProps } from "../features/person/section-mounts.ts";

/** The ids the fixtures use unless a test names its own. */
export const ids = {
  member: "00000000-0000-4000-8000-000000000002",
  person: "00000000-0000-4000-8000-000000000100",
  user: "00000000-0000-4000-8000-000000000001",
  workspace: "00000000-0000-4000-8000-000000000003",
} as const;

/** The person revision the fixtures carry. */
export const revision = "2026-08-15T08:00:00.000000Z";

/**
 * A person as the profile read names them: Ada, active, untagged, with no
 * section turned off (the optional `profileSections` is absent).
 */
export function personIdentity(
  overrides: Partial<PersonProfileIdentity> = {},
): PersonProfileIdentity {
  return {
    givenName: "Ada",
    id: ids.person,
    isDeceased: false,
    isPartial: false,
    isSelf: false,
    isStarred: false,
    tagCount: 0,
    tags: [],
    updatedAt: revision,
    ...overrides,
  };
}

/** What `GET /api/v1/people/:personId` answers. */
export interface PersonProfileAnswer {
  readonly dueInformation: PersonDueInformation;
  readonly genderOptions?: readonly PersonGenderOption[];
  readonly status: "ready" | "archived";
  readonly person: PersonProfileIdentity;
  readonly summary?: PersonProfileSummary;
}

/** An empty profile summary: no contact methods, relationships, or counts. */
export function profileSummary(
  overrides: Partial<PersonProfileSummary> = {},
): PersonProfileSummary {
  return {
    primaryContactMethods: [],
    relationshipCounts: [],
    sectionCounts: [],
    ...overrides,
  };
}

/** The profile a page loaded, overriding any part of it. */
export function personProfile(
  overrides: {
    readonly person?: Partial<PersonProfileIdentity>;
    readonly dueInformation?: Partial<PersonDueInformation>;
    readonly genderOptions?: readonly PersonGenderOption[];
    readonly status?: "ready" | "archived";
    readonly summary?: PersonProfileSummary;
  } = {},
): PersonProfileAnswer {
  return {
    dueInformation: {
      detail: "",
      openTaskCount: 0,
      status: "ready",
      ...overrides.dueInformation,
    },
    ...(overrides.genderOptions
      ? { genderOptions: overrides.genderOptions }
      : {}),
    person: personIdentity(overrides.person),
    status: overrides.status ?? "ready",
    ...(overrides.summary ? { summary: overrides.summary } : {}),
  };
}

/** A member's resolved preferences: English, UTC, given name first. */
export function preferences(
  overrides: Partial<ResolvedMemberPreferences> = {},
): ResolvedMemberPreferences {
  return {
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    effectiveTimezone: "UTC",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    reminderDelivery: "in_app",
    temperatureScale: "celsius",
    ...overrides,
  };
}

/** A signed-in owner of one workspace with nothing left to accept. */
export function workspaceSession(
  overrides: Partial<SessionContext> = {},
): SessionContext {
  const workspace = { id: ids.workspace, name: "Personal" };
  return {
    member: { id: ids.member, role: "owner" },
    // The session carries the member's preferences (AUD-F3).
    preferences: preferences(),
    principal: { userId: ids.user },
    requiredLegalDocuments: [],
    status: "authenticated",
    workspace,
    workspaces: [workspace],
    ...overrides,
  };
}

/** A session whose preferences the API could not read (AUD-F3). */
export function sessionWithoutPreferences(
  overrides: Partial<SessionContext> = {},
): SessionContext {
  const { preferences: _unread, ...session } = workspaceSession(overrides);
  return session;
}

/** What a person section's owner receives on mount. */
export function sectionProps(
  overrides: Partial<SectionProps> = {},
): SectionProps {
  return {
    archived: false,
    personId: ids.person,
    workspaceId: ids.workspace,
    ...overrides,
  };
}
