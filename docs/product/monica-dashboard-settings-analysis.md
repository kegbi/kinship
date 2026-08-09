# Monica Dashboard And Settings Analysis

## Scope And Evidence

This analysis records how Monica 4.x actually composed its dashboard and
settings surfaces. It preserves useful behavior and route coverage, but it does
not adopt Monica's visual styling, Blade/Vue implementation, or historical URL
shape.

The findings were verified against the local Monica 4.x source snapshot,
especially:

- `monica-4.x/routes/web.php`;
- `monica-4.x/app/Http/Controllers/DashboardController.php`;
- `monica-4.x/app/Http/Controllers/SettingsController.php` and the controllers
  under `app/Http/Controllers/Settings`;
- `monica-4.x/resources/views/dashboard` and
  `resources/js/components/dashboard/DashboardLog.vue`;
- `monica-4.x/resources/views/settings`, `resources/js/components/settings`, and
  `resources/sass/settings.scss`;
- `monica-4.x/resources/views/partials/header.blade.php` and
  `resources/views/layouts/skeleton.blade.php`;
- the preserved dashboard/header captures under
  `monica-4.x/public/img/changelogs`, including the custom-tasks and
  product-section captures.

The snapshot does not contain an application `.env`, PHP/Composer dependencies,
or built frontend dependencies, so a live browser rendering was not treated as
evidence. The route, controller, template, component, and style sources are the
authority for this audit.

## Shared Monica Shell

Both areas used the same authenticated shell:

- a dark blue top bar with the Monica mark;
- global contact search on the left;
- `Dashboard`, `People`, and `Journal` as primary text links;
- settings, changelog, and sign-out controls on the right;
- a light gray application background and centered content capped by `mw9`;
- white, thin-bordered cards with a three-pixel radius.

The desktop header put search and navigation on one line. On smaller screens the
same elements wrapped into multiple rows. Settings was represented by a small
gear icon on desktop and a text link on mobile. There was no account/avatar menu
or global create command.

## Monica Dashboard

### Page Composition

`GET /dashboard` rendered one of two states. An account with no real active
contacts received a centered illustration, explanation, and one **Add a
contact** button. Every other account received the full dashboard.

The full page was arranged as follows:

```text
+------------------------------------------------------------------+
| Recently consulted people: up to 10 avatars | Add a contact      |
+--------------------------------+---------------------------------+
| Reminders for current month    | Product changes: 3 entries      |
| and the next two months        +---------------------------------+
|                                | Calls | Notes | Debts | Tasks    |
|                                | one persisted tab at a time     |
|                                +---------------------------------+
|                                | Contacts | Activities | Gifts   |
+--------------------------------+---------------------------------+
```

The two main columns were each half-width on desktop and stacked on mobile. The
page had no explicit title, greeting, or prioritized "today" queue.

The content was source-driven rather than configurable:

- up to ten active, living contacts ordered by `last_consulted_at`;
- reminder outboxes grouped into the current and next two calendar months;
- the three newest product changelog entries;
- one tabbed card mixing recent calls, favorite notes, debts, and tasks;
- total counts for contacts, activities, and gifts.

The selected tab was persisted as `dashboard_active_tab` on the user. Each tab
loaded lazily. The tasks tab further switched between contact-related and
account-wide tasks and allowed inline create, complete, reopen, and delete.

### Dashboard Routes And Data Actions

| Method and path          | Historical role                                   | Page route |
| ------------------------ | ------------------------------------------------- | ---------- |
| `GET /dashboard`         | Full or empty dashboard                           | yes        |
| `GET /dashboard/calls`   | Up to 15 recent calls for the tab                 | no         |
| `GET /dashboard/notes`   | All favorite notes for the tab                    | no         |
| `GET /dashboard/debts`   | Debts for the tab                                 | no         |
| `POST /dashboard/setTab` | Persist the user's active tab                     | no         |
| `GET /tasks`             | Load dashboard tasks                              | no         |
| `POST /tasks`            | Create an account-wide task                       | no         |
| `PUT /tasks/{task}`      | Complete or reopen a task                         | no         |
| `DELETE /tasks/{task}`   | Delete an account-wide task                       | no         |
| `GET /changelog`         | Full product-changes surface linked from the card | yes        |
| `GET /people/add`        | Contact creation target used by the primary CTA   | yes        |

