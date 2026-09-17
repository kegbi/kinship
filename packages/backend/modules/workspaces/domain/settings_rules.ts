/**
 * What a member and a workspace are configured with, and how members order.
 *
 * `managedMembers` is the one rule with a decision in it. The administration
 * page joins memberships this module owns to the names identity owns, and
 * unlike the invitation list it refuses rather than drops: an administrator
 * changing somebody's role has to be shown every member, so a membership whose
 * identity is missing is a broken read and is raised, not quietly hidden.
 *
 * The ordering is by role first — owners, then administrators, then members —
 * because the page is about who can do what, and only then by address and
 * identifier so two people with the same name keep a stable place.
 */

import type { WorkspaceRole } from "./roles.ts";

/** What one member has chosen for themselves. */
export interface MemberPreferences {
  readonly contactNameOrder: string;
  readonly contactSortOrder: string;
  readonly currencyCode?: string;
  readonly fluidLayout: boolean;
  readonly locale: string;
  readonly measurementSystem: "imperial" | "metric";
  readonly temperatureScale: "celsius" | "fahrenheit";
  readonly timezone?: string;
}

/** The same, with the workspace's default filled in where they chose none. */
export interface ResolvedMemberPreferences extends MemberPreferences {
  readonly effectiveTimezone: string;
}

/** What the workspace itself is configured with. */
export interface WorkspaceConfiguration {
  readonly defaultCurrencyCode?: string;
  readonly defaultLocale: string;
  readonly defaultReminderTime: string;
  readonly defaultTimezone?: string;
  readonly name: string;
  readonly slug?: string;
}

/** One member on the administration page. */
export interface ManagedMember {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended";
}

/** One membership, as the repository stores it. */
export interface WorkspaceMemberRecord {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended";
  readonly userId: string;
}

/** The name and address the identity module holds for a member. */
export interface ManagedMemberIdentity {
  readonly email: string;
  readonly name: string;
  readonly userId: string;
}

/** Owners first, then administrators, then members. */
const ROLE_ORDER: Readonly<Record<WorkspaceRole, number>> = {
  owner: 0,
  admin: 1,
  member: 2,
};

/**
 * The administration page's member list.
 *
 * Raises when a membership has no identity behind it, because an
 * administrator acting on a list with a member silently missing from it would
 * be acting on the wrong list.
 */
export function managedMembers(
  memberships: readonly WorkspaceMemberRecord[],
  identities: readonly ManagedMemberIdentity[],
): readonly ManagedMember[] {
  const byUserId = new Map(
    identities.map((identity) => [identity.userId, identity]),
  );
  return memberships.map((membership) => {
    const summary = byUserId.get(membership.userId);
    if (!summary) throw new Error("Identity display summary is unavailable.");
    return {
      email: summary.email,
      id: membership.id,
      name: summary.name,
      role: membership.role,
      status: membership.status,
    };
  }).sort((left, right) =>
    ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
    left.email.localeCompare(right.email, undefined, {
      sensitivity: "base",
    }) ||
    left.id.localeCompare(right.id)
  );
}

/** True when a preferences change moves the member's own timezone. */
export function memberTimezoneChanged(
  previous: ResolvedMemberPreferences | undefined,
  next: ResolvedMemberPreferences,
): boolean {
  return previous?.timezone !== next.timezone;
}

/** True when a workspace change moves when reminders are due. */
export function workspaceScheduleChanged(
  previous: WorkspaceConfiguration | undefined,
  next: WorkspaceConfiguration,
): boolean {
  return previous?.defaultTimezone !== next.defaultTimezone ||
    previous?.defaultReminderTime !== next.defaultReminderTime;
}

/** The timezone reminders are scheduled in when the workspace named none. */
export const FALLBACK_TIMEZONE = "UTC";

/**
 * Whether this text names a time zone the calendar can actually schedule in.
 *
 * A stored timezone is not decoration: planning reschedules every reminder a
 * member or workspace owns against it, so a name the runtime cannot resolve
 * would be found at delivery time rather than at the form that set it. The
 * check is the runtime's own table rather than a list kept here, because the
 * IANA database moves and the only answer worth having is the one the
 * scheduler will get. It was written inside the settings route's Zod schema
 * until GAP-020; a rule about what a workspace may be configured with belongs
 * with the other rules about that.
 */
export function isSchedulableTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
