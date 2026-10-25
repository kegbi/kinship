# Kinship API operation inventory

Code snapshot: `c46579ec`, 25 October 2026. Research snapshot of the generated
OpenAPI 3.1 contract; it does not grant token access or alter the delivery
queue. See [API coverage research](api-integration-research-2026-10-25.md) for
recommendations.

Only `GET /api/v1/people` currently declares `kinship_api_token`. Every other
operation below needs its declared authority or its route-specific credential.
Browser write headers such as `Origin` describe the current browser contract,
not a proposed requirement for bearer clients.

Field names, requiredness, enums, formats, defaults, and bounds below come from
[the generated OpenAPI contract](../../packages/contracts/openapi/openapi.json).
Named nested types refer to its `components.schemas`; the corresponding
[source schemas](../../packages/contracts/schemas) remain authoritative for
refinements and semantic rules. All path parameters are required unless
explicitly stated otherwise. Success and error responses remain
operation-specific.

## consumeApplicationEntry

`POST /api/v1/application-entry`

- Authority: kinship_entry.
- Route source:
  [registration.ts](../../packages/contracts/routes/registration.ts).
- Header parameters: `Origin` required: string uri.
- Success: 200 application/json ApplicationEntry.
- Other documented statuses: 403, 409, 429, 503.

## listWorkspaceAudit

`GET /api/v1/audit-events`

