# Today And Settings Design Contract

## Decision

This document is the accepted UX and route contract for the authenticated home
page and settings. It fixes information hierarchy, layout behavior, stable page
routes, deep-link values, interaction rules, and required states. It does not
freeze brand colors, typography metrics, icon artwork, or package versions.

The design intentionally carries forward Monica's useful breadth without copying
the audited historical UI described in
[`monica-dashboard-settings-analysis.md`](monica-dashboard-settings-analysis.md).

## Shared Authenticated Shell

The application shell contains:

- primary navigation: **Today**, **People**, **Tasks**, and **Journal**;
- a global people search that can expand into command/search behavior;
- one consistently placed **Add** control for quick capture;
- a member menu containing profile, settings, what's new/help, and sign out;
- a visible active-workspace switcher only when the member can access more than
  one workspace.

Settings is not a primary-navigation peer. It is opened from the member menu.
Product changes never consume permanent space on Today.

The shell must preserve the same semantic order on desktop and mobile. A mobile
sheet may expose navigation, but search, the current page, and the primary
action remain reachable without scrolling through a complete settings menu.

## Today

### Route And Purpose

`/app` (`app.today`) is the authenticated landing page. Its job is to answer:

1. What requires my attention now?
2. Who should I reconnect with?
3. What did I work with recently?
4. What is the fastest way to record something new?

It is not an analytics dashboard, a product-news feed, or a compressed copy of
every module.

### Desktop Composition

```text
+-----------------------------------------------------------------------+
| Today · localized date                           [Add] [page actions]   |
| Short summary: overdue count, due today, next important date           |
+----------------------------------------------+------------------------+
| Needs attention                              | People to reconnect    |
| Overdue                                      | ordered by due cadence |
| Today                                        +------------------------+
| Next 7 days                                  | Recently viewed people |
|                                              +------------------------+
|                                              | Favorite notes         |
+----------------------------------------------+------------------------+
| Upcoming (next 30 days, compact preview)                               |
+-----------------------------------------------------------------------+
| Recent activity with type/person filters and progressive loading       |
+-----------------------------------------------------------------------+
```

The primary column uses roughly two-thirds of the available width; the secondary
rail uses one-third. The content width is bounded for readable scan lines. Cards
express a logical group, not every individual field.

### Mobile Composition

The semantic and focus order is:

1. page heading and quick capture;
2. needs attention;
3. people to reconnect;
4. upcoming;
5. recently viewed people;
6. favorite notes;
7. recent activity.

The page uses one column. Primary item actions remain visible or keyboard
reachable; they must not depend on hover. Secondary lists start compact and can
expand in place without changing route.

### Content Rules

- **Needs attention** unifies overdue and due tasks, reminder occurrences,
  important dates, and due stay-in-touch cadences. It groups first by `overdue`,
  `today`, and `next-seven-days`, then uses a deterministic due-time and person
  sort.
- **People to reconnect** shows people whose cadence is due or overdue, with
  last interaction context and direct log-interaction/open-person actions.
- **Upcoming** previews the next 30 days. It does not initially render three
  full calendar months. A link or expansion can reveal later items.
- **Recently viewed people** retains Monica's useful return path but uses actual
  view recency, not a misleading generic "last updated" label.
- **Favorite notes** is secondary reference material. It disappears cleanly when
  empty and never displaces due work.
- **Recent activity** is one chronological projection with type and person
  filters. Calls, notes, debts, and tasks are not mixed as mutually exclusive
  tabs. A debt appears here only according to its normal activity semantics;
  sensitive aggregate debt totals are not shown by default.
- Workspace lifetime counters and product changelog entries are excluded from
  Today. Future analytics require a separate product decision and route.

Completing a task, opening a person, or starting quick capture calls the owning
module's public use case or route. The `today` read model stays read-only.

### Today States

The initial empty state teaches a complete first-success loop:

1. add a person or start an import;
2. record the first interaction or note;
3. create a task, reminder, or stay-in-touch cadence.

A workspace with people but no due work receives a calm "all clear" state plus
recent people and quick capture; it is not treated as an empty account.

Each secondary region has an independent loading, empty, error, and retry state.
A failed favorite-notes or recent-activity query must not hide the attention
queue. Time calculations use the member's effective time zone and must be tested
across midnight and daylight-saving boundaries.

## Settings Information Architecture

### Settings Shell

Every ordinary settings page uses the authenticated shell and a settings-local
layout:

```text
+-----------------------------------------------------------------------+
| Settings                                               [Search settings]|
+--------------------------+--------------------------------------------+
| Personal                 | Breadcrumb / back context                  |
|   Profile                | Page title and concise scope description   |
|   Preferences            |                                            |
|   Security & sessions    | One readable content column                |
| Workspace                | (forms, lists, or a focused subnavigator)  |
|   General                |                                            |
|   Members                |                                            |
|   Personalization        |                                            |
| Data                     |                                            |
|   Storage / Import / ... |                                            |
| Developer                |                                            |
|   Integrations / API     |                                            |
+--------------------------+--------------------------------------------+
```

On desktop the grouped local navigation is sticky and approximately 240–280 px
wide. Form content is normally capped around 760–880 px. On mobile,
`/app/settings` is the category index; a category page shows a compact back
link/breadcrumb and current sibling selector instead of placing the complete
navigation above its content.

The settings search indexes route titles, section titles, and accepted aliases.
It navigates to a route and optional `?section=` value; it does not mutate
settings from search results.

### Stable Settings Routes

