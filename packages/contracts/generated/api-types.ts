export interface paths {
    readonly "/api/v1/application-entry": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Browser-only one-time application entry. Requires the exact Origin header configured for the public web origin and the HttpOnly kinship_entry cookie. The cookie is SameSite=Strict and is Secure outside explicit loopback HTTP development/test use. */
        readonly post: operations["consumeApplicationEntry"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/audit-events": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listWorkspaceAudit"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/calendar-feeds/{feedFile}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description The read-only iCalendar subscription: yearly all-day events for person dates with a known month and day, and the member's reminder days from 30 days back to 365 days ahead, at most 2000 events. It needs no session or cookie; an unknown, revoked, or out-of-scope secret answers 404. */
        readonly get: operations["getCalendarFeedDocument"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/communication-options": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with interactions:create. Returns current capture vocabulary and availability only; no historic content. */
        readonly get: operations["listCommunicationOptions"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/email-verification-deliveries": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Asks for another verification link. Requires the exact Origin header configured for the public web origin. Answers the same whether or not the address has a pending registration. */
        readonly post: operations["retryVerificationDelivery"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/email-verifications": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Verifies an address from its emailed link. Requires the exact Origin header configured for the public web origin. With the registering browser's HttpOnly kinship_registrant cookie it answers `verified` and sets the one-time kinship_entry handoff; without it the address is still verified, but the registrant's password is discarded and it answers `password-required` with the password-reset step to continue at. */
        readonly post: operations["verifyEmail"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/exports": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listExports"];
        readonly put?: never;
        readonly post: operations["createWorkspaceExport"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/exports/{exportId}/download": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["downloadExport"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/exports/{exportId}/downloads": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["createExportDownload"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/imports": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listImports"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/imports/dry-runs": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["createImportDryRun"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/imports/{importId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getImportReport"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/imports/{importId}/commit": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["commitImport"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/imports/{importId}/mapping": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Applies the member's column mapping to a pending CSV import and returns its dry-run report. */
        readonly post: operations["mapImportColumns"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/interaction-options": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with interactions:create. Returns bounded current capture vocabulary and availability only; no historic content. Cursors remain bound to their workspace and search filters. */
        readonly get: operations["listInteractionOptions"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/interactions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Requires a browser session or a personal token with the independent interactions:create grant. Records a note, activity, call, or conversation through its owning use case; grants no historic-content read, edit, or delete access. Reuse body requestId for retries; changed payloads conflict. Bearer requests need no Cookie or Origin. Cookie writes require the exact configured public Origin. */
        readonly post: operations["recordInteraction"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/interactions/activity/{interactionId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Permanently deletes one activity, its participants and emotions, and the journal entry that links it; it leaves the activity report, search, the timeline, and Today. Stay-in-touch cadences it advanced are not moved back. expectedUpdatedAt is the record's updatedAt as last read; a stale revision is refused with 409. There is no undo. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly delete: operations["deleteActivity"];
        readonly options?: never;
        readonly head?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Edits one activity: happenedAt, participantIds (replaces the whole list, every person active in the workspace), summary, activityTypeId, description, and emotionIds (replaces the whole list). Moving it later, or adding people, advances their stay-in-touch cadences as recording it would. Send only the fields to change: an omitted field stays as stored, null clears an optional one, and at least one field is required. expectedUpdatedAt is the record's updatedAt from getActivityReport or listPersonCommunications (or from the create or a previous edit); a stale revision is refused with 409. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly patch: operations["updateActivity"];
        readonly trace?: never;
    };
    readonly "/api/v1/interactions/call/{interactionId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Permanently deletes one call and its emotions; it leaves the person's communications, last-contact date, and timeline. A stay-in-touch cadence it advanced is not moved back. expectedUpdatedAt is the record's updatedAt as last read; a stale revision is refused with 409. There is no undo. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly delete: operations["deleteCall"];
        readonly options?: never;
        readonly head?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Edits one call: calledAt, contactWasCaller, content, and emotionIds (replaces the whole list). Moving it later advances the person's stay-in-touch cadence as recording it would. Send only the fields to change: an omitted field stays as stored, null clears an optional one, and at least one field is required. expectedUpdatedAt is the record's updatedAt from getActivityReport or listPersonCommunications (or from the create or a previous edit); a stale revision is refused with 409. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly patch: operations["updateCall"];
        readonly trace?: never;
    };
    readonly "/api/v1/interactions/conversation/{interactionId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Permanently deletes one conversation and its messages; it leaves the person's communications, last-contact date, and timeline. A stay-in-touch cadence it advanced is not moved back. expectedUpdatedAt is the record's updatedAt as last read; a stale revision is refused with 409. There is no undo. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly delete: operations["deleteConversation"];
        readonly options?: never;
        readonly head?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Edits one conversation: channelTypeId, contactMethodId (one of the person's contact methods on that channel), happenedAt, title, and messages (replaces every message). Moving it later advances the person's stay-in-touch cadence as recording it would. Send only the fields to change: an omitted field stays as stored, null clears an optional one, and at least one field is required. expectedUpdatedAt is the record's updatedAt from getActivityReport or listPersonCommunications (or from the create or a previous edit); a stale revision is refused with 409. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly patch: operations["updateConversation"];
        readonly trace?: never;
    };
    readonly "/api/v1/interactions/note/{interactionId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Permanently deletes one note; it leaves the activity report, search, the person's timeline, and Today's favorite notes. expectedUpdatedAt is the record's updatedAt as last read; a stale revision is refused with 409. There is no undo. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly delete: operations["deleteNote"];
        readonly options?: never;
        readonly head?: never;
        /** @description Requires a browser session or a personal token with interactions:write. Edits one note: body and isFavorited (favorite notes appear on Today). Send only the fields to change: an omitted field stays as stored, null clears an optional one, and at least one field is required. expectedUpdatedAt is the record's updatedAt from getActivityReport or listPersonCommunications (or from the create or a previous edit); a stale revision is refused with 409. A record of an archived person is read-only. Grants no read or capture access. Bearer requests need no Cookie or Origin; cookie writes require the exact configured public Origin. */
        readonly patch: operations["updateNote"];
        readonly trace?: never;
    };
    readonly "/api/v1/journal": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require journal:read. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. Items may carry the content of linked activities. Does not grant writing. */
        readonly get: operations["listJournal"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/journal/activities": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Personal tokens require journal:write. Links an existing activity of the token's workspace to the journal; an activity that is already linked, or is not in the workspace, answers 404. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["linkJournalActivity"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/journal/day-ratings": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** @description Personal tokens require journal:write. Upserts the one workspace-wide rating for its date: an existing rating for that date is replaced, an omitted comment cleared (200), otherwise one is created (201). Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly put: operations["saveJournalDayRating"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/journal/items/{itemId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require journal:read. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. An activity item carries the linked activity's content. Does not grant writing. */
        readonly get: operations["getJournalItem"];
        readonly put?: never;
        readonly post?: never;
        /** @description Personal tokens require journal:write. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. Deleting an activity item removes its journal link, not the activity. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly delete: operations["deleteJournalItem"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/journal/posts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Personal tokens require journal:write. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. Send a client-generated requestId and reuse it when retrying: the same requestId and post return the post it created (201), and the same requestId with a different body, title, or occurredAt is refused (409). A deleted post leaves no record, so a retry after its deletion writes it again. Without a requestId every call creates a new post. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createJournalPost"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/journal/posts/{itemId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** @description Personal tokens require journal:write. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. Replaces the post with the body sent: an omitted title is cleared. Send expectedUpdatedAt, the post's updatedAt as listJournal or getJournalItem returned it, to refuse a concurrent edit: a revision that is no longer current answers 409 and changes nothing. Without expectedUpdatedAt the post is overwritten unchecked. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly put: operations["updateJournalPost"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/legal-acceptances": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["acceptLegalDocument"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/legal-documents/{documentType}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getPublicLegalDocument"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/legal-requirements": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getLegalRequirements"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/mcp": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Model Context Protocol over Streamable HTTP, stateless, for 2025-era (initialize) and 2026-07-28 clients. Accepts any valid personal token in Authorization: Bearer and never reads a session cookie; a missing or refused token answers 401 with WWW-Authenticate: Bearer. tools/list returns only the tools the token's scopes allow, and tools/call sends the tool's own route an in-process request with the same token, so that route's scope, role, workspace, legal, validation, retry, and audit rules apply unchanged. Every answer is one JSON body; there is no session and no server-initiated stream, and GET and DELETE answer 405. */
        readonly post: operations["mcp"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/me": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Accepts any valid personal token and requires no grant. Returns the presented token's id, name, scopes, and optional expiry, and the workspace, member, and current role it acts as. Never reads a session cookie; the optional X-Workspace-Id must match the token's workspace. */
        readonly get: operations["getTokenContext"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/member/ui-state": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getMemberUiState"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch: operations["saveMemberUiState"];
        readonly trace?: never;
    };
    readonly "/api/v1/mfa-challenges": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["completeMfa"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/notifications": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description The signed-in member's notifications in the active workspace, newest first, fifty at a time, with the unread count after their read-through watermark. Marking read saves `notificationsReadThrough` through `PATCH /api/v1/member/ui-state`. */
        readonly get: operations["listNotifications"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/password-reset-requests": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["requestPasswordReset"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/password-resets": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["resetPassword"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Directory only. Personal tokens require the people:read grant; it does not permit person identity, profile facts, dates, relationships, or profile aggregates. */
        readonly get: operations["listPeople"];
        readonly put?: never;
        /** @description Creates a person in the workspace. Personal tokens require the people:write grant. Send a client-generated requestId and reuse it when retrying: the same requestId and names return the person it created (201), and the same requestId with different names, or after that person was deleted, is refused (409). duplicateOverride is not compared, so a create warned as a possible duplicate may be retried with duplicateOverride and the same requestId. Without a requestId every call creates a new person. A name that already exists in the workspace answers a possible duplicate (409) unless the request sets duplicateOverride. */
        readonly post: operations["createPerson"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/bulk": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Archives, restores, tags, or untags up to 100 people. Each person runs through the single-person use case in its own transaction and is answered per person, in request order; only a malformed request, lost access, or a tag outside the workspace refuses the whole request. Personal tokens require the people:write grant. */
        readonly post: operations["bulkPeople"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/bulk/vcard": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description One vCard file of up to 100 selected people, in request order. People missing from the active workspace are skipped and counted in `X-Skipped-Count`. */
        readonly post: operations["exportPeopleVCards"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/duplicates": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Bounded pairs of active people who look like the same person. Personal tokens require the people:merge grant. */
        readonly get: operations["listPeopleDuplicates"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/duplicates/dismissals": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Marks two people from the duplicate review as not duplicates for the whole workspace. Dismissing a dismissed pair changes nothing. Personal tokens require the people:merge grant. */
        readonly post: operations["dismissPeopleDuplicate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/tag-facet": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description The workspace's tags with how many people of the active or archived view carry each, most carried first, at most thirty; `truncated` says more tags are in use. Personal tokens require the people:read grant. */
        readonly get: operations["listPeopleTagFacet"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/tag-options": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Bounded tag options for the directory's tag filter. Personal tokens require the people:read grant. */
        readonly get: operations["listPeopleTagOptions"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getPerson"];
        readonly put?: never;
        readonly post?: never;
        /** @description Deletes a person. The body repeats the exact confirmation phrase of the deletion impact and the person's expectedUpdatedAt; either missing or no longer current is refused. Personal tokens require the people:delete grant, which no other grant implies. */
        readonly delete: operations["deletePerson"];
        readonly options?: never;
        readonly head?: never;
        /** @description Edits a person's identity against the expectedUpdatedAt it was decided from. Personal tokens require the people:write grant. A stale revision is refused (409) and an archived person is read-only. */
        readonly patch: operations["editPerson"];
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/activity-report": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with interactions:read. Returns one person's activities and notes, including their summaries, descriptions, and note bodies, newest first; filter by kind and year and page with the opaque cursor, which stays bound to its workspace, person, and filters. Grants no capture, edit, or delete access. */
        readonly get: operations["getActivityReport"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/archive": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Archives a person against the expectedUpdatedAt it was decided from. Personal tokens require the people:write grant. */
        readonly post: operations["archivePerson"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/audit": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listPersonAudit"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/avatar": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put: operations["replacePersonAvatar"];
        readonly post?: never;
        readonly delete: operations["removePersonAvatar"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/communications": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with interactions:read. Returns one person's calls and conversations, including call content and conversation message text. Grants no capture, edit, or delete access. */
        readonly get: operations["listPersonCommunications"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/dates": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require people:profile:read. Reads important dates, including archived people, preserving stored date precision. */
        readonly get: operations["listImportantDates"];
        readonly put?: never;
        /** @description Personal tokens require people:write. Adds an important date carrying exactly the components its precision declares; a person has at most one birthday, deceased, and first-met date. Archived people are read-only. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createImportantDate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/dates/{dateId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Personal tokens require people:write. Removes an important date at expectedUpdatedAt, the date's updatedAt from listImportantDates. Archived people are read-only. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly delete: operations["deleteImportantDate"];
        readonly options?: never;
        readonly head?: never;
        /** @description Personal tokens require people:write. Replaces an important date at expectedUpdatedAt, the date's updatedAt from listImportantDates. Archived people are read-only. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly patch: operations["updateImportantDate"];
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/debts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Records a debt the person owes or is owed: `amount` is a decimal string and `currencyCode` a three-letter code the workspace supports. A debt created settled may carry a settlement reason and the file id of a settlement photo, which must be an available JPEG, PNG, or WebP photo of this same person in this workspace; a token needs no files scope to reference it. It has no retry key or revision check, so repeating the request records a second debt. An archived person's gifts and debts can be read but refuse this write. */
        readonly post: operations["createDebt"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/debts/{debtId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Permanently removes one debt and its whole settlement history; nothing can restore it. For a recurring charge, its rule, next occurrence, and other charges stay. Ordinary pause/resume does not recreate the removed charge; later explicit schedule changes may charge deleted periods again. An archived person's gifts and debts can be read but refuse this write. */
        readonly delete: operations["deleteDebt"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/debts/{debtId}/settlements": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with gifts:read, which covers both gifts and debts — financial information. Returns one debt's permanent settlement history, newest first: when it was settled, the optional reason, and the optional settlement photo's file id and filename, with whether that photo is still available. Page with the opaque cursor. Grants no write access. */
        readonly get: operations["listDebtSettlements"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/debts/{debtId}/status": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Moves a debt between `open`, `settled`, and `cancelled`: an open debt may be settled or cancelled, a settled debt may reopen, and `cancelled` is terminal. Settling appends to the debt's permanent settlement history and may carry a reason and the file id of a settlement photo, which must be an available JPEG, PNG, or WebP photo of this same person in this workspace; a token needs no files scope to reference it. Asking for the status the debt already has answers `unchanged`. It has no revision check. An archived person's gifts and debts can be read but refuse this write. */
        readonly patch: operations["changeDebtStatus"];
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/deletion-impact": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description What deleting the person removes, and the exact confirmation phrase the deletion must repeat. Personal tokens require the people:delete grant. */
        readonly get: operations["getPersonDeletionImpact"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/facts/{section}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require people:profile:read. Reads one profile-fact section and its lookup options when requested. Hidden sections return no saved records or options; archived people remain readable. Existing person, section, revision, and option-search cursor checks apply. */
        readonly get: operations["listProfileFacts"];
        readonly put?: never;
        /** @description Personal tokens require people:write. Adds a fact to one profile section. first-meeting, food-preferences, and tags hold at most one fact, whose id is the person's id; creating one that exists answers stale, and tags always exists, so it is changed with updateProfileFact. expectedPersonUpdatedAt is the personUpdatedAt that listProfileFacts or the last fact write returned. Hidden sections, archived people, and options that are inactive or outside the workspace are refused. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createProfileFact"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/facts/{section}/{factId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** @description Personal tokens require people:write. Replaces one fact at expectedUpdatedAt, the record's updatedAt; the body's id must be the path's factId. expectedPersonUpdatedAt is the personUpdatedAt that listProfileFacts or the last fact write returned. Hidden sections, archived people, and options that are inactive or outside the workspace are refused. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly put: operations["updateProfileFact"];
        readonly post?: never;
        /** @description Personal tokens require people:write. Removes one fact, or clears first-meeting or food-preferences, at expectedUpdatedAt, the record's updatedAt; tags are cleared with updateProfileFact and an empty tagIds. expectedPersonUpdatedAt is the personUpdatedAt that listProfileFacts or the last fact write returned. Hidden sections and archived people are refused. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly delete: operations["deleteProfileFact"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/files": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require files:read. Lists one person's photos and then documents, a page at a time, with each file's metadata and availability (available, missing, processing, or quarantined); a person's avatar image and removed files are never listed. Does not return file bytes, which only the REST download route serves, and does not grant uploading or removing. */
        readonly get: operations["listPersonFiles"];
        readonly put?: never;
        /** @description Personal tokens require files:write. Stores one document or photo for a person from the raw request body, whose Content-Type must be one of the listed media types, up to 10485760 bytes; the kind travels in X-File-Kind and the percent-encoded filename and title in X-File-Name and X-File-Title. A token without files:write is refused before the body is read. Does not grant listing or downloading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["uploadPersonFile"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/files/{fileId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Personal tokens require files:write. Removes one of the person's documents or photos: its stored bytes and its link to the person are deleted and its metadata is kept as deleted, so it stops being listed or downloadable. There is no revision check; a file still being processed answers 409, and an avatar image, a file of another person, or a file of an archived person answers 404. A gift that links the file keeps its attachmentFileId, and a debt settlement whose photo it was reports that photo as unavailable. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly delete: operations["removePersonFile"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/files/{fileId}/content": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require files:read. Answers the file's bytes as an attachment, with its stored media type, length, and filename, and records the read of a document or photo in the audit history; it also serves the person's avatar image, unrecorded. A removed file, or a file of another person, answers 404; one whose stored bytes are missing answers 410, one still being processed 409, and a quarantined one 423. Does not grant uploading or removing. */
        readonly get: operations["downloadPersonFile"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/gifts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with gifts:read, which covers both gifts and debts — financial information. Returns one person's gifts, debts, and recurring debts: amounts are decimal strings with a three-letter currency code, and the answer names the default and supported currencies. Gifts and debts page independently with their own opaque cursors. An archived person's records stay readable. Grants no write access. */
        readonly get: operations["listPersonGiftsAndDebts"];
        readonly put?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Records a gift idea, plan, or exchange: an optional `amount` is a decimal string with a three-letter `currencyCode` the workspace supports. A recipient person id must name a live person of this workspace. An attachment file id must name an available file of this workspace that is not a person's avatar; a token needs no files scope to reference it. It has no retry key or revision check, so repeating the request records a second gift. An archived person's gifts and debts can be read but refuse this write. */
        readonly post: operations["createGift"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/gifts/{giftId}/status": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Moves a gift along its transition graph: an idea may become planned, given, or received; a planned gift may be given or received; any gift may be archived; and `archived` is terminal. A move the graph does not allow answers 409, and asking for the status the gift already has answers `unchanged`. It has no revision check. An archived person's gifts and debts can be read but refuse this write. */
        readonly patch: operations["changeGiftStatus"];
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/identity": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Minimal person name and identifier, including archived people. Personal tokens require people:profile:read. Returns no profile aggregate, notes, timeline, tasks, or file data. */
        readonly get: operations["getPersonIdentity"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/life-events": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require people:profile:read. Reads at most 100 precision-aware life events of a person in the active workspace, archived people included, with the workspace's life-event types. A hidden section returns no saved events. */
        readonly get: operations["listPersonLifeEvents"];
        readonly put?: never;
        /** @description Personal tokens require people:write. Records a life event on a person of the token's workspace; a retry records a second one. Does not grant reading life events. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createPersonLifeEvent"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/life-events/{lifeEventId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Personal tokens require people:write. Removes the life event when expectedUpdatedAt still matches its revision; a stale revision is refused with 409. Does not grant reading life events. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly delete: operations["deletePersonLifeEvent"];
        readonly options?: never;
        readonly head?: never;
        /** @description Personal tokens require people:write. Replaces the life event when expectedUpdatedAt still matches its revision; a stale revision is refused with 409. Does not grant reading life events. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly patch: operations["updatePersonLifeEvent"];
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/recurring-debts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Creates a rule that charges the person the same debt every period. Every period already due in the workspace's calendar is charged at once, one open debt per period. `amount` is a decimal string and `currencyCode` a three-letter code the workspace supports. It has no retry key or revision check, so repeating the request creates a second rule, and charges its due periods again. An archived person's gifts and debts can be read but refuse this write. */
        readonly post: operations["createRecurringDebt"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/recurring-debts/{recurringDebtId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Deletes a recurring debt. The debts it already charged stay, each settled or cancelled on its own. An archived person's gifts and debts can be read but refuse this write. */
        readonly delete: operations["deleteRecurringDebt"];
        readonly options?: never;
        readonly head?: never;
        /** @description Requires a browser session or a personal token with gifts:write. Changes, pauses, or resumes a recurring debt. A period already charged is never charged again; resuming skips the periods that passed while it was paused. A change that leaves due periods uncharged charges them at once. It has no revision check. An archived person's gifts and debts can be read but refuse this write. */
        readonly patch: operations["updateRecurringDebt"];
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/relationships": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require relationships:read. Returns one person's directional relationships and authorized endpoint names in the bound workspace, including archived people. Hidden sections return no relationships; existing cursor checks apply. */
        readonly get: operations["listRelationships"];
        readonly put?: never;
        /** @description Personal tokens require relationships:write. Links two active people of the bound workspace with a relationship type of that workspace. One stored edge supplies both directions, so never create the reverse edge as well; creating an edge that already exists answers the existing one with 200 rather than a duplicate. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createRelationship"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/relationships/related-person": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["createRelatedPersonRelationship"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/relationships/{relationshipId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Personal tokens require relationships:write. Unlinks one relationship between two active people of the bound workspace without deleting either person; the JSON body must carry the edge's expectedUpdatedAt, and a stale one conflicts. Removing the one stored edge removes both directions. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly delete: operations["deleteRelationship"];
        readonly options?: never;
        readonly head?: never;
        /** @description Personal tokens require relationships:write. Changes only the relationship type of one edge between two active people of the bound workspace, using the edge's expectedUpdatedAt; a stale one conflicts. One stored edge supplies both directions. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly patch: operations["updateRelationship"];
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/reminders": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require reminders:read. Lists one person's calendar reminders, each with its next occurrence, and the person's stay-in-touch cadence, a page at a time. A person outside the token's workspace is not found. Grants are independent; reminders:write does not imply read access. */
        readonly get: operations["listPersonReminders"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/restore": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Restores an archived person against the expectedUpdatedAt it was decided from. Personal tokens require the people:write grant. */
        readonly post: operations["restorePerson"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/star": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** @description Stars the person for the whole workspace. Starring a starred person changes nothing, and an archived person's star is read-only. Personal tokens require the people:write grant. */
        readonly put: operations["starPerson"];
        readonly post?: never;
        /** @description Removes the person's workspace star. An unstarred person is unchanged, and an archived person's star is read-only. Personal tokens require the people:write grant. */
        readonly delete: operations["unstarPerson"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/timeline": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listPersonTimeline"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/vcard": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["exportPersonVCard"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{personId}/view": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["recordPersonView"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{primaryId}/merge": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Merges the duplicate into the primary; a merge cannot be undone. The body quotes the preview's conflictsDigest, both people's revisions, and confirmed: true; any of them no longer current is refused. Personal tokens require the people:merge grant, which no other grant implies. */
        readonly post: operations["mergePeople"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/people/{primaryId}/merge-preview": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description What merging the duplicate into the primary would keep, discard, and move, with both people's revisions and the conflictsDigest the merge must quote. Personal tokens require the people:merge grant. */
        readonly get: operations["previewPeopleMerge"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/registrations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Registers a first workspace. Requires the exact Origin header configured for the public web origin. Answers the same 202 whether or not the address already has an account, and sets the HttpOnly kinship_registrant cookie that a verification from the same browser presents. */
        readonly post: operations["createFirstWorkspace"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/relationship-types": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require relationships:read. Reads the bound workspace's relationship types and resolves selected same-workspace types. Hidden relationship sections return no options; existing cursor and search bounds apply. */
        readonly get: operations["listRelationshipTypes"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/reminder-occurrences/{occurrenceId}/acknowledgement": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** @description Clears the signed-in member's own undelivered reminder (failed or needing attention) from Today, with the other undelivered channel of the same occurrence. It is never resent; acknowledging it again changes nothing. */
        readonly put: operations["acknowledgeReminderOccurrence"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/reminders": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Personal tokens require reminders:write. Creates a calendar reminder for one person and schedules its future occurrences. Retry the same requestId and payload to receive the original reminder, so the call is retry-safe; a changed payload under the same requestId conflicts. Archived people are read-only. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createReminder"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/reminders/{reminderId}/active": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** @description Personal tokens require reminders:write. Disables or re-enables one reminder with active false or true; setting the current state again changes nothing. Disabling cancels its unattempted future occurrences and re-enabling regenerates them. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly put: operations["setReminderActive"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/search": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Searches the active workspace's people, notes, activities, journal posts, and tasks, each group bounded and filtered by the rules its owning module lists rows with. People are answered first; when the text groups cannot be, each is marked unavailable and the people still answer. A blank query answers the member's recently viewed people, archived ones included, in the people group, and every other group empty. Personal tokens require the search:read grant, which deliberately returns results from several areas (people, notes, activities, journal posts, and tasks) and permits no other read. */
        readonly get: operations["searchWorkspace"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/session": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getSession"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/sessions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["signIn"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/api-tokens": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getApiTokens"];
        readonly put?: never;
        readonly post: operations["createApiToken"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/api-tokens/{tokenId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete: operations["revokeApiToken"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/calendar-feed": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getCalendarFeed"];
        readonly put?: never;
        readonly post: operations["createCalendarFeed"];
        readonly delete: operations["revokeCalendarFeed"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/calendar-feed/rotation": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["rotateCalendarFeed"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/integrations/dav": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getDavSubscriptions"];
        readonly put?: never;
        readonly post: operations["createDavSubscription"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/integrations/dav/{subscriptionId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete: operations["disableDavSubscription"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/integrations/dav/{subscriptionId}/sync": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["synchronizeDavSubscription"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/members": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listManagedMembers"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/members/{memberId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch: operations["updateManagedMember"];
        readonly trace?: never;
    };
    readonly "/api/v1/settings/personal-lifecycle": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getPersonalLifecyclePreview"];
        readonly put?: never;
        readonly post?: never;
        readonly delete: operations["deletePersonalIdentity"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/personal-lifecycle/leave": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["leaveCurrentWorkspace"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/personalization/{section}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require vocabularies:read. Lists one section's entries with their ids, for use wherever a record names a type, label, tag, or rule: profile-modules, gender-options, contact-method-types, contact-labels, activity-types, emotion-options, life-event-types, relationship-types, pet-categories, reminder-rules, or tags. These are administrative vocabularies: the token's issuer must currently be an owner or admin of the token's workspace, and is otherwise forbidden. The section's capabilities say whether it takes new entries; each entry's capabilities and referenceCount say whether it may be renamed, reordered, disabled (archived), made the default, deleted, or deleted only with a replacement. emotion-options and pet-categories are read-only. Grants are independent; vocabularies:write does not imply read access. */
        readonly get: operations["listPersonalizationEntries"];
        readonly put?: never;
        /** @description Personal tokens require vocabularies:write. Adds an entry to one section; the body differs by section: tags and contact-labels take name; relationship-types take forwardLabel and reverseLabel; reminder-rules take daysBefore; contact-method-types take name and an optional contactKind; the other sections take name and an optional sortOrder. emotion-options and pet-categories take no new entries. A name already used in the section conflicts. These are administrative vocabularies: the token's issuer must currently be an owner or admin of the token's workspace, and is otherwise forbidden. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createPersonalizationEntry"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/personalization/{section}/{id}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Personal tokens require vocabularies:write. Deletes one entry; send expectedUpdatedAt, and an optional replacementId, in the query string. While records still refer to the entry, the answer is replacement required with the count, and the delete succeeds only with a replacementId of another entry of the same section in the same workspace, to which those records move. Required or seeded entries cannot be deleted. These are administrative vocabularies: the token's issuer must currently be an owner or admin of the token's workspace, and is otherwise forbidden. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly delete: operations["deletePersonalizationEntry"];
        readonly options?: never;
        readonly head?: never;
        /** @description Personal tokens require vocabularies:write. Changes one entry; send expectedUpdatedAt from the entry as last read, and a stale revision conflicts. The fields differ by section and are allowed only where the entry's capabilities say so: a name or labels, sortOrder, daysBefore, contactKind, isActive to disable (archive) or re-enable it, and isDefault to make it the default. These are administrative vocabularies: the token's issuer must currently be an owner or admin of the token's workspace, and is otherwise forbidden. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly patch: operations["updatePersonalizationEntry"];
        readonly trace?: never;
    };
    readonly "/api/v1/settings/preferences": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getMemberPreferences"];
        readonly put: operations["updateMemberPreferences"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/profile": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getSettingsProfile"];
        readonly put: operations["updateSettingsProfile"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/sessions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listMemberSessions"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/sessions/{sessionId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete: operations["revokeMemberSession"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/storage": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getStorageSettings"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/workspace": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getWorkspaceSettings"];
        readonly put: operations["updateWorkspaceSettings"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/workspace-lifecycle": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getWorkspaceLifecyclePreview"];
        readonly put?: never;
        readonly post?: never;
        readonly delete: operations["deleteWorkspace"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/settings/workspace-lifecycle/reset": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["resetWorkspace"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/sign-out": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["signOut"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/stay-in-touch-cadences": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Personal tokens require reminders:write. Sets how often to stay in touch with one person. A person has one cadence, so calling this again with a new requestId replaces it and restarts its due date. Retry the same requestId and payload to receive the original answer, so the call is retry-safe; a changed payload under the same requestId conflicts. Archived people are read-only. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createStayInTouchCadence"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/tasks": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require tasks:read. Lists tasks in the active workspace, optionally filtered by personId, status, and dueBefore (inclusive ISO instant). Continuation cursors are bound to the workspace and all filters; changing a filter requires a new first page. Grants are independent; create and write grants do not imply read access. */
        readonly get: operations["listTasks"];
        readonly put?: never;
        /** @description Personal tokens require tasks:create. Retry the same requestId and payload to receive the original task; a changed payload conflicts. Does not grant listing, detail, or editing. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly post: operations["createTask"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/tasks/{taskId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require tasks:read. Reads one task through planning's public use case with current membership and workspace validation, including its archived or unavailable linked-person projection. */
        readonly get: operations["getTask"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        /** @description Personal tokens require tasks:write. Edits an existing task using expectedUpdatedAt; nullable fields may be explicitly cleared. Archived linked people remain read-only. Does not grant read or create access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly patch: operations["changeTask"];
        readonly trace?: never;
    };
    readonly "/api/v1/tasks/{taskId}/completion": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** @description Personal tokens require tasks:write. Completes or reopens an existing task idempotently with completed true or false. Archived linked people remain read-only. Does not grant read or create access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin. */
        readonly put: operations["setTaskCompletion"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/today/attention": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require today:read. A read-only dashboard projection in the member's time zone: overdue, today, and next-seven-days groups plus an upcoming list of open tasks, undelivered or failing reminders, important dates, life events, and stay-in-touch cadences, each with its person. today:read is a deliberate Today grant: it reads these items here without tasks:read, reminders:read, or people grants, and grants no other route. */
        readonly get: operations["getTodayAttention"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/today/favorite-notes": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with today:read. A dashboard projection across people: returns the workspace's favorite notes, including their bodies and the people they are about. */
        readonly get: operations["getTodayFavoriteNotes"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/today/recent-activity": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Requires a browser session or a personal token with today:read. A dashboard projection across people: returns recent notes and activities, including their content and participants. */
        readonly get: operations["getTodayRecentActivity"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/today/recent-people": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description The people the member recently viewed, newest first. Personal tokens require the today:read grant and answer the token's own member's views. */
        readonly get: operations["getTodayRecentPeople"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/today/reminders": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require today:read. A read-only dashboard projection: reminder occurrences that are due within thirty days, being retried, failed, or need attention, recently sent ones, and stay-in-touch cadences due within thirty days, each with its person. today:read is a deliberate Today grant: it reads these items here without reminders:read, and grants no other route. */
        readonly get: operations["getTodayReminders"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/today/tasks": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** @description Personal tokens require today:read. A read-only dashboard projection: up to twenty open tasks due within thirty days, overdue ones included, earliest first. today:read is a deliberate Today grant: it reads these tasks here without tasks:read, and grants no other route. */
        readonly get: operations["getTodayTasks"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["createWorkspaceInvitation"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations/accept": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Atomically consumes a single-use invitation for the authenticated intended user. */
        readonly post: operations["acceptWorkspaceInvitation"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations/authenticate": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Runs the equalized password challenge for the verified identity matching a pending invitation, without creating a normal workspace session. */
        readonly post: operations["authenticateWorkspaceInvitation"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations/inspect": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Inspects an invitation using a bearer token in the request body so gateway logs never contain it. */
        readonly post: operations["inspectWorkspaceInvitation"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations/mfa": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Completes the equalized MFA challenge for the identity matching the scoped pending invitation. */
        readonly post: operations["completeWorkspaceInvitationMfa"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations/register": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Creates a pending identity for an invitation without creating another workspace. */
        readonly post: operations["registerInvitedIdentity"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations/verification-delivery": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** @description Retries verification delivery only for the identity bound to the scoped pending invitation cookie. */
        readonly post: operations["retryInvitedVerificationDelivery"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-invitations/{invitationId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** @description Revokes a pending invitation of the active workspace so its link no longer works. Owners and admins only. */
        readonly delete: operations["revokeWorkspaceInvitation"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/workspace-members": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listWorkspaceMembers"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        readonly ActivityChangeInput: {
            readonly activityTypeId?: string | null;
            readonly description?: string | null;
            readonly emotionIds?: readonly string[];
            /**
             * Format: date-time
             * @description The updatedAt the client last read for this record; a changed record answers 409.
             */
            readonly expectedUpdatedAt: string;
            /** Format: date-time */
            readonly happenedAt?: string;
            readonly participantIds?: readonly string[];
            readonly summary?: string;
        };
        readonly ActivityInteraction: {
            readonly activityType?: string;
            /** Format: date-time */
            readonly createdAt?: string;
            readonly description?: string;
            readonly emotions: readonly components["schemas"]["InteractionOption"][];
            /** Format: date-time */
            readonly happenedAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "activity";
            readonly participants: readonly components["schemas"]["InteractionParticipant"][];
            readonly summary: string;
            /**
             * Format: date-time
             * @description The record's revision; send it back as expectedUpdatedAt to edit or delete it.
             */
            readonly updatedAt?: string;
        };
        readonly ActivityInteractionInput: {
            /** Format: uuid */
            readonly activityTypeId?: string;
            readonly description?: string;
            readonly emotionIds?: readonly string[];
            /** Format: date-time */
            readonly happenedAt: string;
            /** @constant */
            readonly kind: "activity";
            readonly participantIds: readonly string[];
            /**
             * Format: uuid
             * @description Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.
             */
            readonly requestId: string;
            readonly summary: string;
        };
        readonly ActivityOrNoteInteraction: components["schemas"]["ActivityInteraction"] | components["schemas"]["NoteInteraction"];
        readonly ActivityReport: {
            readonly items: readonly components["schemas"]["ActivityOrNoteInteraction"][];
            readonly nextCursor?: string;
            readonly person: components["schemas"]["InteractionParticipant"];
            /** @enum {string} */
            readonly status: "archived" | "ready";
        };
        readonly AddressFact: {
            readonly city?: string;
            readonly country?: string;
            readonly displayName?: string;
            readonly isPrimary: boolean;
            readonly labelIds: readonly string[];
            readonly postalCode?: string;
            readonly region?: string;
            readonly street?: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "addresses";
        };
        readonly AddressFactCreateInput: {
            readonly city?: string;
            readonly country?: string;
            readonly displayName?: string;
            readonly isPrimary: boolean;
            readonly labelIds: readonly string[];
            readonly postalCode?: string;
            readonly region?: string;
            readonly street?: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "addresses";
        } | {
            readonly city: string;
        } | {
            readonly country: string;
        } | {
            readonly displayName: string;
        } | {
            readonly postalCode: string;
        } | {
            readonly region: string;
        } | {
            readonly street: string;
        };
        readonly AddressFactUpdateInput: {
            readonly city?: string;
            readonly country?: string;
            readonly displayName?: string;
            readonly isPrimary: boolean;
            readonly labelIds: readonly string[];
            readonly postalCode?: string;
            readonly region?: string;
            readonly street?: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "addresses";
        } | {
            readonly city: string;
        } | {
            readonly country: string;
        } | {
            readonly displayName: string;
        } | {
            readonly postalCode: string;
        } | {
            readonly region: string;
        } | {
            readonly street: string;
        };
        readonly ApiTokenContext: {
            /** Format: uuid */
            readonly memberId: string;
            /** @enum {string} */
            readonly role: "owner" | "admin" | "member";
            readonly token: {
                /** Format: date-time */
                readonly expiresAt?: string;
                /** Format: uuid */
                readonly id: string;
                readonly name: string;
                readonly scopes: readonly ("people:read" | "people:profile:read" | "relationships:read" | "tasks:read" | "tasks:create" | "tasks:write" | "interactions:create" | "people:write" | "people:delete" | "people:merge" | "relationships:write" | "interactions:read" | "interactions:write" | "reminders:read" | "reminders:write" | "journal:read" | "journal:write" | "gifts:read" | "gifts:write" | "files:read" | "files:write" | "search:read" | "today:read" | "vocabularies:read" | "vocabularies:write")[];
            };
            /** Format: uuid */
            readonly workspaceId: string;
        };
        readonly ApiTokenCreateInput: {
            /** Format: date-time */
            readonly expiresAt?: string;
            readonly name: string;
            readonly scopes: readonly ("people:read" | "people:profile:read" | "relationships:read" | "tasks:read" | "tasks:create" | "tasks:write" | "interactions:create" | "people:write" | "people:delete" | "people:merge" | "relationships:write" | "interactions:read" | "interactions:write" | "reminders:read" | "reminders:write" | "journal:read" | "journal:write" | "gifts:read" | "gifts:write" | "files:read" | "files:write" | "search:read" | "today:read" | "vocabularies:read" | "vocabularies:write")[];
        };
        readonly ApiTokenCreated: {
            readonly record: components["schemas"]["ApiTokenRecord"];
            readonly secret: string;
            /** @constant */
            readonly status: "created";
        };
        readonly ApiTokenList: {
            readonly records: readonly components["schemas"]["ApiTokenListEntry"][];
            readonly scopes: readonly ("people:read" | "people:profile:read" | "relationships:read" | "tasks:read" | "tasks:create" | "tasks:write" | "interactions:create" | "people:write" | "people:delete" | "people:merge" | "relationships:write" | "interactions:read" | "interactions:write" | "reminders:read" | "reminders:write" | "journal:read" | "journal:write" | "gifts:read" | "gifts:write" | "files:read" | "files:write" | "search:read" | "today:read" | "vocabularies:read" | "vocabularies:write")[];
            /** @constant */
            readonly status: "ready";
        };
        readonly ApiTokenListEntry: {
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: date-time */
            readonly expiresAt?: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly lastUsedAt?: string;
            readonly name: string;
            /** Format: date-time */
            readonly revokedAt?: string;
            readonly scopes: readonly ("people:read" | "people:profile:read" | "relationships:read" | "tasks:read" | "tasks:create" | "tasks:write" | "interactions:create" | "people:write" | "people:delete" | "people:merge" | "relationships:write" | "interactions:read" | "interactions:write" | "reminders:read" | "reminders:write" | "journal:read" | "journal:write" | "gifts:read" | "gifts:write" | "files:read" | "files:write" | "search:read" | "today:read" | "vocabularies:read" | "vocabularies:write")[];
            readonly issuer: {
                readonly email: string;
                readonly name: string;
            };
        };
        readonly ApiTokenRecord: {
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: date-time */
            readonly expiresAt?: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly lastUsedAt?: string;
            readonly name: string;
            /** Format: date-time */
            readonly revokedAt?: string;
            readonly scopes: readonly ("people:read" | "people:profile:read" | "relationships:read" | "tasks:read" | "tasks:create" | "tasks:write" | "interactions:create" | "people:write" | "people:delete" | "people:merge" | "relationships:write" | "interactions:read" | "interactions:write" | "reminders:read" | "reminders:write" | "journal:read" | "journal:write" | "gifts:read" | "gifts:write" | "files:read" | "files:write" | "search:read" | "today:read" | "vocabularies:read" | "vocabularies:write")[];
        };
        readonly ApiTokenRevoked: {
            readonly record: components["schemas"]["ApiTokenRecord"];
            /** @constant */
            readonly status: "revoked";
        };
        readonly ApplicationEntry: {
            /** @constant */
            readonly status: "ready";
            readonly workspace: {
                /** Format: uuid */
                readonly id: string;
                readonly name: string;
            };
            readonly member: {
                /** Format: uuid */
                readonly id: string;
                readonly firstName: string;
            };
        };
        readonly AuditDateDetail: {
            readonly isYearApproximate: boolean;
            /** @enum {string} */
            readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
        };
        readonly AuditEvent: {
            readonly action: string;
            readonly actor: {
                /** Format: uuid */
                readonly id?: string;
                readonly name: string;
            };
            readonly details: {
                /** @enum {string} */
                readonly action?: "changed" | "completed" | "create" | "created" | "delete" | "reopened" | "save" | "update";
                readonly current?: boolean;
                readonly from?: components["schemas"]["AuditTransitionDetail"];
                /** Format: uuid */
                readonly fromPersonId?: string;
                readonly isPartial?: boolean;
                /** @enum {string} */
                readonly kind?: "activity" | "call" | "conversation" | "note";
                readonly participantIds?: readonly string[];
                /** Format: uuid */
                readonly personId?: string;
                /** Format: uuid */
                readonly relationshipTypeId?: string;
                /** @enum {string} */
                readonly role?: "admin" | "member" | "owner";
                /** @enum {string} */
                readonly section?: "activity-types" | "addresses" | "contact-labels" | "contact-method-types" | "contact-methods" | "emotion-options" | "first-meeting" | "food-preferences" | "gender-options" | "identity-summary" | "life-event-types" | "pet-categories" | "pets" | "profile-modules" | "relationship-types" | "reminder-rules" | "security" | "tags" | "work";
                /** @enum {string} */
                readonly status?: "active" | "cancelled" | "completed" | "open" | "suspended";
                readonly to?: components["schemas"]["AuditTransitionDetail"];
                /** Format: uuid */
                readonly toPersonId?: string;
            };
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly occurredAt: string;
            readonly person?: components["schemas"]["InteractionParticipant"];
            readonly redacted: boolean;
            readonly subject: {
                /** Format: uuid */
                readonly id?: string;
                readonly type?: string;
            };
        };
        readonly AuditHistory: {
            readonly items: readonly components["schemas"]["AuditEvent"][];
            readonly nextCursor?: string;
            readonly person?: components["schemas"]["InteractionParticipant"];
            /** @enum {string} */
            readonly status: "archived" | "ready";
        };
        readonly AuditTransitionDetail: null | ("active" | "archived" | "deleted") | components["schemas"]["AuditDateDetail"];
        readonly Authenticated: {
            /** @constant */
            readonly status: "authenticated";
            /** @constant */
            readonly next: "/app";
            readonly workspace: components["schemas"]["AuthenticatedWorkspace"];
            readonly member: components["schemas"]["AuthenticatedMember"];
        };
        readonly AuthenticatedMember: {
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly role: "owner" | "admin" | "member";
        };
        readonly AuthenticatedWorkspace: {
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly BlockingWorkspace: {
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly CadenceCreateInput: {
            readonly intervalCount: number;
            /** @enum {string} */
            readonly intervalUnit: "day" | "week" | "month" | "year";
            /** Format: uuid */
            readonly personId: string;
            /** Format: uuid */
            readonly requestId: string;
        };
        readonly CadenceCreated: {
            readonly cadence: components["schemas"]["StayInTouchCadence"];
            /** @constant */
            readonly status: "created";
        };
        readonly CalendarFeed: {
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: date-time */
            readonly lastUsedAt?: string;
        };
        readonly CalendarFeedIssued: {
            readonly feed: components["schemas"]["CalendarFeed"];
            /** @enum {string} */
            readonly status: "created" | "rotated";
            /**
             * Format: uri
             * @description The subscription URL, shown once. Anyone holding it can read the feed until it is rotated or revoked.
             */
            readonly url: string;
        };
        readonly CalendarFeedRevoked: {
            /** @constant */
            readonly status: "revoked";
        };
        readonly CalendarFeedStatus: {
            readonly feed?: components["schemas"]["CalendarFeed"];
            /** @constant */
            readonly status: "ready";
        };
        readonly CallChangeInput: {
            /** Format: date-time */
            readonly calledAt?: string;
            readonly contactWasCaller?: boolean;
            readonly content?: string | null;
            readonly emotionIds?: readonly string[];
            /**
             * Format: date-time
             * @description The updatedAt the client last read for this record; a changed record answers 409.
             */
            readonly expectedUpdatedAt: string;
        };
        readonly CallInteraction: {
            /** Format: date-time */
            readonly calledAt: string;
            readonly contactWasCaller: boolean;
            readonly content?: string;
            /** Format: date-time */
            readonly createdAt: string;
            readonly emotions: readonly components["schemas"]["InteractionOption"][];
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "call";
            readonly person: components["schemas"]["InteractionParticipant"];
            /**
             * Format: date-time
             * @description The record's revision; send it back as expectedUpdatedAt to edit or delete it.
             */
            readonly updatedAt?: string;
        };
        readonly CallInteractionInput: {
            /** Format: date-time */
            readonly calledAt: string;
            readonly contactWasCaller: boolean;
            readonly content?: string;
            readonly emotionIds?: readonly string[];
            /** @constant */
            readonly kind: "call";
            /** Format: uuid */
            readonly personId: string;
            /**
             * Format: uuid
             * @description Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.
             */
            readonly requestId: string;
        };
        readonly CommunicationList: {
            readonly items: readonly (components["schemas"]["CallInteraction"] | components["schemas"]["ConversationInteraction"])[];
            /** @constant */
            readonly status: "ready";
        };
        readonly CommunicationMessage: {
            readonly content: string;
            /** @enum {string} */
            readonly direction: "inbound" | "outbound";
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly writtenAt: string;
        };
        readonly CommunicationOptions: {
            readonly availability: {
                readonly call: boolean;
                readonly conversation: boolean;
            };
            readonly channelTypes: readonly components["schemas"]["InteractionOption"][];
            readonly emotions: readonly components["schemas"]["InteractionOption"][];
            /** @constant */
            readonly status: "ready";
        };
        readonly ContactMethodFact: {
            readonly isPrimary: boolean;
            readonly labelIds: readonly string[];
            readonly notes?: string;
            /** Format: uuid */
            readonly typeId: string;
            readonly value: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "contact-methods";
        };
        readonly ContactMethodFactCreateInput: {
            readonly isPrimary: boolean;
            readonly labelIds: readonly string[];
            readonly notes?: string;
            /** Format: uuid */
            readonly typeId: string;
            readonly value: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "contact-methods";
        };
        readonly ContactMethodFactUpdateInput: {
            readonly isPrimary: boolean;
            readonly labelIds: readonly string[];
            readonly notes?: string;
            /** Format: uuid */
            readonly typeId: string;
            readonly value: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "contact-methods";
        };
        /** @enum {string} */
        readonly ContactMethodKind: "email" | "phone" | "url" | "social" | "im" | "username" | "custom";
        readonly ConversationChangeInput: {
            /** Format: uuid */
            readonly channelTypeId?: string;
            readonly contactMethodId?: string | null;
            /**
             * Format: date-time
             * @description The updatedAt the client last read for this record; a changed record answers 409.
             */
            readonly expectedUpdatedAt: string;
            /** Format: date-time */
            readonly happenedAt?: string;
            /** @description Replaces every message of the conversation; an empty list removes them all. */
            readonly messages?: readonly {
                readonly content: string;
                /** @enum {string} */
                readonly direction: "inbound" | "outbound";
                /** Format: date-time */
                readonly writtenAt: string;
            }[];
            readonly title?: string | null;
        };
        readonly ConversationInteraction: {
            readonly channelType?: components["schemas"]["InteractionOption"];
            readonly contactMethod?: {
                /** Format: uuid */
                readonly id: string;
                readonly value: string;
            };
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: date-time */
            readonly happenedAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "conversation";
            readonly messages: readonly components["schemas"]["CommunicationMessage"][];
            readonly person: components["schemas"]["InteractionParticipant"];
            readonly title?: string;
            /**
             * Format: date-time
             * @description The record's revision; send it back as expectedUpdatedAt to edit or delete it.
             */
            readonly updatedAt?: string;
        };
        readonly ConversationInteractionInput: {
            /** Format: uuid */
            readonly channelTypeId: string;
            /** Format: uuid */
            readonly contactMethodId?: string;
            /** Format: date-time */
            readonly happenedAt: string;
            /** @constant */
            readonly kind: "conversation";
            readonly messages?: readonly {
                readonly content: string;
                /** @enum {string} */
                readonly direction: "inbound" | "outbound";
                /** Format: date-time */
                readonly writtenAt: string;
            }[];
            /** Format: uuid */
            readonly personId: string;
            /**
             * Format: uuid
             * @description Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.
             */
            readonly requestId: string;
            readonly title?: string;
        };
        readonly CsvColumnMapping: {
            readonly columns: readonly components["schemas"]["CsvColumnTarget"][];
        };
        /** @enum {string} */
        readonly CsvColumnTarget: "ignore" | "givenName" | "familyName" | "middleName" | "nickname" | "email" | "phone" | "street" | "city" | "region" | "postalCode" | "country" | "birthday" | "note" | "company" | "jobTitle";
        readonly CsvPreview: {
            /** @enum {string} */
            readonly delimiter: "," | ";";
            readonly headers: readonly string[];
            readonly rowCount: number;
            readonly rows: readonly (readonly string[])[];
            readonly suggested: readonly components["schemas"]["CsvColumnTarget"][];
        };
        readonly DavSubscription: {
            /** Format: uuid */
            readonly id: string;
            readonly isActive: boolean;
            readonly lastError?: string;
            /** @enum {string} */
            readonly lastOutcome: "auth-failure" | "conflict" | "never" | "partial" | "success";
            /** Format: date-time */
            readonly lastSyncedAt?: string;
            readonly name: string;
            readonly remoteSyncToken?: string;
            /** Format: uri */
            readonly remoteUrl: string;
            readonly username?: string;
        };
        readonly DavSubscriptionConfigured: {
            /** @constant */
            readonly status: "configured";
            readonly subscription: components["schemas"]["DavSubscription"];
        };
        readonly DavSubscriptionDisabled: {
            /** @constant */
            readonly status: "disabled";
            readonly subscription: components["schemas"]["DavSubscription"];
        };
        readonly DavSubscriptionInput: {
            readonly name: string;
            readonly password: string;
            /** Format: uri */
            readonly remoteUrl: string;
            readonly username?: string;
        };
        readonly DavSubscriptionList: {
            /** @constant */
            readonly status: "ready";
            readonly subscriptions: readonly components["schemas"]["DavSubscription"][];
        };
        readonly DavSyncResult: {
            readonly processed?: number;
            /** @enum {string} */
            readonly status: "auth-failure" | "conflict" | "partial" | "success";
            readonly subscription: components["schemas"]["DavSubscription"];
        };
        readonly Debt: {
            readonly amount: string;
            /** Format: date-time */
            readonly createdAt: string;
            readonly currencyCode?: string;
            /** @enum {string} */
            readonly direction: "i_owe" | "they_owe";
            /** Format: uuid */
            readonly id: string;
            /** Format: date */
            readonly occurrenceOn?: string;
            /** Format: uuid */
            readonly personId: string;
            readonly reason?: string;
            /** Format: uuid */
            readonly recurringDebtId?: string;
            /** Format: date-time */
            readonly settledAt?: string;
            /** @enum {string} */
            readonly status: "open" | "settled" | "cancelled";
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly DebtCreateInput: {
            readonly settlementReason?: string;
            /** Format: uuid */
            readonly settlementPhotoFileId?: string;
            readonly amount: string;
            readonly currencyCode: string;
            /** @enum {string} */
            readonly direction: "i_owe" | "they_owe";
            readonly reason?: string;
            /** @enum {string} */
            readonly status: "open" | "settled" | "cancelled";
        };
        readonly DebtCreated: {
            readonly debt: components["schemas"]["Debt"];
            /** @constant */
            readonly status: "created";
        };
        readonly DebtDeleted: {
            /** Format: uuid */
            readonly debtId: string;
            /** @constant */
            readonly status: "deleted";
        };
        readonly DebtSaved: {
            readonly debt: components["schemas"]["Debt"];
            /** @enum {string} */
            readonly status: "saved" | "unchanged";
        };
        readonly DebtSettlement: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly settledAt: string;
            readonly reason?: string;
            /** Format: uuid */
            readonly photoFileId?: string;
            readonly photoFilename?: string;
            readonly photoAvailable?: boolean;
        };
        readonly DebtSettlementList: {
            /** @constant */
            readonly status: "ready";
            readonly settlements: readonly components["schemas"]["DebtSettlement"][];
            readonly nextCursor?: string;
        };
        readonly DebtStatusInput: {
            readonly settlementReason?: string;
            /** Format: uuid */
            readonly settlementPhotoFileId?: string;
            /** @enum {string} */
            readonly status: "open" | "settled" | "cancelled";
        };
        readonly ExportDownload: {
            /** Format: date-time */
            readonly expiresAt: string;
            readonly href: string;
            /** @constant */
            readonly status: "ready";
        };
        /** @enum {string} */
        readonly ExportFormat: "csv" | "json" | "vcard";
        readonly ExportManifest: {
            readonly attachments: {
                readonly count: number;
                readonly items: readonly {
                    readonly byteSize: number;
                    readonly filename: string;
                    readonly sha256: string;
                }[];
                readonly sha256: string;
            };
            readonly limitations: readonly string[];
            /** @enum {string} */
            readonly profile: "csv" | "monica-json" | "vcard";
            readonly rows: {
                readonly contactMethods?: {
                    readonly count: number;
                    readonly sha256: string;
                };
                readonly dates?: {
                    readonly count: number;
                    readonly sha256: string;
                };
                readonly people: {
                    readonly count: number;
                    readonly sha256: string;
                };
            };
            /** @constant */
            readonly version: 1;
        };
        readonly ExportRequest: {
            readonly format?: components["schemas"]["ExportFormat"];
        };
        readonly ExportSummary: {
            /** Format: date-time */
            readonly completedAt?: string;
            /** Format: date-time */
            readonly createdAt: string;
            readonly error?: string;
            /** Format: date-time */
            readonly expiresAt?: string;
            /** Format: uuid */
            readonly exportId: string;
            readonly format: components["schemas"]["ExportFormat"];
            readonly manifest: components["schemas"]["ExportManifest"];
            /** @enum {string} */
            readonly status: "cancelled" | "completed" | "expired" | "failed" | "pending" | "running";
        };
        readonly FirstMeetingFact: {
            /** Format: uuid */
            readonly introducedByPersonId?: string;
            readonly notes?: string;
            readonly placeText?: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "first-meeting";
        };
        readonly FirstMeetingFactCreateInput: {
            /** Format: uuid */
            readonly introducedByPersonId?: string;
            readonly notes?: string;
            readonly placeText?: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "first-meeting";
        } | unknown | {
            readonly notes: string;
        } | {
            readonly placeText: string;
        };
        readonly FirstMeetingFactUpdateInput: {
            /** Format: uuid */
            readonly introducedByPersonId?: string;
            readonly notes?: string;
            readonly placeText?: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "first-meeting";
        } | unknown | {
            readonly notes: string;
        } | {
            readonly placeText: string;
        };
        readonly FoodPreferencesFact: {
            readonly foodPreferences?: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "food-preferences";
        };
        readonly FoodPreferencesFactCreateInput: {
            readonly foodPreferences: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "food-preferences";
        };
        readonly FoodPreferencesFactUpdateInput: {
            readonly foodPreferences: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "food-preferences";
        };
        readonly Gift: {
            readonly amount?: string;
            /** Format: uuid */
            readonly attachmentFileId?: string;
            readonly comment?: string;
            /** Format: date-time */
            readonly createdAt: string;
            readonly currencyCode?: string;
            /** Format: date-time */
            readonly eventAt?: string;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
            /** Format: uuid */
            readonly personId: string;
            /** Format: uuid */
            readonly recipientPersonId?: string;
            /** @enum {string} */
            readonly status: "idea" | "planned" | "given" | "received" | "archived";
            /** Format: date-time */
            readonly updatedAt: string;
            /** Format: uri */
            readonly url?: string;
        };
        readonly GiftCreateInput: {
            readonly amount?: string;
            /** Format: uuid */
            readonly attachmentFileId?: string;
            readonly comment?: string;
            readonly currencyCode?: string;
            /** Format: date-time */
            readonly eventAt?: string;
            readonly name: string;
            /** Format: uuid */
            readonly recipientPersonId?: string;
            /** @enum {string} */
            readonly status: "idea" | "planned" | "given" | "received" | "archived";
            /** Format: uri */
            readonly url?: string;
        };
        readonly GiftCreated: {
            readonly gift: components["schemas"]["Gift"];
            /** @constant */
            readonly status: "created";
        };
        readonly GiftDebtList: {
            readonly debts: readonly components["schemas"]["Debt"][];
            readonly defaultCurrencyCode: string;
            readonly gifts: readonly components["schemas"]["Gift"][];
            readonly nextDebtCursor?: string;
            readonly nextGiftCursor?: string;
            readonly recurringDebts: readonly components["schemas"]["RecurringDebt"][];
            /** @constant */
            readonly status: "ready";
            readonly supportedCurrencyCodes: readonly string[];
        };
        readonly GiftSaved: {
            readonly gift: components["schemas"]["Gift"];
            /** @enum {string} */
            readonly status: "saved" | "unchanged";
        };
        readonly GiftStatusInput: {
            /** @enum {string} */
            readonly status: "idea" | "planned" | "given" | "received" | "archived";
        };
        readonly ImportDryRun: {
            /** Format: uuid */
            readonly importId: string;
            readonly report: components["schemas"]["ImportReport"];
            /** @constant */
            readonly status: "dry_run";
        };
        readonly ImportMappingRequired: {
            /** Format: uuid */
            readonly importId: string;
            readonly preview: components["schemas"]["CsvPreview"];
            /** @constant */
            readonly status: "mapping";
        };
        readonly ImportReport: {
            readonly monicaChoices?: {
                readonly currencyMinorUnits: {
                    readonly [key: string]: number;
                };
                readonly debts: readonly {
                    readonly sourceKey: string;
                    readonly contactName: string;
                    readonly rawAmount: string;
                    readonly minorUnits: boolean;
                    readonly reason?: string;
                    readonly direction?: string;
                }[];
                readonly contacts: readonly {
                    readonly sourceKey: string;
                    readonly contactName: string;
                    readonly sourceGender: string;
                }[];
                readonly currencies: readonly string[];
                readonly genders: readonly {
                    readonly id: string;
                    readonly name: string;
                    readonly source: boolean;
                }[];
            };
            readonly contactMethodTypes?: {
                readonly proposals: readonly {
                    readonly key: string;
                    readonly name: string;
                    /** @enum {string} */
                    readonly kind: "email" | "phone" | "url" | "social" | "im" | "username" | "custom";
                    readonly sourceKind?: string;
                    readonly protocol?: string;
                    readonly count: number;
                    readonly canCreate: boolean;
                }[];
                readonly existingTypes: readonly {
                    /** Format: uuid */
                    readonly id: string;
                    readonly name: string;
                    readonly kind: string;
                }[];
            };
            readonly counts: {
                readonly contacts: number;
                readonly legacyCredentialsDiscarded: number;
                readonly missingFiles: number;
                readonly orphans: number;
                readonly unsupported: number;
            };
            readonly diagnostics: readonly {
                readonly code: string;
                readonly message: string;
                /** @enum {string} */
                readonly severity: "info" | "skipped" | "warning";
            }[];
        };
        readonly ImportSummary: {
            /** Format: date-time */
            readonly completedAt?: string;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly importId: string;
            /** @description Present while a CSV import awaits its column mapping. */
            readonly preview?: components["schemas"]["CsvPreview"];
            readonly report: components["schemas"]["ImportReport"];
            /** @enum {string} */
            readonly sourceProfile: "csv" | "json_export" | "sql_export" | "vcf";
            /** @enum {string} */
            readonly sourceSystem: "csv" | "monica" | "vcard";
            /** @enum {string} */
            readonly status: "completed" | "dry_run" | "failed" | "pending";
        };
        readonly ImportantDate: {
            readonly day?: number;
            readonly isAgeBased: boolean;
            readonly isYearApproximate: boolean;
            /** @enum {string} */
            readonly kind: "birthday" | "custom" | "deceased" | "first_met";
            readonly label?: string;
            readonly month?: number;
            readonly notes?: string;
            /** @enum {string} */
            readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
            readonly year?: number;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: uuid */
            readonly personId: string;
            /** @enum {string} */
            readonly scheduling: "annual-reminder" | "not-schedulable";
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly ImportantDateChanged: {
            readonly date: components["schemas"]["ImportantDate"];
            /** @enum {string} */
            readonly status: "created" | "updated";
        };
        readonly ImportantDateDeleted: {
            /** Format: uuid */
            readonly dateId: string;
            /** @constant */
            readonly status: "deleted";
        };
        readonly ImportantDateInput: {
            readonly day?: number;
            readonly isAgeBased: boolean;
            readonly isYearApproximate: boolean;
            /** @enum {string} */
            readonly kind: "birthday" | "custom" | "deceased" | "first_met";
            readonly label?: string;
            readonly month?: number;
            readonly notes?: string;
            /** @enum {string} */
            readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
            readonly year?: number;
        };
        readonly ImportantDateList: {
            readonly dates: readonly components["schemas"]["ImportantDate"][];
            /** @enum {string} */
            readonly status: "ready" | "archived";
        };
        readonly ImportantDateUpdateInput: {
            readonly day?: number;
            readonly isAgeBased: boolean;
            readonly isYearApproximate: boolean;
            /** @enum {string} */
            readonly kind: "birthday" | "custom" | "deceased" | "first_met";
            readonly label?: string;
            readonly month?: number;
            readonly notes?: string;
            /** @enum {string} */
            readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
            readonly year?: number;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
        };
        readonly Interaction: components["schemas"]["ActivityInteraction"] | components["schemas"]["NoteInteraction"] | components["schemas"]["CallInteraction"] | components["schemas"]["ConversationInteraction"];
        readonly InteractionCreated: {
            readonly record: components["schemas"]["Interaction"];
            /** @constant */
            readonly status: "created";
        };
        readonly InteractionDeleted: {
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly kind: "activity" | "call" | "conversation" | "note";
            /** @constant */
            readonly status: "deleted";
        };
        readonly InteractionInput: components["schemas"]["ActivityInteractionInput"] | components["schemas"]["NoteInteractionInput"] | components["schemas"]["CallInteractionInput"] | components["schemas"]["ConversationInteractionInput"];
        readonly InteractionOption: {
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly InteractionOptions: {
            readonly activityTypes: readonly components["schemas"]["InteractionOption"][];
            readonly activityTypesNextCursor?: string;
            readonly availability: {
                readonly activity: boolean;
                readonly note: boolean;
            };
            readonly emotions: readonly components["schemas"]["InteractionOption"][];
            readonly emotionsNextCursor?: string;
            /** @constant */
            readonly status: "ready";
        };
        readonly InteractionParticipant: {
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly InteractionRemovalInput: {
            /**
             * Format: date-time
             * @description The updatedAt the client last read for this record; a changed record answers 409.
             */
            readonly expectedUpdatedAt: string;
        };
        readonly InteractionSaved: {
            readonly record: components["schemas"]["Interaction"];
            /** @constant */
            readonly status: "saved";
        };
        readonly InvitationAccepted: {
            /** @constant */
            readonly status: "accepted";
            /** @constant */
            readonly next: "/app";
            readonly workspace: components["schemas"]["AuthenticatedWorkspace"];
        };
        readonly InvitationInput: {
            /** Format: email */
            readonly email: string;
            /** @enum {string} */
            readonly role: "admin" | "member";
        };
        readonly InvitationInspection: {
            /** @constant */
            readonly status: "pending";
            /** Format: email */
            readonly email: string;
            /** @enum {string} */
            readonly role: "admin" | "member";
            readonly workspaceName: string;
        };
        readonly InvitationRegistrationInput: {
            /** Format: email */
            readonly email: string;
            readonly firstName: string;
            readonly lastName: string;
            readonly password: string;
            readonly token: string;
        };
        readonly InvitationRevoked: {
            /** @constant */
            readonly status: "revoked";
        };
        readonly InvitationToken: {
            readonly token: string;
        };
        readonly JournalActivityItem: {
            readonly activity: {
                /** Format: uuid */
                readonly id: string;
                readonly participants: readonly components["schemas"]["InteractionParticipant"][];
                readonly summary: string;
            };
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly occurredAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly type: "activity";
        };
        readonly JournalActivityLinked: {
            /** Format: uuid */
            readonly activityId: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly occurredAt: string;
            /** @constant */
            readonly status: "created";
        };
        readonly JournalDayRatingInput: {
            readonly comment?: string;
            /** Format: date */
            readonly ratedOn: string;
            readonly rating: number;
        };
        readonly JournalDayRatingItem: {
            readonly dayRating: {
                readonly comment?: string;
                /** Format: uuid */
                readonly id: string;
                /** Format: date */
                readonly ratedOn: string;
                readonly rating: number;
            };
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly occurredAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly type: "day-rating";
        };
        readonly JournalDayRatingSaved: {
            readonly rating: components["schemas"]["JournalStoredDayRating"];
            /** @enum {string} */
            readonly status: "created" | "updated";
        };
        readonly JournalDeleted: {
            /** @enum {string} */
            readonly itemType: "activity" | "day-rating" | "post";
            /** @constant */
            readonly status: "deleted";
        };
        readonly JournalItemReady: {
            readonly item: components["schemas"]["JournalTimelineItem"];
            /** @constant */
            readonly status: "ready";
        };
        readonly JournalLinkableActivity: {
            /** Format: date-time */
            readonly happenedAt: string;
            /** Format: uuid */
            readonly id: string;
            readonly summary: string;
        };
        readonly JournalPostCreated: {
            readonly post: components["schemas"]["JournalStoredPost"];
            /** @constant */
            readonly status: "created";
        };
        readonly JournalPostInput: {
            readonly body: string;
            /** Format: date-time */
            readonly occurredAt: string;
            /**
             * Format: uuid
             * @description Optional client-generated UUID that makes the create safe to retry: reuse it when retrying the same create, and send a new one for a different post.
             */
            readonly requestId?: string;
            readonly title?: string;
        };
        readonly JournalPostItem: {
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly occurredAt: string;
            readonly post: {
                readonly body: string;
                /** Format: uuid */
                readonly id: string;
                readonly title?: string;
                /** Format: date-time */
                readonly updatedAt: string;
            };
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly type: "post";
        };
        readonly JournalPostUpdateInput: {
            readonly body: string;
            /**
             * Format: date-time
             * @description Optional revision check: the post's updatedAt exactly as a read returned it. When it is no longer the post's revision the edit is refused (409) and nothing changes.
             */
            readonly expectedUpdatedAt?: string;
            /** Format: date-time */
            readonly occurredAt: string;
            readonly title?: string;
        };
        readonly JournalPostUpdated: {
            readonly post: components["schemas"]["JournalStoredPost"];
            /** @constant */
            readonly status: "updated";
        };
        readonly JournalStoredDayRating: {
            readonly comment?: string;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date */
            readonly ratedOn: string;
            readonly rating: number;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly JournalStoredPost: {
            readonly body: string;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly occurredAt: string;
            readonly title?: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly JournalTimelineItem: components["schemas"]["JournalActivityItem"] | components["schemas"]["JournalDayRatingItem"] | components["schemas"]["JournalPostItem"];
        readonly JournalTimelineList: {
            readonly activities: readonly components["schemas"]["JournalLinkableActivity"][];
            readonly items: readonly components["schemas"]["JournalTimelineItem"][];
            readonly nextCursor?: string;
            /** @constant */
            readonly status: "ready";
        };
        readonly LegalAccepted: {
            /** Format: date-time */
            readonly acceptedAt: string;
            /** Format: uuid */
            readonly documentId: string;
            /** @enum {string} */
            readonly status: "accepted" | "already-accepted";
        };
        readonly LegalDocument: {
            readonly content: string;
            readonly documentType: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly publishedAt?: string;
            readonly version: string;
        };
        readonly LegalDocumentReady: {
            readonly document: components["schemas"]["LegalDocument"];
            /** @constant */
            readonly status: "ready";
        };
        readonly LegalRequirements: {
            readonly documents: readonly components["schemas"]["LegalDocument"][];
            /** @constant */
            readonly status: "ready";
        };
        readonly ManagedMember: {
            /** Format: uuid */
            readonly id: string;
            /** Format: email */
            readonly email: string;
            readonly name: string;
            /** @enum {string} */
            readonly role: "owner" | "admin" | "member";
            /** @enum {string} */
            readonly status: "active" | "suspended";
        };
        readonly ManagedMemberResult: {
            /** @constant */
            readonly status: "ready";
            readonly member: components["schemas"]["ManagedMember"];
        };
        readonly ManagedMembers: {
            /** @constant */
            readonly status: "ready";
            readonly members: readonly components["schemas"]["ManagedMember"][];
        };
        readonly McpMessage: {
            /** @constant */
            readonly jsonrpc: "2.0";
            readonly id?: (string | number) | null;
            /** @description The MCP method, such as initialize, tools/list, or tools/call. Absent on a response. */
            readonly method?: string;
            readonly params?: {
                readonly [key: string]: unknown;
            };
            readonly result?: {
                readonly [key: string]: unknown;
            };
            readonly error?: {
                readonly code: number;
                readonly message: string;
                readonly data?: unknown;
            } & {
                readonly [key: string]: unknown;
            };
        } & {
            readonly [key: string]: unknown;
        };
        readonly MemberUiState: {
            /** Format: date-time */
            readonly notificationsReadThrough?: string;
            /** @enum {string} */
            readonly personWorkspaceView?: "all" | "timeline" | "planning" | "things" | "admin";
            /** @enum {string} */
            readonly theme?: "system" | "light" | "dark";
        };
        readonly MemberUiStateInput: {
            /** Format: date-time */
            readonly notificationsReadThrough?: string;
            /** @enum {string} */
            readonly personWorkspaceView?: "all" | "timeline" | "planning" | "things" | "admin";
            /** @enum {string} */
            readonly theme?: "system" | "light" | "dark";
        };
        readonly MemberUiStateReady: {
            /** @constant */
            readonly status: "ready";
            readonly uiState: components["schemas"]["MemberUiState"];
        };
        readonly MemberUpdateInput: {
            /** @enum {string} */
            readonly role: "owner" | "admin" | "member";
            /** @enum {string} */
            readonly status: "active" | "suspended";
        };
        readonly MfaInput: {
            readonly factor: string;
            /** Format: uuid */
            readonly workspaceId?: string;
        };
        readonly MfaRequired: {
            /** @constant */
            readonly status: "mfa-required";
            /** @constant */
            readonly next: "/auth/mfa";
        };
        readonly NoteChangeInput: {
            readonly body?: string;
            /**
             * Format: date-time
             * @description The updatedAt the client last read for this record; a changed record answers 409.
             */
            readonly expectedUpdatedAt: string;
            /** @description Whether the note is one of Today's favorite notes. */
            readonly isFavorited?: boolean;
        };
        readonly NoteInteraction: {
            readonly body: string;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            readonly isFavorited: boolean;
            /** @constant */
            readonly kind: "note";
            readonly person?: components["schemas"]["InteractionParticipant"];
            readonly participants?: readonly components["schemas"]["InteractionParticipant"][];
            /**
             * Format: date-time
             * @description The record's revision; send it back as expectedUpdatedAt to edit or delete it.
             */
            readonly updatedAt?: string;
        };
        readonly NoteInteractionInput: {
            readonly body: string;
            readonly isFavorited?: boolean;
            /** @constant */
            readonly kind: "note";
            /** Format: uuid */
            readonly personId: string;
            /**
             * Format: uuid
             * @description Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.
             */
            readonly requestId: string;
        };
        readonly NotificationItem: {
            readonly href: string;
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly kind: "reminder" | "reminder-email-failed" | "export-ready" | "import-finished" | "invitation-accepted";
            /** Format: date-time */
            readonly occurredAt: string;
            readonly person?: components["schemas"]["TodayReminderPerson"];
            readonly title?: string;
            readonly unread: boolean;
        };
        readonly NotificationsPage: {
            readonly items: readonly components["schemas"]["NotificationItem"][];
            readonly nextCursor?: string;
            /** Format: date-time */
            readonly readThrough?: string;
            /** @constant */
            readonly status: "ready";
            /** @description Unread items, counted no further than 100: show 99+ there. */
            readonly unreadCount: number;
        };
        readonly OccupationFact: {
            readonly description?: string;
            /** Format: date */
            readonly endOn?: string;
            readonly isCurrent: boolean;
            /** Format: uuid */
            readonly organizationId?: string;
            readonly organizationName?: string;
            /** Format: date */
            readonly startOn?: string;
            readonly title: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "work";
        };
        readonly OccupationFactCreateInput: {
            readonly description?: string;
            /** Format: date */
            readonly endOn?: string;
            readonly isCurrent: boolean;
            /** Format: uuid */
            readonly organizationId?: string;
            readonly organizationName?: string;
            /** Format: date */
            readonly startOn?: string;
            readonly title: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "work";
        };
        readonly OccupationFactUpdateInput: {
            readonly description?: string;
            /** Format: date */
            readonly endOn?: string;
            readonly isCurrent: boolean;
            /** Format: uuid */
            readonly organizationId?: string;
            readonly organizationName?: string;
            /** Format: date */
            readonly startOn?: string;
            readonly title: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "work";
        };
        readonly OptionalInvitationToken: {
            readonly token?: string;
        };
        readonly PasswordResetAccepted: {
            /** @constant */
            readonly status: "reset";
            /** @constant */
            readonly next: "/auth/sign-in";
        };
        readonly PasswordResetInput: {
            readonly password: string;
            readonly token: string;
        };
        readonly PeopleBulkInput: {
            /** @enum {string} */
            readonly action: "archive" | "restore" | "tag" | "untag";
            /** @description Distinct people in the active workspace. */
            readonly personIds: readonly string[];
            /**
             * Format: uuid
             * @description The workspace tag to add or remove; only tagging names one.
             */
            readonly tagId?: string;
        };
        readonly PeopleBulkItemResult: {
            /**
             * @description Why a failed person was refused.
             * @enum {string}
             */
            readonly code?: "archived_write_rejected" | "forbidden" | "invalid" | "not_found" | "section_hidden" | "stale" | "tag_unavailable" | "unavailable";
            /** @enum {string} */
            readonly outcome: "done" | "failed" | "skipped" | "unchanged";
            /** Format: uuid */
            readonly personId: string;
        };
        readonly PeopleBulkResult: {
            /** @enum {string} */
            readonly action: "archive" | "restore" | "tag" | "untag";
            readonly results: readonly components["schemas"]["PeopleBulkItemResult"][];
            readonly summary: {
                readonly done: number;
                readonly failed: number;
                readonly skipped: number;
                readonly unchanged: number;
            };
        };
        readonly PeopleDirectoryPage: {
            /** @constant */
            readonly status: "ready";
            /** @enum {string} */
            readonly lifecycle: "active" | "archived";
            readonly people: readonly components["schemas"]["PeopleDirectoryPerson"][];
            readonly nextCursor?: string;
            readonly selected?: components["schemas"]["PeopleDirectoryPerson"];
        };
        readonly PeopleDirectoryPerson: {
            readonly avatar?: components["schemas"]["PersonAvatar"];
            readonly familyName?: string;
            readonly givenName: string;
            /** Format: uuid */
            readonly id: string;
            readonly isPartial: boolean;
            readonly isStarred: boolean;
            /** @enum {string} */
            readonly lifecycle: "active" | "archived";
            readonly middleName?: string;
            readonly nickname?: string;
            readonly tagCount: number;
            readonly tags: readonly components["schemas"]["PeopleDirectoryTag"][];
        };
        readonly PeopleDirectoryTag: {
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly PeopleDuplicateDismissalInput: {
            readonly personIds: readonly string[];
        };
        readonly PeopleDuplicateDismissed: {
            readonly personIds: readonly string[];
            /** @constant */
            readonly status: "dismissed";
        };
        readonly PeopleDuplicatePair: {
            readonly people: readonly components["schemas"]["PeopleDuplicatePerson"][];
            readonly reasons: readonly ("email" | "name" | "phone")[];
        };
        readonly PeopleDuplicatePerson: {
            readonly avatar?: components["schemas"]["PersonAvatar"];
            readonly familyName?: string;
            readonly givenName: string;
            /** Format: uuid */
            readonly id: string;
            readonly middleName?: string;
            readonly nickname?: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly PeopleDuplicates: {
            readonly pairs: readonly components["schemas"]["PeopleDuplicatePair"][];
            /** @constant */
            readonly status: "ready";
            readonly truncated: boolean;
        };
        readonly PeopleTagFacet: {
            /** @constant */
            readonly status: "ready";
            /** @enum {string} */
            readonly lifecycle: "active" | "archived";
            readonly tags: readonly components["schemas"]["PeopleTagFacetEntry"][];
            readonly truncated: boolean;
        };
        readonly PeopleTagFacetEntry: {
            readonly count: number;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly PeopleTagOptionsPage: {
            /** @constant */
            readonly status: "ready";
            readonly options: readonly components["schemas"]["PeopleDirectoryTag"][];
            readonly nextCursor?: string;
            readonly selected?: components["schemas"]["PeopleDirectoryTag"];
        };
        readonly PeopleVCardInput: {
            /** @description Distinct people in the active workspace. */
            readonly personIds: readonly string[];
        };
        readonly PersonAvatar: {
            readonly color: string;
            readonly imageUrl?: string;
        };
        readonly PersonAvatarChanged: {
            readonly avatar: components["schemas"]["PersonProfileAvatar"];
            /** @enum {string} */
            readonly status: "removed" | "updated";
        };
        readonly PersonCreated: {
            /** @constant */
            readonly status: "created";
            readonly person: components["schemas"]["PersonIdentity"];
            readonly next: string;
        };
        readonly PersonDeleteInput: {
            readonly confirmation: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
        };
        readonly PersonDeleted: {
            /** @constant */
            readonly next: "/app/people";
            /** Format: uuid */
            readonly personId: string;
            /** @constant */
            readonly status: "deleted";
        };
        readonly PersonDeletionImpact: {
            readonly impact: {
                readonly confirmation: string;
                /** @constant */
                readonly dependentRecordPolicy: "retained";
                readonly person: components["schemas"]["PersonLifecycleIdentity"];
            };
            /** @constant */
            readonly status: "ready";
        };
        readonly PersonDueInformation: {
            /** @constant */
            readonly status: "ready";
            readonly detail: string;
            /** Format: date-time */
            readonly nextReminderAt?: string;
            readonly openTaskCount: number;
            /** Format: date-time */
            readonly stayInTouchAt?: string;
        };
        readonly PersonEditInput: {
            readonly description?: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly familyName?: string;
            readonly genderOptionId?: string | "";
            readonly givenName: string;
            readonly isDeceased?: boolean;
            readonly isPartial: boolean;
            readonly middleName?: string;
            readonly nickname?: string;
        };
        readonly PersonFile: {
            readonly byteSize: number;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly fileId: string;
            readonly filename: string;
            readonly kind: string;
            readonly mimeType: string;
            /** Format: uuid */
            readonly personId: string;
            /** @enum {string} */
            readonly status: "available" | "missing" | "processing" | "quarantined";
            readonly title: string;
        };
        readonly PersonFileCreated: {
            readonly file: components["schemas"]["PersonFile"];
            /** @constant */
            readonly status: "created";
        };
        readonly PersonFileList: {
            readonly files: readonly components["schemas"]["PersonFile"][];
            readonly nextCursor?: string;
            /** @constant */
            readonly status: "ready";
        };
        readonly PersonGenderOption: {
            readonly archived: boolean;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly PersonIdentity: {
            readonly familyName?: string;
            readonly givenName: string;
            /** Format: uuid */
            readonly id: string;
            readonly isPartial: boolean;
            readonly middleName?: string;
            readonly nickname?: string;
        };
        readonly PersonIdentityReady: {
            readonly person: components["schemas"]["PersonIdentity"];
            /** @enum {string} */
            readonly status: "ready" | "archived";
        };
        readonly PersonInput: {
            readonly duplicateOverride?: boolean;
            readonly familyName?: string;
            readonly givenName: string;
            readonly isPartial: boolean;
            readonly middleName?: string;
            readonly nickname?: string;
            /**
             * Format: uuid
             * @description Optional client-generated UUID that makes the create safe to retry: reuse it when retrying the same create, and send a new one for a different person.
             */
            readonly requestId?: string;
        };
        readonly PersonLifeEvent: {
            readonly date: components["schemas"]["PersonLifeEventDate"];
            /** Format: uuid */
            readonly id: string;
            readonly name?: string;
            readonly note?: string;
            /** Format: uuid */
            readonly typeId?: string;
            readonly typeName?: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly PersonLifeEventChanged: {
            readonly event: components["schemas"]["PersonLifeEvent"];
            /** @enum {string} */
            readonly status: "created" | "updated";
        };
        readonly PersonLifeEventDate: {
            readonly day?: number;
            /** Format: date-time */
            readonly happenedAt?: string;
            readonly month?: number;
            /** @enum {string} */
            readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
            readonly year?: number;
        };
        readonly PersonLifeEventDeleted: {
            /** Format: uuid */
            readonly lifeEventId: string;
            /** @constant */
            readonly status: "deleted";
        };
        readonly PersonLifeEventInput: {
            readonly day?: number;
            readonly month?: number;
            readonly name?: string;
            readonly note?: string;
            /** @enum {string} */
            readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
            /** Format: uuid */
            readonly typeId?: string;
            readonly year?: number;
        };
        readonly PersonLifeEventType: {
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly PersonLifeEventUpdateInput: {
            readonly day?: number;
            readonly month?: number;
            readonly name?: string;
            readonly note?: string;
            /** @enum {string} */
            readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
            /** Format: uuid */
            readonly typeId?: string;
            readonly year?: number;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
        };
        readonly PersonLifeEventsReady: {
            readonly events: readonly components["schemas"]["PersonLifeEvent"][];
            /** @enum {string} */
            readonly status: "hidden" | "ready";
            readonly types: readonly components["schemas"]["PersonLifeEventType"][];
        };
        readonly PersonLifecycleChanged: {
            readonly person: components["schemas"]["PersonLifecycleIdentity"];
            /** @enum {string} */
            readonly status: "updated" | "archived" | "restored";
        };
        readonly PersonLifecycleIdentity: {
            readonly description?: string;
            readonly familyName?: string;
            /** Format: uuid */
            readonly genderOptionId?: string;
            readonly givenName: string;
            /** Format: uuid */
            readonly id: string;
            readonly isDeceased: boolean;
            readonly isPartial: boolean;
            /** @enum {string} */
            readonly lifecycle: "active" | "archived" | "deleted";
            readonly middleName?: string;
            readonly nickname?: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly PersonMergeConflict: {
            readonly discarded: string;
            /** @enum {string} */
            readonly fact: "avatar" | "birthday" | "deceased" | "first-meeting" | "first_met" | "stay-in-touch";
            readonly kept: string;
        };
        readonly PersonMergeInput: {
            /** @constant */
            readonly confirmed: true;
            readonly conflictsDigest: string;
            /** Format: uuid */
            readonly duplicateId: string;
            /** Format: date-time */
            readonly duplicateRevision: string;
            /** Format: date-time */
            readonly primaryRevision: string;
        };
        readonly PersonMergePreview: {
            readonly conflicts: readonly components["schemas"]["PersonMergeConflict"][];
            readonly conflictsDigest: string;
            readonly duplicate: components["schemas"]["PersonLifecycleIdentity"];
            readonly moves: number;
            readonly primary: components["schemas"]["PersonLifecycleIdentity"];
            /** @constant */
            readonly status: "ready";
        };
        readonly PersonMerged: {
            /** Format: uuid */
            readonly duplicateId: string;
            readonly moved: number;
            readonly next: string;
            readonly person: components["schemas"]["PersonLifecycleIdentity"];
            /** @constant */
            readonly status: "merged";
        };
        readonly PersonPrimaryContactMethod: {
            readonly href?: string;
            /** Format: uuid */
            readonly id: string;
            readonly kind: string;
            readonly label: string;
            readonly value: string;
        };
        readonly PersonProfileAvatar: {
            readonly color: string;
            readonly imageUrl?: string;
            readonly hasStoredImage: boolean;
        };
        readonly PersonProfileIdentity: {
            readonly avatar?: components["schemas"]["PersonProfileAvatar"];
            readonly description?: string;
            readonly familyName?: string;
            readonly gender?: string;
            /** Format: uuid */
            readonly genderOptionId?: string;
            readonly givenName: string;
            /** Format: uuid */
            readonly id: string;
            readonly isDeceased: boolean;
            readonly isPartial: boolean;
            readonly isSelf: boolean;
            readonly isStarred: boolean;
            /** Format: date-time */
            readonly lastContactAt?: string;
            readonly middleName?: string;
            readonly nickname?: string;
            readonly profileSections?: readonly {
                readonly id: components["schemas"]["PersonProfileSectionId"];
                /** @enum {string} */
                readonly status: "hidden" | "ready";
            }[];
            readonly tagCount: number;
            readonly tags: readonly components["schemas"]["PeopleDirectoryTag"][];
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly PersonProfileSectionCount: {
            readonly count: number;
            readonly id: components["schemas"]["PersonProfileSectionId"];
            /** @constant */
            readonly status: "ready";
        } | {
            readonly id: components["schemas"]["PersonProfileSectionId"];
            /** @constant */
            readonly status: "hidden";
        };
        /** @enum {string} */
        readonly PersonProfileSectionId: "activities" | "addresses" | "calls" | "contact-methods" | "conversations" | "first-meeting" | "food-preferences" | "life-events" | "notes" | "pets" | "relationships" | "tasks" | "tags" | "work";
        readonly PersonProfileSummary: {
            /** Format: date-time */
            readonly nextReminderAt?: string;
            readonly primaryContactMethods: readonly components["schemas"]["PersonPrimaryContactMethod"][];
            readonly relationshipCounts: readonly components["schemas"]["PersonRelationshipCount"][];
            readonly sectionCounts: readonly components["schemas"]["PersonProfileSectionCount"][];
            /** Format: date-time */
            readonly stayInTouchAt?: string;
        };
        readonly PersonRail: {
            readonly "contact-methods": components["schemas"]["PersonRailFacts"];
            readonly addresses: components["schemas"]["PersonRailFacts"];
            readonly "first-meeting": components["schemas"]["PersonRailFacts"];
            readonly work: components["schemas"]["PersonRailFacts"];
            readonly "food-preferences": components["schemas"]["PersonRailFacts"];
            readonly pets: components["schemas"]["PersonRailFacts"];
            readonly tags: components["schemas"]["PersonRailFacts"];
            readonly relationships: components["schemas"]["PersonRailRelationships"];
            readonly "important-dates": components["schemas"]["PersonRailImportantDates"];
            readonly reminders: components["schemas"]["PersonRailReminders"];
        };
        readonly PersonRailFacts: {
            /** @constant */
            readonly status: "ready";
            readonly value: components["schemas"]["ProfileFactSection"];
        } | components["schemas"]["PersonRailSectionHidden"] | components["schemas"]["PersonRailSectionForbidden"] | components["schemas"]["PersonRailSectionUnavailable"];
        readonly PersonRailImportantDates: {
            /** @constant */
            readonly status: "ready";
            readonly value: components["schemas"]["ImportantDateList"];
        } | components["schemas"]["PersonRailSectionForbidden"] | components["schemas"]["PersonRailSectionUnavailable"];
        readonly PersonRailRelationships: {
            /** @constant */
            readonly status: "ready";
            readonly value: {
                readonly list: components["schemas"]["RelationshipList"];
                readonly types: components["schemas"]["RelationshipTypeList"];
            };
        } | components["schemas"]["PersonRailSectionHidden"] | components["schemas"]["PersonRailSectionForbidden"] | components["schemas"]["PersonRailSectionUnavailable"];
        readonly PersonRailReminders: {
            /** @constant */
            readonly status: "ready";
            readonly value: components["schemas"]["PersonReminders"];
        } | components["schemas"]["PersonRailSectionForbidden"] | components["schemas"]["PersonRailSectionUnavailable"];
        readonly PersonRailSectionForbidden: {
            /** @constant */
            readonly status: "forbidden";
        };
        readonly PersonRailSectionHidden: {
            /** @constant */
            readonly status: "hidden";
        };
        readonly PersonRailSectionUnavailable: {
            /** @constant */
            readonly status: "unavailable";
        };
        readonly PersonReady: {
            /** @enum {string} */
            readonly status: "ready" | "archived";
            readonly person: components["schemas"]["PersonProfileIdentity"];
            readonly dueInformation: components["schemas"]["PersonDueInformation"];
            readonly genderOptions?: readonly components["schemas"]["PersonGenderOption"][];
            readonly summary?: components["schemas"]["PersonProfileSummary"];
            readonly rail?: components["schemas"]["PersonRail"];
        };
        readonly PersonRelationshipCount: {
            readonly count: number;
            readonly label: string;
            /** Format: uuid */
            readonly relationshipTypeId: string;
        };
        readonly PersonReminders: {
            readonly cadences: readonly components["schemas"]["StayInTouchCadence"][];
            readonly nextCursor?: string;
            readonly reminders: readonly components["schemas"]["Reminder"][];
            /** @constant */
            readonly status: "ready";
        };
        readonly PersonStarChanged: {
            readonly isStarred: boolean;
            /** @constant */
            readonly status: "ready";
        };
        readonly PersonTimelineItem: {
            /** @description Recorded calendar components for component-backed life events; occurredAt remains their ordering key, not an event instant. */
            readonly calendarDate?: {
                readonly year?: number;
                readonly month?: number;
                readonly day?: number;
            };
            /** @enum {string} */
            readonly datePrecision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
            readonly activityType?: string;
            readonly channelType?: string;
            readonly contactMethod?: string;
            readonly contactWasCaller?: boolean;
            readonly emotions?: readonly components["schemas"]["InteractionOption"][];
            readonly excerpt?: string;
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly kind: "activity" | "call" | "conversation" | "life-event" | "note";
            readonly messages?: readonly components["schemas"]["PersonTimelineMessage"][];
            /** Format: date-time */
            readonly occurredAt: string;
            readonly participants?: readonly components["schemas"]["InteractionParticipant"][];
            readonly title?: string;
        };
        readonly PersonTimelineMessage: {
            readonly content: string;
            /** @enum {string} */
            readonly direction: "inbound" | "outbound";
            /** Format: date-time */
            readonly writtenAt: string;
        };
        readonly PersonTimelinePage: {
            readonly items: readonly components["schemas"]["PersonTimelineItem"][];
            readonly nextCursor?: string;
            /** @enum {string} */
            readonly status: "archived" | "ready";
        };
        readonly PersonTransitionInput: {
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
        };
        readonly PersonViewRecorded: {
            /** @constant */
            readonly status: "recorded";
        };
        readonly PersonalIdentityDeleted: {
            /** @constant */
            readonly next: "/auth/sign-in";
            /** @constant */
            readonly status: "deleted";
        };
        readonly PersonalIdentityDeletionInput: {
            readonly confirmation: string;
            readonly password: string;
        };
        readonly PersonalLifecycleConfirmation: {
            readonly confirmation: string;
            readonly password: string;
        };
        readonly PersonalLifecyclePreview: {
            readonly activeSessionCount: number;
            readonly blockingWorkspaces: readonly components["schemas"]["BlockingWorkspace"][];
            readonly confirmations: {
                readonly deleteIdentity: string;
                readonly leaveWorkspace: string;
            };
            readonly memberships: readonly {
                readonly finalOwner: boolean;
                /** Format: uuid */
                readonly id: string;
                /** @enum {string} */
                readonly role: "owner" | "admin" | "member";
                /** @enum {string} */
                readonly status: "active" | "suspended";
                readonly workspace: components["schemas"]["BlockingWorkspace"];
            }[];
            /** @constant */
            readonly retainedLegalRecords: true;
            /** @constant */
            readonly status: "ready";
        };
        readonly PersonalizationContactTypeCreate: {
            readonly contactKind?: components["schemas"]["ContactMethodKind"];
            readonly name: string;
            readonly sortOrder?: number;
        };
        readonly PersonalizationContactTypeUpdate: {
            readonly contactKind?: components["schemas"]["ContactMethodKind"];
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly isActive?: boolean;
            readonly name?: string;
            readonly sortOrder?: number;
        } | unknown | unknown | unknown | unknown;
        readonly PersonalizationCreate: components["schemas"]["PersonalizationContactTypeCreate"] | components["schemas"]["PersonalizationNamedCreate"] | components["schemas"]["PersonalizationNameOnlyCreate"] | components["schemas"]["PersonalizationRelationshipCreate"] | components["schemas"]["PersonalizationReminderCreate"];
        readonly PersonalizationDeleted: {
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly status: "deleted";
        };
        readonly PersonalizationEntry: {
            readonly capabilities: {
                readonly delete: boolean;
                readonly disable: boolean;
                readonly editValue: boolean;
                readonly rename: boolean;
                readonly reorder: boolean;
                readonly replace: boolean;
                readonly setDefault: boolean;
            };
            readonly canDelete: boolean;
            readonly contactKind?: components["schemas"]["ContactMethodKind"];
            readonly daysBefore?: number;
            readonly forwardLabel?: string;
            /** Format: uuid */
            readonly id: string;
            readonly isActive: boolean;
            readonly isDefault: boolean;
            /** @enum {string} */
            readonly kind: "named" | "relationship-type" | "reminder-rule";
            readonly name: string;
            readonly readOnly: boolean;
            readonly referenceCount: number;
            readonly reverseLabel?: string;
            readonly sortOrder: number;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly PersonalizationGenderUpdate: {
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly isActive?: boolean;
            /** @constant */
            readonly isDefault?: true;
            readonly name?: string;
            readonly sortOrder?: number;
        } | unknown | unknown | unknown | unknown;
        readonly PersonalizationList: {
            readonly capabilities: {
                readonly create: boolean;
                readonly editValue: boolean;
            };
            readonly entries: readonly components["schemas"]["PersonalizationEntry"][];
            readonly readOnly: boolean;
            readonly section: components["schemas"]["PersonalizationSection"];
            /** @constant */
            readonly status: "ready";
        };
        readonly PersonalizationNameOnlyCreate: {
            readonly name: string;
        };
        readonly PersonalizationNameOnlyUpdate: {
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly name: string;
        };
        readonly PersonalizationNamedCreate: {
            readonly name: string;
            readonly sortOrder?: number;
        };
        readonly PersonalizationNamedUpdate: {
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly isActive?: boolean;
            readonly name?: string;
            readonly sortOrder?: number;
        } | unknown | unknown | unknown;
        readonly PersonalizationRelationshipCreate: {
            readonly forwardLabel: string;
            readonly reverseLabel: string;
            readonly sortOrder?: number;
        };
        readonly PersonalizationRelationshipUpdate: {
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly forwardLabel?: string;
            readonly isActive?: boolean;
            readonly reverseLabel?: string;
            readonly sortOrder?: number;
        } | unknown | unknown | unknown;
        readonly PersonalizationReminderCreate: {
            readonly daysBefore: number;
        };
        readonly PersonalizationReminderUpdate: {
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly daysBefore?: number;
            readonly isActive?: boolean;
        } | unknown | unknown;
        readonly PersonalizationSaved: {
            readonly entry: components["schemas"]["PersonalizationEntry"];
            /** @constant */
            readonly status: "saved";
        };
        /** @enum {string} */
        readonly PersonalizationSection: "profile-modules" | "gender-options" | "contact-method-types" | "contact-labels" | "activity-types" | "emotion-options" | "life-event-types" | "relationship-types" | "pet-categories" | "reminder-rules" | "tags";
        readonly PersonalizationUpdate: components["schemas"]["PersonalizationContactTypeUpdate"] | components["schemas"]["PersonalizationNamedUpdate"] | components["schemas"]["PersonalizationGenderUpdate"] | components["schemas"]["PersonalizationNameOnlyUpdate"] | components["schemas"]["PersonalizationRelationshipUpdate"] | components["schemas"]["PersonalizationReminderUpdate"];
        readonly PetFact: {
            /** Format: uuid */
            readonly categoryId?: string;
            readonly name?: string;
            readonly notes?: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "pets";
        };
        readonly PetFactCreateInput: {
            /** Format: uuid */
            readonly categoryId?: string;
            readonly name?: string;
            readonly notes?: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "pets";
        } | unknown | {
            readonly name: string;
        };
        readonly PetFactUpdateInput: {
            /** Format: uuid */
            readonly categoryId?: string;
            readonly name?: string;
            readonly notes?: string;
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "pets";
        } | unknown | {
            readonly name: string;
        };
        readonly PreferenceSettings: {
            /** @constant */
            readonly status: "ready";
            readonly preferences: components["schemas"]["ResolvedMemberPreferences"];
            readonly supportedCurrencyCodes: readonly string[];
        };
        readonly PreferencesInput: {
            /** @enum {string} */
            readonly contactNameOrder: "given_family_nickname" | "family_given_nickname";
            /** @enum {string} */
            readonly contactSortOrder: "given_name_asc" | "family_name_asc";
            readonly currencyCode?: string;
            readonly digestTime?: string | null;
            readonly fluidLayout: boolean;
            readonly locale: string;
            /** @enum {string} */
            readonly measurementSystem: "metric" | "imperial";
            /** @enum {string} */
            readonly reminderDelivery?: "in_app" | "email" | "both";
            /** @enum {string} */
            readonly temperatureScale: "celsius" | "fahrenheit";
            readonly timezone?: string;
        };
        readonly Problem: {
            /** Format: uri */
            readonly type: string;
            readonly title: string;
            readonly status: number;
            readonly detail: string;
            readonly code: string;
            readonly errors?: {
                readonly [key: string]: string;
            };
            readonly blockingWorkspaces?: readonly components["schemas"]["BlockingWorkspace"][];
        };
        readonly ProfileFactChanged: {
            /** @constant */
            readonly status: "saved";
            /** Format: date-time */
            readonly personUpdatedAt: string;
            readonly record: components["schemas"]["ProfileFactRecord"];
        };
        readonly ProfileFactCreateInput: components["schemas"]["AddressFactCreateInput"] | components["schemas"]["ContactMethodFactCreateInput"] | components["schemas"]["FirstMeetingFactCreateInput"] | components["schemas"]["FoodPreferencesFactCreateInput"] | components["schemas"]["PetFactCreateInput"] | components["schemas"]["TagsFactCreateInput"] | components["schemas"]["OccupationFactCreateInput"];
        readonly ProfileFactDeleteInput: {
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly section: components["schemas"]["ProfileFactSectionId"];
        };
        readonly ProfileFactDeleted: {
            /** @constant */
            readonly status: "deleted";
            /** Format: uuid */
            readonly factId: string;
            /** Format: date-time */
            readonly personUpdatedAt: string;
        };
        readonly ProfileFactOption: {
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly kind?: "contact-label" | "contact-type" | "organization" | "pet-category";
            readonly name: string;
        };
        readonly ProfileFactRecord: {
            /** Format: uuid */
            readonly id: string;
            readonly referencesResolved?: boolean;
            readonly section: components["schemas"]["ProfileFactSectionId"];
            readonly selectedOptions?: readonly components["schemas"]["ProfileFactOption"][];
            /** Format: date-time */
            readonly updatedAt: string;
            readonly value: components["schemas"]["ProfileFactValue"];
        };
        readonly ProfileFactSection: {
            readonly nextCursor?: string;
            readonly nextOptionsCursor?: string;
            /** @enum {string} */
            readonly status: "ready" | "archived" | "hidden";
            readonly options: readonly components["schemas"]["ProfileFactOption"][];
            /** Format: date-time */
            readonly personUpdatedAt: string;
            readonly records: readonly components["schemas"]["ProfileFactRecord"][];
        };
        /** @enum {string} */
        readonly ProfileFactSectionId: "addresses" | "contact-methods" | "first-meeting" | "food-preferences" | "pets" | "tags" | "work";
        readonly ProfileFactUpdateInput: components["schemas"]["AddressFactUpdateInput"] | components["schemas"]["ContactMethodFactUpdateInput"] | components["schemas"]["FirstMeetingFactUpdateInput"] | components["schemas"]["FoodPreferencesFactUpdateInput"] | components["schemas"]["PetFactUpdateInput"] | components["schemas"]["TagsFactUpdateInput"] | components["schemas"]["OccupationFactUpdateInput"];
        readonly ProfileFactValue: components["schemas"]["AddressFact"] | components["schemas"]["ContactMethodFact"] | components["schemas"]["FirstMeetingFact"] | components["schemas"]["FoodPreferencesFact"] | components["schemas"]["PetFact"] | components["schemas"]["TagsFact"] | components["schemas"]["OccupationFact"];
        readonly ProfileInput: {
            readonly firstName: string;
            readonly lastName: string;
        };
        readonly ProfileSettings: {
            /** @constant */
            readonly status: "ready";
            readonly profile: {
                /** Format: email */
                readonly email: string;
                readonly firstName: string;
                readonly lastName: string;
            };
        };
        readonly RecoveryAccepted: {
            /** @constant */
            readonly status: "accepted";
        };
        readonly RecurringDebt: {
            readonly active: boolean;
            readonly amount: string;
            /** Format: date-time */
            readonly createdAt: string;
            readonly currencyCode: string;
            readonly dayOfMonth: number;
            /** @enum {string} */
            readonly direction: "i_owe" | "they_owe";
            /** Format: date */
            readonly endsOn?: string;
            /** Format: uuid */
            readonly id: string;
            readonly intervalMonths: number;
            /** Format: date */
            readonly nextOccurrenceOn?: string;
            /** Format: uuid */
            readonly personId: string;
            readonly reason?: string;
            /** Format: date */
            readonly startsOn: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly RecurringDebtCreateInput: {
            readonly amount: string;
            readonly currencyCode: string;
            readonly dayOfMonth: number;
            /** @enum {string} */
            readonly direction: "i_owe" | "they_owe";
            /** Format: date */
            readonly endsOn?: string;
            readonly intervalMonths: number;
            readonly reason?: string;
            /** Format: date */
            readonly startsOn: string;
        };
        readonly RecurringDebtCreated: {
            readonly charged: number;
            readonly recurringDebt: components["schemas"]["RecurringDebt"];
            /** @constant */
            readonly status: "created";
        };
        readonly RecurringDebtDeleted: {
            /** Format: uuid */
            readonly recurringDebtId: string;
            /** @constant */
            readonly status: "deleted";
        };
        readonly RecurringDebtSaved: {
            readonly charged: number;
            readonly recurringDebt: components["schemas"]["RecurringDebt"];
            /** @constant */
            readonly status: "saved";
        };
        readonly RecurringDebtUpdateInput: {
            readonly active?: boolean;
            readonly amount?: string;
            readonly currencyCode?: string;
            readonly dayOfMonth?: number;
            /** @enum {string} */
            readonly direction?: "i_owe" | "they_owe";
            readonly endsOn?: string | null;
            readonly intervalMonths?: number;
            readonly reason?: string | null;
            /** Format: date */
            readonly startsOn?: string;
        };
        readonly RegistrationAccepted: {
            /** @constant */
            readonly status: "verification-required";
        };
        readonly RegistrationInput: {
            /** Format: email */
            readonly email: string;
            readonly firstName: string;
            readonly lastName: string;
            readonly password: string;
            readonly workspaceName: string;
        };
        readonly RelatedPersonInput: {
            readonly duplicateOverride?: boolean;
            readonly familyName?: string;
            readonly givenName: string;
            readonly isPartial: boolean;
            readonly middleName?: string;
            readonly nickname?: string;
        };
        readonly RelatedPersonRelationshipChanged: {
            readonly affectedPersonIds: readonly string[];
            readonly forward: components["schemas"]["RelationshipDisplay"];
            readonly inverse: components["schemas"]["RelationshipDisplay"];
            readonly person: components["schemas"]["PersonIdentity"];
            readonly relationship: components["schemas"]["Relationship"];
            /** @constant */
            readonly status: "created";
        };
        readonly RelatedPersonRelationshipInput: {
            readonly person: components["schemas"]["RelatedPersonInput"];
            /** Format: uuid */
            readonly relationshipTypeId: string;
        };
        readonly Relationship: {
            /** Format: date-time */
            readonly createdAt: string;
            readonly forwardLabel: string;
            /** Format: uuid */
            readonly fromPersonId: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: uuid */
            readonly relationshipTypeId: string;
            readonly relationshipTypeArchived: boolean;
            readonly reverseLabel: string;
            /** @enum {string} */
            readonly status: "active" | "ended";
            /** Format: uuid */
            readonly toPersonId: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly RelationshipChanged: {
            readonly affectedPersonIds: readonly string[];
            readonly forward: components["schemas"]["RelationshipDisplay"];
            readonly inverse: components["schemas"]["RelationshipDisplay"];
            readonly relationship: components["schemas"]["Relationship"];
            /** @enum {string} */
            readonly status: "created" | "existing" | "updated";
        };
        readonly RelationshipCreateInput: {
            /** Format: uuid */
            readonly relationshipTypeId: string;
            /** Format: uuid */
            readonly targetPersonId: string;
        };
        readonly RelationshipDeleted: {
            readonly affectedPersonIds: readonly string[];
            /** Format: uuid */
            readonly relationshipId: string;
            /** @constant */
            readonly status: "deleted";
        };
        readonly RelationshipDisplay: {
            readonly label: string;
            readonly name?: string;
            /** Format: uuid */
            readonly personId: string;
            /** Format: uuid */
            readonly relationshipId: string;
        };
        readonly RelationshipList: {
            readonly nextCursor?: string;
            readonly relationships: readonly components["schemas"]["RelationshipWithDisplay"][];
            /** @enum {string} */
            readonly status: "archived" | "hidden" | "ready";
        };
        readonly RelationshipType: {
            readonly archived: boolean;
            readonly forwardLabel: string;
            /** Format: uuid */
            readonly id: string;
            readonly reverseLabel: string;
        };
        readonly RelationshipTypeList: {
            readonly nextCursor?: string;
            readonly options: readonly components["schemas"]["RelationshipType"][];
            readonly selected: readonly components["schemas"]["RelationshipType"][];
            /** @enum {string} */
            readonly status: "hidden" | "ready";
        };
        readonly RelationshipUpdateInput: {
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly relationshipTypeId: string;
        };
        readonly RelationshipWithDisplay: {
            /** Format: date-time */
            readonly createdAt: string;
            readonly forwardLabel: string;
            /** Format: uuid */
            readonly fromPersonId: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: uuid */
            readonly relationshipTypeId: string;
            readonly relationshipTypeArchived: boolean;
            readonly reverseLabel: string;
            /** @enum {string} */
            readonly status: "active" | "ended";
            /** Format: uuid */
            readonly toPersonId: string;
            /** Format: date-time */
            readonly updatedAt: string;
            readonly display: components["schemas"]["RelationshipDisplay"];
        };
        readonly Reminder: {
            /** Format: date */
            readonly anchorOn: string;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            readonly isActive: boolean;
            readonly nextOccurrence?: components["schemas"]["ReminderOccurrence"];
            /** Format: uuid */
            readonly personId: string;
            readonly recurrenceInterval: number;
            /** @enum {string} */
            readonly recurrenceUnit: "none" | "day" | "week" | "month" | "year";
            readonly sendTime: string;
            readonly title: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly ReminderCreateInput: {
            /** Format: date */
            readonly anchorOn: string;
            /** Format: uuid */
            readonly personId: string;
            readonly recurrenceInterval: number;
            /** @enum {string} */
            readonly recurrenceUnit: "none" | "day" | "week" | "month" | "year";
            /** Format: uuid */
            readonly requestId: string;
            readonly sendTime: string;
            readonly title: string;
        };
        readonly ReminderCreated: {
            readonly reminder: components["schemas"]["Reminder"];
            /** @constant */
            readonly status: "created";
        };
        readonly ReminderOccurrence: {
            readonly attemptCount: number;
            /** Format: date-time */
            readonly deliverAt: string;
            readonly error?: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date */
            readonly occursOn: string;
            /** Format: date-time */
            readonly providerEffectAt?: string;
            /** Format: date-time */
            readonly sentAt?: string;
            /** @enum {string} */
            readonly status: "pending" | "claimed" | "retry" | "sent" | "skipped" | "failed" | "cancelled" | "manual_attention";
            /** Format: date-time */
            readonly visibleAt?: string;
        };
        readonly ReminderOccurrenceAcknowledged: {
            /** Format: uuid */
            readonly occurrenceId: string;
            /** @constant */
            readonly status: "acknowledged";
        };
        readonly ReminderSaved: {
            readonly reminder: components["schemas"]["Reminder"];
            /** @constant */
            readonly status: "saved";
        };
        readonly ResolvedMemberPreferences: {
            readonly effectiveTimezone: string;
            /** @enum {string} */
            readonly contactNameOrder: "given_family_nickname" | "family_given_nickname";
            /** @enum {string} */
            readonly contactSortOrder: "given_name_asc" | "family_name_asc";
            readonly currencyCode?: string;
            readonly digestTime?: string;
            readonly fluidLayout: boolean;
            readonly locale: string;
            /** @enum {string} */
            readonly measurementSystem: "metric" | "imperial";
            /** @enum {string} */
            readonly reminderDelivery: "in_app" | "email" | "both";
            /** @enum {string} */
            readonly temperatureScale: "celsius" | "fahrenheit";
            readonly timezone?: string;
        };
        readonly SearchEntityGroup: {
            /** @enum {string} */
            readonly kind: "notes" | "activities" | "journal-posts" | "tasks";
            readonly results: readonly components["schemas"]["SearchEntityResult"][];
            /** @constant */
            readonly unavailable?: true;
        };
        readonly SearchEntityResult: {
            readonly href: string;
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly kind: "note" | "activity" | "journal-post" | "task";
            readonly person?: components["schemas"]["SearchPersonReference"];
            readonly snippet: string;
            readonly title?: string;
        };
        readonly SearchPeopleGroup: {
            /** @constant */
            readonly kind: "people";
            readonly results: readonly components["schemas"]["SearchPersonResult"][];
        };
        readonly SearchPersonReference: {
            readonly archived: boolean;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly SearchPersonResult: {
            readonly archived?: boolean;
            readonly avatar?: components["schemas"]["PersonAvatar"];
            readonly familyName?: string;
            readonly givenName: string;
            readonly href: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "person";
            readonly middleName?: string;
            readonly nickname?: string;
        };
        readonly SearchResults: {
            readonly groups: readonly (components["schemas"]["SearchPeopleGroup"] | components["schemas"]["SearchEntityGroup"])[];
            readonly query: string;
            /** @constant */
            readonly status: "ready";
        };
        readonly SessionContext: {
            /** @constant */
            readonly status: "authenticated";
            readonly principal: {
                /** Format: uuid */
                readonly userId: string;
            };
            readonly workspace: components["schemas"]["AuthenticatedWorkspace"];
            readonly member: components["schemas"]["AuthenticatedMember"];
            readonly workspaces: readonly components["schemas"]["AuthenticatedWorkspace"][];
            readonly requiredLegalDocuments: readonly components["schemas"]["LegalDocument"][];
            readonly uiState?: components["schemas"]["MemberUiState"];
            readonly preferences?: components["schemas"]["ResolvedMemberPreferences"];
        };
        readonly SessionRevoked: {
            /** @constant */
            readonly status: "revoked";
            readonly current: boolean;
        };
        readonly SessionSettings: {
            /** @constant */
            readonly status: "ready";
            readonly sessions: readonly {
                /** Format: uuid */
                readonly id: string;
                readonly current: boolean;
                /** Format: date-time */
                readonly createdAt: string;
                /** Format: date-time */
                readonly lastSeenAt: string;
                /** Format: date-time */
                readonly expiresAt: string;
                readonly ipAddress?: string;
                readonly userAgent?: string;
            }[];
        };
        readonly SignInInput: {
            /** Format: email */
            readonly email: string;
            readonly password: string;
            /** Format: uuid */
            readonly workspaceId?: string;
        };
        readonly SignedOut: {
            /** @constant */
            readonly status: "signed-out";
            /** @constant */
            readonly next: "/auth/sign-in";
        };
        readonly StayInTouchCadence: {
            /** Format: uuid */
            readonly id: string;
            readonly intervalCount: number;
            /** @enum {string} */
            readonly intervalUnit: "day" | "week" | "month" | "year";
            readonly isActive: boolean;
            /** Format: date-time */
            readonly lastContactedAt?: string;
            /** Format: date-time */
            readonly nextDueAt: string;
            /** Format: uuid */
            readonly personId: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly StorageFileLookupItem: {
            readonly byteSize: number;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly fileId: string;
            readonly filename: string;
            readonly kind: string;
            readonly mimeType: string;
            /** Format: uuid */
            readonly personId?: string;
            readonly personName?: string;
            /** @enum {string} */
            readonly status: "available" | "missing" | "processing" | "quarantined";
            readonly title: string;
        };
        readonly StorageSettings: {
            readonly files: readonly components["schemas"]["StorageFileLookupItem"][];
            readonly maximumUploadBytes: number;
            readonly provider: {
                readonly bucket: string;
                /** @enum {string} */
                readonly health: "available" | "not-initialized" | "unavailable";
                readonly name: string;
            };
            /** @constant */
            readonly status: "ready";
            readonly usage: {
                readonly available: number;
                readonly missing: number;
                readonly processing: number;
                readonly quarantined: number;
                readonly totalBytes: number;
                readonly totalFiles: number;
            };
        };
        readonly TagsFact: {
            readonly tagIds: readonly string[];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "tags";
        };
        readonly TagsFactCreateInput: {
            readonly tagIds: readonly string[];
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "tags";
        };
        readonly TagsFactUpdateInput: {
            readonly tagIds: readonly string[];
            /** Format: date-time */
            readonly expectedPersonUpdatedAt: string;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            /** Format: uuid */
            readonly id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            readonly section: "tags";
        };
        readonly Task: {
            /** Format: date-time */
            readonly completedAt?: string;
            /** Format: uuid */
            readonly completedByMemberId?: string;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly createdByMemberId?: string;
            readonly description?: string;
            /** Format: date-time */
            readonly dueAt?: string;
            /** Format: uuid */
            readonly id: string;
            readonly person?: components["schemas"]["TaskPerson"];
            /** @enum {string} */
            readonly status: "cancelled" | "completed" | "open";
            readonly title: string;
            /** Format: date-time */
            readonly updatedAt: string;
        };
        readonly TaskChangeInput: {
            readonly description?: string | null;
            readonly dueAt?: string | null;
            /** Format: date-time */
            readonly expectedUpdatedAt: string;
            readonly personId?: string | null;
            /** @enum {string} */
            readonly status?: "cancelled" | "open";
            readonly title?: string;
        };
        readonly TaskChanged: {
            /** @enum {string} */
            readonly status: "saved" | "unchanged";
            readonly task: components["schemas"]["Task"];
        };
        readonly TaskCompletionInput: {
            readonly completed: boolean;
        };
        readonly TaskCreateInput: {
            readonly description?: string;
            /** Format: date-time */
            readonly dueAt?: string;
            /** Format: uuid */
            readonly personId?: string;
            /** Format: uuid */
            readonly requestId: string;
            readonly title: string;
        };
        readonly TaskCreated: {
            /** @constant */
            readonly status: "created";
            readonly task: components["schemas"]["Task"];
        };
        readonly TaskList: {
            readonly items: readonly components["schemas"]["Task"][];
            readonly nextCursor?: string;
            /** @constant */
            readonly status: "ready";
        };
        readonly TaskPerson: {
            readonly archived: boolean;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
            readonly unavailable?: boolean;
        };
        readonly TaskReady: {
            /** @constant */
            readonly status: "ready";
            readonly task: components["schemas"]["Task"];
        };
        readonly TodayAttention: {
            readonly attention: components["schemas"]["TodayAttentionGroup"];
            /** Format: date */
            readonly date: string;
            /** @constant */
            readonly status: "ready";
            readonly timezone: string;
            readonly upcoming: readonly components["schemas"]["TodayAttentionItem"][];
        };
        readonly TodayAttentionGroup: {
            readonly nextSevenDays: readonly components["schemas"]["TodayAttentionItem"][];
            readonly overdue: readonly components["schemas"]["TodayAttentionItem"][];
            readonly today: readonly components["schemas"]["TodayAttentionItem"][];
        };
        readonly TodayAttentionItem: components["schemas"]["TodayTaskAttentionItem"] | components["schemas"]["TodayReminderAttentionItem"] | components["schemas"]["TodayImportantDateAttentionItem"] | components["schemas"]["TodayLifeEventAttentionItem"] | components["schemas"]["TodayCadenceAttentionItem"];
        readonly TodayAttentionPerson: {
            readonly archived: boolean;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
            readonly unavailable?: boolean;
        };
        readonly TodayCadenceAttentionItem: {
            /** Format: date-time */
            readonly dueAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "cadence";
            readonly person: components["schemas"]["TodayAttentionPerson"];
            /** Format: date-time */
            readonly lastContactedAt?: string;
            readonly title: string;
        };
        readonly TodayCadenceItem: {
            /** Format: date-time */
            readonly dueAt: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly lastContactedAt?: string;
            readonly person: components["schemas"]["TodayReminderPerson"];
        };
        readonly TodayFavoriteNotes: {
            readonly items: readonly components["schemas"]["NoteInteraction"][];
            /** @constant */
            readonly status: "ready";
        };
        readonly TodayImportantDateAttentionItem: {
            /** Format: date-time */
            readonly dueAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "important-date";
            readonly person?: components["schemas"]["TodayAttentionPerson"];
            /** Format: date */
            readonly occursOn: string;
            readonly title: string;
        };
        readonly TodayLifeEventAttentionItem: {
            /** Format: date-time */
            readonly dueAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "life-event";
            readonly person?: components["schemas"]["TodayAttentionPerson"];
            /** Format: date */
            readonly occursOn: string;
            readonly title: string;
        };
        readonly TodayRecentActivity: {
            readonly items: readonly components["schemas"]["ActivityOrNoteInteraction"][];
            /** @constant */
            readonly status: "ready";
        };
        readonly TodayRecentPeople: {
            readonly people: readonly components["schemas"]["TodayRecentPerson"][];
            /** @constant */
            readonly status: "ready";
        };
        readonly TodayRecentPerson: {
            readonly archived: boolean;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly TodayReminderAttentionItem: {
            /** Format: date-time */
            readonly dueAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "reminder";
            readonly person?: components["schemas"]["TodayAttentionPerson"];
            /** Format: date */
            readonly occursOn: string;
            /** @enum {string} */
            readonly channel: "email" | "in_app";
            /** @enum {string} */
            readonly reminderStatus: "failed" | "manual_attention" | "pending" | "retry";
            readonly title: string;
        };
        readonly TodayReminderItem: {
            readonly attemptCount: number;
            /** Format: date-time */
            readonly deliverAt: string;
            /** Format: uuid */
            readonly id: string;
            /** Format: date-time */
            readonly nextAttemptAt?: string;
            readonly person: components["schemas"]["TodayReminderPerson"];
            /** @enum {string} */
            readonly status: "pending" | "claimed" | "retry" | "sent" | "failed" | "manual_attention";
            readonly title: string;
            /** Format: date-time */
            readonly visibleAt?: string;
        } & ({
            /** @constant */
            readonly status?: "retry";
        } | {
            /** @enum {unknown} */
            readonly status?: "pending" | "claimed" | "sent" | "failed" | "manual_attention";
        });
        readonly TodayReminderPerson: {
            readonly archived: boolean;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
        };
        readonly TodayReminders: {
            readonly cadences: readonly components["schemas"]["TodayCadenceItem"][];
            readonly reminders: readonly components["schemas"]["TodayReminderItem"][];
            /** @constant */
            readonly status: "ready";
            readonly timezone: string;
        };
        readonly TodayTaskAttentionItem: {
            /** Format: date-time */
            readonly dueAt: string;
            /** Format: uuid */
            readonly id: string;
            /** @constant */
            readonly kind: "task";
            readonly person?: components["schemas"]["TodayAttentionPerson"];
            readonly title: string;
        };
        readonly TodayTasks: {
            readonly items: readonly components["schemas"]["Task"][];
            /** @constant */
            readonly status: "ready";
        };
        readonly VerificationAccepted: {
            /** @constant */
            readonly status: "verified";
            /** @enum {string} */
            readonly next: "/app" | "/invite/continue";
        } | {
            /** @constant */
            readonly status: "password-required";
            readonly next: string;
        };
        readonly WorkspaceDeleted: {
            /** @enum {string} */
            readonly cleanupStatus: "complete" | "pending";
            /** @constant */
            readonly next: "/auth/sign-in";
            /** @constant */
            readonly status: "deleted";
        };
        readonly WorkspaceLeft: {
            /** @enum {string} */
            readonly next: "/app" | "/auth/sign-in";
            /** Format: uuid */
            readonly nextWorkspaceId?: string;
            /** @constant */
            readonly status: "left";
        };
        readonly WorkspaceLifecycleConfirmation: {
            readonly confirmation: string;
            readonly impactToken: string;
            readonly password: string;
        };
        readonly WorkspaceLifecyclePreview: {
            readonly activeSessionCount: number;
            readonly confirmations: {
                readonly deleteWorkspace: string;
                readonly resetWorkspace: string;
            };
            readonly counts: {
                readonly activities: number;
                readonly auditEvents: number;
                readonly calls: number;
                readonly debts: number;
                readonly exports: number;
                readonly files: number;
                readonly gifts: number;
                readonly imports: number;
                readonly integrations: number;
                readonly journalPosts: number;
                readonly lifeEvents: number;
                readonly members: number;
                readonly messages: number;
                readonly notes: number;
                readonly operations: number;
                readonly people: number;
                readonly relationships: number;
                readonly reminders: number;
                readonly tasks: number;
            };
            readonly impactToken: string;
            /** @constant */
            readonly status: "ready";
            readonly workspace: components["schemas"]["BlockingWorkspace"];
        };
        readonly WorkspaceMembers: {
            /** @constant */
            readonly status: "ready";
            readonly members: readonly {
                /** Format: uuid */
                readonly id: string;
                /** Format: email */
                readonly email: string;
                readonly name: string;
                /** @enum {string} */
                readonly role: "owner" | "admin" | "member";
                /** @constant */
                readonly status: "active";
            }[];
            readonly invitations: readonly {
                /** Format: uuid */
                readonly id: string;
                /** Format: email */
                readonly email: string;
                /** @enum {string} */
                readonly role: "admin" | "member";
                /** @constant */
                readonly status: "pending";
                /** Format: date-time */
                readonly createdAt: string;
                /** Format: date-time */
                readonly expiresAt: string;
                /** @description The member who sent the invitation, or null when their identity is no longer available. */
                readonly invitedBy: {
                    /** Format: uuid */
                    readonly id: string;
                    readonly name: string;
                } | null;
            }[];
        };
        readonly WorkspaceReset: {
            /** @enum {string} */
            readonly cleanupStatus: "complete" | "pending";
            /** @constant */
            readonly next: "/auth/sign-in";
            /** @constant */
            readonly status: "reset";
        };
        readonly WorkspaceSettings: {
            /** @constant */
            readonly status: "ready";
            readonly supportedCurrencyCodes: readonly string[];
            readonly workspace: components["schemas"]["WorkspaceSettingsInput"];
        };
        readonly WorkspaceSettingsInput: {
            readonly name: string;
            readonly slug?: string;
            readonly defaultLocale: string;
            readonly defaultTimezone?: string;
            readonly defaultCurrencyCode?: string;
            readonly defaultReminderTime: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    readonly consumeApplicationEntry: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Narrow application entry context */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ApplicationEntry"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listWorkspaceAudit: {
        readonly parameters: {
            readonly query?: {
                readonly personId?: string;
                readonly actorMemberId?: string;
                readonly action?: string;
                readonly from?: string;
                readonly to?: string;
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Authorized redacted workspace audit history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AuditHistory"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getCalendarFeedDocument: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description A tag from an earlier answer; a match answers 304. */
                readonly "If-None-Match"?: string;
            };
            readonly path: {
                /** @description The feed's secret followed by `.ics`. It is the request's only credential and is never logged. */
                readonly feedFile: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The member's calendar feed */
            readonly 200: {
                headers: {
                    readonly "Cache-Control": "private, max-age=300";
                    /** @description A strong tag of the exact body. */
                    readonly ETag: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/calendar": string;
                };
            };
            /** @description The feed has not changed since the tag presented */
            readonly 304: {
                headers: {
                    readonly "Cache-Control": "private, max-age=300";
                    /** @description A strong tag of the exact body. */
                    readonly ETag: string;
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listCommunicationOptions: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Active communication channels, emotions, and availability */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CommunicationOptions"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly retryVerificationDelivery: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** Format: email */
                    readonly email: string;
                };
            };
        };
        readonly responses: {
            /** @description Delivery retry accepted without identity disclosure */
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** @constant */
                        readonly status: "accepted";
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly verifyEmail: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly token: string;
                };
            };
        };
        readonly responses: {
            /** @description Email verified */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["VerificationAccepted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listExports: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Admin-only export history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly exports: readonly components["schemas"]["ExportSummary"][];
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createWorkspaceExport: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["ExportRequest"];
            };
        };
        readonly responses: {
            /** @description Completed workspace export: portable JSON, a CSV archive, or an all-people vCard */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ExportSummary"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 413: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly downloadExport: {
        readonly parameters: {
            readonly query: {
                readonly token: string;
                /** @description Optional workspace selection for browser download links; validated against active membership. */
                readonly workspaceId?: string;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly exportId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Private export artifact */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": string;
                    readonly "application/zip": string;
                    readonly "text/vcard": string;
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createExportDownload: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly exportId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Short-lived authorized download reference */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ExportDownload"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listImports: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Admin-only import history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly imports: readonly components["schemas"]["ImportSummary"][];
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createImportDryRun: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** @description A Monica JSON export, or `{ format: "vcard" | "csv", text }` with the file's UTF-8 text. */
                    readonly source: Record<string, never>;
                };
            };
        };
        readonly responses: {
            /** @description Validated bounded dry-run, or a CSV import awaiting its column mapping */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ImportDryRun"] | components["schemas"]["ImportMappingRequired"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 413: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getImportReport: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly importId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Import report */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ImportSummary"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly commitImport: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly importId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** @constant */
                    readonly confirmed: true;
                    readonly monicaChoices?: {
                        readonly timezone: string;
                        readonly currencies: readonly {
                            readonly sourceKey: string;
                            readonly currencyCode: string;
                        }[];
                        readonly genders: readonly {
                            readonly sourceKey: string;
                            /** @enum {string} */
                            readonly action: "map" | "source" | "create" | "unspecified";
                            readonly genderId?: string;
                            readonly name?: string;
                        }[];
                    };
                    readonly contactMethodTypes?: readonly {
                        readonly sourceKey: string;
                        /** @enum {string} */
                        readonly action: "create" | "map" | "skip";
                        /** Format: uuid */
                        readonly typeId?: string;
                    }[];
                };
            };
        };
        readonly responses: {
            /** @description Atomic idempotent import commit */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** Format: uuid */
                        readonly importId: string;
                        readonly peopleCreated: number;
                        readonly peopleReused: number;
                        readonly peopleSkippedDeleted: number;
                        /** @constant */
                        readonly status: "completed";
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly mapImportColumns: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly importId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CsvColumnMapping"];
            };
        };
        readonly responses: {
            /** @description Mapped CSV dry-run */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ImportDryRun"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listInteractionOptions: {
        readonly parameters: {
            readonly query?: {
                readonly activityTypeCursor?: string;
                readonly activityTypeSearch?: string;
                readonly emotionCursor?: string;
                readonly emotionSearch?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded active activity types and emotions */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionOptions"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly recordInteraction: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InteractionInput"];
            };
        };
        readonly responses: {
            /** @description Interaction or communication persisted atomically */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteActivity: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InteractionRemovalInput"];
            };
        };
        readonly responses: {
            /** @description Activity deleted at the expected revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateActivity: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ActivityChangeInput"];
            };
        };
        readonly responses: {
            /** @description Activity saved at a new revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteCall: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InteractionRemovalInput"];
            };
        };
        readonly responses: {
            /** @description Call deleted at the expected revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateCall: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CallChangeInput"];
            };
        };
        readonly responses: {
            /** @description Call saved at a new revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteConversation: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InteractionRemovalInput"];
            };
        };
        readonly responses: {
            /** @description Conversation deleted at the expected revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateConversation: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ConversationChangeInput"];
            };
        };
        readonly responses: {
            /** @description Conversation saved at a new revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteNote: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InteractionRemovalInput"];
            };
        };
        readonly responses: {
            /** @description Note deleted at the expected revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateNote: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly interactionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["NoteChangeInput"];
            };
        };
        readonly responses: {
            /** @description Note saved at a new revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InteractionSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listJournal: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Ordered personal journal */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalTimelineList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly linkJournalActivity: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** Format: uuid */
                    readonly activityId: string;
                };
            };
        };
        readonly responses: {
            /** @description Activity linked */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalActivityLinked"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly saveJournalDayRating: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["JournalDayRatingInput"];
            };
        };
        readonly responses: {
            /** @description Day rating updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalDayRatingSaved"];
                };
            };
            /** @description Day rating created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalDayRatingSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getJournalItem: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly itemId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description One journal item */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalItemReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteJournalItem: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly itemId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Journal item removed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createJournalPost: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["JournalPostInput"];
            };
        };
        readonly responses: {
            /** @description Journal post created, or the post an earlier call with the same requestId created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalPostCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateJournalPost: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly itemId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["JournalPostUpdateInput"];
            };
        };
        readonly responses: {
            /** @description Journal post updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["JournalPostUpdated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly acceptLegalDocument: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** Format: uuid */
                    readonly documentId: string;
                };
            };
        };
        readonly responses: {
            /** @description Previously recorded immutable acceptance */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LegalAccepted"];
                };
            };
            /** @description Immutable acceptance recorded */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LegalAccepted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getPublicLegalDocument: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly documentType: "privacy" | "terms";
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Exact active public legal-document version */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LegalDocumentReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getLegalRequirements: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Unaccepted active versions for the current identity and workspace */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LegalRequirements"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly mcp: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
                /** @description Optional. MCP clients send none; a request that carries one other than the configured public web origin is refused with 403. */
                readonly Origin?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["McpMessage"];
            };
        };
        readonly responses: {
            /** @description The JSON-RPC response to a request, a tool's result included; a refused or failed tool call is a result with isError set */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["McpMessage"];
                };
            };
            /** @description A JSON-RPC notification or response, accepted */
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
            /** @description A malformed X-Workspace-Id (RFC 9457 problem), or a message the protocol refuses (a JSON-RPC error) */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["McpMessage"];
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTokenContext: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The presented token and the membership it acts as */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ApiTokenContext"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getMemberUiState: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemberUiStateReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly saveMemberUiState: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["MemberUiStateInput"];
            };
        };
        readonly responses: {
            /** @description Settings saved */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemberUiStateReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly completeMfa: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["MfaInput"];
            };
        };
        readonly responses: {
            /** @description MFA accepted and authenticated session created */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Authenticated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listNotifications: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description One page of the member's notifications */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["NotificationsPage"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly requestPasswordReset: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** Format: email */
                    readonly email: string;
                };
            };
        };
        readonly responses: {
            /** @description Request accepted without identity disclosure */
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RecoveryAccepted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly resetPassword: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PasswordResetInput"];
            };
        };
        readonly responses: {
            /** @description Password reset and sessions revoked */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PasswordResetAccepted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPeople: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly excludePersonId?: string;
                readonly search?: string;
                readonly selectedPersonId?: string;
                readonly tag?: string;
                readonly lifecycle?: "active" | "archived";
                readonly sort?: "given-name" | "family-name" | "recently-added" | "last-contacted" | "recently-updated";
                /** @description Only starred people (GAP-053). */
                readonly starred?: "true" | "false";
                /** @description Starred people before everybody else, each group in the sort order. */
                readonly starredFirst?: "true" | "false";
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Tenant-scoped people directory page */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PeopleDirectoryPage"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createPerson: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonInput"];
            };
        };
        readonly responses: {
            /** @description Workspace-owned person created, or the person an earlier call with the same requestId created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly bulkPeople: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PeopleBulkInput"];
            };
        };
        readonly responses: {
            /** @description Each person's outcome; partial success is expected */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PeopleBulkResult"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly exportPeopleVCards: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PeopleVCardInput"];
            };
        };
        readonly responses: {
            /** @description Member-authorized vCard of the selected people */
            readonly 200: {
                headers: {
                    /** @description How many selected people were missing from the workspace and left out. */
                    readonly "X-Skipped-Count": string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/vcard": string;
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPeopleDuplicates: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded pairs of active people in the workspace who share a full name, an email address, or a phone number */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PeopleDuplicates"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly dismissPeopleDuplicate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PeopleDuplicateDismissalInput"];
            };
        };
        readonly responses: {
            /** @description The duplicate review no longer offers the pair to any member of the workspace */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PeopleDuplicateDismissed"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPeopleTagFacet: {
        readonly parameters: {
            readonly query?: {
                readonly lifecycle?: "active" | "archived";
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded tenant-scoped tag counts for the directory view */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PeopleTagFacet"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPeopleTagOptions: {
        readonly parameters: {
            readonly query?: {
                readonly search?: string;
                readonly cursor?: string;
                readonly selected?: string;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded tenant-scoped people tag options */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PeopleTagOptionsPage"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getPerson: {
        readonly parameters: {
            readonly query?: {
                /** @description summary adds the bounded person summary; rail adds the summary and the first page of every rail section, each with its own status. Neither changes the default response. */
                readonly include?: "summary" | "rail";
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current-workspace person identity, lifecycle, due-information shell, optional bounded summary, and optional composed rail */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deletePerson: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonDeleteInput"];
            };
        };
        readonly responses: {
            /** @description Atomic current-workspace person lifecycle change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly editPerson: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonEditInput"];
            };
        };
        readonly responses: {
            /** @description Atomic current-workspace person lifecycle change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonLifecycleChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getActivityReport: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly kind?: "activity" | "note";
                readonly year?: number;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Tenant-scoped person activity report */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ActivityReport"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly archivePerson: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonTransitionInput"];
            };
        };
        readonly responses: {
            /** @description Atomic current-workspace person lifecycle change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonLifecycleChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonAudit: {
        readonly parameters: {
            readonly query?: {
                readonly actorMemberId?: string;
                readonly action?: string;
                readonly from?: string;
                readonly to?: string;
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Authorized redacted person audit history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AuditHistory"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly replacePersonAvatar: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
                readonly "X-File-Name": string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "image/jpeg": string;
                readonly "image/png": string;
                readonly "image/webp": string;
            };
        };
        readonly responses: {
            /** @description The image is stored, scanned, and now the person's avatar; the one it replaced is removed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonAvatarChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 413: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 423: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly removePersonAvatar: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The person is drawn with their initials again */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonAvatarChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonCommunications: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Tenant-scoped person communication history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CommunicationList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listImportantDates: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Exact important-date list for one workspace person */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ImportantDateList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createImportantDate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ImportantDateInput"];
            };
        };
        readonly responses: {
            /** @description Important date created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ImportantDateChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteImportantDate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly dateId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonTransitionInput"];
            };
        };
        readonly responses: {
            /** @description Important date deleted */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ImportantDateDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateImportantDate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly dateId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ImportantDateUpdateInput"];
            };
        };
        readonly responses: {
            /** @description Important date updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ImportantDateChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createDebt: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["DebtCreateInput"];
            };
        };
        readonly responses: {
            /** @description Debt created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DebtCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteDebt: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly debtId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Debt permanently deleted */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DebtDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listDebtSettlements: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly debtId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Permanent settlement history, newest first */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DebtSettlementList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly changeDebtStatus: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly debtId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["DebtStatusInput"];
            };
        };
        readonly responses: {
            /** @description Debt status changed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DebtSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getPersonDeletionImpact: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Canonical soft-delete impact and confirmation */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonDeletionImpact"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listProfileFacts: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly includeOptions?: "true";
                /** @description Requires includeOptions=true. */
                readonly optionCursor?: string;
                readonly optionSearch?: string;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly section: components["schemas"]["ProfileFactSectionId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description One enabled person profile-fact section */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ProfileFactSection"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createProfileFact: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly section: components["schemas"]["ProfileFactSectionId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ProfileFactCreateInput"];
            };
        };
        readonly responses: {
            /** @description Profile fact saved */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ProfileFactChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateProfileFact: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly section: components["schemas"]["ProfileFactSectionId"];
                readonly factId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ProfileFactUpdateInput"];
            };
        };
        readonly responses: {
            /** @description Profile fact updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ProfileFactChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteProfileFact: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly section: components["schemas"]["ProfileFactSectionId"];
                readonly factId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ProfileFactDeleteInput"];
            };
        };
        readonly responses: {
            /** @description Profile fact deleted */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ProfileFactDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonFiles: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Explicit document and photo states for one person */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonFileList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly uploadPersonFile: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
                readonly "X-File-Kind": "document" | "photo";
                readonly "X-File-Name": string;
                readonly "X-File-Title": string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/pdf": string;
                readonly "application/vnd.openxmlformats-officedocument.wordprocessingml.document": string;
                readonly "image/jpeg": string;
                readonly "image/png": string;
                readonly "image/webp": string;
                readonly "text/plain": string;
            };
        };
        readonly responses: {
            /** @description Stored metadata and typed person link created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonFileCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 413: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly removePersonFile: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly fileId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Person file safely removed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** Format: uuid */
                        readonly fileId: string;
                        /** @constant */
                        readonly status: "removed";
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly downloadPersonFile: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly fileId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Authorized private file bytes */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/pdf": string;
                    readonly "application/vnd.openxmlformats-officedocument.wordprocessingml.document": string;
                    readonly "text/plain": string;
                    readonly "image/jpeg": string;
                    readonly "image/png": string;
                    readonly "image/webp": string;
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 423: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonGiftsAndDebts: {
        readonly parameters: {
            readonly query?: {
                readonly debtCursor?: string;
                readonly giftCursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Person gift and debt sections */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GiftDebtList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createGift: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["GiftCreateInput"];
            };
        };
        readonly responses: {
            /** @description Gift created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GiftCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly changeGiftStatus: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly giftId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["GiftStatusInput"];
            };
        };
        readonly responses: {
            /** @description Gift status changed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GiftSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getPersonIdentity: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Workspace-scoped minimal person identity */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonIdentityReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonLifeEvents: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded precision-aware life-event history from the person profile read model */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonLifeEventsReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createPersonLifeEvent: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonLifeEventInput"];
            };
        };
        readonly responses: {
            /** @description Life event recorded on a current-workspace person */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonLifeEventChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deletePersonLifeEvent: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly lifeEventId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonTransitionInput"];
            };
        };
        readonly responses: {
            /** @description Life event removed at the expected revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonLifeEventDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updatePersonLifeEvent: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly lifeEventId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonLifeEventUpdateInput"];
            };
        };
        readonly responses: {
            /** @description Life event replaced at the expected revision */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonLifeEventChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createRecurringDebt: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RecurringDebtCreateInput"];
            };
        };
        readonly responses: {
            /** @description Recurring debt created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RecurringDebtCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteRecurringDebt: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly recurringDebtId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Recurring debt deleted */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RecurringDebtDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateRecurringDebt: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly recurringDebtId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RecurringDebtUpdateInput"];
            };
        };
        readonly responses: {
            /** @description Recurring debt changed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RecurringDebtSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listRelationships: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Directional relationships for one person profile section */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelationshipList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createRelationship: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelationshipCreateInput"];
            };
        };
        readonly responses: {
            /** @description Idempotent existing relationship */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelationshipChanged"];
                };
            };
            /** @description Relationship created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelationshipChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createRelatedPersonRelationship: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelatedPersonRelationshipInput"];
            };
        };
        readonly responses: {
            /** @description Person and relationship created atomically */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelatedPersonRelationshipChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteRelationship: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly relationshipId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonTransitionInput"];
            };
        };
        readonly responses: {
            /** @description Relationship unlinked without deleting either person */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelationshipDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateRelationship: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
                readonly relationshipId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RelationshipUpdateInput"];
            };
        };
        readonly responses: {
            /** @description Relationship updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelationshipChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonReminders: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Person reminder and cadence section */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonReminders"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly restorePerson: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonTransitionInput"];
            };
        };
        readonly responses: {
            /** @description Atomic current-workspace person lifecycle change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonLifecycleChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly starPerson: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The person is starred */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonStarChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly unstarPerson: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The person is no longer starred */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonStarChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonTimeline: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly kind?: "activity" | "call" | "conversation" | "life-event" | "note";
                readonly limit?: number;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Reverse-chronological tenant-scoped person timeline page */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonTimelinePage"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly exportPersonVCard: {
        readonly parameters: {
            readonly query?: {
                /** @description Optional workspace selection for browser download links; validated against active membership. */
                readonly workspaceId?: string;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Member-authorized person vCard */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/vcard": string;
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly recordPersonView: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly personId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Member-scoped recent-person view recorded */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonViewRecorded"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly mergePeople: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly primaryId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonMergeInput"];
            };
        };
        readonly responses: {
            /** @description Every record of the duplicate now belongs to the primary and the duplicate is deleted; a merge cannot be undone */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonMerged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly previewPeopleMerge: {
        readonly parameters: {
            readonly query: {
                readonly duplicateId: string;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly primaryId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description What merging the duplicate into the primary would keep, discard, and move, from the same decision the merge takes */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonMergePreview"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createFirstWorkspace: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RegistrationInput"];
            };
        };
        readonly responses: {
            /** @description Verification required */
            readonly 202: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RegistrationAccepted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listRelationshipTypes: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly search?: string;
                readonly selected?: readonly string[];
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded active workspace relationship types */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelationshipTypeList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly acknowledgeReminderOccurrence: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly occurrenceId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The undelivered reminder is acknowledged */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReminderOccurrenceAcknowledged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createReminder: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ReminderCreateInput"];
            };
        };
        readonly responses: {
            /** @description Calendar reminder created with unique future occurrences */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReminderCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly setReminderActive: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly reminderId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly active: boolean;
                };
            };
        };
        readonly responses: {
            /** @description Reminder active state changed; safe unattempted work is cancelled when disabled, in-flight delivery is preserved, and future work is regenerated when re-enabled */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReminderSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly searchWorkspace: {
        readonly parameters: {
            readonly query: {
                readonly q: string;
                readonly limit?: number;
                readonly sort?: "given-name" | "family-name";
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Grouped workspace search results */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SearchResults"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getSession: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; always validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Resolved principal and active workspace */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SessionContext"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly signIn: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["SignInInput"];
            };
        };
        readonly responses: {
            /** @description Authenticated session created and rotated */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Authenticated"];
                };
            };
            /** @description MFA challenge required */
            readonly 202: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MfaRequired"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getApiTokens: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Every personal API token of the workspace, with its issuer, for an owner or administrator */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ApiTokenList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createApiToken: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ApiTokenCreateInput"];
            };
        };
        readonly responses: {
            /** @description API token created; secret returned only once */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ApiTokenCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly revokeApiToken: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly tokenId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description API token revoked */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ApiTokenRevoked"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getCalendarFeed: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The member's live calendar feed, if any, without its URL */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CalendarFeedStatus"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createCalendarFeed: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Calendar feed created; the URL is shown this once */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CalendarFeedIssued"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly revokeCalendarFeed: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Calendar feed revoked; its URL answers 404 from now on */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CalendarFeedRevoked"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly rotateCalendarFeed: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The old URL is revoked and a new one is shown this once */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CalendarFeedIssued"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getDavSubscriptions: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description DAV subscription metadata */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DavSubscriptionList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createDavSubscription: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["DavSubscriptionInput"];
            };
        };
        readonly responses: {
            /** @description DAV subscription configured */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DavSubscriptionConfigured"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly disableDavSubscription: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly subscriptionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description DAV subscription disabled without deleting core data */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DavSubscriptionDisabled"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly synchronizeDavSubscription: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly subscriptionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description DAV synchronization completed or produced a recoverable outcome */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DavSyncResult"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listManagedMembers: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ManagedMembers"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateManagedMember: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly memberId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["MemberUpdateInput"];
            };
        };
        readonly responses: {
            /** @description Settings saved */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ManagedMemberResult"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getPersonalLifecyclePreview: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonalLifecyclePreview"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deletePersonalIdentity: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonalIdentityDeletionInput"];
            };
        };
        readonly responses: {
            /** @description Personal identity deleted and sessions revoked */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonalIdentityDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly leaveCurrentWorkspace: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonalLifecycleConfirmation"];
            };
        };
        readonly responses: {
            /** @description Current workspace left with next valid destination */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceLeft"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listPersonalizationEntries: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly section: components["schemas"]["PersonalizationSection"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Active-workspace personalization section */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonalizationList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createPersonalizationEntry: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly section: components["schemas"]["PersonalizationSection"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonalizationCreate"];
            };
        };
        readonly responses: {
            /** @description Personalization entry created */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonalizationSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deletePersonalizationEntry: {
        readonly parameters: {
            readonly query: {
                readonly expectedUpdatedAt: string;
                readonly replacementId?: string;
            };
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly section: components["schemas"]["PersonalizationSection"];
                readonly id: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Personalization entry deleted */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonalizationDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updatePersonalizationEntry: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly section: components["schemas"]["PersonalizationSection"];
                readonly id: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PersonalizationUpdate"];
            };
        };
        readonly responses: {
            /** @description Personalization entry updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PersonalizationSaved"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getMemberPreferences: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PreferenceSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateMemberPreferences: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PreferencesInput"];
            };
        };
        readonly responses: {
            /** @description Settings saved */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PreferenceSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getSettingsProfile: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ProfileSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateSettingsProfile: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ProfileInput"];
            };
        };
        readonly responses: {
            /** @description Settings saved */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ProfileSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listMemberSessions: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SessionSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly revokeMemberSession: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Owned session revoked */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SessionRevoked"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getStorageSettings: {
        readonly parameters: {
            readonly query?: {
                readonly query?: string;
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Admin-only safe workspace storage diagnostics */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["StorageSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getWorkspaceSettings: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly updateWorkspaceSettings: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["WorkspaceSettingsInput"];
            };
        };
        readonly responses: {
            /** @description Settings saved */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceSettings"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getWorkspaceLifecyclePreview: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current member settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceLifecyclePreview"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly deleteWorkspace: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["WorkspaceLifecycleConfirmation"];
            };
        };
        readonly responses: {
            /** @description Workspace deleted and cleanup recorded */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceDeleted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    /** @description Seconds before another current-password attempt. */
                    readonly "Retry-After"?: number;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly resetWorkspace: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["WorkspaceLifecycleConfirmation"];
            };
        };
        readonly responses: {
            /** @description Workspace CRM data reset and sessions revoked */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceReset"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    /** @description Seconds before another current-password attempt. */
                    readonly "Retry-After"?: number;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly signOut: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current session revoked */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SignedOut"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createStayInTouchCadence: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CadenceCreateInput"];
            };
        };
        readonly responses: {
            /** @description Stay-in-touch cadence created or changed */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CadenceCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listTasks: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly limit?: number;
                readonly dueBefore?: string;
                readonly personId?: string;
                readonly status?: "cancelled" | "completed" | "open";
            };
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded tenant-scoped task list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskList"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createTask: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["TaskCreateInput"];
            };
        };
        readonly responses: {
            /** @description Task created idempotently */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskCreated"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTask: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly taskId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description One task in the active workspace */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskReady"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly changeTask: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly taskId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["TaskChangeInput"];
            };
        };
        readonly responses: {
            /** @description Task changed or already equal */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly setTaskCompletion: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Required for cookie-authenticated writes and must exactly match the configured public web origin. Not required for bearer-authenticated writes. */
                readonly Origin?: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly taskId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["TaskCompletionInput"];
            };
        };
        readonly responses: {
            /** @description Idempotent task completion state */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskChanged"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTodayAttention: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Unified member-local Today attention and upcoming projection */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TodayAttention"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTodayFavoriteNotes: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Read-only favorite-note Today region */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TodayFavoriteNotes"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTodayRecentActivity: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Read-only recent-activity Today region */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TodayRecentActivity"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTodayRecentPeople: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Bounded actual member-scoped recently viewed people */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TodayRecentPeople"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTodayReminders: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Independent Today reminder and cadence regions */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TodayReminders"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly getTodayTasks: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Read-only due-task Today region */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TodayTasks"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly createWorkspaceInvitation: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InvitationInput"];
            };
        };
        readonly responses: {
            /** @description Invitation created and delivered */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** @constant */
                        readonly status: "invited";
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly acceptWorkspaceInvitation: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["OptionalInvitationToken"];
            };
        };
        readonly responses: {
            /** @description Invitation accepted */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InvitationAccepted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly authenticateWorkspaceInvitation: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** Format: email */
                    readonly email: string;
                    readonly password: string;
                    readonly token?: string;
                };
            };
        };
        readonly responses: {
            /** @description One-use verified identity entry issued */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** @constant */
                        readonly status: "authenticated";
                        /** @constant */
                        readonly next: "/invite/continue";
                    };
                };
            };
            /** @description Invitation-scoped MFA challenge required */
            readonly 202: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MfaRequired"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly inspectWorkspaceInvitation: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["OptionalInvitationToken"];
            };
        };
        readonly responses: {
            /** @description Pending invitation */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InvitationInspection"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly completeWorkspaceInvitationMfa: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly factor: string;
                };
            };
        };
        readonly responses: {
            /** @description One-use verified identity entry issued */
            readonly 200: {
                headers: {
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** @constant */
                        readonly status: "authenticated";
                        /** @constant */
                        readonly next: "/invite/continue";
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly registerInvitedIdentity: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InvitationRegistrationInput"];
            };
        };
        readonly responses: {
            /** @description Verification required */
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RegistrationAccepted"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 415: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly retryInvitedVerificationDelivery: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Verification delivery accepted */
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** @constant */
                        readonly status: "accepted";
                    };
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 410: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 429: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly revokeWorkspaceInvitation: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                /** @description Must exactly match the configured public web origin. */
                readonly Origin: string;
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path: {
                readonly invitationId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Invitation revoked */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["InvitationRevoked"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    readonly listWorkspaceMembers: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional requested workspace; validated against active membership. */
                readonly "X-Workspace-Id"?: string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Active members and pending invitations */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceMembers"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RFC 9457 problem details */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