- Authority: kinship_session.
- Route source: [governance.ts](../../packages/contracts/routes/governance.ts).
- Query parameters: `personId` optional: string uuid; `actorMemberId` optional:
  string uuid; `action` optional: string [minLength=1, maxLength=200]; `from`
  optional: string date-time; `to` optional: string date-time; `cursor`
  optional: string [maxLength=2000]; `limit` optional: integer [min=1, max=50,
  default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json AuditHistory.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## getCalendarFeedDocument

`GET /api/v1/calendar-feeds/{feedFile}`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [calendar_feeds.ts](../../packages/contracts/routes/calendar_feeds.ts).
- Path parameters: `feedFile` required: string.
- Header parameters: `If-None-Match` optional: string.
- Success: 200 text/calendar string binary.
- Other documented statuses: 304, 404, 503.

## listCommunicationOptions

`GET /api/v1/communication-options`

- Authority: kinship_session.
- Route source:
  [interactions.ts](../../packages/contracts/routes/interactions.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json CommunicationOptions.
- Other documented statuses: 401, 403, 409, 503.

## retryVerificationDelivery

`POST /api/v1/email-verification-deliveries`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [registration.ts](../../packages/contracts/routes/registration.ts).
- Body (application/json, required): object. `email` required: string email
  [maxLength=254].
- Success: 202 application/json object.
- Other documented statuses: 400, 503.

## verifyEmail

`POST /api/v1/email-verifications`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [registration.ts](../../packages/contracts/routes/registration.ts).
- Body (application/json, required): object. `token` required: string
  [minLength=32, maxLength=256].
- Success: 200 application/json VerificationAccepted.
- Other documented statuses: 400, 409, 410, 503.

## listExports

`GET /api/v1/exports`

- Authority: kinship_session.
- Route source: [exports.ts](../../packages/contracts/routes/exports.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json object.
- Other documented statuses: 401, 403, 503.

## createWorkspaceExport

`POST /api/v1/exports`

- Authority: kinship_session.
- Route source: [exports.ts](../../packages/contracts/routes/exports.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, optional): ExportRequest. ExportRequest: `format`
  optional: ExportFormat.
- Success: 201 application/json ExportSummary.
- Other documented statuses: 400, 401, 403, 413, 503.

## downloadExport

`GET /api/v1/exports/{exportId}/download`

- Authority: kinship_session.
- Route source: [exports.ts](../../packages/contracts/routes/exports.ts).
- Path parameters: `exportId` required: string uuid.
- Query parameters: `token` required: string [minLength=1, maxLength=200];
  `workspaceId` optional: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json string binary, application/zip string binary,
  text/vcard string binary.
- Other documented statuses: 401, 403, 404, 410, 503.

## createExportDownload

`POST /api/v1/exports/{exportId}/downloads`

- Authority: kinship_session.
- Route source: [exports.ts](../../packages/contracts/routes/exports.ts).
- Path parameters: `exportId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 201 application/json ExportDownload.
- Other documented statuses: 401, 403, 404, 503.

## listImports

`GET /api/v1/imports`

- Authority: kinship_session.
- Route source: [imports.ts](../../packages/contracts/routes/imports.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json object.
- Other documented statuses: 401, 403, 503.

## createImportDryRun

`POST /api/v1/imports/dry-runs`

- Authority: kinship_session.
- Route source: [imports.ts](../../packages/contracts/routes/imports.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): object. `source` required: object.
- Success: 201 application/json ImportDryRun or ImportMappingRequired.
- Other documented statuses: 400, 401, 403, 413, 503.

## getImportReport

`GET /api/v1/imports/{importId}`

- Authority: kinship_session.
- Route source: [imports.ts](../../packages/contracts/routes/imports.ts).
- Path parameters: `importId` required: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json ImportSummary.
- Other documented statuses: 401, 403, 404, 503.

## commitImport

`POST /api/v1/imports/{importId}/commit`

- Authority: kinship_session.
- Route source: [imports.ts](../../packages/contracts/routes/imports.ts).
- Path parameters: `importId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): object. `confirmed` required: true;
  `monicaChoices` optional: object; `contactMethodTypes` optional: array<object>
  [maxItems=1000].
- Success: 200 application/json object.
- Other documented statuses: 400, 401, 403, 404, 503.

## mapImportColumns

`POST /api/v1/imports/{importId}/mapping`

- Authority: kinship_session.
- Route source: [imports.ts](../../packages/contracts/routes/imports.ts).
- Path parameters: `importId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): CsvColumnMapping. CsvColumnMapping:
  `columns` required: array<CsvColumnTarget> [minItems=1, maxItems=100].
- Success: 200 application/json ImportDryRun.
- Other documented statuses: 400, 401, 403, 404, 503.

## listInteractionOptions

`GET /api/v1/interaction-options`

- Authority: kinship_session.
- Route source:
  [interactions.ts](../../packages/contracts/routes/interactions.ts).
- Query parameters: `activityTypeCursor` optional: string [maxLength=2000];
  `activityTypeSearch` optional: string [maxLength=100]; `emotionCursor`
  optional: string [maxLength=2000]; `emotionSearch` optional: string
  [maxLength=100]; `limit` optional: integer [min=1, max=20, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json InteractionOptions.
- Other documented statuses: 400, 401, 403, 409, 503.

## recordInteraction

`POST /api/v1/interactions`

- Authority: kinship_session.
- Route source:
  [interactions.ts](../../packages/contracts/routes/interactions.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): InteractionInput. InteractionInput: exactly
  one of (ActivityInteractionInput: `activityTypeId` optional: string uuid;
  `description` optional: string [minLength=1, maxLength=10000]; `emotionIds`
  optional: array<string uuid> [maxItems=20]; `happenedAt` required: string
  date-time; `kind` required: "activity"; `participantIds` required:
  array<string uuid> [minItems=1, maxItems=50]; `requestId` required: string
  uuid; `summary` required: string [minLength=1, maxLength=500]) OR
  (NoteInteractionInput: `body` required: string [minLength=1, maxLength=10000];
  `isFavorited` optional: boolean; `kind` required: "note"; `personId` required:
  string uuid; `requestId` required: string uuid) OR (CallInteractionInput:
  `calledAt` required: string date-time; `contactWasCaller` required: boolean;
  `content` optional: string [minLength=1, maxLength=10000]; `emotionIds`
  optional: array<string uuid> [maxItems=20]; `kind` required: "call";
  `personId` required: string uuid; `requestId` required: string uuid) OR
  (ConversationInteractionInput: `channelTypeId` required: string uuid;
  `contactMethodId` optional: string uuid; `happenedAt` required: string
  date-time; `kind` required: "conversation"; `messages` optional: array<object>
  [maxItems=50]; `personId` required: string uuid; `requestId` required: string
  uuid; `title` optional: string [minLength=1, maxLength=500]).
- Success: 201 application/json InteractionCreated.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listJournal

`GET /api/v1/journal`

- Authority: kinship_session.
- Route source: [journal.ts](../../packages/contracts/routes/journal.ts).
- Query parameters: `cursor` optional: string [maxLength=2000]; `limit`
  optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json JournalTimelineList.
- Other documented statuses: 400, 401, 403, 503.

## linkJournalActivity

`POST /api/v1/journal/activities`

- Authority: kinship_session.
- Route source: [journal.ts](../../packages/contracts/routes/journal.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): object. `activityId` required: string uuid.
- Success: 201 application/json JournalActivityLinked.
- Other documented statuses: 400, 401, 403, 404, 503.

## saveJournalDayRating

`PUT /api/v1/journal/day-ratings`

- Authority: kinship_session.
- Route source: [journal.ts](../../packages/contracts/routes/journal.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): JournalDayRatingInput.
  JournalDayRatingInput: `comment` optional: string [minLength=1,
  maxLength=10000]; `ratedOn` required: string date; `rating` required: integer
  [min=1, max=5].
- Success: 200 application/json JournalDayRatingSaved; 201 application/json
  JournalDayRatingSaved.
- Other documented statuses: 400, 401, 403, 503.

## deleteJournalItem

`DELETE /api/v1/journal/items/{itemId}`

- Authority: kinship_session.
- Route source: [journal.ts](../../packages/contracts/routes/journal.ts).
- Path parameters: `itemId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json JournalDeleted.
- Other documented statuses: 400, 401, 403, 404, 503.

## getJournalItem

`GET /api/v1/journal/items/{itemId}`

- Authority: kinship_session.
- Route source: [journal.ts](../../packages/contracts/routes/journal.ts).
- Path parameters: `itemId` required: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json JournalItemReady.
- Other documented statuses: 401, 403, 404, 503.

## createJournalPost

`POST /api/v1/journal/posts`

- Authority: kinship_session.
- Route source: [journal.ts](../../packages/contracts/routes/journal.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): JournalPostInput. JournalPostInput: `body`
  required: string [minLength=1, maxLength=50000]; `occurredAt` required: string
  date-time; `title` optional: string [minLength=1, maxLength=500].
- Success: 201 application/json JournalPostCreated.
- Other documented statuses: 400, 401, 403, 503.

## updateJournalPost

`PUT /api/v1/journal/posts/{itemId}`

- Authority: kinship_session.
- Route source: [journal.ts](../../packages/contracts/routes/journal.ts).
- Path parameters: `itemId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): JournalPostInput. JournalPostInput: `body`
  required: string [minLength=1, maxLength=50000]; `occurredAt` required: string
  date-time; `title` optional: string [minLength=1, maxLength=500].
- Success: 200 application/json JournalPostUpdated.
- Other documented statuses: 400, 401, 403, 404, 503.

## acceptLegalDocument

`POST /api/v1/legal-acceptances`

- Authority: kinship_session.
- Route source: [governance.ts](../../packages/contracts/routes/governance.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): object. `documentId` required: string uuid.
- Success: 200 application/json LegalAccepted; 201 application/json
  LegalAccepted.
- Other documented statuses: 400, 401, 403, 409, 503.

## getPublicLegalDocument

`GET /api/v1/legal-documents/{documentType}`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source: [governance.ts](../../packages/contracts/routes/governance.ts).
- Path parameters: `documentType` required: enum("privacy", "terms").
- Success: 200 application/json LegalDocumentReady.
- Other documented statuses: 404, 503.

## getLegalRequirements

`GET /api/v1/legal-requirements`

- Authority: kinship_session.
- Route source: [governance.ts](../../packages/contracts/routes/governance.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json LegalRequirements.
- Other documented statuses: 401, 403, 503.

## getMemberUiState

`GET /api/v1/member/ui-state`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json MemberUiStateReady.
- Other documented statuses: 401, 403, 503.

## saveMemberUiState

`PATCH /api/v1/member/ui-state`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): MemberUiStateInput. MemberUiStateInput:
  `notificationsReadThrough` optional: string date-time; `personWorkspaceView`
  optional: enum("all", "timeline", "planning", "things", "admin"); `theme`
  optional: enum("system", "light", "dark").
- Success: 200 application/json MemberUiStateReady.
- Other documented statuses: 400, 401, 403, 409, 503.

## completeMfa

`POST /api/v1/mfa-challenges`

- Authority: kinship_mfa.
- Route source:
  [authentication.ts](../../packages/contracts/routes/authentication.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, required): MfaInput. MfaInput: `factor` required:
  string [minLength=6, maxLength=128]; `workspaceId` optional: string uuid.
- Success: 200 application/json Authenticated.
- Other documented statuses: 401, 403, 410, 429, 503.

## listNotifications

`GET /api/v1/notifications`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Query parameters: `cursor` optional: string [maxLength=500].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json NotificationsPage.
- Other documented statuses: 400, 401, 403, 503.

## requestPasswordReset

`POST /api/v1/password-reset-requests`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [authentication.ts](../../packages/contracts/routes/authentication.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, required): object. `email` required: string email
  [maxLength=254].
- Success: 202 application/json RecoveryAccepted.
- Other documented statuses: 400, 503.

## resetPassword

`POST /api/v1/password-resets`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [authentication.ts](../../packages/contracts/routes/authentication.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, required): PasswordResetInput. PasswordResetInput:
  `password` required: string [minLength=12, maxLength=128]; `token` required:
  string [minLength=32, maxLength=256].
- Success: 200 application/json PasswordResetAccepted.
- Other documented statuses: 400, 410, 503.

## listPeople

`GET /api/v1/people`

- Authority: kinship_session OR kinship_api_token.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Query parameters: `cursor` optional: string [maxLength=2000];
  `excludePersonId` optional: string uuid; `search` optional: string
  [maxLength=200]; `selectedPersonId` optional: string uuid; `tag` optional:
  string uuid; `lifecycle` optional: enum("active", "archived"); `sort`
  optional: enum("given-name", "family-name", "recently-added",
  "last-contacted", "recently-updated"); `starred` optional: enum("true",
  "false"); `starredFirst` optional: enum("true", "false"); `limit` optional:
  integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PeopleDirectoryPage.
- Other documented statuses: 400, 401, 403, 409, 503.

## createPerson

`POST /api/v1/people`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonInput. PersonInput:
  `duplicateOverride` optional: boolean; `familyName` optional: string
  [maxLength=200]; `givenName` required: string [maxLength=200]; `isPartial`
  required: boolean; `middleName` optional: string [maxLength=200]; `nickname`
  optional: string [maxLength=200].
- Success: 201 application/json PersonCreated.
- Other documented statuses: 400, 401, 403, 409, 503.

## bulkPeople

`POST /api/v1/people/bulk`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PeopleBulkInput. PeopleBulkInput: `action`
  required: enum("archive", "restore", "tag", "untag"); `personIds` required:
  array<string uuid> [minItems=1, maxItems=100]; `tagId` optional: string uuid.
- Success: 200 application/json PeopleBulkResult.
- Other documented statuses: 400, 401, 403, 503.

## exportPeopleVCards

`POST /api/v1/people/bulk/vcard`

- Authority: kinship_session.
- Route source: [exports.ts](../../packages/contracts/routes/exports.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PeopleVCardInput. PeopleVCardInput:
  `personIds` required: array<string uuid> [minItems=1, maxItems=100].
- Success: 200 text/vcard string binary.
- Other documented statuses: 400, 401, 403, 404, 503.

## listPeopleDuplicates

`GET /api/v1/people/duplicates`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PeopleDuplicates.
- Other documented statuses: 401, 403, 503.

## dismissPeopleDuplicate

`POST /api/v1/people/duplicates/dismissals`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PeopleDuplicateDismissalInput.
  PeopleDuplicateDismissalInput: `personIds` required: array<string uuid>
  [minItems=2, maxItems=2].
- Success: 200 application/json PeopleDuplicateDismissed.
- Other documented statuses: 400, 401, 403, 404, 503.

## listPeopleTagFacet

`GET /api/v1/people/tag-facet`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Query parameters: `lifecycle` optional: enum("active", "archived").
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PeopleTagFacet.
- Other documented statuses: 400, 401, 403, 503.

## listPeopleTagOptions

`GET /api/v1/people/tag-options`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Query parameters: `search` optional: string [maxLength=200]; `cursor`
  optional: string [maxLength=2000]; `selected` optional: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PeopleTagOptionsPage.
- Other documented statuses: 400, 401, 403, 409, 503.

## deletePerson

`DELETE /api/v1/people/{personId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonDeleteInput. PersonDeleteInput:
  `confirmation` required: string [minLength=1, maxLength=500];
  `expectedUpdatedAt` required: string date-time.
- Success: 200 application/json PersonDeleted.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## getPerson

`GET /api/v1/people/{personId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `include` optional: enum("summary").
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonReady.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## editPerson

`PATCH /api/v1/people/{personId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonEditInput. PersonEditInput:
  `description` optional: string [maxLength=2000]; `expectedUpdatedAt` required:
  string date-time; `familyName` optional: string [maxLength=200];
  `genderOptionId` optional: string uuid or ""; `givenName` required: string
  [maxLength=200]; `isDeceased` optional: boolean; `isPartial` required:
  boolean; `middleName` optional: string [maxLength=200]; `nickname` optional:
  string [maxLength=200].
- Success: 200 application/json PersonLifecycleChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## getActivityReport

`GET /api/v1/people/{personId}/activity-report`

- Authority: kinship_session.
- Route source:
  [interactions.ts](../../packages/contracts/routes/interactions.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `cursor` optional: string [maxLength=2000]; `kind` optional:
  enum("activity", "note"); `year` optional: integer [min=1, max=9999]; `limit`
  optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json ActivityReport.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## archivePerson

`POST /api/v1/people/{personId}/archive`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonTransitionInput.
  PersonTransitionInput: `expectedUpdatedAt` required: string date-time.
- Success: 200 application/json PersonLifecycleChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listPersonAudit

`GET /api/v1/people/{personId}/audit`

- Authority: kinship_session.
- Route source: [governance.ts](../../packages/contracts/routes/governance.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `actorMemberId` optional: string uuid; `action` optional:
  string [minLength=1, maxLength=200]; `from` optional: string date-time; `to`
  optional: string date-time; `cursor` optional: string [maxLength=2000];
  `limit` optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json AuditHistory.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## replacePersonAvatar

`PUT /api/v1/people/{personId}/avatar`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid; `X-File-Name` required: string [maxLength=500].
- Body (image/jpeg, required): string binary [maxLength=1048576].
- Body (image/png, required): string binary [maxLength=1048576].
- Body (image/webp, required): string binary [maxLength=1048576].
- Success: 200 application/json PersonAvatarChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 413, 415, 423, 503.

## removePersonAvatar

`DELETE /api/v1/people/{personId}/avatar`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json PersonAvatarChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listPersonCommunications

`GET /api/v1/people/{personId}/communications`

- Authority: kinship_session.
- Route source:
  [interactions.ts](../../packages/contracts/routes/interactions.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json CommunicationList.
- Other documented statuses: 400, 401, 403, 404, 503.

## listImportantDates

`GET /api/v1/people/{personId}/dates`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json ImportantDateList.
- Other documented statuses: 400, 401, 403, 404, 503.

## createImportantDate

`POST /api/v1/people/{personId}/dates`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ImportantDateInput. ImportantDateInput:
  `day` optional: integer [min=1, max=31]; `isAgeBased` required: boolean;
  `isYearApproximate` required: boolean; `kind` required: enum("birthday",
  "custom", "deceased", "first_met"); `label` optional: string [maxLength=200];
  `month` optional: integer [min=1, max=12]; `notes` optional: string
  [maxLength=2000]; `precision` required: enum("day", "full", "month",
  "month_day", "unknown", "year", "year_month"); `year` optional: integer
  [min=1, max=9999].
- Success: 201 application/json ImportantDateChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## deleteImportantDate

`DELETE /api/v1/people/{personId}/dates/{dateId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `dateId` required: string
  uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonTransitionInput.
  PersonTransitionInput: `expectedUpdatedAt` required: string date-time.
- Success: 200 application/json ImportantDateDeleted.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## updateImportantDate

`PATCH /api/v1/people/{personId}/dates/{dateId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `dateId` required: string
  uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ImportantDateUpdateInput.
  ImportantDateUpdateInput: `day` optional: integer [min=1, max=31];
  `isAgeBased` required: boolean; `isYearApproximate` required: boolean; `kind`
  required: enum("birthday", "custom", "deceased", "first_met"); `label`
  optional: string [maxLength=200]; `month` optional: integer [min=1, max=12];
  `notes` optional: string [maxLength=2000]; `precision` required: enum("day",
  "full", "month", "month_day", "unknown", "year", "year_month"); `year`
  optional: integer [min=1, max=9999]; `expectedUpdatedAt` required: string
  date-time.
- Success: 200 application/json ImportantDateChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## createDebt

`POST /api/v1/people/{personId}/debts`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): DebtCreateInput. DebtCreateInput:
  `settlementReason` optional: string [minLength=1, maxLength=10000];
  `settlementPhotoFileId` optional: string uuid; `amount` required: string
  [pattern="^\\d{1,15}(?:\\.\\d{1,4})?$"]; `currencyCode` required: string [pattern="^[A-Za-z]{3}$"];
  `direction` required: enum("i_owe", "they_owe"); `reason` optional: string
  [minLength=1, maxLength=10000]; `status` required: enum("open", "settled",
  "cancelled").
- Success: 201 application/json DebtCreated.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## deleteDebt

`DELETE /api/v1/people/{personId}/debts/{debtId}`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid; `debtId` required: string
  uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json DebtDeleted.
- Other documented statuses: 401, 403, 404, 409, 503.

## listDebtSettlements

`GET /api/v1/people/{personId}/debts/{debtId}/settlements`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid; `debtId` required: string
  uuid.
- Query parameters: `cursor` optional: string [maxLength=2000]; `limit`
  optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json DebtSettlementList.
- Other documented statuses: 400, 401, 403, 404, 503.

## changeDebtStatus

`PATCH /api/v1/people/{personId}/debts/{debtId}/status`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid; `debtId` required: string
  uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): DebtStatusInput. DebtStatusInput:
  `settlementReason` optional: string [minLength=1, maxLength=10000];
  `settlementPhotoFileId` optional: string uuid; `status` required: enum("open",
  "settled", "cancelled").
- Success: 200 application/json DebtSaved.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## getPersonDeletionImpact

`GET /api/v1/people/{personId}/deletion-impact`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonDeletionImpact.
- Other documented statuses: 400, 401, 403, 404, 503.

## listProfileFacts

`GET /api/v1/people/{personId}/facts/{section}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `section` required:
  ProfileFactSectionId.
- Query parameters: `cursor` optional: string [maxLength=2000]; `includeOptions`
  optional: "true"; `optionCursor` optional: string [maxLength=2000];
  `optionSearch` optional: string [maxLength=200].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json ProfileFactSection.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## createProfileFact

`POST /api/v1/people/{personId}/facts/{section}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `section` required:
  ProfileFactSectionId.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ProfileFactCreateInput.
  ProfileFactCreateInput: exactly one of (AddressFactCreateInput: `city`
  optional: string [maxLength=200]; `country` optional: string [maxLength=200];
  `displayName` optional: string [maxLength=200]; `isPrimary` required: boolean;
  `labelIds` required: array<string uuid> [maxItems=20]; `postalCode` optional:
  string [maxLength=50]; `region` optional: string [maxLength=200]; `street`
  optional: string [maxLength=500]; `expectedPersonUpdatedAt` required: string
  date-time; `section` required: "addresses"; additional constraint: at least
  one of (`city` required: string [minLength=1, pattern="\\S"]) OR (`country`
  required: string [minLength=1, pattern="\\S"]) OR (`displayName` required:
  string [minLength=1, pattern="\\S"]) OR (`postalCode` required: string
  [minLength=1, pattern="\\S"]) OR (`region` required: string [minLength=1,
  pattern="\\S"]) OR (`street` required: string [minLength=1, pattern="\\S"]))
  OR (ContactMethodFactCreateInput: `isPrimary` required: boolean; `labelIds`
  required: array<string uuid> [maxItems=20]; `notes` optional: string
  [maxLength=2000]; `typeId` required: string uuid; `value` required: string
  [minLength=1, maxLength=2000, pattern="\\S"]; `expectedPersonUpdatedAt`
  required: string date-time; `section` required: "contact-methods") OR
  (FirstMeetingFactCreateInput: `introducedByPersonId` optional: string uuid;
  `notes` optional: string [maxLength=2000]; `placeText` optional: string
  [maxLength=500]; `expectedPersonUpdatedAt` required: string date-time;
  `section` required: "first-meeting"; additional constraint: at least one of
  (requires `introducedByPersonId`) OR (`notes` required: string [minLength=1,
  pattern="\\S"]) OR (`placeText` required: string [minLength=1,
  pattern="\\S"])) OR (FoodPreferencesFactCreateInput: `foodPreferences`
  required: string [minLength=1, maxLength=2000, pattern="\\S"];
  `expectedPersonUpdatedAt` required: string date-time; `section` required:
  "food-preferences") OR (PetFactCreateInput: `categoryId` optional: string
  uuid; `name` optional: string [maxLength=200]; `notes` optional: string
  [maxLength=2000]; `expectedPersonUpdatedAt` required: string date-time;
  `section` required: "pets"; additional constraint: at least one of (requires
  `categoryId`) OR (`name` required: string [minLength=1, pattern="\\S"])) OR
  (TagsFactCreateInput: `tagIds` required: array<string uuid> [maxItems=500];
  `expectedPersonUpdatedAt` required: string date-time; `section` required:
  "tags") OR (OccupationFactCreateInput: `description` optional: string
  [maxLength=2000]; `endOn` optional: string date; `isCurrent` required:
  boolean; `organizationId` optional: string uuid; `organizationName` optional:
  string [maxLength=200]; `startOn` optional: string date; `title` required:
  string [minLength=1, maxLength=200, pattern="\\S"]; `expectedPersonUpdatedAt`
  required: string date-time; `section` required: "work").
- Success: 200 application/json ProfileFactChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## deleteProfileFact

`DELETE /api/v1/people/{personId}/facts/{section}/{factId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `section` required:
  ProfileFactSectionId; `factId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ProfileFactDeleteInput.
  ProfileFactDeleteInput: `expectedPersonUpdatedAt` required: string date-time;
  `expectedUpdatedAt` required: string date-time; `section` required:
  ProfileFactSectionId.
- Success: 200 application/json ProfileFactDeleted.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## updateProfileFact

`PUT /api/v1/people/{personId}/facts/{section}/{factId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `section` required:
  ProfileFactSectionId; `factId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ProfileFactUpdateInput.
  ProfileFactUpdateInput: exactly one of (AddressFactUpdateInput: `city`
  optional: string [maxLength=200]; `country` optional: string [maxLength=200];
  `displayName` optional: string [maxLength=200]; `isPrimary` required: boolean;
  `labelIds` required: array<string uuid> [maxItems=20]; `postalCode` optional:
  string [maxLength=50]; `region` optional: string [maxLength=200]; `street`
  optional: string [maxLength=500]; `expectedPersonUpdatedAt` required: string
  date-time; `expectedUpdatedAt` required: string date-time; `id` required:
  string uuid; `section` required: "addresses"; additional constraint: at least
  one of (`city` required: string [minLength=1, pattern="\\S"]) OR (`country`
  required: string [minLength=1, pattern="\\S"]) OR (`displayName` required:
  string [minLength=1, pattern="\\S"]) OR (`postalCode` required: string
  [minLength=1, pattern="\\S"]) OR (`region` required: string [minLength=1,
  pattern="\\S"]) OR (`street` required: string [minLength=1, pattern="\\S"]))
  OR (ContactMethodFactUpdateInput: `isPrimary` required: boolean; `labelIds`
  required: array<string uuid> [maxItems=20]; `notes` optional: string
  [maxLength=2000]; `typeId` required: string uuid; `value` required: string
  [minLength=1, maxLength=2000, pattern="\\S"]; `expectedPersonUpdatedAt`
  required: string date-time; `expectedUpdatedAt` required: string date-time;
  `id` required: string uuid; `section` required: "contact-methods") OR
  (FirstMeetingFactUpdateInput: `introducedByPersonId` optional: string uuid;
  `notes` optional: string [maxLength=2000]; `placeText` optional: string
  [maxLength=500]; `expectedPersonUpdatedAt` required: string date-time;
  `expectedUpdatedAt` required: string date-time; `id` required: string uuid;
  `section` required: "first-meeting"; additional constraint: at least one of
  (requires `introducedByPersonId`) OR (`notes` required: string [minLength=1,
  pattern="\\S"]) OR (`placeText` required: string [minLength=1,
  pattern="\\S"])) OR (FoodPreferencesFactUpdateInput: `foodPreferences`
  required: string [minLength=1, maxLength=2000, pattern="\\S"];
  `expectedPersonUpdatedAt` required: string date-time; `expectedUpdatedAt`
  required: string date-time; `id` required: string uuid; `section` required:
  "food-preferences") OR (PetFactUpdateInput: `categoryId` optional: string
  uuid; `name` optional: string [maxLength=200]; `notes` optional: string
  [maxLength=2000]; `expectedPersonUpdatedAt` required: string date-time;
  `expectedUpdatedAt` required: string date-time; `id` required: string uuid;
  `section` required: "pets"; additional constraint: at least one of (requires
  `categoryId`) OR (`name` required: string [minLength=1, pattern="\\S"])) OR
  (TagsFactUpdateInput: `tagIds` required: array<string uuid> [maxItems=500];
  `expectedPersonUpdatedAt` required: string date-time; `expectedUpdatedAt`
  required: string date-time; `id` required: string uuid; `section` required:
  "tags") OR (OccupationFactUpdateInput: `description` optional: string
  [maxLength=2000]; `endOn` optional: string date; `isCurrent` required:
  boolean; `organizationId` optional: string uuid; `organizationName` optional:
  string [maxLength=200]; `startOn` optional: string date; `title` required:
  string [minLength=1, maxLength=200, pattern="\\S"]; `expectedPersonUpdatedAt`
  required: string date-time; `expectedUpdatedAt` required: string date-time;
  `id` required: string uuid; `section` required: "work").
- Success: 200 application/json ProfileFactChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listPersonFiles

`GET /api/v1/people/{personId}/files`

- Authority: kinship_session.
- Route source: [files.ts](../../packages/contracts/routes/files.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `cursor` optional: string [maxLength=2000]; `limit`
  optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonFileList.
- Other documented statuses: 400, 401, 403, 404, 503.

## uploadPersonFile

`POST /api/v1/people/{personId}/files`

- Authority: kinship_session.
- Route source: [files.ts](../../packages/contracts/routes/files.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid; `X-File-Kind` required: enum("document", "photo"); `X-File-Name`
  required: string [maxLength=500]; `X-File-Title` required: string
  [maxLength=500].
- Body (application/pdf, required): string binary [maxLength=10485760].
- Body (application/vnd.openxmlformats-officedocument.wordprocessingml.document,
  required): string binary [maxLength=10485760].
- Body (image/jpeg, required): string binary [maxLength=10485760].
- Body (image/png, required): string binary [maxLength=10485760].
- Body (image/webp, required): string binary [maxLength=10485760].
- Body (text/plain, required): string binary [maxLength=10485760].
- Success: 201 application/json PersonFileCreated.
- Other documented statuses: 400, 401, 403, 404, 413, 415, 503.

## removePersonFile

`DELETE /api/v1/people/{personId}/files/{fileId}`

- Authority: kinship_session.
- Route source: [files.ts](../../packages/contracts/routes/files.ts).
- Path parameters: `personId` required: string uuid; `fileId` required: string
  uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json object.
- Other documented statuses: 401, 403, 404, 409, 503.

## downloadPersonFile

`GET /api/v1/people/{personId}/files/{fileId}/content`

- Authority: kinship_session.
- Route source: [files.ts](../../packages/contracts/routes/files.ts).
- Path parameters: `personId` required: string uuid; `fileId` required: string
  uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/pdf string binary,
  application/vnd.openxmlformats-officedocument.wordprocessingml.document string
  binary, text/plain string binary, image/jpeg string binary, image/png string
  binary, image/webp string binary.
- Other documented statuses: 401, 403, 404, 410, 423, 503.

## listPersonGiftsAndDebts

`GET /api/v1/people/{personId}/gifts`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `debtCursor` optional: string [maxLength=2000]; `giftCursor`
  optional: string [maxLength=2000]; `limit` optional: integer [min=1, max=50,
  default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json GiftDebtList.
- Other documented statuses: 400, 401, 403, 404, 503.

## createGift

`POST /api/v1/people/{personId}/gifts`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): GiftCreateInput. GiftCreateInput: `amount`
  optional: string
  [pattern="^\\d{1,15}(?:\\.\\d{1,4})?$"]; `attachmentFileId` optional: string uuid; `comment` optional: string [minLength=1, maxLength=10000]; `currencyCode` optional: string [pattern="^[A-Za-z]{3}$"];
  `eventAt` optional: string date-time; `name` required: string [minLength=1,
  maxLength=500]; `recipientPersonId` optional: string uuid; `status` required:
  enum("idea", "planned", "given", "received", "archived"); `url` optional:
  string uri [maxLength=2000].
- Success: 201 application/json GiftCreated.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## changeGiftStatus

`PATCH /api/v1/people/{personId}/gifts/{giftId}/status`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid; `giftId` required: string
  uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): GiftStatusInput. GiftStatusInput: `status`
  required: enum("idea", "planned", "given", "received", "archived").
- Success: 200 application/json GiftSaved.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listPersonLifeEvents

`GET /api/v1/people/{personId}/life-events`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonLifeEventsReady.
- Other documented statuses: 400, 401, 403, 404, 503.

## createPersonLifeEvent

`POST /api/v1/people/{personId}/life-events`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonLifeEventInput. PersonLifeEventInput:
  `day` optional: integer [min=1, max=31]; `month` optional: integer [min=1,
  max=12]; `name` optional: string [maxLength=200]; `note` optional: string
  [maxLength=10000]; `precision` required: enum("day", "full", "month",
  "month_day", "unknown", "year", "year_month"); `typeId` optional: string uuid;
  `year` optional: integer [min=1, max=9999].
- Success: 201 application/json PersonLifeEventChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## updatePersonLifeEvent

`PATCH /api/v1/people/{personId}/life-events/{lifeEventId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `lifeEventId` required:
  string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonLifeEventUpdateInput.
  PersonLifeEventUpdateInput: `day` optional: integer [min=1, max=31]; `month`
  optional: integer [min=1, max=12]; `name` optional: string [maxLength=200];
  `note` optional: string [maxLength=10000]; `precision` required: enum("day",
  "full", "month", "month_day", "unknown", "year", "year_month"); `typeId`
  optional: string uuid; `year` optional: integer [min=1, max=9999];
  `expectedUpdatedAt` required: string date-time.
- Success: 200 application/json PersonLifeEventChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## deletePersonLifeEvent

`DELETE /api/v1/people/{personId}/life-events/{lifeEventId}`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid; `lifeEventId` required:
  string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonTransitionInput.
  PersonTransitionInput: `expectedUpdatedAt` required: string date-time.
- Success: 200 application/json PersonLifeEventDeleted.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## createRecurringDebt

`POST /api/v1/people/{personId}/recurring-debts`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): RecurringDebtCreateInput.
  RecurringDebtCreateInput: `amount` required: string
  [pattern="^\\d{1,15}(?:\\.\\d{1,4})?$"]; `currencyCode` required: string [pattern="^[A-Za-z]{3}$"];
  `dayOfMonth` required: integer [min=1, max=31]; `direction` required:
  enum("i_owe", "they_owe"); `endsOn` optional: string date; `intervalMonths`
  required: integer [min=1, max=120]; `reason` optional: string [minLength=1,
  maxLength=10000]; `startsOn` required: string date.
- Success: 201 application/json RecurringDebtCreated.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## updateRecurringDebt

`PATCH /api/v1/people/{personId}/recurring-debts/{recurringDebtId}`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid; `recurringDebtId` required:
  string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): RecurringDebtUpdateInput.
  RecurringDebtUpdateInput: `active` optional: boolean; `amount` optional:
  string
  [pattern="^\\d{1,15}(?:\\.\\d{1,4})?$"]; `currencyCode` optional: string [pattern="^[A-Za-z]{3}$"];
  `dayOfMonth` optional: integer [min=1, max=31]; `direction` optional:
  enum("i_owe", "they_owe"); `endsOn` optional: string date or null;
  `intervalMonths` optional: integer [min=1, max=120]; `reason` optional: string
  [minLength=1, maxLength=10000] or null; `startsOn` optional: string date.
- Success: 200 application/json RecurringDebtSaved.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## deleteRecurringDebt

`DELETE /api/v1/people/{personId}/recurring-debts/{recurringDebtId}`

- Authority: kinship_session.
- Route source: [gifts.ts](../../packages/contracts/routes/gifts.ts).
- Path parameters: `personId` required: string uuid; `recurringDebtId` required:
  string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json RecurringDebtDeleted.
- Other documented statuses: 401, 403, 404, 409, 503.

## listRelationships

`GET /api/v1/people/{personId}/relationships`

- Authority: kinship_session.
- Route source:
  [relationships.ts](../../packages/contracts/routes/relationships.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `cursor` optional: string [maxLength=2000]; `limit`
  optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json RelationshipList.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## createRelationship

`POST /api/v1/people/{personId}/relationships`

- Authority: kinship_session.
- Route source:
  [relationships.ts](../../packages/contracts/routes/relationships.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): RelationshipCreateInput.
  RelationshipCreateInput: `relationshipTypeId` required: string uuid;
  `targetPersonId` required: string uuid.
- Success: 200 application/json RelationshipChanged; 201 application/json
  RelationshipChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## createRelatedPersonRelationship

`POST /api/v1/people/{personId}/relationships/related-person`

- Authority: kinship_session.
- Route source:
  [relationships.ts](../../packages/contracts/routes/relationships.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): RelatedPersonRelationshipInput.
  RelatedPersonRelationshipInput: `person` required: PersonInput;
  `relationshipTypeId` required: string uuid.
- Success: 201 application/json RelatedPersonRelationshipChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## deleteRelationship

`DELETE /api/v1/people/{personId}/relationships/{relationshipId}`

- Authority: kinship_session.
- Route source:
  [relationships.ts](../../packages/contracts/routes/relationships.ts).
- Path parameters: `personId` required: string uuid; `relationshipId` required:
  string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonTransitionInput.
  PersonTransitionInput: `expectedUpdatedAt` required: string date-time.
- Success: 200 application/json RelationshipDeleted.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## updateRelationship

`PATCH /api/v1/people/{personId}/relationships/{relationshipId}`

- Authority: kinship_session.
- Route source:
  [relationships.ts](../../packages/contracts/routes/relationships.ts).
- Path parameters: `personId` required: string uuid; `relationshipId` required:
  string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): RelationshipUpdateInput.
  RelationshipUpdateInput: `expectedUpdatedAt` required: string date-time;
  `relationshipTypeId` required: string uuid.
- Success: 200 application/json RelationshipChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listPersonReminders

`GET /api/v1/people/{personId}/reminders`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `cursor` optional: string [maxLength=2000]; `limit`
  optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonReminders.
- Other documented statuses: 400, 401, 403, 503.

## restorePerson

`POST /api/v1/people/{personId}/restore`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonTransitionInput.
  PersonTransitionInput: `expectedUpdatedAt` required: string date-time.
- Success: 200 application/json PersonLifecycleChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## starPerson

`PUT /api/v1/people/{personId}/star`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json PersonStarChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## unstarPerson

`DELETE /api/v1/people/{personId}/star`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json PersonStarChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listPersonTimeline

`GET /api/v1/people/{personId}/timeline`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `cursor` optional: string [maxLength=2000]; `kind` optional:
  enum("activity", "call", "conversation", "life-event", "note"); `limit`
  optional: integer [min=1, max=50, default=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonTimelinePage.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## exportPersonVCard

`GET /api/v1/people/{personId}/vcard`

- Authority: kinship_session.
- Route source: [exports.ts](../../packages/contracts/routes/exports.ts).
- Path parameters: `personId` required: string uuid.
- Query parameters: `workspaceId` optional: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 text/vcard string binary.
- Other documented statuses: 401, 404, 503.

## recordPersonView

`POST /api/v1/people/{personId}/view`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `personId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json PersonViewRecorded.
- Other documented statuses: 400, 401, 403, 404, 503.

## mergePeople

`POST /api/v1/people/{primaryId}/merge`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `primaryId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonMergeInput. PersonMergeInput:
  `confirmed` required: true; `conflictsDigest` required: string
  [pattern="^[0-9a-f]{64}$"]; `duplicateId` required: string uuid;
  `duplicateRevision` required: string date-time; `primaryRevision` required:
  string date-time.
- Success: 200 application/json PersonMerged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## previewPeopleMerge

`GET /api/v1/people/{primaryId}/merge-preview`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Path parameters: `primaryId` required: string uuid.
- Query parameters: `duplicateId` required: string uuid.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonMergePreview.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## createFirstWorkspace

`POST /api/v1/registrations`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [registration.ts](../../packages/contracts/routes/registration.ts).
- Body (application/json, required): RegistrationInput. RegistrationInput:
  `email` required: string email [maxLength=254]; `firstName` required: string
  [minLength=1, maxLength=100]; `lastName` required: string [maxLength=100];
  `password` required: string [minLength=12, maxLength=128]; `workspaceName`
  required: string [minLength=2, maxLength=120].
- Success: 202 application/json RegistrationAccepted.
- Other documented statuses: 400, 409, 429, 503.

## listRelationshipTypes

`GET /api/v1/relationship-types`

- Authority: kinship_session.
- Route source:
  [relationships.ts](../../packages/contracts/routes/relationships.ts).
- Query parameters: `cursor` optional: string [maxLength=2000]; `search`
  optional: string [maxLength=200]; `selected` optional: array<string uuid>
  [maxItems=20].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json RelationshipTypeList.
- Other documented statuses: 400, 401, 403, 409, 503.

## acknowledgeReminderOccurrence

`PUT /api/v1/reminder-occurrences/{occurrenceId}/acknowledgement`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Path parameters: `occurrenceId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json ReminderOccurrenceAcknowledged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## createReminder

`POST /api/v1/reminders`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ReminderCreateInput. ReminderCreateInput:
  `anchorOn` required: string date; `personId` required: string uuid;
  `recurrenceInterval` required: integer [min=1, max=100]; `recurrenceUnit`
  required: enum("none", "day", "week", "month", "year"); `requestId` required:
  string uuid; `sendTime` required: string
  [pattern="^([01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$"]; `title` required:
  string [minLength=1, maxLength=500].
- Success: 201 application/json ReminderCreated.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## setReminderActive

`PUT /api/v1/reminders/{reminderId}/active`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Path parameters: `reminderId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): object. `active` required: boolean.
- Success: 200 application/json ReminderSaved.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## searchWorkspace

`GET /api/v1/search`

- Authority: kinship_session.
- Route source: [search.ts](../../packages/contracts/routes/search.ts).
- Query parameters: `q` required: string [minLength=1, maxLength=200]; `limit`
  optional: integer [min=1, max=10, default=5]; `sort` optional:
  enum("given-name", "family-name").
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json SearchResults.
- Other documented statuses: 400, 401, 403, 503.

## getSession

`GET /api/v1/session`

- Authority: kinship_session.
- Route source:
  [authentication.ts](../../packages/contracts/routes/authentication.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json SessionContext.
- Other documented statuses: 401.

## signIn

`POST /api/v1/sessions`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [authentication.ts](../../packages/contracts/routes/authentication.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, required): SignInInput. SignInInput: `email` required:
  string email [maxLength=254]; `password` required: string [minLength=1,
  maxLength=128]; `workspaceId` optional: string uuid.
- Success: 200 application/json Authenticated; 202 application/json MfaRequired.
- Other documented statuses: 400, 401, 403, 429, 503.

## getApiTokens

`GET /api/v1/settings/api-tokens`

- Authority: kinship_session.
- Route source: [api_tokens.ts](../../packages/contracts/routes/api_tokens.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json ApiTokenList.
- Other documented statuses: 401, 403, 503.

## createApiToken

`POST /api/v1/settings/api-tokens`

- Authority: kinship_session.
- Route source: [api_tokens.ts](../../packages/contracts/routes/api_tokens.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ApiTokenCreateInput. ApiTokenCreateInput:
  `expiresAt` optional: string date-time; `name` required: string [minLength=1,
  maxLength=100]; `scopes` required: array<enum("people:read")> [minItems=1,
  maxItems=1].
- Success: 201 application/json ApiTokenCreated.
- Other documented statuses: 400, 401, 403, 503.

## revokeApiToken

`DELETE /api/v1/settings/api-tokens/{tokenId}`

- Authority: kinship_session.
- Route source: [api_tokens.ts](../../packages/contracts/routes/api_tokens.ts).
- Path parameters: `tokenId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json ApiTokenRevoked.
- Other documented statuses: 401, 403, 404, 503.

## getCalendarFeed

`GET /api/v1/settings/calendar-feed`

- Authority: kinship_session.
- Route source:
  [calendar_feeds.ts](../../packages/contracts/routes/calendar_feeds.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json CalendarFeedStatus.
- Other documented statuses: 401, 403, 503.

## createCalendarFeed

`POST /api/v1/settings/calendar-feed`

- Authority: kinship_session.
- Route source:
  [calendar_feeds.ts](../../packages/contracts/routes/calendar_feeds.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 201 application/json CalendarFeedIssued.
- Other documented statuses: 401, 403, 409, 503.

## revokeCalendarFeed

`DELETE /api/v1/settings/calendar-feed`

- Authority: kinship_session.
- Route source:
  [calendar_feeds.ts](../../packages/contracts/routes/calendar_feeds.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json CalendarFeedRevoked.
- Other documented statuses: 401, 403, 404, 503.

## rotateCalendarFeed

`POST /api/v1/settings/calendar-feed/rotation`

- Authority: kinship_session.
- Route source:
  [calendar_feeds.ts](../../packages/contracts/routes/calendar_feeds.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 201 application/json CalendarFeedIssued.
- Other documented statuses: 401, 403, 404, 503.

## getDavSubscriptions

`GET /api/v1/settings/integrations/dav`

- Authority: kinship_session.
- Route source:
  [integrations.ts](../../packages/contracts/routes/integrations.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json DavSubscriptionList.
- Other documented statuses: 401, 403, 503.

## createDavSubscription

`POST /api/v1/settings/integrations/dav`

- Authority: kinship_session.
- Route source:
  [integrations.ts](../../packages/contracts/routes/integrations.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): DavSubscriptionInput. DavSubscriptionInput:
  `name` required: string [minLength=1, maxLength=100]; `password` required:
  string [minLength=1, maxLength=4096]; `remoteUrl` required: string uri
  [maxLength=2048]; `username` optional: string [maxLength=255].
- Success: 201 application/json DavSubscriptionConfigured.
- Other documented statuses: 400, 401, 403, 503.

## disableDavSubscription

`DELETE /api/v1/settings/integrations/dav/{subscriptionId}`

- Authority: kinship_session.
- Route source:
  [integrations.ts](../../packages/contracts/routes/integrations.ts).
- Path parameters: `subscriptionId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json DavSubscriptionDisabled.
- Other documented statuses: 401, 403, 404, 503.

## synchronizeDavSubscription

`POST /api/v1/settings/integrations/dav/{subscriptionId}/sync`

- Authority: kinship_session.
- Route source:
  [integrations.ts](../../packages/contracts/routes/integrations.ts).
- Path parameters: `subscriptionId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json DavSyncResult.
- Other documented statuses: 401, 403, 404, 409, 503.

## listManagedMembers

`GET /api/v1/settings/members`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json ManagedMembers.
- Other documented statuses: 401, 403, 503.

## updateManagedMember

`PATCH /api/v1/settings/members/{memberId}`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Path parameters: `memberId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): MemberUpdateInput. MemberUpdateInput:
  `role` required: enum("owner", "admin", "member"); `status` required:
  enum("active", "suspended").
- Success: 200 application/json ManagedMemberResult.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## deletePersonalIdentity

`DELETE /api/v1/settings/personal-lifecycle`

- Authority: kinship_session.
- Route source:
  [personal_lifecycle.ts](../../packages/contracts/routes/personal_lifecycle.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonalIdentityDeletionInput.
  PersonalIdentityDeletionInput: `confirmation` required: string [minLength=1,
  maxLength=300]; `password` required: string [minLength=1, maxLength=1024].
- Success: 200 application/json PersonalIdentityDeleted.
- Other documented statuses: 400, 401, 403, 409, 429, 503.

## getPersonalLifecyclePreview

`GET /api/v1/settings/personal-lifecycle`

- Authority: kinship_session.
- Route source:
  [personal_lifecycle.ts](../../packages/contracts/routes/personal_lifecycle.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonalLifecyclePreview.
- Other documented statuses: 401, 403, 503.

## leaveCurrentWorkspace

`POST /api/v1/settings/personal-lifecycle/leave`

- Authority: kinship_session.
- Route source:
  [personal_lifecycle.ts](../../packages/contracts/routes/personal_lifecycle.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonalLifecycleConfirmation.
  PersonalLifecycleConfirmation: `confirmation` required: string [minLength=1,
  maxLength=300]; `password` required: string [minLength=1, maxLength=1024].
- Success: 200 application/json WorkspaceLeft.
- Other documented statuses: 400, 401, 403, 409, 429, 503.

## listPersonalizationEntries

`GET /api/v1/settings/personalization/{section}`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Path parameters: `section` required: PersonalizationSection.
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PersonalizationList.
- Other documented statuses: 401, 403, 404, 503.

## createPersonalizationEntry

`POST /api/v1/settings/personalization/{section}`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Path parameters: `section` required: PersonalizationSection.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonalizationCreate.
  PersonalizationCreate: at least one of (PersonalizationContactTypeCreate:
  `contactKind` optional: ContactMethodKind; `name` required: string
  [minLength=1, maxLength=200]; `sortOrder` optional: integer [min=0,
  max=10000]) OR (PersonalizationNamedCreate: `name` required: string
  [minLength=1, maxLength=200]; `sortOrder` optional: integer [min=0,
  max=10000]) OR (PersonalizationNameOnlyCreate: `name` required: string
  [minLength=1, maxLength=200]) OR (PersonalizationRelationshipCreate:
  `forwardLabel` required: string [minLength=1, maxLength=200]; `reverseLabel`
  required: string [minLength=1, maxLength=200]; `sortOrder` optional: integer
  [min=0, max=10000]) OR (PersonalizationReminderCreate: `daysBefore` required:
  integer [min=0, max=3650]).
- Success: 200 application/json PersonalizationSaved.
- Other documented statuses: 400, 401, 403, 409, 503.

## deletePersonalizationEntry

`DELETE /api/v1/settings/personalization/{section}/{id}`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Path parameters: `section` required: PersonalizationSection; `id` required:
  string uuid.
- Query parameters: `expectedUpdatedAt` required: string date-time;
  `replacementId` optional: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json PersonalizationDeleted.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## updatePersonalizationEntry

`PATCH /api/v1/settings/personalization/{section}/{id}`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Path parameters: `section` required: PersonalizationSection; `id` required:
  string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PersonalizationUpdate.
  PersonalizationUpdate: at least one of (PersonalizationContactTypeUpdate:
  `contactKind` optional: ContactMethodKind; `expectedUpdatedAt` required:
  string date-time; `isActive` optional: boolean; `name` optional: string
  [minLength=1, maxLength=200]; `sortOrder` optional: integer [min=0,
  max=10000]; additional constraint: at least one of (requires `contactKind`) OR
  (requires `isActive`) OR (requires `name`) OR (requires `sortOrder`)) OR
  (PersonalizationNamedUpdate: `expectedUpdatedAt` required: string date-time;
  `isActive` optional: boolean; `name` optional: string [minLength=1,
  maxLength=200]; `sortOrder` optional: integer [min=0, max=10000]; additional
  constraint: at least one of (requires `isActive`) OR (requires `name`) OR
  (requires `sortOrder`)) OR (PersonalizationGenderUpdate: `expectedUpdatedAt`
  required: string date-time; `isActive` optional: boolean; `isDefault`
  optional: true; `name` optional: string [minLength=1, maxLength=200];
  `sortOrder` optional: integer [min=0, max=10000]; additional constraint: at
  least one of (requires `isActive`) OR (requires `isDefault`) OR (requires
  `name`) OR (requires `sortOrder`)) OR (PersonalizationNameOnlyUpdate:
  `expectedUpdatedAt` required: string date-time; `name` required: string
  [minLength=1, maxLength=200]) OR (PersonalizationRelationshipUpdate:
  `expectedUpdatedAt` required: string date-time; `forwardLabel` optional:
  string [minLength=1, maxLength=200]; `isActive` optional: boolean;
  `reverseLabel` optional: string [minLength=1, maxLength=200]; `sortOrder`
  optional: integer [min=0, max=10000]; additional constraint: at least one of
  (requires `forwardLabel`, `reverseLabel`) OR (requires `isActive`) OR
  (requires `sortOrder`)) OR (PersonalizationReminderUpdate: `expectedUpdatedAt`
  required: string date-time; `daysBefore` optional: integer [min=0, max=3650];
  `isActive` optional: boolean; additional constraint: at least one of (requires
  `daysBefore`) OR (requires `isActive`)).
- Conditional input for relationship types: `forwardLabel` and `reverseLabel`
  must be supplied together whenever either is present, including when
  `isActive` or `sortOrder` is also supplied.
- Success: 200 application/json PersonalizationSaved.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## getMemberPreferences

`GET /api/v1/settings/preferences`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json PreferenceSettings.
- Other documented statuses: 401, 403, 503.

## updateMemberPreferences

`PUT /api/v1/settings/preferences`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): PreferencesInput. PreferencesInput:
  `contactNameOrder` required: enum("given_family_nickname",
  "family_given_nickname"); `contactSortOrder` required: enum("given_name_asc",
  "family_name_asc"); `currencyCode` optional: string
  [pattern="^[A-Z]{3}$"]; `digestTime` optional: string [pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"]
  or null; `fluidLayout` required: boolean; `locale` required: string;
  `measurementSystem` required: enum("metric", "imperial"); `reminderDelivery`
  optional: enum("in_app", "email", "both"); `temperatureScale` required:
  enum("celsius", "fahrenheit"); `timezone` optional: string.
- Success: 200 application/json PreferenceSettings.
- Other documented statuses: 400, 401, 403, 409, 503.

## getSettingsProfile

`GET /api/v1/settings/profile`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json ProfileSettings.
- Other documented statuses: 401, 403, 503.

## updateSettingsProfile

`PUT /api/v1/settings/profile`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): ProfileInput. ProfileInput: `firstName`
  required: string [minLength=1, maxLength=100]; `lastName` required: string
  [maxLength=100].
- Success: 200 application/json ProfileSettings.
- Other documented statuses: 400, 401, 403, 409, 503.

## listMemberSessions

`GET /api/v1/settings/sessions`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json SessionSettings.
- Other documented statuses: 401, 403, 503.

## revokeMemberSession

`DELETE /api/v1/settings/sessions/{sessionId}`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Path parameters: `sessionId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Success: 200 application/json SessionRevoked.
- Other documented statuses: 401, 403, 404, 503.

## getStorageSettings

`GET /api/v1/settings/storage`

- Authority: kinship_session.
- Route source: [files.ts](../../packages/contracts/routes/files.ts).
- Query parameters: `query` optional: string [maxLength=100].
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json StorageSettings.
- Other documented statuses: 400, 401, 403, 503.

## getWorkspaceSettings

`GET /api/v1/settings/workspace`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json WorkspaceSettings.
- Other documented statuses: 401, 403, 503.

## updateWorkspaceSettings

`PUT /api/v1/settings/workspace`

- Authority: kinship_session.
- Route source: [settings.ts](../../packages/contracts/routes/settings.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): WorkspaceSettingsInput.
  WorkspaceSettingsInput: `name` required: string [minLength=1, maxLength=200];
  `slug` optional: string; `defaultLocale` required: string; `defaultTimezone`
  optional: string; `defaultCurrencyCode` optional: string
  [pattern="^[A-Z]{3}$"]; `defaultReminderTime` required: string [pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"].
- Success: 200 application/json WorkspaceSettings.
- Other documented statuses: 400, 401, 403, 409, 503.

## deleteWorkspace

`DELETE /api/v1/settings/workspace-lifecycle`

- Authority: kinship_session.
- Route source:
  [workspace_lifecycle.ts](../../packages/contracts/routes/workspace_lifecycle.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): WorkspaceLifecycleConfirmation.
  WorkspaceLifecycleConfirmation: `confirmation` required: string [minLength=1,
  maxLength=300]; `impactToken` required: string [pattern="^[0-9a-f]{64}$"];
  `password` required: string [minLength=1, maxLength=1024].
- Success: 200 application/json WorkspaceDeleted.
- Other documented statuses: 400, 401, 403, 409, 429, 503.

## getWorkspaceLifecyclePreview

`GET /api/v1/settings/workspace-lifecycle`

- Authority: kinship_session.
- Route source:
  [workspace_lifecycle.ts](../../packages/contracts/routes/workspace_lifecycle.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json WorkspaceLifecyclePreview.
- Other documented statuses: 401, 403, 503.

## resetWorkspace

`POST /api/v1/settings/workspace-lifecycle/reset`

- Authority: kinship_session.
- Route source:
  [workspace_lifecycle.ts](../../packages/contracts/routes/workspace_lifecycle.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): WorkspaceLifecycleConfirmation.
  WorkspaceLifecycleConfirmation: `confirmation` required: string [minLength=1,
  maxLength=300]; `impactToken` required: string [pattern="^[0-9a-f]{64}$"];
  `password` required: string [minLength=1, maxLength=1024].
- Success: 200 application/json WorkspaceReset.
- Other documented statuses: 400, 401, 403, 409, 429, 503.

## signOut

`POST /api/v1/sign-out`

- Authority: kinship_session.
- Route source:
  [authentication.ts](../../packages/contracts/routes/authentication.ts).
- Header parameters: `Origin` required: string uri.
- Success: 200 application/json SignedOut.
- Other documented statuses: 403, 503.

## createStayInTouchCadence

`POST /api/v1/stay-in-touch-cadences`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): CadenceCreateInput. CadenceCreateInput:
  `intervalCount` required: integer [min=1, max=100]; `intervalUnit` required:
  enum("day", "week", "month", "year"); `personId` required: string uuid;
  `requestId` required: string uuid.
- Success: 201 application/json CadenceCreated.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## listTasks

`GET /api/v1/tasks`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Query parameters: `cursor` optional: string [maxLength=2000]; `limit`
  optional: integer [min=1, max=50, default=20]; `personId` optional: string
  uuid; `status` optional: enum("cancelled", "completed", "open").
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json TaskList.
- Other documented statuses: 400, 401, 403, 409, 503.

## createTask

`POST /api/v1/tasks`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): TaskCreateInput. TaskCreateInput:
  `description` optional: string [minLength=1, maxLength=10000, pattern="\\S"];
  `dueAt` optional: string date-time; `personId` optional: string uuid;
  `requestId` required: string uuid; `title` required: string [minLength=1,
  maxLength=500, pattern="\\S"].
- Success: 201 application/json TaskCreated.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## changeTask

`PATCH /api/v1/tasks/{taskId}`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Path parameters: `taskId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): TaskChangeInput. TaskChangeInput:
  `description` optional: string [minLength=1, maxLength=10000, pattern="\\S"]
  or null; `dueAt` optional: string date-time or null; `expectedUpdatedAt`
  required: string date-time; `personId` optional: string uuid or null; `status`
  optional: enum("cancelled", "open"); `title` optional: string [minLength=1,
  maxLength=500, pattern="\\S"].
- Success: 200 application/json TaskChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## setTaskCompletion

`PUT /api/v1/tasks/{taskId}/completion`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Path parameters: `taskId` required: string uuid.
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): TaskCompletionInput. TaskCompletionInput:
  `completed` required: boolean.
- Success: 200 application/json TaskChanged.
- Other documented statuses: 400, 401, 403, 404, 409, 503.

## getTodayAttention

`GET /api/v1/today/attention`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json TodayAttention.
- Other documented statuses: 401, 403, 503.

## getTodayFavoriteNotes

`GET /api/v1/today/favorite-notes`

- Authority: kinship_session.
- Route source:
  [interactions.ts](../../packages/contracts/routes/interactions.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json TodayFavoriteNotes.
- Other documented statuses: 401, 403, 503.

## getTodayRecentActivity

`GET /api/v1/today/recent-activity`

- Authority: kinship_session.
- Route source:
  [interactions.ts](../../packages/contracts/routes/interactions.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json TodayRecentActivity.
- Other documented statuses: 401, 403, 503.

## getTodayRecentPeople

`GET /api/v1/today/recent-people`

- Authority: kinship_session.
- Route source: [people.ts](../../packages/contracts/routes/people.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json TodayRecentPeople.
- Other documented statuses: 401, 403, 503.

## getTodayReminders

`GET /api/v1/today/reminders`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json TodayReminders.
- Other documented statuses: 401, 403, 503.

## getTodayTasks

`GET /api/v1/today/tasks`

- Authority: kinship_session.
- Route source: [planning.ts](../../packages/contracts/routes/planning.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json TodayTasks.
- Other documented statuses: 401, 403, 503.

## createWorkspaceInvitation

`POST /api/v1/workspace-invitations`

- Authority: kinship_session.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `Origin` required: string uri; `X-Workspace-Id` optional:
  string uuid.
- Body (application/json, required): InvitationInput. InvitationInput: `email`
  required: string email [maxLength=254]; `role` required: enum("admin",
  "member").
- Success: 201 application/json object.
- Other documented statuses: 400, 401, 403, 409, 503.

## acceptWorkspaceInvitation

`POST /api/v1/workspace-invitations/accept`

- Authority: kinship_session OR kinship_entry.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, optional): OptionalInvitationToken.
  OptionalInvitationToken: `token` optional: string [minLength=32,
  maxLength=256].
- Success: 200 application/json InvitationAccepted.
- Other documented statuses: 401, 403, 404, 409, 410, 503.

## authenticateWorkspaceInvitation

`POST /api/v1/workspace-invitations/authenticate`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, required): object. `email` required: string email
  [maxLength=254]; `password` required: string [minLength=1, maxLength=128];
  `token` optional: string [minLength=32, maxLength=256].
- Success: 200 application/json object; 202 application/json MfaRequired.
- Other documented statuses: 401, 403, 429, 503.

## inspectWorkspaceInvitation

`POST /api/v1/workspace-invitations/inspect`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, optional): OptionalInvitationToken.
  OptionalInvitationToken: `token` optional: string [minLength=32,
  maxLength=256].
- Success: 200 application/json InvitationInspection.
- Other documented statuses: 403, 404, 410, 503.

## completeWorkspaceInvitationMfa

`POST /api/v1/workspace-invitations/mfa`

- Authority: kinship_mfa AND kinship_invitation.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, required): object. `factor` required: string
  [minLength=6, maxLength=128].
- Success: 200 application/json object.
- Other documented statuses: 401, 403, 410, 429, 503.

## registerInvitedIdentity

`POST /api/v1/workspace-invitations/register`

- Authority: No OpenAPI security scheme; inspect route-specific body or URL
  credentials before treating as anonymous.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `Origin` required: string uri.
- Body (application/json, required): InvitationRegistrationInput.
  InvitationRegistrationInput: `email` required: string email [maxLength=254];
  `firstName` required: string [minLength=1, maxLength=100]; `lastName`
  required: string [maxLength=100]; `password` required: string [minLength=12,
  maxLength=128]; `token` required: string [minLength=32, maxLength=256].
- Success: 202 application/json RegistrationAccepted.
- Other documented statuses: 400, 404, 409, 410, 503.

## retryInvitedVerificationDelivery

`POST /api/v1/workspace-invitations/verification-delivery`

- Authority: kinship_invitation.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `Origin` required: string uri.
- Success: 202 application/json object.
- Other documented statuses: 403, 404, 410, 429, 503.

## listWorkspaceMembers

`GET /api/v1/workspace-members`

- Authority: kinship_session.
- Route source:
  [invitations.ts](../../packages/contracts/routes/invitations.ts).
- Header parameters: `X-Workspace-Id` optional: string uuid.
- Success: 200 application/json WorkspaceMembers.
- Other documented statuses: 401, 403, 503.