| Page ID                     | Route                                       | Responsibility                                                               |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `settings.index`            | `/app/settings`                             | Searchable grouped settings overview                                         |
| `settings.profile`          | `/app/settings/profile`                     | Name, email, self-person link, personal account lifecycle                    |
| `settings.preferences`      | `/app/settings/preferences`                 | Locale, time zone, regional formats, reminder delivery time, display density |
| `settings.security`         | `/app/settings/security`                    | Password, MFA, passkeys, recovery codes, active sessions                     |
| `settings.workspace`        | `/app/settings/workspace`                   | Workspace identity and workspace-wide defaults                               |
| `settings.members`          | `/app/settings/members`                     | Members, roles, pending invitations                                          |
| `settings.personalization`  | `/app/settings/personalization?section=...` | Workspace profile modules and controlled vocabularies                        |
| `settings.workspace-danger` | `/app/settings/workspace/danger-zone`       | Owner-only workspace reset and deletion                                      |
| `settings.storage`          | `/app/settings/storage`                     | Usage, limits, missing/quarantined objects, file lookup                      |
| `settings.import`           | `/app/settings/import`                      | Import history and first-import empty state                                  |
| `settings.import-new`       | `/app/settings/import/new`                  | Upload, format detection, dry run, and confirmation                          |
| `settings.import-report`    | `/app/settings/import/:importId`            | Resumable progress and complete diagnostics                                  |
| `settings.export`           | `/app/settings/export`                      | Export creation, progress, history, and authorized download                  |
| `settings.audit`            | `/app/settings/audit`                       | Filterable workspace audit history                                           |
| `settings.integrations`     | `/app/settings/integrations`                | Optional adapters such as DAV and their health/conflicts                     |
| `settings.api-access`       | `/app/settings/api`                         | API tokens, OAuth clients, scopes, expiry, and revocation                    |
| `settings.billing`          | `/app/settings/billing`                     | Optional owner-only billing and invoices                                     |

The accepted personalization deep-link values are:

- `profile-modules`;
- `gender-options`;
- `contact-method-types`;
- `contact-labels`;
- `activity-types`;
- `emotion-options`;
- `life-event-types`;
- `relationship-types`;
- `pet-categories`;
- `reminder-rules`;
- `tags`.

Only one personalization section is primary at a time. The section navigator
updates the URL and browser history. Create, rename, replace, reorder, set
default, disable, and delete actions use accessible dialogs, drawers, or inline
rows on that page; they do not create additional page routes.

### What Is Intentionally Standalone

- Import creation and each import report have routes because the work is
  long-running, resumable, and diagnostics-heavy.
- Export, storage, audit, integrations, API access, and billing have routes
  because they are workspace-wide operational surfaces.
- The workspace danger zone has its own owner-only route so destructive actions
  cannot be mistaken for ordinary preferences.
- Invitation creation stays on the members page as a dialog or drawer;
  invitation acceptance remains the external `/invite/:token` route.
- Password/MFA/passkey/session actions stay within the security page. Challenge
  steps can use dialogs or on-demand authentication transitions without adding
  discoverable settings pages.
- Personalization vocabularies share one route and stable section deep links;
  individual CRUD forms are not pages.
- Billing-provider callbacks, downloads, and API mutations are transport
  endpoints, not navigation destinations. Their exact API paths belong to the
  generated OpenAPI contract when implemented.

### Settings Interaction Rules

- Fields with several related edits use an explicit **Save changes** action and
  a visible dirty state. Navigating away with unsaved changes requires a clear
  choice.
- Independent toggles may save immediately only when success/failure is
  announced and the prior value can be restored. Do not mix implicit and
  explicit persistence inside one logical form.
- Validation appears beside the responsible field and an error summary focuses
  the first invalid control. A success toast never substitutes for persistent
  state on security, import, export, or billing work.
- Destructive vocabulary replacement shows impact counts and the replacement
  target before confirmation.
- Personal account deletion requires reauthentication and explains membership
  consequences from `settings.profile`. Workspace reset/deletion additionally
  requires owner permission, impact counts, typed confirmation, and a final
  server-side invariant check.
- Navigation is derived from permissions and enabled modules. A direct request
  to a forbidden route still returns the canonical forbidden state; hiding a
  link is not authorization.
- Lists support search/filtering before pagination is needed. Narrow layouts use
  labeled rows or cards instead of horizontally clipped desktop tables.
- Every setting has a stable label, description, current value, ownership scope
  (`Personal` or `Workspace`), and predictable reset-to-default behavior.

## Component And Accessibility Contract

Use equivalent Kinship primitives for button, card, badge, breadcrumb, segmented
filter, dialog, sheet, menu, table, and skeleton interactions. These primitives
are hand-written vanilla TypeScript and CSS. This amendment supersedes the
earlier shadcn/ui naming; it is an explicit implementation decision, not
contract drift.

The component library does not determine information architecture. In
particular:

- do not use tabs to hide unrelated dashboard datasets;
- do not rely on an icon, color, placeholder, or toast as the only label;
- do not require hover for an action;
- preserve heading hierarchy, keyboard focus, browser history, and live-region
  announcements for island updates;
- meet a minimum 44-by-44 CSS-pixel touch target where actions are used on
  mobile;
- respect reduced motion and maintain usable focus/contrast in all themes.

## Change Control

The following are fixed and require synchronized updates to this document,
[`page-catalog.yaml`](page-catalog.yaml), affected flows, and E2E coverage:

- `/app` as the one Today route and its semantic content order;
- the settings route hierarchy above;
- personalization section IDs;
- which workflows are standalone versus local actions;
- permission-dependent navigation and destructive-action safeguards;
- loading, empty, error, forbidden, and responsive behavior.

Brand expression, exact spacing tokens, fonts, final icon set, illustration
style, and optional analytics remain open until the implementation/design-system
slice makes them concrete.
