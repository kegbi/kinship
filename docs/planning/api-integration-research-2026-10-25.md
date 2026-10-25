# Kinship external API coverage research

Status: proposed API scope and functionality, researched 25 October 2026 against
code snapshot `c46579ec`. This research does not change accepted authorization,
schema, product contracts, or the active delivery queue.

On 25 October 2026 the product owner authorized autonomous implementation of a
useful initial subset followed by a styled public API guide. The
[active delivery ledger](active-delivery.md#user-directed-api-integration-2026-10-25)
owns its execution status. The findings below remain a snapshot of the original
baseline; later implementation must update its executable contracts and describe
only delivered capabilities in public documentation.

Kinship should expose its ordinary CRM workflows through explicitly scoped
personal tokens: person records and profile sections, relationships,
interactions, tasks, reminders, files, journal entries, and gifts and debts.
Administrative data operations need separate grants. Public API documentation
should be readable without an account. Workspace data should continue to require
authentication and authorization.

The immediate opportunity is substantial: the checked-in OpenAPI document has
**151 operations, but only `GET /api/v1/people` accepts a personal token**. Most
domain functionality already has HTTP routes for the browser. Token access,
scope-aware aggregate reads, safe external writes, and several missing resource
operations are the gaps. The
[complete operation inventory](api-operation-inventory-2026-10-25.md) records
every existing operation with its actual parameters, required fields, enums,
formats, bounds, authority, and response types.

## Existing API and constraints

- Base path: `/api/v1`; JSON transport and OpenAPI 3.1.
- Personal token authentication: `Authorization: Bearer kin_pat_…`; currently
  only `people:read`, limited to the people directory. Issuance, listing, and
  revocation require an active owner or administrator and browser
  authentication.
- Tokens bind a user to one workspace. An optional `X-Workspace-Id` must agree
  with that binding. Current membership and workspace validity are rechecked.
  Expiry is optional, revocation is supported, and the secret is shown once.
- Browser writes require the configured `Origin`. CORS currently admits only the
  application origin, and its allowed request headers do not include
  `Authorization`. These are material implementation constraints for new token
  writes and browser-based integrations.
- Ordinary collection pagination uses `cursor` up to 2,000 characters and
  `limit` from 1 to 50, normally defaulting to 20. Lists return an optional
  `nextCursor`; search and a few bounded option lists have different bounds.
- Errors use RFC 9457 problem JSON with stable `code`, `detail`, and optional
  field `errors`. Response envelopes are operation-specific; there is no
  universal `data` envelope.
- Aggregate read models are read-only. Every mutation must still call the owning
  module's application facade. IDs in paths or bodies do not establish workspace
  authority.

Sources: [HTTP architecture](../architecture/backend-architecture.md),
[authorization matrix](../architecture/authorization-matrix.yaml),
[token rules](../../packages/backend/modules/api-access/domain/token_rules.ts),
[token authentication](../../packages/backend/modules/api-access/application/token_authentication.ts),
[token or session admission](../../packages/http-kit/session.ts),
[origin checks](../../packages/http-kit/origin.ts), and
[CORS policy](../../packages/http-kit/cors.ts).

## Lessons from comparable APIs

| Source                                                                                                          | Relevant functionality                                                                                                                                                                          | Kinship implication                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Monica API documentation](https://www.monicahq.com/api)                                                        | Authenticated contact CRUD, relationships, addresses, contact fields, notes, calls, conversations, activities, reminders, tasks, gifts, debts, journal, files, vocabularies, and audit history. | Cover the corresponding Kinship behavior. Preserve Kinship's canonical schema and workspace model rather than adopting Monica's field names or historical route design.                     |
| [Google People list connections](https://developers.google.com/people/api/rest/v1/people.connections/list)      | Field selection, pagination, incremental sync tokens, and deleted-record markers; continuation requests preserve the original query.                                                            | A reliable contact connector needs selected fields, stable paging, and eventually a documented change and deletion protocol. A recently updated sort alone is not a complete sync protocol. |
| [Google People contact updates](https://developers.google.com/people/api/rest/v1/people/updateContact)          | Explicit fields to update and stale-version rejection through a contact etag.                                                                                                                   | Document patch versus replacement behavior and supply a current revision for mutable resources. Preserve existing `expectedUpdatedAt` semantics where implemented.                          |
| [Google People partial dates](https://developers.google.com/people/api/rest/v1/people#Date)                     | Whole and partial calendar dates remain distinct from instants.                                                                                                                                 | Keep Kinship's own explicit precision and nullable date components; connectors must translate the external representation without inventing an unknown year or day.                         |
| [Todoist API](https://developer.todoist.com/api/v1/)                                                            | A create-only task permission, separate data permissions, recurring due dates, and command UUIDs for duplicate protection.                                                                      | Capture automations should be able to create a task or record an interaction without gaining unrelated read access. Keep recurrence and timezone inputs explicit.                           |
| [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)                                   | Retried mutations reuse an idempotency key and reject reuse with different parameters.                                                                                                          | Require duplicate protection for externally retryable creates and state transitions that produce new history. Decide retention and response replay behavior explicitly.                     |
| [GitHub webhook guidance](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) | Minimal event subscriptions, signed deliveries over HTTPS, stable delivery IDs, and redelivery support.                                                                                         | Later event integrations need durable deliveries, verification, deduplication, and recovery. A callback URL alone is insufficient.                                                          |

These are design comparisons. The functionality and parameters below derive from
Kinship's contracts; proposed additions are identified separately.

## Recommended delivery order

| Priority                                     | User outcome                                                          | Scope of work                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First                                        | Read the API reference and build a useful read-only connector.        | Public docs and downloadable external OpenAPI; token context; profile and section reads; lookup reads; scope-filtered search; paged reads for interactions, tasks, and reminders. Preserve the existing directory grant.                                   |
| Next                                         | Capture and maintain ordinary CRM data from scripts and automation.   | Person and profile fact writes, relationships, notes and interactions, task creation and completion, reminder scheduling. Include bearer admission, concurrency, audit attribution, and durable duplicate protection in the feature that first needs them. |
| Then                                         | Cover the rest of the delivered CRM product.                          | Journal, files and avatars, gifts and debts, recurring debts, contact exports, administrative imports and exports, and authorized audit/history reads. Complete missing edit, delete, and resource-detail operations where the workflow requires them.     |
| When a connector needs it                    | Keep external systems synchronized.                                   | External identity mapping or upsert, a change/deletion feed, then webhooks and delivery recovery. These have persistence and product decisions; they are not prerequisites to useful read or capture APIs.                                                 |
| When third-party apps need delegated consent | Let users connect an application without handing it a personal token. | An approved OAuth authorization flow with scoped consent and revocation. Existing OAuth tables do not mean an OAuth service is implemented.                                                                                                                |

## Proposed token permissions

Effective permission must be the intersection of the token's grants, the user's
current role and membership, resource ownership rules, and enabled product
features. A broad role does not compensate for a missing token scope, and a
token scope does not compensate for a missing role permission.

The names below are a proposed vocabulary, not accepted or implemented scopes.
Add families only with the operations that consume them.

| Family                         | Proposed grants                                                                                                     | Boundary                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory and core person data | Existing `people:read`; new `people:profile:read`, `people:write`, `people:delete`, `people:merge`                  | Preserve the existing grant's directory-only meaning. New detailed and destructive access requires deliberate grants.                                                               |
| Relationships                  | `relationships:read`, `relationships:write`                                                                         | Both endpoints of a relationship must be authorized in the same workspace.                                                                                                          |
| Notes and interactions         | `notes:read`, `notes:write`; `interactions:read`, `interactions:create`, `interactions:write`                       | A create-only capture token must not acquire the ability to search private content or edit old records.                                                                             |
| Tasks and reminders            | `tasks:read`, `tasks:create`, `tasks:write`; `reminders:read`, `reminders:write`                                    | Assignments and reminder recipients remain subject to current workspace and member rules.                                                                                           |
| Other CRM data                 | `journal:read/write`, `gifts:read/write`, `debts:read/write`, `files:read/write`                                    | Each slash denotes two separate grants. Financial information, private writing, and file bytes need independent read grants.                                                        |
| Reference data                 | `vocabularies:read`, `vocabularies:write`                                                                           | Read the IDs required by ordinary CRM forms without granting administration; writes remain owner/admin only.                                                                        |
| Portability and administration | `imports:read/write`, `exports:read/write`, `audit:read`, `integrations:read/write`; optional `members:read/manage` | These require their corresponding owner/admin application permission. A contact vCard operation needs an explicit contact-export capability without implying full-workspace export. |
| Future change delivery         | `changes:read`, `webhooks:manage`                                                                                   | The token can receive only event types and record identifiers allowed by its resource grants.                                                                                       |

Full profile, timeline, Today, search, journal activity references, and change
feeds compose several modules. They need scope-aware projections. A caller
should explicitly request supported sections or resource kinds; requesting a
section without its required grants should fail clearly rather than expose it
through a broader aggregate permission. Never quietly extend `people:read` to
notes, debts, files, journal content, or the complete profile.

## Functionality and concrete parameters

All paths in this section are relative to `/api/v1`. These operations already
exist for browser sessions unless marked **new**. Only the people directory
currently accepts a personal token. Required fields are named explicitly; other
fields are optional. Resource IDs are UUIDs. An **instant** means an ISO
datetime with an offset, a **date** means `YYYY-MM-DD`, and **page** means the
standard optional `cursor` and `limit` described above. The operation inventory
contains the remaining exact bounds and response schemas.

### People and profile sections

| Operation                                                                 | Current parameters and behavior                                                                                                                                                                                                                                                                                               | External API requirement                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /people`                                                             | Optional `search` up to 200 characters; `tag`, `selectedPersonId`, `excludePersonId`; `lifecycle` active/archived; `sort` given-name/family-name/recently-added/last-contacted/recently-updated; wire strings `starred` and `starredFirst` true/false; page. Returns directory rows, optional selected row, and `nextCursor`. | Keep current token support. Name search is not exact email/phone lookup. `starred=false` does not select only unstarred people. Rows have no `updatedAt` or contact values.                      |
| `POST /people`                                                            | Required `givenName` up to 200 characters and `isPartial`; optional `familyName`, `middleName`, `nickname`, `duplicateOverride`. Partial records can use a family name or nickname without a given name. Returns the created identity and ID.                                                                                 | Add scoped creation and safe replay. Resolve possible duplicates deliberately. **New:** exact normalized email/phone or external-reference lookup when a connector needs matching.               |
| `GET /people/{personId}`                                                  | Optional `include=summary`. Identity includes `updatedAt`; the response also carries due information, gender options, visibility descriptors, and optionally contact values, relationship counts, and section counts.                                                                                                         | Provide a minimal core projection and explicit authorized section access. The current response already crosses people, planning, and relationship boundaries.                                    |
| `PATCH /people/{personId}`                                                | Required `givenName`, `isPartial`, `expectedUpdatedAt`; optional other name parts, `description`, `genderOptionId`, `isDeceased`.                                                                                                                                                                                             | Preserve exact semantics: optional name parts are replaced/cleared when omitted, but omitted description/gender/deceased values are preserved. Empty description or gender ID clears that value. |
| `POST /people/{personId}/archive` and `/restore`                          | Required `expectedUpdatedAt`; returns the current person and transition status.                                                                                                                                                                                                                                               | Expose reversible lifecycle operations separately from deletion; already-in-target-state calls are successful no-ops.                                                                            |
| `GET /people/{personId}/deletion-impact`; `DELETE /people/{personId}`     | Delete requires the preview's `confirmation` phrase and `expectedUpdatedAt`.                                                                                                                                                                                                                                                  | Require explicit delete scope and confirmation. Current person deletion is soft deletion with dependent records retained, not erasure.                                                           |
| `PUT` or `DELETE /people/{personId}/star`                                 | No body; returns `isStarred`. The star is workspace-wide and does not advance person `updatedAt`.                                                                                                                                                                                                                             | Allow only under a deliberate people mutation grant; do not describe stars as member-private favorites.                                                                                          |
| `POST /people/bulk`                                                       | Required `action` archive/restore/tag/untag, 1–100 distinct `personIds`; `tagId` required only for tag/untag. Independent per-person results and partial success; no client revision array.                                                                                                                                   | Document partial outcomes and apply every constituent grant. Do not promise atomic batch semantics.                                                                                              |
| `GET /people/duplicates`; `POST /people/duplicates/dismissals`            | Review returns at most 20 pairs and `truncated`; dismissal requires exactly two `personIds`.                                                                                                                                                                                                                                  | This is a bounded, workspace-wide review tool. **New:** paged review and reversal only if needed; do not use it as an exhaustive lookup API.                                                     |
| `GET /people/{primaryId}/merge-preview`; `POST /people/{primaryId}/merge` | Preview requires query `duplicateId`. Merge requires `confirmed:true`, `duplicateId`, `primaryRevision`, `duplicateRevision`, `conflictsDigest`.                                                                                                                                                                              | Separate sensitive preview and destructive execution grants. Keep the current conflict digest and all owning-module checks; there is no undo or per-field winner selection.                      |

The seven fact sections share `/people/{personId}/facts/{section}` for GET/POST
and `/people/{personId}/facts/{section}/{factId}` for PUT/DELETE. GET accepts
`cursor`, `includeOptions=true`, `optionCursor`, and `optionSearch` up to 200
characters; fact and option pages each contain at most 50 records. POST requires
the path's `section` in the body and `expectedPersonUpdatedAt`. PUT is a full
replacement and additionally requires body `id` matching the path and
`expectedUpdatedAt`. DELETE requires `section` and both expected timestamps.
Responses return the current `personUpdatedAt`; clients must retain it for the
next write.

| Fact section       | Required value fields                                                               | Optional value fields and rules                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contact-methods`  | `typeId`, nonblank `value` up to 2,000 characters, `isPrimary`, `labelIds` up to 20 | `notes` up to 2,000. Primary selection replaces the primary of that type.                                                                                                            |
| `addresses`        | `isPrimary`, `labelIds` up to 20                                                    | `displayName`, `street`, `city`, `region`, `postalCode`, `country`; at least one nonblank address detail.                                                                            |
| `first-meeting`    | At least one usable optional value                                                  | `introducedByPersonId`, `placeText`, `notes`; the introducer must be a valid other person.                                                                                           |
| `food-preferences` | Nonblank `foodPreferences` up to 2,000 characters                                   | Deleting the singleton clears it; the content can include sensitive dietary information.                                                                                             |
| `pets`             | A category or nonblank name                                                         | `categoryId`, `name`, `notes`.                                                                                                                                                       |
| `tags`             | `tagIds`, at most 500                                                               | Replaces the full set, including clearing with an empty array.                                                                                                                       |
| `work`             | Nonblank `title`, `isCurrent`                                                       | `organizationId` or `organizationName`, `description`, `startOn`, `endOn`. Dates are calendar dates; end cannot precede start. An organization name can find/create an organization. |

First meeting, food preferences, and tags are singleton fact records. Fact
mutation checks workspace vocabulary references, section enablement, active
person state, record revision, and parent revision. Hidden sections reject
writes. These are source-owned use cases, not free-form JSON storage.

Important dates use GET/POST `/people/{personId}/dates` and PATCH/DELETE
`/people/{personId}/dates/{dateId}`. Creation requires `kind` (`birthday`,
`custom`, `deceased`, `first_met`), `precision`, `isAgeBased`, and
`isYearApproximate`; optional `label`, `notes`, and allowed components `year`,
`month`, `day`. A custom date requires a label. PATCH is full replacement plus
`expectedUpdatedAt`; DELETE requires that revision. Changes regenerate implied
reminders through the owning use case.

Life events use GET/POST `/people/{personId}/life-events` and PATCH/DELETE an
event ID. Creation requires `precision`, plus a name or `typeId`; optional
`name`, `note`, and date components. PATCH is full replacement plus
`expectedUpdatedAt`; DELETE requires that revision. **Journal owns these
mutations**, even though the HTTP path is person-scoped. The current read stops
at 100 events/types without continuation, so complete API coverage needs paging.

Both resources use precision shapes: `full` = year/month/day; `year_month` =
year/month; `month_day` = month/day; `year`, `month`, or `day` = that component;
`unknown` = none. Unexpected components and impossible calendar dates reject.
Life-event `happenedAt` can be returned for imported data but is not a writable
parameter. Example: a birthday with unknown year uses `precision: "month_day"`,
`month: 5`, `day: 12`; no invented year.

Sources: [people routes](../../packages/contracts/routes/people.ts),
[people schemas](../../packages/contracts/schemas/people.ts),
[fact writes](../../packages/backend/modules/people/application/profile_fact_writes.ts),
[person identity rules](../../packages/backend/modules/people/domain/person_identity.ts),
[profile composition](../../packages/backend/read-models/person-profile/application/get_person_profile.ts),
and
[life events](../../packages/backend/modules/journal/application/life_events.ts).
Related flows: `PEOPLE-001` through `PEOPLE-010`, `JOURNAL-002`.

### Relationships

| Operation                                                             | Current parameters                                                                                                                            | External API requirement                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /relationship-types`                                             | Optional `search`, `cursor`, comma-separated `selected` UUIDs up to 20. Returns active choices plus hydrated selected types and continuation. | Member-readable lookup under a reference-data grant; archived types may be returned to describe existing edges.                                       |
| `GET /people/{personId}/relationships`                                | Page; returns directional edge IDs, both person IDs, type labels, status, timestamps, and relative display data.                              | Scoped, complete traversal. **New:** single-edge or workspace list only for a concrete integration need.                                              |
| `POST /people/{personId}/relationships`                               | Required `targetPersonId`, `relationshipTypeId`. Returns 201 created or 200 existing, forward/inverse display, and affected person IDs.       | Preserve same-workspace validation and exact-edge replay. One stored edge supplies both directions; clients must not create a second reverse edge.    |
| `POST /people/{personId}/relationships/related-person`                | Required `person` with the person-creation fields and `relationshipTypeId`.                                                                   | Preserve atomic related-person-and-edge creation. Require both creation capabilities.                                                                 |
| `PATCH` or `DELETE /people/{personId}/relationships/{relationshipId}` | PATCH requires `relationshipTypeId`, `expectedUpdatedAt`; DELETE requires `expectedUpdatedAt`.                                                | Keep revision checks and active endpoints. Current PATCH changes the type only; ending status and romantic metadata are not exposed write parameters. |

Sources:
[relationship routes](../../packages/contracts/routes/relationships.ts),
[schemas](../../packages/contracts/schemas/relationships.ts), and
[writes](../../packages/backend/modules/relationships/application/relationship_writes.ts).
Flow: `RELATIONSHIP-001`.

### Notes activities calls and conversations

`POST /interactions` already provides four typed capture operations. Each
requires `requestId`; use v4 UUIDs for compatibility with current application
validation. The schema advertises UUIDs more broadly than the use-case
validator.

| `kind`         | Required fields in addition to `kind` and `requestId`                           | Optional fields                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `note`         | `personId`, `body` from 1 to 10,000 characters                                  | `isFavorited`. Creation time is server-assigned.                                                                                                                |
| `activity`     | `happenedAt` instant, 1–50 `participantIds`, `summary` from 1 to 500 characters | `activityTypeId`, `description` up to 10,000, up to 20 `emotionIds`.                                                                                            |
| `call`         | `personId`, `calledAt` instant, `contactWasCaller` boolean                      | `content` up to 10,000, up to 20 `emotionIds`.                                                                                                                  |
| `conversation` | `personId`, `channelTypeId`, `happenedAt` instant                               | `contactMethodId`, `title` up to 500, up to 50 `messages`. Each message requires `content` up to 10,000, `direction` inbound/outbound, and `writtenAt` instant. |

The response is `{status:"created", record:<typed record>}` with resource IDs.
The existing request identity derives deterministic workspace-scoped IDs and
rejects a different proposal under the same key. Capture does not require a new
parallel repository path. Selected participants and vocabulary values must be
valid in the workspace; a conversation contact method must belong to that person
and match its channel. Calls, conversations, and activities advance contact
cadences; notes do not.

Current reads and lookup requirements:

- `GET /interaction-options`: independent `activityTypeCursor`, `emotionCursor`,
  `activityTypeSearch`, `emotionSearch`, and `limit` 1–20. Return both option
  groups with their continuations and feature availability.
- `GET /communication-options`: channel types, emotions, and call/conversation
  availability. Current groups are bounded rather than fully paged.
- `GET /people/{personId}/activity-report`: optional `kind` activity/note,
  `year` 1–9999, and page. Year filtering uses UTC.
- `GET /people/{personId}/communications`: newest 50 calls/conversations,
  including messages, with no paging. **New:** cursor continuation is required
  for complete retrieval.
- `GET /people/{personId}/timeline`: optional `kind`
  activity/call/conversation/life-event/note and page. It can return actual
  message content and life-event ordering dates, so it needs source scopes and
  explicit partial-date semantics.

**New functionality to prioritize:** individual interaction reads, note edit and
favorite toggle, bounded message append, and revision-protected edit/delete
operations where product behavior is approved. These are missing HTTP contracts,
not routes that can be enabled by adding a scope. Workspace-wide interaction
listing and date-window filters are useful for connectors but also need explicit
new query contracts.

Sources: [interaction routes](../../packages/contracts/routes/interactions.ts),
[schemas](../../packages/contracts/schemas/interactions.ts),
[capture use cases](../../packages/backend/modules/interactions/application/interaction_writes.ts),
[communication writes](../../packages/backend/modules/interactions/application/communication_writes.ts),
and [person timeline routes](../../packages/contracts/routes/people.ts). Flows:
`INTERACTION-001`, `INTERACTION-002`, `PEOPLE-003`.

### Tasks reminders and contact cadences

| Operation                                                  | Current parameters and behavior                                                                                                                                                         | External API requirement                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tasks`                                               | Optional `personId`, `status` open/completed/cancelled, page. Returns task IDs, descriptions, due instants, status, creator/completer metadata, and `updatedAt`.                        | Enable scoped reads. **New:** individual task GET; the application already supports it. Expose existing application `dueBefore` only through a documented query change. |
| `POST /tasks`                                              | Required `requestId`, `title` up to 500; optional `description` up to 10,000, `dueAt` instant, `personId`. Creates an open task with retry-safe deterministic identity.                 | Support create-only automation and return the new ID/revision.                                                                                                          |
| `PATCH /tasks/{taskId}`                                    | Required `expectedUpdatedAt` and at least one of `title`, `description`, `dueAt`, `personId`, `status` open/cancelled. Description/due/person can be null to clear; omission preserves. | Preserve stale-write rejection and exact clearing behavior.                                                                                                             |
| `PUT /tasks/{taskId}/completion`                           | Required `completed` boolean; no revision. Can complete or reopen, including from cancelled state. Repeated target state is unchanged.                                                  | Document the existing transition; decide concurrency behavior before promising lossless two-way sync.                                                                   |
| `GET /people/{personId}/reminders`                         | Page; returns reminders and at most one cadence with continuation.                                                                                                                      | Scoped read. **New:** workspace reminder list, individual definition read, and paged occurrence history if integrations need them.                                      |
| `POST /reminders`                                          | Required `requestId`, `personId`, `title`, `anchorOn` date, `sendTime` HH:mm or HH:mm:ss, `recurrenceUnit` none/day/week/month/year, `recurrenceInterval` 1–100.                        | Reuse scheduling rules. Current input has no explicit timezone, recipient, channel, end date, or arbitrary RRULE.                                                       |
| `PUT /reminders/{reminderId}/active`                       | Required `active` boolean. Disabling cancels safe unattempted future deliveries; re-enabling regenerates work.                                                                          | Preserve delivery evidence and in-flight handling. **New:** full definition editing/deletion and snooze/reschedule need explicit behavior.                              |
| `POST /stay-in-touch-cadences`                             | Required `requestId`, `personId`, `intervalCount` 1–100, `intervalUnit` day/week/month/year. Creates/updates the person's one cadence.                                                  | Preserve durable request receipts. **New:** cadence detail, pause, or deletion requires new routes.                                                                     |
| `PUT /reminder-occurrences/{occurrenceId}/acknowledgement` | No body. Clears the caller's failed/manual-attention occurrence and eligible sibling delivery; does not resend.                                                                         | Keep member ownership and delivery state rules; do not describe acknowledgement as snooze or retry.                                                                     |

Current reminders use effective member/workspace time zones. Monthly/yearly
recurrences clamp from the original anchor; DST gaps move forward and folds
choose the earlier occurrence. Changes must retain these rules through the
planning facade. Assignment, priority, recurring tasks, partial task dates, new
reminder channels, and arbitrary recurrence rules are new domain/product work,
not existing accepted request parameters.

Sources: [planning routes](../../packages/contracts/routes/planning.ts),
[schemas](../../packages/contracts/schemas/planning.ts),
[task writes](../../packages/backend/modules/planning/application/task_writes.ts),
[task listing](../../packages/backend/modules/planning/application/task_listing.ts),
[recurrence](../../packages/backend/modules/planning/domain/recurrence.ts), and
[cadences](../../packages/backend/modules/planning/application/reminder_cadences.ts).
Flows: `PLANNING-001` through `PLANNING-003`.

### Journal

- `GET /journal` uses page; `GET /journal/items/{itemId}` reads an item.
- `POST /journal/posts` and `PUT /journal/posts/{itemId}` require `body` from 1
  to 50,000 characters and `occurredAt` instant; optional `title` up to 500. PUT
  replaces the value and clears an omitted title. There is no request key or
  expected revision.
- `PUT /journal/day-ratings` requires `ratedOn` date and integer `rating` 1–5;
  optional `comment` up to 10,000. It upserts the workspace's rating for that
  date; omission clears the comment.
- `POST /journal/activities` requires `activityId`. Current duplicate-link
  behavior is a failure, not successful replay.
- `DELETE /journal/items/{itemId}` has no revision. For an activity item it
  removes the journal link, not the source activity.

Journal content and day ratings are **workspace-wide**, not author-private.
Scope-aware journal reads must also protect the linked activity data. The
current timeline includes a separate unpaged list of up to 50 linkable
activities. External writes need retry/concurrency decisions; callers must not
assume journal privacy follows the token owner's identity.

Sources: [journal routes](../../packages/contracts/routes/journal.ts),
[schemas](../../packages/contracts/schemas/journal.ts), and
[repository behavior](../../packages/backend/modules/journal/adapters/postgres/journal_repository.ts).
Flow: `JOURNAL-001`.

### Gifts debts and recurring debts

Money is a decimal **string**, matching `^\d{1,15}(?:\.\d{1,4})?$`, rather than
a floating-point number. Currency codes contain three letters and are validated
against supported currencies.

| Operation                                                     | Current required fields                                                                           | Optional fields and semantics                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /people/{personId}/gifts`                                | Person path                                                                                       | `giftCursor`, `debtCursor`, `limit`; separate continuations for gifts/debts plus at most 50 recurring rules, default currency, and supported currencies. |
| `POST /people/{personId}/gifts`                               | `name`, `status` idea/planned/given/received/archived                                             | `amount` with `currencyCode`, `eventAt`, `comment`, `url`, `recipientPersonId`, `attachmentFileId`.                                                      |
| `PATCH /people/{personId}/gifts/{giftId}/status`              | `status`                                                                                          | Explicit transition graph; archived is terminal. No revision.                                                                                            |
| `POST /people/{personId}/debts`                               | `amount`, `currencyCode`, `direction` i_owe/they_owe, `status` open/settled/cancelled             | `reason`, and only when settled `settlementReason`, `settlementPhotoFileId`.                                                                             |
| `PATCH /people/{personId}/debts/{debtId}/status`              | `status`                                                                                          | Optional settlement reason/photo. Settled can reopen; cancelled is terminal; repeating settled neither appends nor edits settlement history.             |
| `GET /people/{personId}/debts/{debtId}/settlements`           | Person/debt paths                                                                                 | Page; newest-first history with settled time, optional reason, and photo availability/filename metadata.                                                 |
| `DELETE /people/{personId}/debts/{debtId}`                    | Person/debt paths                                                                                 | No body; permanently removes debt and settlement history. Give this an explicit destructive capability.                                                  |
| `POST /people/{personId}/recurring-debts`                     | `amount`, `currencyCode`, `direction`, `dayOfMonth` 1–31, `intervalMonths` 1–120, `startsOn` date | `endsOn` date, `reason`. Short months clamp. Can immediately create due charges.                                                                         |
| `PATCH /people/{personId}/recurring-debts/{recurringDebtId}`  | At least one changed value                                                                        | Creation fields plus `active`; `endsOn` and `reason` can be null to clear. No revision.                                                                  |
| `DELETE /people/{personId}/recurring-debts/{recurringDebtId}` | Person/rule paths                                                                                 | Removes the rule while retaining charged debts.                                                                                                          |

Settling appends history atomically, including initial settled creation.
Reopening preserves earlier history. A settlement photo must be an available
same-person photo in the workspace, excluding avatars. Photo removal preserves
history metadata. Archived people permit reads but reject these mutations.

**New functionality:** individual gift/debt reads, full value editing and gift
deletion where approved, independently paged collections, and filters such as
person/status/direction/currency. Creates and currently unversioned changes need
safe retries/concurrency before unattended financial integrations. Partial
payments, editable settlement timestamps, and payment-provider operations are
new financial domain behavior and are not implied by debt API coverage.

Sources: [gift routes](../../packages/contracts/routes/gifts.ts),
[schemas](../../packages/contracts/schemas/gifts.ts),
[gift and debt writes](../../packages/backend/modules/gifts/application/gift_writes.ts),
[settlement reads](../../packages/backend/modules/gifts/application/debt_settlements.ts),
and
[recurring rules](../../packages/backend/modules/gifts/domain/recurring_debts.ts).
Flow: `GIFTS-001`.

### Files photos avatars and storage

| Operation                                           | Current protocol                                                                                                                                                                                         | External API requirement                                                                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /people/{personId}/files`                      | Page; returns document/photo metadata and availability state. Avatars are excluded.                                                                                                                      | Token-authorized metadata retrieval with appropriate person scope.                                                                                                                 |
| `POST /people/{personId}/files`                     | **Raw binary body**, not multipart. Required headers: `Content-Type`, `X-File-Kind` document/photo, percent-encoded `X-File-Name` and `X-File-Title`. Names/titles decode to nonblank strings up to 500. | Document the actual protocol and allowed MIME types: PDF/DOCX/plain text for documents; JPEG/PNG/WebP for photos.                                                                  |
| `GET /people/{personId}/files/{fileId}/content`     | Private binary download, content type/length and attachment filename; unavailable bytes return 410, processing 409 at runtime, quarantine 423.                                                           | Authorize token byte downloads. The current OpenAPI descriptor omits the processing 409 and needs correction when this boundary is changed.                                        |
| `DELETE /people/{personId}/files/{fileId}`          | No body/revision. Removes bytes/link and soft-deletes metadata; processing files reject.                                                                                                                 | Preserve person/workspace ownership and attachment consequences.                                                                                                                   |
| `PUT /people/{personId}/avatar`; `DELETE` same path | PUT uses raw JPEG/PNG/WebP, `Content-Type`, percent-encoded `X-File-Name`, at most 1 MiB. DELETE resets initials. No revision.                                                                           | Token directory avatar URLs currently point to session-only content; enable the content boundary with avatar access. Do not advertise URL or existing-file association parameters. |
| `GET /settings/storage`                             | Admin-only optional `query` up to 100; provider/usage summary and at most 20 matching files, without paging.                                                                                             | Optional separate administrative storage read, not ordinary file-read access.                                                                                                      |

The file domain advertises a **10 MiB** general upload maximum, but the
gateway's current `/api/v1/` request limit is **1,501,024 bytes**. Resolve that
mismatch before publishing a larger effective upload limit. Avatar limits are
separate. Retain metadata when bytes are missing; never return storage
credentials or keys.

**New functionality only if consumed:** individual metadata reads, kind/status
filters, revision-protected title edits, missing-file byte replacement,
resumable uploads, range downloads, and idempotent upload creation.
Malware/quarantine administration needs its own product and authorization
design.

Sources: [file routes](../../packages/contracts/routes/files.ts),
[file schemas](../../packages/contracts/schemas/files.ts),
[file rules](../../packages/backend/modules/files/domain/file_rules.ts),
[avatar transport](../../packages/backend/modules/people/transport/http/avatar.ts),
and [gateway](../../gateway/nginx.conf). Flows: `FILES-001`, `PEOPLE-007`.

### Imports exports and contact portability

| Operation                                                                | Current parameters                                                                                                                                                               | External API requirement                                                                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /imports`; `GET /imports/{importId}`                                | List latest 50 without paging; report reads persisted status, diagnostics, optional CSV preview.                                                                                 | Admin read; **new** paging, bounded row diagnostics, and explicit job-resource lifecycle where needed.                                                                       |
| `POST /imports/dry-runs`                                                 | Required `source`: CSV/vCard `{format, text}`; Monica JSON `{format:"monica-json",version:1,tables,attachments?}`; Monica SQL `{format:"monica-sql",text}`.                      | Replace the under-specified OpenAPI object placeholder with the actual format union. Current source cap is 1,500,000 bytes and 500 contacts; CSV has at most 100 columns.    |
| `POST /imports/{importId}/mapping`                                       | Required `columns`, one target per CSV header: ignore/givenName/familyName/middleName/nickname/email/phone/street/city/region/postalCode/country/birthday/note/company/jobTitle. | Preserve dry-run validation and explicit mapping before commit.                                                                                                              |
| `POST /imports/{importId}/commit`                                        | Required `confirmed:true`; optional `contactMethodTypes` decisions and `monicaChoices`.                                                                                          | Separate commit authority; retain transactional identity-map replay and deleted-person non-recreation. Legacy credentials must remain inactive.                              |
| `GET /exports`; `POST /exports`                                          | Latest 50, no paging. Create body optionally sets `format` json/csv/vcard, default json; creates synchronously and may join matching running work.                               | Admin-only export grants. **New:** `GET /exports/{exportId}`, paging, and explicit retry/cancel if supported. Status enum values alone do not establish lifecycle endpoints. |
| `POST /exports/{exportId}/downloads`; `GET /exports/{exportId}/download` | Issue a five-minute, single-use reference; GET requires `token`, optional `workspaceId`, and session authority. The export expires after seven days.                             | Define token-authorized issuance/download without reducing existing authority. Do not imply the short-lived URL alone currently authorizes access.                           |
| `GET /people/{personId}/vcard`; `POST /people/bulk/vcard`                | Optional query `workspaceId` for single read; bulk requires 1–100 distinct `personIds`. Returns `text/vcard`, bulk `X-Skipped-Count`.                                            | Contact-export grant, separate from workspace export. Document skipped foreign/missing IDs and the all-missing 404.                                                          |

Commit type decisions contain `sourceKey`, `action` create/map/skip, and
`typeId` when mapping. Monica choices contain a `timezone`, currency mappings
`{sourceKey,currencyCode}`, and gender decisions with `sourceKey`, `action`
map/source/create/unspecified, and applicable `genderId` or `name`.

Current export fidelity is limited: JSON contains person identities; CSV ZIP
contains people/contact methods/dates; vCard contains names/email/phone. The
workspace formats are capped at 500 people and omit attachments. These are not
full backup/restore APIs. Import attachment manifests currently create missing
file metadata rather than transfer the bytes. Explicit attachment transfer,
full-fidelity export, cancellation, retry/resume, destinations, and physical
retention cleanup require new functionality; expiry does not prove byte purging.

Sources: [import routes](../../packages/contracts/routes/imports.ts),
[import schemas](../../packages/contracts/schemas/imports.ts),
[source formats](../../packages/backend/modules/import-export/domain/formats),
[export routes](../../packages/contracts/routes/exports.ts),
[contact export behavior](../../packages/backend/modules/import-export/domain/formats/contacts_export.ts),
and
[export downloads](../../packages/backend/modules/import-export/application/export_downloads.ts).
Flows: `IMPORT-001`, `IMPORT-002`, `EXPORT-001`, `EXPORT-002`.

### Lookups preferences and workspace administration

Ordinary integrations need IDs and labels without access to configuration
mutation. Reuse member-readable tag, relationship, interaction, communication,
and profile-fact options. **New:** a unified paged lookup surface can accept
`kind`, `search`, `cursor`, `limit`, and `selectedIds` if a connector actually
needs it. Do not make all ordinary lookups depend on admin personalization.

Administrative personalization uses GET/POST
`/settings/personalization/{section}` and PATCH/DELETE its `{id}`. Sections are
`profile-modules`, `gender-options`, `activity-types`, `life-event-types`,
`contact-method-types`, `contact-labels`, `tags`, `relationship-types`,
`reminder-rules`, and the read-only `emotion-options`/`pet-categories`.

Create inputs are generally `name` and optional `sortOrder`; relationship types
use `forwardLabel`/`reverseLabel`, reminder rules use `daysBefore` 0–3650, and
contact-method types can specify `contactKind`
email/phone/url/social/im/username/custom. PATCH requires `expectedUpdatedAt`
and allowed changed fields; relationship label changes require both labels.
DELETE takes `expectedUpdatedAt` and optional `replacementId` in the **query**.
Returned capabilities and reference counts determine whether archive, delete,
replacement, and default selection are allowed.

| Area               | Existing parameters                                                                                                                                                                                                    | Recommendation                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace settings | `GET/PUT /settings/workspace`; PUT requires `name`, `defaultLocale`, `defaultReminderTime`; optional `slug`, `defaultTimezone`, `defaultCurrencyCode` clear when omitted.                                              | Optional admin-only read/write. Never infer full workspace authority from contact scopes.                                                    |
| Own preferences    | `GET/PUT /settings/preferences`; required name/sort orders, `fluidLayout`, `locale`, `measurementSystem`, `temperatureScale`; optional `timezone`, `currencyCode`, `reminderDelivery` in_app/email/both, `digestTime`. | Read effective timezone/currency where useful. Preference writes are a later narrow grant; zone changes can regenerate reminder work.        |
| Members            | `GET /settings/members`; `PATCH /settings/members/{memberId}` requires both `role` owner/admin/member and `status` active/suspended. No revision.                                                                      | Separate admin grant, last-owner protection, and no implied ownership transfer.                                                              |
| Invitations        | `GET /workspace-members`; `POST /workspace-invitations` requires `email`, `role` admin/member. Create returns no invitation ID; delivery failure can occur after persistence.                                          | New safe replay, cancellation/resend, and delivery status before routine automation. Invitation acceptance remains an identity/consent flow. |
| Audit              | `GET /audit-events`; `GET /people/{personId}/audit`. Optional `personId` on workspace route, `actorMemberId`, `action`, `from`, `to`, page; time interval is `[from,to)`.                                              | Admin-only scoped reads. Redacted allowlisted details are not full before/after records and cannot substitute for a complete change feed.    |

Sources: [settings routes](../../packages/contracts/routes/settings.ts),
[settings schemas](../../packages/contracts/schemas/settings.ts),
[personalization rules](../../packages/backend/modules/workspaces/domain/personalization_rules.ts),
[invitations](../../packages/contracts/routes/invitations.ts), and
[audit routes](../../packages/contracts/routes/governance.ts). Flows:
`WORKSPACE-001`, `WORKSPACE-003`, `AUTH-002`, `AUTH-004`, `GOVERNANCE-002`.

### DAV calendar Today search and notifications

| Area                  | Existing operations and parameters                                                                                                                                                                                                                                | API coverage implications                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAV subscriptions     | GET/POST `/settings/integrations/dav`; create requires `name`, HTTPS `remoteUrl`, write-only `password`, optional `username`. DELETE `/{subscriptionId}` disables; POST `/{subscriptionId}/sync` pulls changes and returns success/partial/conflict/auth-failure. | Admin-only setup and sync can become separate grants. Current adapter pulls names from CardDAV and task title/description/UTC due time from VTODO; no hosted DAV server, push/writeback, or full contact synchronization.   |
| Calendar subscription | GET/POST/DELETE `/settings/calendar-feed`, POST `/rotation`; manage only the caller's feed. `GET /calendar-feeds/{feedFile}` uses its separate URL secret and optional `If-None-Match`.                                                                           | Retain existing read-only feed and distinct credential. Known-month/day dates plus member reminder days, 30 days back to 365 ahead, at most 2,000 events; no arbitrary date-range parameter.                                |
| Today                 | GET `/today/attention`, `/reminders`, `/tasks`, `/favorite-notes`, `/recent-activity`, `/recent-people`; no query filters.                                                                                                                                        | These are capped UI projections. Scope-filter underlying tasks, notes, interactions, dates, and personal history; they are not exhaustive lists or sync endpoints. Machine reads should not call `/people/{personId}/view`. |
| Search                | `GET /search`; required `q` 1–200 trimmed characters, optional `limit` 1–10/default 5 and `sort` given-name/family-name. Five groups: people/notes/activities/journal-posts/tasks, possibly unavailable text groups.                                              | Scope-filter both snippets and identifiers. **New:** allowed kinds/section selection; retain bounded search rather than claim exhaustive paging.                                                                            |
| Notifications         | `GET /notifications`; optional cursor up to 500; fixed 50/page. Returns member-scoped items and unread state. Read-through is currently written through PATCH `/member/ui-state` with monotonic UTC `notificationsReadThrough`.                                   | Optional own-inbox read/acknowledgement grants. Prefer a dedicated semantic operation over access to arbitrary browser UI-state preferences.                                                                                |

Today limits include 20 task items, eight favorite notes, 20 recent activity
items, eight recently viewed people, and 100 reminders/cadences. Its
member-local attention windows are useful dashboard behavior, not general API
date filters. No operations/admin job execution API exists; worker claims and
system-wide `scheduled_job_runs` must not be exposed through ordinary workspace
tokens.

Sources: [integration routes](../../packages/contracts/routes/integrations.ts),
[DAV adapter](../../packages/backend/modules/integrations/adapters/dav/http_dav_client.ts),
[calendar contract](../../packages/contracts/routes/calendar_feeds.ts),
[planning routes](../../packages/contracts/routes/planning.ts),
[search contract](../../packages/contracts/routes/search.ts), and
[notification read model](../../packages/backend/read-models/notifications/application/list_notifications.ts).
Flows: `INTEGRATION-001`, `INTEGRATION-002`, `TODAY-001`, `TODAY-002`,
`SEARCH-001`.

## Shared parameter and behavior requirements

1. **Authentication and context.** A proposed `GET /api/v1/me` should report the
   token's subject, workspace, granted scopes, expiry, and usable capabilities.
   Do not reuse the browser session response if it exposes other workspaces,
   credential state, or browser handoff details. Keep token management itself
   interactive initially; a CRM token should not mint broader credentials.
2. **Bearer writes.** Resolve a valid bearer token and its required scope before
   allowing a write without the browser `Origin` requirement. Preserve origin
   and CSRF checks for cookie authentication. A present invalid bearer must
   never fall back to a session cookie. Server-to-server clients should not need
   fabricated application-origin headers. Cross-origin browser support is a
   separate, explicit CORS policy decision.
3. **Identifiers and tenant scope.** Keep existing UUID resource IDs and
   workspace-bound tokens. Validate every referenced person, member, tag,
   vocabulary entry, file, activity, and parent-child combination in that
   workspace. Reject attempts to select another workspace.
4. **Updates and clearing.** For each operation document whether omitted values
   are unchanged, reset, or replaced; when `null` clears a value; whether arrays
   replace a set; and which transitions are allowed. The current strict schemas
   do not support arbitrary new parameters. Do not advertise a generic PATCH
   convention that differs from the actual route.
5. **Concurrency.** Carry current `expectedUpdatedAt`, `expectedRevision`, or
   snapshot fields where the feature already uses them. Where absent, define a
   resource revision before advertising safe two-way updates. Surface the
   returned new revision and the documented stale-write outcome. Do not claim
   that every current mutation already has an etag or version check.
6. **Retry safety.** Standardize an `Idempotency-Key` header for appropriate
   external creates. Reuse existing body `requestId` semantics for interactions,
   tasks, reminders, and cadences; define one authoritative identity mapping
   rather than adding an independent duplicate registry for the same operation.
   Bind any new receipt to the workspace, token or actor, operation, and
   normalized payload; same key plus different payload must conflict. Specify
   durable retention, concurrent-request behavior, and replay responses.
   Existing cadence `requestId` receipts prove one local pattern, not general
   idempotency for all API writes.
7. **Time and dates.** Distinguish an ISO date, a timestamp with offset, a
   partial date, and an IANA time zone. Keep canonical unknown components and
   recurrence enums. Define all-day deadlines, DST changes, February 29, monthly
   overflow, and time-zone precedence through the owning use case.
8. **Collections and sync.** Preserve cursor bounds and stable ordering. Add
   filters only where the use case supports them. `updatedSince`, arbitrary
   resource field selection, and sync tokens are proposed additions, not
   existing universal query parameters. Deletion tracking and a consistent
   initial scan are necessary before claiming full incremental sync.
9. **Responses and operations.** Return durable resource IDs, relevant revisions
   and timestamps, pagination cursors, and canonical resource references. Keep
   operation-specific states, errors, and download media types. Browser `href`
   and `next` links can remain conveniences, but must not be the only way to
   identify or retrieve a created resource.
10. **Limits and diagnostics.** Document endpoint limits, upload caps, `429`
    retry guidance, transient failures, stable problem codes, and request
    correlation. Existing gateway limits are deployment controls rather than a
    permanent per-token quota contract. Mutations should be attributable to the
    user and credential without recording token secrets or sensitive payloads.

## Public API documentation

Serve a static `/docs/api` page and an external OpenAPI download without login.
Link them from the public site and `/app/settings/api`. The docs should publish:

- A quickstart that creates a token through settings and reads a directory.
- Supported scopes, role prerequisites, and exactly which operations accept a
  token. Separate browser-session and calendar-link authentication.
- Per-operation path, query, header, JSON or multipart parameters; requiredness,
  types, bounds, defaults, enums, nested schemas, and examples.
- Success and problem responses, paging, stale revisions, date and timezone
  semantics, idempotent retries, rate limiting, and file-download behavior.
- Supported API versions, compatibility policy, changes, and module
  availability.
- A complete example of finding a person and recording an interaction, and one
  of creating and completing a task once those grants are delivered.

Generate the external reference from the same route and schema authority as the
internal OpenAPI. Do not present the existing full document as though every
listed route accepts personal tokens. An interactive request runner is optional;
viewing documentation must not require a token, and examples must not retain
secrets in local storage or send them to an external documentation service.

## Synchronization and future integration additions

These are useful extensions once a named connector consumes them. Their paths
and fields are proposals and are absent from the current external API.

| Capability                           | Proposed operation and parameters                                                                                             | Required semantics                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Context and capability discovery     | `GET /api/v1/me`, no body                                                                                                     | Return only the bound subject/workspace, effective capabilities, token grants, and expiry.                                                                                                                                                 |
| Selected aggregate reads             | Existing profile/search routes extended with an allowlisted `sections` or `kinds` parameter                                   | Scope-filter each source module and expose a stable supported set. Parameter spelling and default projection need a decision.                                                                                                              |
| External reference lookup and upsert | Proposed lookup/upsert with `system`, `externalId`, resource kind, and validated resource fields                              | Durable uniqueness within the workspace and connector; clear collision, merge, and deletion behavior. Current import identity mapping is not a general integration mapping API.                                                            |
| Change and deletion feed             | Proposed `GET /api/v1/changes` with opaque `cursor`, bounded `limit`, and allowlisted `types`                                 | Return authorized resource type/ID, operation, revision/time, and deletion tombstones; define initial-scan consistency, retention, cursor expiry, and resync. Never use a UI activity list or audit history as an undocumented substitute. |
| Webhook management                   | Proposed create/list/update/delete operations with HTTPS `url`, allowlisted `events`, `enabled`, and a managed signing secret | Stable event/delivery IDs, signature and timestamp verification, durable retry state, redelivery, and a delivery-status read. Recheck current authorization at delivery. Do not include full personal content by default.                  |
| Third-party authorization            | A separately approved OAuth authorization-code flow with PKCE                                                                 | Registered redirect URIs, scoped consent, token expiry/revocation and refresh-token policy. Follow [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html); do not treat schema tables as a ready OAuth implementation.                    |

The current schema stores scopes as `text[]`, so defining more personal-token
scope names need not by itself change a database column. New durable idempotency
receipts, connector mappings, change history, webhook subscriptions, or delivery
queues require a canonical schema review and a synchronized schema version
wherever new persistence is needed. Keep v1 through v10 immutable and do not
edit v11 piecemeal. OAuth tables already exist, but tenant binding, consent,
PKCE, and refresh behavior still need an approved application design.

## Actions that should remain interactive initially

Do not grant ordinary integration tokens access to sign-in, password resets,
MFA, session handoffs, security credentials, legal acceptance on somebody's
behalf, personal identity deletion, owner transfer, workspace reset/deletion, or
internal worker commands. Member administration can be a later explicit admin
capability; its authorization must not be implied by `people:write`.

Billing remains disabled/planned, and AI assistance was removed from current
scope. Neither should be advertised as an available API capability. The
read-only calendar feed retains its separate `kin_cal_…` URL credential and
`calendar.read` scope; it is not an ordinary personal bearer-token endpoint.

## Acceptance requirements for each delivered API capability

- Publish its exact token scopes, request and response schema, and required
  application permission in the same generated contract used by the route.
- Exercise a token request without browser cookies, missing and wrong scopes,
  revoked/expired credentials, inactive membership, wrong workspace, and foreign
  child IDs. Verify a present invalid bearer cannot borrow cookie authority.
- For writes, cover permitted bearer admission, retained browser CSRF behavior,
  validation, module-owned mutations, current-role revalidation, audit effects,
  stale data, and duplicate retries where relevant.
- Cover pagination and filters, dates/recurrence where used, sensitive aggregate
  projections, file or job failures, and download authority at their actual
  changed boundaries.
- Extend relevant delivered flow coverage and API-focused contract/integration
  tests. Keep the repository's 80% production line, branch, and function floors;
  apply focused versus integration-checkpoint gates as AGENTS.md requires.
- Public docs must load when signed out, carry a new stable page-catalog ID, and
  show only executable token capabilities as available. Any new required user
  flow needs its stable flow ID and Playwright coverage.

## Decisions required before implementation

1. Approve the first token scopes and the default projection for person detail,
   timeline, Today, and search, while preserving existing `people:read` access.
2. Keep token issuance owner/admin-only under the current contract, or
   explicitly change the product and authorization contract for member-owned
   integrations.
3. Select the first real integration outcome: read-only contact retrieval,
   interaction capture, task automation, or two-way contact sync. This
   determines which new reads, writes, and persistence are immediately
   necessary.
4. Define stable revision and idempotency behavior for that first external
   mutation, including receipt retention and replay/error semantics.
5. Decide whether a full person read rejects unavailable sections or requires
   explicit section selection; state optional-module behavior consistently.
6. Approve any needed schema and module-boundary changes for sync, external
   identities, webhooks, or OAuth only when that integration is scheduled.
