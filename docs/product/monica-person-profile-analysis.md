# Monica Person Profile Analysis

## Scope

This analysis studies how Monica 4.x grouped information and workflows around a
contact. It deliberately does not adopt Monica's visual styling, Blade/Vue
component choices, responsive behavior, or interaction design.

The findings were verified against the local Monica 4.x source snapshot,
especially:

- `monica-4.x/routes/web.php`;
- `monica-4.x/app/Http/Controllers/ContactsController.php`;
- `monica-4.x/resources/views/people/profile.blade.php`;
- `monica-4.x/resources/views/people/_header.blade.php`;
- `monica-4.x/resources/views/people/sidebar.blade.php`;
- the `monica-4.x/resources/views/people` and
  `monica-4.x/resources/js/components/people` trees.

The committed supporting evidence is the contact-centered domain description in
[`personal-crm-schema/v1/monica_architecture_analysis.md`](../../personal-crm-schema/v1/monica_architecture_analysis.md)
and the contact-scoped API and web-route inventory in
[`monica-internals-spec/07-api-surface.md`](../../monica-internals-spec/07-api-surface.md).

## What Monica Put On One Contact Screen

`GET /people/{contact}` rendered the main profile. The controller prepared the
contact, categorized relationships, active reminders, enabled profile modules,
partial-date inputs, weather, and storage/account state for that one surface.

The profile header combined:

- avatar, display name, nickname, favorite state, and self-contact state;
- work title and company;
- birthday/age or deceased state;
- last shared activity and last call;
- short description;
- stay-in-touch cadence;
- tags and the main edit action.

The profile sidebar combined:

- relationships grouped as romantic, family, friend, and work relationships;
- pets;
- contact methods;
- addresses;
- how and when the people met, including who introduced them;
- work history;
- food preferences;
- weather when an address supported it;
- archive, delete, vCard export, and audit-log actions.

The main profile content combined configurable modules:

- life events;
- notes;
- conversations and their messages;
- calls and emotions;
- activities, participants, and emotions;
- reminders;
- tasks;
- gifts;
- debts;
- documents;
- photos.

The historical UI switched the main column among `life-events`, an `other` group
whose saved preference was named `notes`, and `photos`. The `other` group still
embedded notes, conversations, calls, activities, reminders, tasks, gifts,
debts, and documents on the same contact route. The rewrite does not inherit
those three tabs or their naming; it inherits the decision that these are
sections of one person's workspace.

Monica used a small profile-view preference and broad profile-module toggles,
but the data remained person-scoped and reachable from the same profile. The
canonical rewrite preserves those preferences in `member_preferences.ui_state`
and module configuration in `workspace_profile_modules`.

## What Deserved A Separate Surface

Monica used separate routes primarily when the operation was not just another
piece of the profile:

- people list, archived people, search, and person creation;
- activity reports by year;
- full audit history and vCard/file delivery;
- journal and account-wide tasks;
- import/export and other long-running jobs;
- workspace personalization, members, security, API, DAV, storage, and billing;
- focused edit/create forms when the older UI could not express them inline.

The existence of a historical form route does not mean the rewrite needs a
separate page. A dialog, drawer, expandable editor, or deep-linked section may
implement a local person action while preserving one canonical profile route.

## Accepted Rewrite Rule

The rewrite has one canonical person workspace at `/app/people/:personId`. It
owns the user's navigation context for virtually all person-specific
information. Sections may be lazy, independently refreshable, and deep-linkable
through `?section=<section-id>`, but they do not become a tree of mandatory
subpages.

A separate page is justified only when at least one of these is true:

1. The workflow spans multiple people or the whole workspace.
2. It is a report or history view whose scale would overwhelm the profile.
3. It is long-running, resumable, or job-oriented.
4. It changes workspace, identity, security, or integration configuration.
5. It needs a stable external/document URL, such as an export or file stream.

This keeps Monica's strong contact-centered mental model while allowing modern
section navigation, responsive layouts, accessibility, and incremental data
loading.

## Architectural Consequence

The person profile is a read composition, not a new mega-module. Its query may
combine approved read models from people, relationships, interactions, journal,
planning, files, and gifts/debts. Every mutation still enters the public use
case of the module that owns the data. The profile must never gain write access
to other modules' tables merely because it displays their information.
