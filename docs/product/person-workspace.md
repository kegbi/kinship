# Person Workspace

## Scope

This document fixes how the application groups information and workflows around
one person. [`information-architecture.md`](information-architecture.md) defines
the navigation and section composition; this document records the rule that
decides whether something is a section of the person workspace or a page of its
own.

## What Belongs On One Person Screen

A relationship manager is used one person at a time. Everything whose meaning
depends on the current person stays on that person's screen.

The profile header combines:

- avatar, display name, nickname, favorite state, and self-contact state;
- work title and company;
- birthday/age or deceased state;
- last shared activity and last call;
- short description;
- stay-in-touch cadence;
- tags and the main edit action.

The profile facts combine:

- relationships grouped as romantic, family, friend, and work relationships;
- pets;
- contact methods;
- addresses;
- how and when the people met, including who introduced them;
- work history;
- food preferences;
- archive, delete, vCard export, and audit-history actions.

The main profile content combines configurable sections:

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

These are sections of one person's workspace, not tabs that hide unrelated
datasets from each other. A member's view preference is kept in
`member_preferences.ui_state`, and section visibility for a workspace is kept in
`workspace_profile_modules`.

## What Deserves A Separate Surface

A separate route is used when the operation is not just another piece of the
profile:

- people list, archived people, search, and person creation;
- activity reports by year;
- full audit history and vCard/file delivery;
- journal and workspace-wide tasks;
- import/export and other long-running jobs;
- workspace personalization, members, security, API, DAV, storage, and billing.

A focused edit or create form does not need a page. A dialog, drawer, expandable
editor, or deep-linked section implements a local person action while preserving
one canonical profile route.

## Accepted Rule

The application has one canonical person workspace at `/app/people/:personId`.
It owns the user's navigation context for virtually all person-specific
information. Sections may be lazy, independently refreshable, and deep-linkable
through `?section=<section-id>`, but they do not become a tree of mandatory
subpages.

A separate page is justified only when at least one of these is true:

1. The workflow spans multiple people or the whole workspace.
2. It is a report or history view whose scale would overwhelm the profile.
3. It is long-running, resumable, or job-oriented.
4. It changes workspace, identity, security, or integration configuration.
5. It needs a stable external/document URL, such as an export or file stream.

This keeps a strong person-centered mental model while allowing modern section
navigation, responsive layouts, accessibility, and incremental data loading.

## Architectural Consequence

The person profile is a read composition, not a new mega-module. Its query may
combine approved read models from people, relationships, interactions, journal,
planning, files, and gifts/debts. Every mutation still enters the public use
case of the module that owns the data. The profile must never gain write access
to other modules' tables merely because it displays their information.
