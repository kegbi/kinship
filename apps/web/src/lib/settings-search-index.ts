/**
 * What the settings overview's search can find: every settings page, and the
 * individual settings inside each, grouped by the overview's categories. A
 * member looking for "theme" or "time zone" lands on the control itself
 * rather than guessing which page holds it. `pages/app/settings/index.astro`
 * draws every entry once, hidden; `mountSettingsSearch` (`app-shell.ts`)
 * reveals the ones a query matches. `access` is the role an entry needs, the
 * same as its page's in `settings-destinations.ts`.
 */

import { PERSONALIZATION_SECTIONS } from "../features/settings/personalization/personalization.ts";
import { groups } from "./settings-destinations.ts";

export type SettingsAccess = "member" | "admin" | "owner";

export interface SettingsSearchEntry {
  readonly access: SettingsAccess;
  readonly href: string;
  /** Words a member might type for it besides its label and page. */
  readonly keywords: string;
  readonly label: string;
  /** The page it lives on, shown beside the label; absent for a page. */
  readonly page?: string;
}

export interface SettingsSearchCategory {
  readonly entries: readonly SettingsSearchEntry[];
  /** The overview section the entries belong to. */
  readonly id: "personal" | "workspace" | "data" | "developer" | "billing";
}

interface Destination {
  readonly access: SettingsAccess;
  readonly href: string;
  readonly id: string;
  readonly label: string;
}

const destinations: readonly Destination[] = groups.flatMap((
  group,
): readonly Destination[] => group.destinations);

function destination(id: string): Destination {
  const found = destinations.find((entry) => entry.id === id);
  if (!found) throw new Error(`No settings destination ${id}`);
  return found;
}

/** The settings page itself, as an entry. */
function page(id: string, keywords: string): SettingsSearchEntry {
  const { access, href, label } = destination(id);
  return { access, href, keywords, label };
}

/** One setting on the page `id` names, opened at `anchor` when it has one. */
function setting(
  id: string,
  label: string,
  keywords: string,
  anchor = "",
): SettingsSearchEntry {
  const { access, href, label: pageLabel } = destination(id);
  return {
    access,
    href: anchor ? `${href}#${anchor}` : href,
    keywords,
    label,
    page: pageLabel,
  };
}

export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchCategory[] = [
  {
    id: "personal",
    entries: [
      page("settings.profile", "account personal identity"),
      setting("settings.profile", "Email address", "email login verify"),
      setting("settings.profile", "Name", "first name last name"),
      setting("settings.profile", "Leave this workspace", "membership quit"),
      setting(
        "settings.profile",
        "Delete personal identity",
        "delete account remove me",
      ),
      page("settings.preferences", "display formats"),
      setting(
        "settings.preferences",
        "Theme",
        "appearance dark light mode system colors night",
        "appearance-heading",
      ),
      setting("settings.preferences", "Locale", "language region formats"),
      setting("settings.preferences", "Time zone", "timezone clock"),
      setting("settings.preferences", "Temperature", "celsius fahrenheit"),
      setting("settings.preferences", "Measurements", "units metric imperial"),
      setting("settings.preferences", "Currency", "money"),
      setting("settings.preferences", "Contact sorting", "sort order people"),
      setting(
        "settings.preferences",
        "Name display",
        "name order nickname family given",
      ),
      setting(
        "settings.preferences",
        "Reminder delivery",
        "email reminders notifications",
      ),
      setting("settings.preferences", "Daily email digest", "summary email"),
      setting(
        "settings.preferences",
        "Calendar feed",
        "ical ics subscription calendar",
        "calendar-feed-heading",
      ),
      page(
        "settings.security",
        "password mfa two-factor passkeys recovery sessions",
      ),
      setting(
        "settings.security",
        "Active sessions",
        "devices sign out log out",
      ),
    ],
  },
  {
    id: "workspace",
    entries: [
      page("settings.workspace", "workspace identity shared defaults"),
      setting("settings.workspace", "Workspace name", "rename title"),
      setting("settings.workspace", "Workspace slug", "url address"),
      setting("settings.workspace", "Default locale", "language"),
      setting("settings.workspace", "Default time zone", "timezone"),
      setting("settings.workspace", "Default currency", "money"),
      setting("settings.workspace", "Default reminder time", "notification"),
      page("settings.members", "people team roles"),
      setting("settings.members", "Invite a member", "invitation add user"),
      setting("settings.members", "Member roles", "owner admin permissions"),
      setting("settings.members", "Pending invitations", "invites"),
      page(
        "settings.personalization",
        "vocabularies customize options",
      ),
      ...PERSONALIZATION_SECTIONS.map(({ id, label }) => ({
        ...setting("settings.personalization", label, "vocabulary options"),
        href: `/app/settings/personalization?section=${id}`,
      })),
    ],
  },
  {
    id: "data",
    entries: [
      page("settings.storage", "files usage limits quota missing quarantined"),
      page("settings.import", "upload history report resumable"),
      setting(
        "settings.import",
        "Import from Monica",
        "migrate monica sql",
      ),
      setting(
        "settings.import",
        "Import contacts",
        "csv vcard vcf google outlook",
      ),
      page("settings.export", "download backup data"),
      page("settings.audit", "history log governance changes"),
      page("settings.workspace-danger", "danger destructive"),
      setting(
        "settings.workspace-danger",
        "Reset CRM data",
        "erase wipe clear",
      ),
      setting(
        "settings.workspace-danger",
        "Delete workspace",
        "remove close destroy",
      ),
    ],
  },
  {
    id: "developer",
    entries: [
      page("settings.integrations", "dav carddav caldav sync connection"),
      page("settings.api-access", "api tokens personal access scopes"),
    ],
  },
];
