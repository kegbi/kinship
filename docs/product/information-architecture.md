# Information Architecture

## Navigation Model

The authenticated application has four primary destinations:

1. **Today** for time-sensitive and recent information.
2. **People** for finding and working with a person.
3. **Tasks** for workspace-wide planning.
4. **Journal** for the user's chronological personal record.

Settings, import/export, account administration, and optional integrations are
utilities rather than primary CRM navigation.

```text
Public
  Home
  Features
  Privacy
  Terms
  Authentication and invitation acceptance

Application
  Today
  People
    People list
    Archived people
    Create person
    Person workspace
      Activity report
      Audit history
  Tasks
  Journal
    Journal item
  Settings
    Overview and settings search
    Personal
      Profile
      Preferences
      Security and sessions
    Workspace
      General
      Members
      Personalization and vocabularies
      Danger zone
    Data
      Storage
      Import and import reports
      Export
      Audit history
    Developer
      Integrations
      API access
    Billing when enabled
```

There is no required global relationship page, reminder page, or generic
timeline page in the initial information architecture. Relationships and
person-specific reminders belong to the person workspace. Upcoming reminders
belong on Today, account-wide planning belongs on Tasks, and the personal record
belongs in Journal. A later power-user view needs usage evidence and a product
decision rather than an anticipatory route.

## Today

`/app` is the only authenticated home route. It prioritizes a unified attention
queue, people due for contact, upcoming items, recently viewed people, favorite
notes, and recent activity in that order. It does not display product news,
lifetime vanity counters, or unrelated datasets hidden behind a single tab.

The attention queue composes overdue, today, and next-seven-day work from tasks,
reminders, important dates, and stay-in-touch cadences. The wider upcoming
preview is bounded to the next 30 days. Every item links back to its canonical
person section or global task surface; Today does not create duplicate detail
pages or write directly through its read model.

The accepted desktop and mobile composition, empty states, and interaction rules
are fixed in [`dashboard-settings-design.md`](dashboard-settings-design.md).

## Settings

`/app/settings` is a searchable category overview, not a long general-settings
form. Ordinary pages share a grouped local navigation on desktop and compact
category context on mobile. The stable category routes are:

- personal: `/app/settings/profile`, `/app/settings/preferences`, and
  `/app/settings/security`;
- workspace: `/app/settings/workspace`, `/app/settings/members`,
  `/app/settings/personalization`, and the owner-only
  `/app/settings/workspace/danger-zone`;
- data: `/app/settings/storage`, `/app/settings/import`,
  `/app/settings/import/new`, `/app/settings/import/:importId`,
  `/app/settings/export`, and `/app/settings/audit`;
- developer: `/app/settings/integrations` and `/app/settings/api`;
- optional owner billing: `/app/settings/billing`.

Related controlled vocabularies do not become a forest of CRUD routes.
`/app/settings/personalization?section=<section-id>` shows one focused
vocabulary/module view and preserves it in browser history. Dialogs, drawers, or
inline rows handle local create/edit/replace/delete actions. Imports and reports
remain standalone because they are long-running and resumable; member invitation
creation stays local to the members page.

Personal and workspace scopes must be visibly labeled. Permission-dependent
navigation never replaces server authorization. Destructive workspace actions
are isolated from ordinary preferences and require owner permission,
reauthentication when policy requires it, impact disclosure, typed confirmation,
and invariant checks.

## Person Workspace

`/app/people/:personId` is the canonical person route. It is an information-rich
workspace composed from sections, not an overview that forces the user into a
route for every fact.

### Identity and orientation

- name, nickname, pronouns/gender vocabulary, avatar, description, and tags;
- favorite, archived, partial, self-person, and deceased states;
- important dates and partial-date precision;
- last interaction, next reminder, and stay-in-touch state;
- work summary and primary contact methods;
- quick actions for an interaction, note, task, reminder, and edit.

### Profile facts

- all contact methods and labels;
- addresses and location-derived information;
- first-meeting story, date, place, and introducer;
- organizations and occupation history;
- food preferences;
- pets;
- relationships grouped by configured relationship type.

### History and communication

- life events;
- notes, including favorite notes;
- conversations and messages;
- calls and emotions;
- activities, participants, categories, and emotions;
- a compact chronological projection across relevant person events.

### Planning and practical details

- open and completed tasks;
- reminders and their next occurrence;
- stay-in-touch cadence;
- gifts and gift attachments;
- debts;
- documents and photos.

### Administrative actions

- vCard export;
- audit summary and link to full audit history;
- archive, restore, soft delete, and deletion confirmation.

Workspace profile-module settings may hide optional sections, but hidden modules
do not destroy data. The page must preserve section identity even when layout or
ordering changes.

## Person Workspace Interaction Rules

- Use local editors for person-owned data. The concrete presentation can be a
  dialog, drawer, expandable section, or inline editor; this contract does not
  prescribe visual UI.
- The URL query `section` is the stable deep-link mechanism for a profile
  section. Back/forward navigation and keyboard focus must continue to work.
- Load the identity summary and high-value due information first. Large history,
  files, photos, and reports may load lazily in focused islands.
- Each section owns independent loading, empty, error, forbidden, and retry
  states. A failed optional section must not blank the complete profile.
- Archived people remain readable. Mutating actions are disabled except restore,
  export, and deletion actions allowed by policy.
- Partial/imported placeholder people resolve to the canonical person or display
  an explicit reconciliation state; they are never shown as silently duplicated
  profiles.

## Global Quick Capture

Authenticated pages may expose a common command surface for:

- create a person;
- log an activity, call, or conversation;
- add a note;
- create a task or reminder;
- search and navigate to a person.

Quick capture invokes the same application use cases and permission checks as
the full person workspace. It does not introduce a second write path.

## Rendering Contract

| Page class                                               | Default strategy                  | Reason                                                             |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Marketing and legal                                      | Static                            | Public and stable content.                                         |
| Sign-in and simple recovery forms                        | Static shell with an island       | Only the form and session result are dynamic.                      |
| Token, invitation, MFA, and cookie-sensitive transitions | On-demand                         | The first response depends on protected server state.              |
| Authenticated CRM pages                                  | Static shell with focused islands | Preserves static-first delivery while loading private data safely. |
| Exceptional personalized first paint                     | On-demand by ADR                  | Allowed only after the page-level trade-off is demonstrated.       |

Client rendering never weakens authorization: every API query and mutation
independently verifies the principal and active workspace.

## Responsive And Accessible Composition

On wide screens, profile sections may use summary/detail columns. On narrow
screens, the same semantic section order becomes a single flow with a sticky or
disclosed section navigator. DOM order, heading hierarchy, focus restoration,
keyboard operation, and announcements for asynchronous state are contractual;
the visual arrangement is not.

Every cataloged page must define and test loading, empty, error, forbidden, and
not-found behavior where applicable. Representative states receive automated
accessibility and keyboard-only E2E assertions.