Relative Axios URLs made the dashboard's data loading depend on its current
route and delivery framework. The rewrite must use generated, typed API
contracts instead of copying these paths.

### Useful Lessons And Friction

Useful behavior to retain:

- a strong empty state that leads directly to the first useful object;
- fast return to recently consulted people;
- reminders and tasks that can be acted on without opening several pages;
- independent loading for secondary dashboard regions;
- a remembered view preference when that preference remains meaningful.

Friction to remove:

- three months of reminders consumed the largest area without separating
  overdue, today, and soon;
- product news competed with the person's relationship priorities;
- raw lifetime counters did not suggest a next action;
- calls, notes, debts, and tasks were unrelated datasets hidden behind one tab
  position, so three of four were always invisible;
- debt information could be unexpectedly exposed on the first screen;
- the dashboard mixed recent history, reference material, planning, product
  marketing, and statistics without a single hierarchy;
- the empty state taught only contact creation, not the first complete CRM loop.

## Monica Settings

### Visual And Navigation Structure

Most settings pages used a breadcrumb followed by a 3/9-column layout:

```text
Dashboard > Settings > Current page

+----------------------+-------------------------------------------+
| General              | Page heading or one/more white cards      |
| Personalization      |                                           |
| Storage              | Forms, tables, or Vue CRUD widgets        |
| Export               |                                           |
| Import               |                                           |
| Users                |                                           |
| Subscription*        |                                           |
| Tags                 |                                           |
| API                  |                                           |
| DAV*                 |                                           |
| Audit logs           |                                           |
| Security             |                                           |
+----------------------+-------------------------------------------+
* conditional
```

The sidebar was one ungrouped bordered list. Every row had a Font Awesome icon;
the active row received a pale background, bold text, and a green icon. On
mobile the entire sidebar became a full-width block above the content, forcing
the user to scroll past all navigation for every page.

`GET /settings` was not a settings overview. It was a long general form that
combined:

- first name, last name, email, and the contact representing the current user;
- locale, currency, temperature scale, reminder delivery time, and time zone;
- name ordering and narrow/fluid layout selection;
- workspace reset and account deletion forms directly below ordinary settings.

`GET /settings/personalization` placed six independently interactive Vue areas
on one long page: gender options, reminder rules, contact field types, activity
types, life-event types, and profile modules. Tags remained a separate page.

### Settings Page Routes

| Historical page path                              | Main content and presentation                                 |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `GET /settings`                                   | General/profile/preferences form plus both danger zones       |
| `GET /settings/emailchange1`                      | Detached reauthentication step for changing email             |
| `GET /settings/emailchange2`                      | Detached new-email form using the marketing shell             |
| `GET /settings/personalization`                   | Six stacked CRUD/toggle cards                                 |
| `GET /settings/storage`                           | Usage summary and a table of stored files and owning contacts |
| `GET /settings/export`                            | SQL/JSON job creation and previous export jobs                |
| `GET /settings/import`                            | Import empty state or job history                             |
| `GET /settings/import/upload`                     | Detached centered vCard upload form                           |
| `GET /settings/import/report/{importjobid}`       | Detached full-width import result                             |
| `GET /settings/users`                             | Member/invitation table or empty state                        |
| `GET /settings/users/create`                      | Detached centered invitation form                             |
| `GET /invitations/accept/{key}`                   | External invitation acceptance outside authenticated settings |
| `GET /settings/subscriptions`                     | Billing state or upgrade entry point                          |
| `GET /settings/subscriptions/upgrade`             | Upgrade form                                                  |
| `GET /settings/subscriptions/upgrade/success`     | Upgrade result                                                |
| `GET /settings/subscriptions/update`              | Payment-method update                                         |
| `GET /settings/subscriptions/confirmPayment/{id}` | Payment confirmation without the normal header or footer      |
| `GET /settings/subscriptions/invoice/{invoice}`   | Invoice delivery                                              |
| `GET /settings/subscriptions/downgrade`           | Downgrade checklist                                           |
| `GET /settings/subscriptions/archive`             | Subscription/account archive workflow                         |
| `GET /settings/subscriptions/downgrade/success`   | Downgrade result                                              |
| `GET /settings/tags`                              | Tag list, inline rename/delete, and expanded contact names    |
| `GET /settings/api`                               | Endpoint URL, personal tokens, OAuth clients, authorizations  |
| `GET /settings/dav`                               | DAV/CardDAV/CalDAV URLs and copy controls                     |
| `GET /settings/auditlogs`                         | Paginated workspace-wide audit table                          |
| `GET /settings/security`                          | Password, recovery codes, TOTP, and WebAuthn controls         |

The email-change steps, upload form, invitation form, and import report
deliberately left the settings sidebar. The email-change steps used the public
marketing shell; payment confirmation removed the normal header and footer.
These are the main surfaces Monica "pulled out" from the standard settings
layout.

### Settings Mutation And Widget Routes

These paths supported forms or widgets; they were not separate user-facing
pages:

- `POST /settings/save`, `/settings/reset`, and `/settings/delete`;
- `POST /settings/emailchange1` and `/settings/emailchange2` for the detached
  email-change challenge;
- CRUD under `/settings/personalization/contactfieldtypes`;
- CRUD, replacement, type lookup, and default selection under
  `/settings/personalization/genders`;
- reads and toggles under `/settings/personalization/reminderrules` and
  `/settings/personalization/modules`;
- category/type CRUD under `/settings/personalization/activitytypecategories`,
  `/settings/personalization/activitytypes`, and
  `/settings/personalization/lifeeventtypes`;
- `POST /settings/exportToSql`, `POST /settings/exportToJson`, and
  `POST /settings/export/{uuid}` for job creation/download;
- `POST /settings/import/storeImport` for upload submission;
- `POST /settings/users` and delete routes for members and invitations;
- `POST /invitations/accept/{key}` for external invitation acceptance;
- update/delete routes below `/settings/tags/{tag}`;
- password, TOTP, and recovery-code actions below `/settings/security`, with
  WebAuthn handled by the embedded connector/provider routes;
- `POST /settings/updateDefaultProfileView` for the profile tab preference;
- payment update, confirmation, downgrade, and archive POST actions under
  `/settings/subscriptions`.

OAuth token/client operations were performed by embedded Passport components,
not by additional settings pages. DAV copy buttons also acted locally on the one
DAV page.

### Useful Lessons And Friction

Useful behavior to retain:

- stable URLs for security, data jobs, members, API, integrations, billing, and
  audit history;
- job history and result pages for long-running import/export work;
- explicit empty states for first import, first teammate, and first tag;
- conditional navigation for unavailable subscription and DAV capabilities;
- clear separation between self settings and workspace data in the underlying
  behavior, even where the UI labels were vague.

Friction to remove:

- an ungrouped 10–12-item sidebar exposed implementation features rather than a
  user's mental model;
- personal identity, regional preferences, workspace defaults, layout, reset,
  and deletion were mixed on one page;
- the personalization page was long, heterogeneous, and had no deep link to an
  individual vocabulary;
- mobile navigation repeated the full settings list before every page;
- destructive actions relied on a native `confirm()` string and were visually
  adjacent to routine preferences;
- some breadcrumbs were incorrect because storage and audit reused the users
  label;
- save behavior varied between full forms, instant Vue mutations, inline links,
  and modal actions without a consistent dirty/success state;
- icons and color alone carried too much of the current-location and result
  meaning;
- tables were not designed for narrow screens, search, filtering, or large
  workspaces.

## Rewrite Consequence

The rewrite retains the dashboard as one global working surface and settings as
category-level administrative surfaces. It does not retain Monica's layout, tab
mixture, news/statistics priority, flat sidebar, or action URLs. The accepted
replacement is defined in
[`dashboard-settings-design.md`](dashboard-settings-design.md) and the exact
page IDs and routes live in [`page-catalog.yaml`](page-catalog.yaml).
