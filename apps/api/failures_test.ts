/**
 * The pin on every refusal the migrated route files answer with.
 *
 * The web app reads `code`; a person reads `title` and `detail`. Both are
 * contract, and GAP-019 and GAP-020 moved every one of them out of a
 * hand-written `if` chain into a table or a named definition, so each is
 * compared here against the exact prose the chains produced before the move. A
 * wording change is allowed — it is just not allowed to be silent.
 *
 * It reads every module's route tables, so it lives beside the one app that
 * mounts them all (GAP-024 moved the routes into their modules and the kit
 * into `packages/http-kit`, whose own responder tests stay beside the kit).
 *
 * Four refusals are built rather than named, because their sentence names
 * something only the result knows: the source a dry run could not read, the
 * workspaces a final owner has to hand on, the number of records still
 * pointing at an option, and the person a new one may duplicate. Each is
 * pinned with arguments of the shape the routes pass.
 */

import { assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  API_TOKEN_FAILURES,
  API_TOKEN_PROBLEMS,
  CALENDAR_FEED_FAILURES,
  CALENDAR_FEED_SETTINGS_PROBLEMS,
} from "../../packages/backend/modules/api-access/transport/http/routes.ts";
import {
  AUTHENTICATION_PROBLEMS,
  MFA_FAILURES,
  SIGN_IN_FAILURES,
} from "../../packages/backend/modules/workspaces/transport/http/authentication.ts";
import {
  EXPORT_FAILURES,
  EXPORT_PROBLEMS,
} from "../../packages/backend/modules/import-export/transport/http/exports.ts";
import {
  FILE_FAILURES,
  STORAGE_FAILURES,
} from "../../packages/backend/modules/files/transport/http/routes.ts";
import {
  AUDIT_FAILURES,
  GOVERNANCE_PROBLEMS,
} from "../../packages/backend/modules/governance/transport/http/routes.ts";
import {
  IMPORT_HISTORY_FAILURES,
  IMPORT_PROBLEMS,
  IMPORT_WRITE_FAILURES,
} from "../../packages/backend/modules/import-export/transport/http/imports.ts";
import {
  CALENDAR_FEED_PROBLEMS,
  INTEGRATION_FAILURES,
  INTEGRATION_PROBLEMS,
} from "../../packages/backend/modules/integrations/transport/http/routes.ts";
import {
  INTERACTION_FAILURES,
  INTERACTION_PROBLEMS,
} from "../../packages/backend/modules/interactions/transport/http/routes.ts";
import {
  INVITATION_DELIVERY_FAILURES,
  INVITATION_FAILURES,
  INVITATION_MFA_FAILURES,
  INVITATION_PROBLEMS,
  INVITATION_REGISTRATION_FAILURES,
  INVITATION_SIGN_IN_FAILURES,
} from "../../packages/backend/modules/workspaces/transport/http/invitations.ts";
import {
  AVATAR_FAILURES,
  DUPLICATE_DISMISSAL_FAILURES,
  IMPORTANT_DATE_FAILURES,
  MERGE_FAILURES,
  PEOPLE_PROBLEMS,
  PERSON_LIFECYCLE_FAILURES,
  PROFILE_FACT_FAILURES,
  STAR_FAILURES,
} from "../../packages/backend/modules/people/transport/http/routes.ts";
import {
  PERSONAL_LIFECYCLE_FAILURES,
  PERSONAL_LIFECYCLE_PROBLEMS,
} from "../../packages/backend/modules/workspaces/transport/http/personal_lifecycle.ts";
import {
  REGISTRATION_PROBLEMS,
  VERIFICATION_FAILURES,
} from "../../packages/backend/modules/workspaces/transport/http/registration.ts";
import {
  RELATIONSHIP_FAILURES,
  RELATIONSHIP_PROBLEMS,
  RELATIONSHIP_SECTION_FAILURES,
  RELATIONSHIP_TYPE_FAILURES,
} from "../../packages/backend/modules/relationships/transport/http/routes.ts";
import {
  PERSONALIZATION_FAILURES,
  SETTINGS_PROBLEMS,
} from "../../packages/backend/modules/workspaces/transport/http/settings.ts";
import {
  WORKSPACE_LIFECYCLE_FAILURES,
  WORKSPACE_LIFECYCLE_PROBLEMS,
} from "../../packages/backend/modules/workspaces/transport/http/workspace_lifecycle.ts";
import { protectedSessionHttpStatus } from "../../packages/backend/modules/workspaces/public.ts";
import { finalOwnerProblem } from "../../packages/backend/modules/workspaces/transport/http/personal_lifecycle.ts";
import { importSourceInvalid } from "../../packages/backend/modules/import-export/transport/http/imports.ts";
import { possibleDuplicate } from "../../packages/backend/modules/people/transport/http/routes.ts";
import { replacementRequired } from "../../packages/backend/modules/workspaces/transport/http/settings.ts";
import { GIFT_FAILURES } from "../../packages/backend/modules/gifts/transport/http/routes.ts";
import {
  JOURNAL_FAILURES,
  LIFE_EVENT_FAILURES,
} from "../../packages/backend/modules/journal/transport/http/routes.ts";
import {
  PLANNING_PROBLEMS,
  REMINDER_FAILURES,
  TASK_FAILURES,
} from "../../packages/backend/modules/planning/transport/http/routes.ts";
import { NOTIFICATIONS_PROBLEMS } from "../../packages/backend/modules/planning/transport/http/notifications.ts";
import {
  failureDefinitions,
  type FailureTable,
} from "../../packages/http-kit/failures.ts";
import type { ProblemDefinition } from "../../packages/http-kit/problem.ts";
import { UNSUPPORTED_MEDIA_TYPE } from "../../packages/http-kit/route.ts";
import { WORKSPACE_HEADER_INVALID } from "../../packages/http-kit/session.ts";
import { NUL_MESSAGE } from "../../packages/http-kit/validate.ts";

/** `status code title detail`, one line per entry, in table order. */
function pinned(table: FailureTable): string {
  const lines = [...failureDefinitions(table)].map(([name, definition]) =>
    [
      name,
      definition.status,
      definition.code,
      definition.title,
      definition.detail,
    ].join(" | ")
  );
  const fallback = table.fallback;
  return [
    ...lines,
    [
      "(fallback)",
      fallback.status,
      fallback.code,
      fallback.title,
      fallback.detail,
    ].join(" | "),
  ].join("\n");
}

/** `status code title detail`, one line per named problem, in list order. */
function listed(problems: readonly ProblemDefinition[]): string {
  return problems.map((definition) =>
    [definition.status, definition.code, definition.title, definition.detail]
      .join(" | ")
  ).join("\n");
}

Deno.test("[GAP-019] the gifts failure table is what gifts.ts answered", () => {
  assertEquals(
    pinned(GIFT_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore the person before changing gifts or debts.",
      "forbidden | 403 | gifts_forbidden | Gifts unavailable | Your active workspace membership no longer permits this action.",
      "invalid-transition | 409 | gift_transition_invalid | Status cannot be changed | Refresh the record and choose a valid next status.",
      "limit-reached | 409 | recurring_debt_limit_reached | Too many recurring debts | This person already has 50 recurring debts. Delete one before adding another.",
      "not-found | 404 | gift_not_found | Record unavailable | The person, recipient, attachment, gift, debt, or recurring debt does not exist in the active workspace.",
      "query-invalid | 400 | gift_query_invalid | Invalid gift query | Reload the first page of gifts and debts before continuing.",
      "validation-error | 400 | gift_invalid | Invalid gift or debt | Review the amount, currency, recipient, attachment, and other fields.",
      "(fallback) | 503 | gifts_unavailable | Gifts unavailable | Gifts and debts are temporarily unavailable.",
    ].join("\n"),
    "gifts problems",
  );
});

Deno.test("[GAP-019] the journal failure table is what journal.ts answered", () => {
  assertEquals(
    pinned(JOURNAL_FAILURES),
    [
      "forbidden | 403 | journal_forbidden | Journal unavailable | Your active workspace membership no longer permits this action.",
      "not-found | 404 | journal_item_not_found | Journal item unavailable | This item does not exist in the active workspace.",
      "query-invalid | 400 | journal_query_invalid | Invalid journal query | Reload the first page of the journal before continuing.",
      "validation-error | 400 | journal_invalid | Invalid journal item | Review the date, rating, title, and content.",
      "(fallback) | 503 | journal_unavailable | Journal unavailable | The journal is temporarily unavailable.",
    ].join("\n"),
    "journal problems",
  );
});

Deno.test("[JOURNAL-002] the life-event failure table names life events", () => {
  assertEquals(
    pinned(LIFE_EVENT_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore this person before changing life events.",
      "forbidden | 403 | life_events_forbidden | Life events unavailable | Your active workspace membership or profile configuration no longer permits this change.",
      "hidden | 403 | life_events_forbidden | Life events unavailable | Your active workspace membership or profile configuration no longer permits this change.",
      "not-found | 404 | life_event_not_found | Life event not found | The person or life event does not exist in the active workspace.",
      "stale | 409 | life_event_stale | Life event changed | Refresh the life events before trying again.",
      "unavailable | 503 | life_events_unavailable | Life events unavailable | Life events are temporarily unavailable.",
      "(fallback) | 400 | validation_failed | Invalid life event | Review the name, type, precision, and known date components.",
    ].join("\n"),
    "life-event problems",
  );
});

Deno.test("[GAP-019] the task failure table is what planning.ts answered", () => {
  assertEquals(
    pinned(TASK_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore the linked person before changing this task.",
      "forbidden | 403 | tasks_forbidden | Tasks unavailable | Your active workspace membership no longer permits this action.",
      "idempotency-conflict | 409 | task_request_conflict | Request identifier already used | Use a new request identifier when the task payload changes.",
      "not-found | 404 | task_not_found | Task unavailable | The task or linked person does not exist in the active workspace.",
      "stale | 409 | task_stale | Task changed | Refresh the task before saving your edits.",
      "stale-cursor | 409 | task_cursor_stale | Task list changed | Reload the first task page before continuing.",
      "(fallback) | 400 | task_validation_failed | Invalid task | Review the task fields and try again.",
    ].join("\n"),
    "task problems",
  );
});

Deno.test("[GAP-019] the reminder failure table is what planning.ts answered", () => {
  assertEquals(
    pinned(REMINDER_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore the person before changing reminders.",
      "forbidden | 403 | reminders_forbidden | Reminders unavailable | Your active membership no longer permits this action.",
      "idempotency-conflict | 409 | reminder_request_conflict | Request identifier already used | Use a new request identifier when reminder fields change.",
      "not-found | 404 | reminder_not_found | Reminder unavailable | The reminder or person does not exist in the active workspace.",
      "stale | 409 | reminder_occurrence_stale | Reminder changed | Only an undelivered reminder can be dismissed. Refresh Today.",
      "(fallback) | 400 | reminder_validation_failed | Invalid reminder | Review the calendar reminder fields.",
    ].join("\n"),
    "reminder problems",
  );
});

Deno.test("[GAP-053] the problems the notification feed answers are pinned", () => {
  assertEquals(
    listed(NOTIFICATIONS_PROBLEMS),
    [
      "403 | notifications_forbidden | Notifications unavailable | Your active workspace membership no longer permits this view.",
      "400 | notifications_query_invalid | Invalid notifications page | Start again from the newest notifications.",
      "503 | notifications_unavailable | Notifications unavailable | Notifications are temporarily unavailable.",
    ].join("\n"),
    "NOTIFICATIONS_PROBLEMS",
  );
});

Deno.test("[GAP-019] the problems planning answers on its own are unchanged", () => {
  assertEquals(
    listed(PLANNING_PROBLEMS),
    [
      "400 | cadence_request_invalid | Invalid stay-in-touch cadence | Use a supported calendar interval.",
      "400 | reminder_request_invalid | Invalid reminder | Use a canonical reminder and explicit active state.",
      "400 | reminder_request_invalid | Invalid reminder | Use supported calendar fields and canonical identifiers.",
      "400 | reminder_request_invalid | Invalid reminder | Use a canonical reminder occurrence.",
      "404 | person_not_found | Person not found | No person with this identifier exists in the current workspace.",
      "400 | reminder_query_invalid | Invalid reminder query | Use a canonical person identifier, a current page cursor, and a bounded limit.",
      "503 | reminders_unavailable | Reminders unavailable | Nothing was changed.",
      "503 | reminders_unavailable | Reminders unavailable | Nothing was saved.",
      "503 | reminders_unavailable | Reminders unavailable | Other person sections remain available.",
      "400 | task_request_invalid | Invalid task | Use a canonical task and at least one supported change.",
      "400 | task_request_invalid | Invalid task | Use a canonical task and explicit completion state.",
      "400 | task_request_invalid | Invalid task | Use supported task fields and canonical identifiers.",
      "400 | task_query_invalid | Invalid task query | Use a canonical person, supported state, and bounded limit.",
      "503 | tasks_unavailable | Tasks unavailable | Saved tasks were not changed.",
      "503 | tasks_unavailable | Tasks unavailable | Nothing was changed.",
      "503 | tasks_unavailable | Tasks unavailable | Nothing was saved. Try again when the service is available.",
      "503 | today_attention_unavailable | Attention unavailable | Other Today regions remain available. Retry the attention queue.",
      "503 | today_reminders_unavailable | Reminder region unavailable | Other Today regions remain available.",
      "503 | today_tasks_unavailable | Due tasks unavailable | Other Today regions remain available.",
    ].join("\n"),
    "planning's own problems",
  );
});

Deno.test("[GAP-020] the refusals api_tokens.ts answers are unchanged", () => {
  assertEquals(
    pinned(API_TOKEN_FAILURES),
    [
      "forbidden | 403 | api_tokens_forbidden | API tokens unavailable | Only an active workspace owner or administrator may manage API tokens.",
      "invalid | 400 | api_token_invalid | Invalid API token | Choose a name, accepted scopes, and a future expiry.",
      "not-found | 404 | api_token_not_found | API token unavailable | That API token does not exist in this workspace or is already revoked.",
      "(fallback) | 503 | api_tokens_unavailable | API tokens unavailable | Your API tokens could not be loaded.",
    ].join("\n"),
    "API_TOKEN_FAILURES",
  );
  assertEquals(
    listed(API_TOKEN_PROBLEMS),
    [
      "503 | api_tokens_unavailable | API token unavailable | The API token could not be created.",
      "404 | api_token_not_found | API token unavailable | That API token does not exist in this workspace.",
      "503 | api_tokens_unavailable | API token unavailable | The API token could not be revoked.",
      "400 | api_token_invalid | Invalid API token | Choose a name, at least one accepted scope, and a future expiry.",
    ].join("\n"),
    "API_TOKEN_PROBLEMS",
  );
});

Deno.test("[INTEGRATION-002] the calendar feed's refusals are pinned", () => {
  assertEquals(
    pinned(CALENDAR_FEED_FAILURES),
    [
      "conflict | 409 | calendar_feed_exists | Calendar feed exists | You already have a calendar feed. Rotate it for a new link.",
      "forbidden | 403 | calendar_feed_forbidden | Calendar feed unavailable | Your active workspace membership no longer permits this.",
      "not-found | 404 | calendar_feed_not_found | Calendar feed not found | You have no calendar feed in this workspace.",
      "(fallback) | 503 | calendar_feed_settings_unavailable | Calendar feed unavailable | Your calendar feed could not be loaded or changed. Try again.",
    ].join("\n"),
    "CALENDAR_FEED_FAILURES",
  );
  assertEquals(
    listed([...CALENDAR_FEED_SETTINGS_PROBLEMS, ...CALENDAR_FEED_PROBLEMS]),
    [
      "503 | calendar_feed_settings_unavailable | Calendar feed unavailable | Your calendar feed could not be loaded or changed. Try again.",
      "404 | calendar_feed_not_found | Calendar feed not found | This calendar feed does not exist or has been revoked.",
      "503 | calendar_feed_unavailable | Calendar feed unavailable | The calendar feed is temporarily unavailable. Try again later.",
    ].join("\n"),
    "CALENDAR_FEED_PROBLEMS",
  );
});

Deno.test("[GAP-020] the refusals authentication.ts answers are unchanged", () => {
  assertEquals(
    listed(AUTHENTICATION_PROBLEMS),
    [
      "503 | legal_unavailable | Legal review unavailable | Required legal documents cannot be confirmed right now.",
      "410 | mfa_challenge_expired | Challenge expired | Return to sign-in and start again.",
      "503 | authentication_unavailable | MFA unavailable | The challenge could not be completed. Please try again.",
      "400 | validation_failed | Invalid recovery request | Provide a valid email address.",
      "503 | password_recovery_unavailable | Recovery unavailable | The recovery request could not be submitted. Please try again.",
      "410 | password_reset_expired | Reset link expired | Request a new password reset link.",
      "400 | validation_failed | Invalid password reset | Use a valid link and a password of at least 12 characters.",
      "503 | password_reset_unavailable | Reset unavailable | Password reset is temporarily unavailable. Please try again.",
      "401 | session_invalid | Authentication required | The session or workspace access is no longer active.",
      "400 | validation_failed | Invalid sign-in | Provide a valid email address and password.",
      "401 | session_invalid | Authentication required | Sign in to continue.",
      "503 | authentication_unavailable | Sign-in unavailable | Sign-in is temporarily unavailable. Please try again.",
      "503 | sign_out_unavailable | Sign-out unavailable | Your session could not be revoked. Please try again.",
    ].join("\n"),
    "AUTHENTICATION_PROBLEMS",
  );
  assertEquals(
    pinned(MFA_FAILURES),
    [
      "challenge-expired | 410 | mfa_challenge_expired | Challenge expired | Return to sign-in and start again.",
      "membership-inactive | 403 | membership_inactive | Workspace access unavailable | Your workspace membership is not active.",
      "rate-limited | 429 | authentication_rate_limited | Try again later | Too many attempts. Return to sign-in when the challenge expires.",
      "(fallback) | 401 | invalid_mfa | Challenge failed | That authenticator or recovery code is not valid.",
    ].join("\n"),
    "MFA_FAILURES",
  );
  assertEquals(
    pinned(SIGN_IN_FAILURES),
    [
      "membership-inactive | 403 | membership_inactive | Workspace access unavailable | Your workspace membership is not active.",
      "rate-limited | 429 | authentication_rate_limited | Try again later | Too many attempts. Wait before trying again.",
      "(fallback) | 401 | invalid_credentials | Sign-in failed | The email address or password is incorrect.",
    ].join("\n"),
    "SIGN_IN_FAILURES",
  );
});

Deno.test("[GAP-020] the refusals exports.ts answers are unchanged", () => {
  assertEquals(
    pinned(EXPORT_FAILURES),
    [
      "expired | 410 | export_download_expired | Download expired | Create a new short-lived download reference from export history.",
      "forbidden | 403 | export_forbidden | Export unavailable | Workspace export is available to owners and administrators only.",
      "not-found | 404 | export_not_found | Export unavailable | This export does not exist in the active workspace.",
      "too-large | 413 | export_too_large | Export too large | This portable profile supports at most 500 people.",
      "(fallback) | 404 | export_not_found | Export unavailable | This export does not exist in the active workspace.",
    ].join("\n"),
    "EXPORT_FAILURES",
  );
  assertEquals(
    listed(EXPORT_PROBLEMS),
    [
      "503 | exports_unavailable | Exports unavailable | A download reference could not be issued.",
      "503 | export_artifact_unavailable | Export unavailable | The export artifact could not be read.",
      "400 | export_format_invalid | Export format invalid | Choose JSON, CSV, or vCard.",
      "503 | exports_unavailable | Exports unavailable | Export history could not be loaded.",
      "503 | export_failed | Export failed | The export artifact could not be completed.",
      "404 | export_not_found | Export unavailable | This export does not exist in the active workspace.",
      "404 | person_not_found | vCard unavailable | None of the selected people exists in the active workspace.",
      "403 | people_forbidden | vCard unavailable | Your active workspace membership no longer permits this export.",
      "400 | validation_failed | Invalid selection | Select between 1 and 100 different people.",
      "503 | vcard_unavailable | vCard unavailable | These people could not be exported right now.",
      "503 | vcard_unavailable | vCard unavailable | This person could not be exported right now.",
    ].join("\n"),
    "EXPORT_PROBLEMS",
  );
});

Deno.test("[GAP-020] the refusals files.ts answers are unchanged", () => {
  assertEquals(
    pinned(FILE_FAILURES),
    [
      "deleted | 410 | file_deleted | File removed | This file has been removed.",
      "forbidden | 403 | files_forbidden | Files unavailable | Your active workspace membership no longer permits this action.",
      "missing | 410 | file_missing | File bytes missing | The file metadata remains visible, but its stored bytes are missing.",
      "not-found | 404 | person_file_not_found | File not found | No file with this opaque identifier exists for this person in the active workspace.",
      "processing | 409 | file_processing | File processing | This file is not ready to open yet.",
      "quarantined | 423 | file_quarantined | File quarantined | This file cannot be opened while it is quarantined.",
      "query-invalid | 400 | file_query_invalid | Invalid file query | Reload the first page of files before continuing.",
      "rejected-media | 415 | file_media_rejected | File type rejected | Choose a supported PDF, document, text, JPEG, PNG, or WebP file.",
      "storage-limit | 413 | file_storage_limit | File too large | Files must be 10485760 bytes or smaller.",
      "validation-error | 400 | file_invalid | Invalid file | Provide a non-empty filename, title, and file body.",
      "(fallback) | 503 | files_unavailable | Files unavailable | The file service is temporarily unavailable.",
    ].join("\n"),
    "FILE_FAILURES",
  );
  assertEquals(
    pinned(STORAGE_FAILURES),
    [
      "forbidden | 403 | storage_settings_forbidden | Storage settings forbidden | Only an active workspace owner or administrator may view storage diagnostics.",
      "validation-error | 400 | storage_lookup_invalid | Invalid file lookup | Search terms must be 100 characters or fewer.",
      "(fallback) | 503 | storage_settings_unavailable | Storage diagnostics unavailable | Workspace storage diagnostics could not be loaded.",
    ].join("\n"),
    "STORAGE_FAILURES",
  );
});

Deno.test("[GAP-020] the refusals governance.ts answers are unchanged", () => {
  assertEquals(
    pinned(AUDIT_FAILURES),
    [
      "forbidden | 403 | audit_forbidden | Audit history unavailable | Audit history requires an active owner or administrator membership.",
      "not-found | 404 | audit_scope_not_found | Audit history unavailable | The selected audit scope does not exist in the active workspace.",
      "stale-cursor | 409 | audit_cursor_stale | Audit page changed | Restart this bounded audit search.",
      "(fallback) | 503 | audit_unavailable | Audit history unavailable | No historical data was changed. Try again.",
    ].join("\n"),
    "AUDIT_FAILURES",
  );
  assertEquals(
    listed(GOVERNANCE_PROBLEMS),
    [
      "400 | audit_query_invalid | Invalid audit search | Use canonical identifiers, an ordered time range, and a bounded page size.",
      "403 | legal_forbidden | Acceptance forbidden | Your active workspace membership no longer permits acceptance.",
      "400 | legal_acceptance_invalid | Invalid acceptance | Accept one exact legal document version.",
      "403 | legal_acceptance_required | Legal acceptance required | Review and accept the required legal document before continuing.",
      "503 | legal_unavailable | Acceptance unavailable | No acceptance was recorded. Try again.",
      "404 | legal_document_not_found | Legal document unavailable | This legal document is not published.",
      "409 | legal_document_superseded | Document version changed | Review the currently required version before continuing.",
      "503 | legal_document_unavailable | Legal document unavailable | The published document cannot be loaded right now.",
      "403 | legal_forbidden | Legal review unavailable | Your active workspace membership no longer permits this review.",
      "401 | session_invalid | Authentication required | The session or workspace access is no longer active.",
      "503 | legal_unavailable | Legal review unavailable | Required legal documents cannot be confirmed right now.",
    ].join("\n"),
    "GOVERNANCE_PROBLEMS",
  );
});

Deno.test("[GAP-020] the refusals imports.ts answers are unchanged", () => {
  assertEquals(
    pinned(IMPORT_HISTORY_FAILURES),
    [
      "forbidden | 403 | import_forbidden | Import unavailable | Workspace import is available to owners and administrators only.",
      "not-found | 404 | import_not_found | Import unavailable | This import does not exist in the active workspace.",
      "(fallback) | 404 | import_not_found | Import unavailable | This import does not exist in the active workspace.",
    ].join("\n"),
    "IMPORT_HISTORY_FAILURES",
  );
  assertEquals(
    listed(IMPORT_PROBLEMS),
    [
      "400 | import_confirmation_required | Confirmation required | Confirm the validated dry-run before committing it.",
      "404 | import_not_found | Import unavailable | This import does not exist in the active workspace.",
      "413 | import_too_large | Import too large | The import source exceeds the 1.5 MB staging limit.",
    ].join("\n"),
    "IMPORT_PROBLEMS",
  );
  assertEquals(
    pinned(IMPORT_WRITE_FAILURES),
    [
      "monica-choices-changed | 400 | import_monica_choices_changed | Import choices changed | Another import has already resolved these choices. Validate the source again to reuse the saved resolutions before committing.",
      "monica-choice-required | 400 | import_monica_choice_required | Import choices required | Choose your timezone, a supported currency for every unresolved debt, and an active gender option or Unspecified for every unresolved contact. Validate again if available options changed.",
      "contact-type-decision-required | 400 | import_contact_type_decision_required | Contact type choice required | Choose Create, an active existing type, or Skip for every unmatched contact type. A type may have changed since validation; validate again to refresh the choices.",
      "confirmation-required | 400 | import_confirmation_required | Confirmation required | Confirm the validated dry-run before committing it.",
      "forbidden | 403 | import_forbidden | Import unavailable | Workspace import is available to owners and administrators only.",
      "not-found | 404 | import_not_found | Import unavailable | This validated import does not exist in the active workspace.",
      "(fallback) | 400 | import_confirmation_required | Confirmation required | Confirm the validated dry-run before committing it.",
    ].join("\n"),
    "IMPORT_WRITE_FAILURES",
  );
});

Deno.test("[GAP-020] the refusals integrations.ts answers are unchanged", () => {
  assertEquals(
    pinned(INTEGRATION_FAILURES),
    [
      "busy | 409 | integration_busy | DAV unavailable | Synchronization is already running. Retry after it finishes.",
      "forbidden | 403 | integrations_forbidden | DAV unavailable | Only an active workspace owner or administrator may manage integrations.",
      "invalid | 400 | integration_invalid | DAV unavailable | Use a public HTTPS DAV URL and valid credentials.",
      "not-found | 404 | integration_not_found | DAV unavailable | That integration does not exist in this workspace.",
      "(fallback) | 503 | integrations_unavailable | DAV unavailable | Integrations could not be loaded.",
    ].join("\n"),
    "INTEGRATION_FAILURES",
  );
  assertEquals(
    listed(INTEGRATION_PROBLEMS),
    [
      "403 | origin_invalid | DAV unavailable | Request origin is not allowed.",
      "404 | integration_not_found | DAV unavailable | That integration does not exist.",
      "503 | integrations_unavailable | DAV unavailable | The integration could not be configured.",
      "503 | integrations_unavailable | DAV unavailable | The integration could not be disabled.",
      "400 | integration_invalid | DAV unavailable | Enter a name, public HTTPS URL, username, and secret.",
      "503 | integrations_unavailable | DAV unavailable | Integrations could not be loaded.",
      "503 | integrations_unavailable | DAV unavailable | Synchronization could not finish.",
    ].join("\n"),
    "INTEGRATION_PROBLEMS",
  );
});

Deno.test("[GAP-020] the refusals interactions.ts answers are unchanged", () => {
  assertEquals(
    pinned(INTERACTION_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore every selected person before recording an interaction.",
      "forbidden | 403 | interactions_forbidden | Interaction unavailable | Your active workspace membership or profile configuration no longer permits this action.",
      "hidden | 403 | interactions_forbidden | Interaction unavailable | Your active workspace membership or profile configuration no longer permits this action.",
      "idempotency-conflict | 409 | interaction_request_conflict | Request identifier already used | Use a new request identifier when the interaction payload changes.",
      "not-found | 404 | interaction_context_not_found | Interaction unavailable | A selected person, activity type, or emotion does not exist in the active workspace.",
      "stale-cursor | 409 | interaction_cursor_stale | Interaction page changed | Restart this bounded option or report search.",
      "(fallback) | 400 | validation_failed | Invalid interaction | Review the participants, occurrence time, and content.",
    ].join("\n"),
    "INTERACTION_FAILURES",
  );
  assertEquals(
    listed(INTERACTION_PROBLEMS),
    [
      "400 | activity_report_query_invalid | Invalid activity report | Use a canonical person, year, and bounded page size.",
      "503 | activity_report_unavailable | Activity report unavailable | Saved interactions were not changed.",
      "503 | communication_options_unavailable | Communication options unavailable | Try again before recording communication.",
      "400 | communication_query_invalid | Invalid communication query | Use a canonical person identifier.",
      "503 | communications_unavailable | Communication unavailable | Saved communication was not changed.",
      "503 | today_favorite_notes_unavailable | Favorite notes unavailable | Other Today regions remain available.",
      "503 | interactions_unavailable | Interaction unavailable | Nothing was saved. Try again when the service is available.",
      "400 | interaction_request_invalid | Invalid interaction | Use supported interaction fields and canonical identifiers.",
      "400 | interaction_options_query_invalid | Invalid options search | Use bounded searches and opaque cursors.",
      "503 | interaction_options_unavailable | Options unavailable | Try again before recording an interaction.",
      "503 | today_recent_activity_unavailable | Recent activity unavailable | Other Today regions remain available.",
    ].join("\n"),
    "INTERACTION_PROBLEMS",
  );
});

Deno.test("[GAP-020] the refusals invitations.ts answers are unchanged", () => {
  assertEquals(
    pinned(INVITATION_DELIVERY_FAILURES),
    [
      "expired | 410 | invitation_expired | Verification delivery unavailable | This invitation can no longer continue.",
      "invalid | 404 | invitation_invalid | Verification delivery unavailable | This invitation can no longer continue.",
      "revoked | 410 | invitation_revoked | Verification delivery unavailable | This invitation can no longer continue.",
      "used | 410 | invitation_used | Verification delivery unavailable | This invitation can no longer continue.",
      "(fallback) | 410 | invitation_used | Verification delivery unavailable | This invitation can no longer continue.",
    ].join("\n"),
    "INVITATION_DELIVERY_FAILURES",
  );
  assertEquals(
    pinned(INVITATION_FAILURES),
    [
      "already-member | 409 | already_member | Membership already exists | A membership record for this workspace already exists and this invitation was not consumed.",
      "expired | 410 | invitation_expired | Invitation unavailable | This invitation has expired.",
      "invalid | 404 | invitation_invalid | Invitation unavailable | This invitation link is invalid.",
      "revoked | 410 | invitation_revoked | Invitation unavailable | This invitation was revoked.",
      "used | 410 | invitation_used | Invitation unavailable | This invitation has already been used.",
      "wrong-user | 403 | invitation_wrong_user | Use the invited account | This invitation belongs to a different email address.",
      "(fallback) | 410 | invitation_used | Invitation unavailable | This invitation has already been used.",
    ].join("\n"),
    "INVITATION_FAILURES",
  );
  assertEquals(
    pinned(INVITATION_MFA_FAILURES),
    [
      "challenge-expired | 410 | mfa_challenge_expired | Challenge failed | Return to the invitation and sign in again.",
      "rate-limited | 429 | authentication_rate_limited | Challenge delayed | Wait before trying again.",
      "(fallback) | 401 | invalid_mfa | Challenge failed | That authenticator or recovery code is not valid.",
    ].join("\n"),
    "INVITATION_MFA_FAILURES",
  );
  assertEquals(
    listed(INVITATION_PROBLEMS),
    [
      "409 | already_member | Membership already exists | That email already has a membership record in this workspace. Manage its lifecycle explicitly instead of inviting it again.",
      "429 | verification_delivery_rate_limited | Verification retry delayed | Wait a few minutes before requesting another verification email.",
      "503 | invitation_verification_delivery_failed | Verification email delayed | The verification email still could not be delivered. Please try again.",
      "404 | invitation_invalid | Verification delivery unavailable | Return to the invitation and try again.",
      "401 | invalid_credentials | Sign-in failed | The email address or password is incorrect.",
      "503 | invitation_delivery_failed | Invitation delivery unavailable | The invitation was saved but its email could not be delivered. Contact an administrator before trying again.",
      "410 | invitation_unavailable | Invitation unavailable | This invitation can no longer continue.",
      "403 | invitation_forbidden | Invitation forbidden | Only an active workspace owner or admin may invite members.",
      "429 | invitation_limit_reached | Invitation limit reached | No more invitations can be sent from this workspace or to this address today. Try again tomorrow.",
      "404 | invitation_invalid | Invitation unavailable | This invitation link is invalid.",
      "503 | invitation_unavailable | Invitation unavailable | The invitation could not be accepted. Please try again.",
      "503 | invitation_unavailable | Invitation unavailable | The invitation could not be checked. Please try again.",
      "503 | invitation_delivery_failed | Invitation delivery unavailable | The invitation could not be created. Please try again.",
      "404 | invitation_not_found | Invitation not found | That invitation is not pending in this workspace.",
      "503 | invitation_unavailable | Invitation unavailable | The invitation could not be revoked. Please try again.",
      "400 | validation_failed | Invalid invitation | Provide a valid email address and allowed role.",
      "403 | invitation_forbidden | Invitation forbidden | Only an active workspace owner or admin may revoke invitations.",
      "401 | session_invalid | Sign in required | Sign in as the invited email address to accept.",
      "503 | invitation_verification_delivery_failed | Verification email delayed | Your account was created for this invitation, but the verification email could not be delivered. Retry delivery.",
      "403 | inviter_not_established | Invitation forbidden | You can send invitations once your email address has been verified for a day.",
      "403 | members_forbidden | Members unavailable | Only an active workspace owner or admin may view this page.",
      "503 | members_unavailable | Members unavailable | Members and invitations could not be loaded.",
      "410 | mfa_challenge_expired | Challenge expired | Return to the invitation and sign in again.",
      "503 | authentication_unavailable | Challenge unavailable | Please try again.",
      "400 | validation_failed | Registration unavailable | Check the invitation and registration fields.",
      "503 | authentication_unavailable | Sign-in unavailable | Please try again.",
      "429 | verification_mail_limit_reached | Verification email limit reached | No more verification emails can be sent to this address today. Try again tomorrow.",
    ].join("\n"),
    "INVITATION_PROBLEMS",
  );
  assertEquals(
    pinned(INVITATION_REGISTRATION_FAILURES),
    [
      "expired | 410 | invitation_expired | Registration unavailable | This invitation can no longer be used.",
      "invalid | 404 | invitation_registration_unavailable | Registration unavailable | Use the invited email address or sign in to an existing account.",
      "revoked | 410 | invitation_revoked | Registration unavailable | This invitation can no longer be used.",
      "used | 410 | invitation_used | Registration unavailable | This invitation can no longer be used.",
      "(fallback) | 409 | invitation_registration_unavailable | Registration unavailable | Use the invited email address or sign in to an existing account.",
    ].join("\n"),
    "INVITATION_REGISTRATION_FAILURES",
  );
  assertEquals(
    pinned(INVITATION_SIGN_IN_FAILURES),
    [
      "rate-limited | 429 | authentication_rate_limited | Sign-in delayed | Wait before trying again.",
      "(fallback) | 401 | invalid_credentials | Sign-in failed | The email address or password is incorrect.",
    ].join("\n"),
    "INVITATION_SIGN_IN_FAILURES",
  );
});

Deno.test("[GAP-020] the refusals people.ts answers are unchanged", () => {
  assertEquals(
    pinned(IMPORTANT_DATE_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore this person before changing important dates.",
      "conflict | 409 | person_date_conflict | Important date already exists | Birthday, first meeting, and date of death can each be recorded once.",
      "forbidden | 403 | people_forbidden | Important dates unavailable | Your active workspace membership no longer permits this change.",
      "not-found | 404 | person_date_not_found | Important date not found | The person or important date does not exist in the active workspace.",
      "stale | 409 | person_date_stale | Important date changed | Refresh the important dates before trying again.",
      "(fallback) | 400 | validation_failed | Invalid important date | Use only the components declared by the selected precision.",
    ].join("\n"),
    "IMPORTANT_DATE_FAILURES",
  );
  assertEquals(
    listed(PEOPLE_PROBLEMS),
    [
      "404 | person_not_found | Person not found | No active person with this identifier exists in the current workspace.",
      "404 | person_not_found | Person not found | No person with this identifier exists in the current workspace.",
      "503 | people_unavailable | Deletion impact unavailable | The person service is temporarily unavailable.",
      "400 | validation_failed | Invalid dismissal | Name the two people by their canonical identifiers.",
      "403 | people_forbidden | Duplicates unavailable | Your active workspace membership no longer permits this view.",
      "503 | people_unavailable | Duplicates unavailable | Possible duplicates are temporarily unavailable.",
      "400 | validation_failed | Invalid important date | Review the precision and known components.",
      "400 | validation_failed | Invalid important date deletion | Refresh this important date before deleting it.",
      "503 | important_dates_unavailable | Important date could not be deleted | The important-date service is temporarily unavailable.",
      "503 | important_dates_unavailable | Important date could not be saved | The important-date service is temporarily unavailable.",
      "400 | validation_failed | Invalid important date | Review the precision, known components, and current version.",
      "403 | people_forbidden | Important dates unavailable | Your active workspace membership no longer permits this view.",
      "503 | important_dates_unavailable | Important dates unavailable | Important dates are temporarily unavailable.",
      "403 | people_forbidden | Life events unavailable | Your active workspace membership no longer permits this view.",
      "503 | person_life_events_unavailable | Life events unavailable | Other person sections remain available.",
      "400 | validation_failed | Invalid lifecycle request | Refresh this person before trying again.",
      "400 | validation_failed | Invalid merge preview | Name both people to merge by their canonical identifiers.",
      "503 | people_unavailable | Merge preview unavailable | What a merge would change is temporarily unavailable.",
      "400 | validation_failed | Invalid merge request | Choose the duplicate to merge by its canonical identifier.",
      "403 | people_forbidden | People unavailable | Your active workspace membership no longer permits this change.",
      "400 | validation_failed | Invalid bulk action | Select between 1 and 100 different people, and a tag only when tagging.",
      "400 | profile_fact_reference_invalid | Profile option unavailable | Select an active option from the current workspace.",
      "503 | people_unavailable | People could not be changed | The person service is temporarily unavailable.",
      "409 | stale_cursor | People list changed | Refresh the directory before continuing from this page.",
      "403 | people_forbidden | People unavailable | Your active workspace membership no longer permits this view.",
      "503 | people_unavailable | People could not be merged | Nothing was merged. The person service is temporarily unavailable.",
      "400 | people_query_invalid | Invalid people query | Review the search, tag, sort, lifecycle, and pagination criteria.",
      "503 | people_unavailable | People unavailable | The people directory is temporarily unavailable.",
      "403 | people_forbidden | Person could not be created | Your active workspace membership no longer permits this change.",
      "400 | validation_failed | Invalid person | Review the identity fields and try again.",
      "400 | validation_failed | Invalid person | Review the highlighted identity fields and try again.",
      "400 | validation_failed | Invalid deletion request | Use the current deletion impact preview and exact confirmation.",
      "400 | validation_failed | Invalid person | Review the identity fields and current version before saving.",
      "403 | people_forbidden | Person unavailable | Your active workspace membership no longer permits this view.",
      "400 | person_id_invalid | Invalid person | Use a valid canonical person identifier.",
      "503 | people_unavailable | Person could not be changed | The person service is temporarily unavailable.",
      "503 | people_unavailable | Person could not be created | The person service is temporarily unavailable.",
      "503 | people_unavailable | Person could not be deleted | The person service is temporarily unavailable.",
      "503 | people_unavailable | Person could not be updated | The person service is temporarily unavailable.",
      "400 | person_query_invalid | Invalid person query | Use include=summary to request the person summary.",
      "503 | people_unavailable | Person unavailable | The person service is temporarily unavailable.",
      "400 | person_view_invalid | Invalid person view | Use a canonical person identifier and an empty request body.",
      "404 | person_not_found | Person not found | No viewable person with this identifier exists in the current workspace.",
      "503 | person_view_unavailable | Person view unavailable | Recent-person history could not be updated.",
      "503 | person_view_unavailable | Person view unavailable | The person could not be resolved before updating recent history.",
      "400 | validation_failed | Invalid profile fact | Review the fields for this profile section.",
      "400 | profile_fact_request_invalid | Invalid profile fact | Use a supported section and canonical person identifier.",
      "409 | profile_fact_cursor_stale | Profile section changed | Restart this profile section before loading more facts.",
      "400 | profile_fact_request_invalid | Invalid profile fact | Use current canonical profile identifiers.",
      "503 | profile_facts_unavailable | Profile fact could not be deleted | This profile section is temporarily unavailable.",
      "503 | profile_facts_unavailable | Profile fact could not be saved | This profile section is temporarily unavailable.",
      "400 | profile_fact_request_invalid | Invalid profile fact | Use supported canonical profile identifiers.",
      "400 | validation_failed | Invalid profile fact | Review the identifiers and current version for this profile fact.",
      "403 | people_forbidden | Profile facts unavailable | Your active workspace membership no longer permits this view.",
      "503 | profile_facts_unavailable | Profile facts unavailable | This profile section is temporarily unavailable.",
      "400 | profile_fact_request_invalid | Invalid profile section | Use a supported section and canonical person identifier.",
      "403 | people_forbidden | Recent people unavailable | Your active workspace membership no longer permits this view.",
      "503 | today_recent_people_unavailable | Recent people unavailable | Recently viewed people are temporarily unavailable.",
      "403 | search_forbidden | Search unavailable | Your active workspace membership no longer permits this search.",
      "400 | search_query_invalid | Invalid search | Search for one to two hundred characters, ten results at most.",
      "503 | search_unavailable | Search unavailable | Search is temporarily unavailable.",
      "403 | people_forbidden | Tag counts unavailable | Your active workspace membership no longer permits this view.",
      "400 | tag_facet_query_invalid | Invalid tag facet query | Ask for the active or the archived people's tags.",
      "503 | tag_facet_unavailable | Tag counts unavailable | Tag counts are temporarily unavailable.",
      "400 | tag_options_cursor_invalid | Invalid tag options cursor | Start a new tag search before continuing.",
      "403 | people_forbidden | Tag options unavailable | Your active workspace membership no longer permits this view.",
      "400 | tag_options_query_invalid | Invalid tag options query | Review the tag search and pagination criteria.",
      "503 | tag_options_unavailable | Tag options unavailable | Tag options are temporarily unavailable.",
      "409 | person_timeline_stale_cursor | Person timeline changed | Refresh the timeline before continuing from this page.",
      "403 | person_timeline_forbidden | Person timeline unavailable | Your active workspace membership no longer permits this view.",
      "404 | person_timeline_not_found | Person not found | No active person with this identifier exists in the current workspace.",
      "400 | person_timeline_query_invalid | Invalid person timeline | Use a canonical person, supported kind, and bounded page size.",
      "401 | person_timeline_authentication_required | Authentication required | Sign in with an active workspace membership.",
      "503 | person_timeline_unavailable | Person timeline unavailable | Other person sections remain available.",
      "404 | person_not_found | Person not found | No person with this identifier exists in the active workspace.",
    ].join("\n"),
    "PEOPLE_PROBLEMS",
  );
  assertEquals(
    pinned(PERSON_LIFECYCLE_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore this person before editing their identity.",
      "confirmation-required | 400 | confirmation_required | Confirmation required | Enter the exact confirmation shown in the deletion impact preview.",
      "forbidden | 403 | people_forbidden | Person unavailable | Your active workspace membership no longer permits this change.",
      "not-found | 404 | person_not_found | Person not found | No person with this identifier exists in the current workspace.",
      "stale | 409 | person_stale | Person changed | Refresh this person before trying the lifecycle action again.",
      "(fallback) | 400 | validation_failed | Invalid person | Review the highlighted identity fields and try again.",
    ].join("\n"),
    "PERSON_LIFECYCLE_FAILURES",
  );
  assertEquals(
    pinned(PROFILE_FACT_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore this person before changing profile facts.",
      "forbidden | 403 | people_forbidden | Profile facts unavailable | Your active workspace membership no longer permits this change.",
      "hidden | 409 | profile_section_hidden | Profile section hidden | An administrator disabled this section. Saved data was retained.",
      "invalid-reference | 400 | profile_fact_reference_invalid | Profile option unavailable | Select an active option from the current workspace.",
      "not-found | 404 | person_fact_not_found | Profile fact not found | The person or profile fact does not exist in the active workspace.",
      "stale | 409 | profile_fact_stale | Profile fact changed | Refresh this section before trying again.",
      "(fallback) | 400 | validation_failed | Invalid profile fact | Review the highlighted profile fields.",
    ].join("\n"),
    "PROFILE_FACT_FAILURES",
  );
});

Deno.test("[GAP-020] the refusals personal_lifecycle.ts answers are unchanged", () => {
  assertEquals(
    pinned(PERSONAL_LIFECYCLE_FAILURES),
    [
      "confirmation-invalid | 400 | confirmation_invalid | Confirmation does not match | Type the exact confirmation shown in the current impact preview.",
      "not-found | 401 | session_invalid | Authentication required | Sign in with an active workspace membership.",
      "rate-limited | 429 | authentication_rate_limited | Try again later | Too many attempts. Wait before trying again.",
      "reauthentication-required | 403 | reauthentication_required | Recent authentication required | Enter your current password before continuing with this lifecycle action.",
      "(fallback) | 503 | personal_lifecycle_unavailable | Account lifecycle unavailable | The current impact could not be revalidated. Nothing was changed.",
    ].join("\n"),
    "PERSONAL_LIFECYCLE_FAILURES",
  );
  assertEquals(
    listed(PERSONAL_LIFECYCLE_PROBLEMS),
    [
      "400 | validation_failed | Reauthentication and confirmation required | Enter your current password and exact deletion confirmation.",
      "400 | validation_failed | Confirmation required | Enter your current password and exact leave confirmation from the current preview.",
    ].join("\n"),
    "PERSONAL_LIFECYCLE_PROBLEMS",
  );
});

Deno.test("[GAP-020] the refusals registration.ts answers are unchanged", () => {
  assertEquals(
    listed(REGISTRATION_PROBLEMS),
    [
      "400 | validation_failed | Invalid delivery request | Provide a valid email address.",
      "409 | entry_handoff_invalid | Application entry unavailable | Use the link from a completed verification.",
      "409 | entry_handoff_invalid | Application entry unavailable | This application-entry handoff cannot be used.",
      "503 | entry_handoff_unavailable | Application entry unavailable | Application entry is temporarily unavailable. Please try again.",
      "403 | origin_invalid | Application entry forbidden | This request did not come from the configured application origin.",
      "409 | entry_handoff_invalid | Application entry unavailable | Workspace access is no longer active.",
      "503 | registration_failed | Registration unavailable | Nothing was created. Please try again.",
      "400 | validation_failed | Invalid registration | Check the highlighted fields.",
      "503 | verification_delivery_failed | Verification email delayed | Your account was created with its workspace, but the verification email could not be delivered. Retry delivery.",
      "400 | invalid_verification | Verification link invalid | Request a new verification link.",
      "503 | verification_unavailable | Verification unavailable | Email verification is temporarily unavailable. Please try again.",
    ].join("\n"),
    "REGISTRATION_PROBLEMS",
  );
  assertEquals(
    pinned(VERIFICATION_FAILURES),
    [
      "expired | 410 | verification_expired | Email not verified | This verification link cannot be used.",
      "replayed | 409 | verification_replayed | Email not verified | This verification link cannot be used.",
      "(fallback) | 409 | invalid_verification | Email not verified | This verification link cannot be used.",
    ].join("\n"),
    "VERIFICATION_FAILURES",
  );
});

Deno.test("[GAP-020] the refusals relationships.ts answers are unchanged", () => {
  assertEquals(
    pinned(RELATIONSHIP_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore both people before changing their relationship.",
      "forbidden | 403 | relationships_forbidden | Relationships unavailable | Your active workspace membership no longer permits this action.",
      "not-found | 404 | relationship_not_found | Relationship unavailable | The relationship, person, or type does not exist in the active workspace.",
      "possible-duplicate | 409 | related_person_possible_duplicate | Possible duplicate person | Choose the existing person or explicitly confirm creating another.",
      "stale | 409 | relationship_stale | Relationship changed | Refresh relationships before trying again.",
      "(fallback) | 400 | validation_failed | Invalid relationship | Review the selected person, type, and current version.",
    ].join("\n"),
    "RELATIONSHIP_FAILURES",
  );
  assertEquals(
    listed(RELATIONSHIP_PROBLEMS),
    [
      "400 | relationship_request_invalid | Invalid relationship | Select another person and an active relationship type.",
      "400 | relationship_request_invalid | Invalid related person | Provide a valid person identity and active relationship type.",
      "503 | relationships_unavailable | Related person unavailable | Neither the person nor relationship was saved.",
      "503 | relationships_unavailable | Relationships unavailable | The relationship could not be changed.",
      "503 | relationships_unavailable | Relationships unavailable | The relationship could not be saved.",
      "503 | relationships_unavailable | Relationships unavailable | The relationship could not be unlinked.",
      "400 | relationship_request_invalid | Invalid relationship request | Use a canonical person identifier.",
      "400 | relationship_types_query_invalid | Invalid relationship type query | Review the search and selected type.",
      "400 | relationship_request_invalid | Invalid relationship | Use current canonical identifiers and version.",
    ].join("\n"),
    "RELATIONSHIP_PROBLEMS",
  );
  assertEquals(
    pinned(RELATIONSHIP_SECTION_FAILURES),
    [
      "forbidden | 403 | relationships_forbidden | Relationships unavailable | Your active workspace membership no longer permits this view.",
      "not-found | 404 | relationship_not_found | Relationships unavailable | The person does not exist in the active workspace.",
      "stale-cursor | 409 | relationships_cursor_stale | Relationships changed | Refresh the relationship section before loading another page.",
      "(fallback) | 503 | relationships_unavailable | Relationships unavailable | This relationship section is temporarily unavailable.",
    ].join("\n"),
    "RELATIONSHIP_SECTION_FAILURES",
  );
  assertEquals(
    pinned(RELATIONSHIP_TYPE_FAILURES),
    [
      "forbidden | 403 | relationship_types_forbidden | Relationship types unavailable | Your active workspace no longer permits this action.",
      "stale-cursor | 409 | relationship_types_cursor_stale | Relationship types changed | Restart relationship type search from the first page.",
      "(fallback) | 503 | relationship_types_unavailable | Relationship types unavailable | Relationship types are temporarily unavailable.",
    ].join("\n"),
    "RELATIONSHIP_TYPE_FAILURES",
  );
});

Deno.test("[GAP-020] the refusals settings.ts answers are unchanged", () => {
  assertEquals(
    pinned(PERSONALIZATION_FAILURES),
    [
      "conflict | 409 | personalization_duplicate | Name already used | Choose a unique name in this workspace.",
      "forbidden | 403 | personalization_forbidden | Personalization forbidden | Only an active workspace owner or admin may manage personalization.",
      "invalid | 400 | validation_failed | Invalid personalization change | That change is not supported by this section.",
      "not-found | 404 | personalization_not_found | Option unavailable | That option does not belong to this active workspace.",
      "replacement-conflict | 409 | personalization_replacement_conflict | Replacement conflicts with existing history | Some records already use both the source and replacement options. Resolve the duplicate primary or relationship history before replacing this option.",
      "required-default | 409 | personalization_required_default | Required option | This required or seeded option can be disabled where supported, but cannot be deleted.",
      "stale | 409 | personalization_stale | Option changed | Reload this section before applying another change.",
      "(fallback) | 503 | personalization_unavailable | Personalization unavailable | Personalization could not be updated.",
    ].join("\n"),
    "PERSONALIZATION_FAILURES",
  );
  assertEquals(
    listed(SETTINGS_PROBLEMS),
    [
      "409 | last_owner | Last owner protected | At least one active workspace owner must remain.",
      "403 | member_forbidden | Member update forbidden | Your role cannot apply that member change.",
      "404 | member_not_found | Member unavailable | That member does not belong to this workspace.",
      "503 | settings_unavailable | Member unavailable | That member could not be updated.",
      "400 | validation_failed | Invalid member update | Choose a valid member role and active state.",
      "403 | members_forbidden | Members forbidden | Only an active workspace owner or admin may manage members.",
      "503 | settings_unavailable | Members unavailable | Workspace members could not be loaded.",
      "400 | validation_failed | Invalid personalization option | Provide an accepted section, unique name, and valid order.",
      "400 | validation_failed | Invalid personalization deletion | Reload the option and choose a valid replacement when required.",
      "400 | validation_failed | Invalid personalization option | Reload the option and provide valid values.",
      "400 | validation_failed | Invalid preferences | Review the locale, time zone, regional, and display values.",
      "503 | settings_unavailable | Preferences unavailable | Your preferences could not be loaded.",
      "503 | settings_unavailable | Preferences unavailable | Your preferences could not be saved.",
      "400 | validation_failed | Invalid profile | Provide a first name and valid profile values.",
      "503 | settings_unavailable | Profile unavailable | Your profile could not be loaded.",
      "503 | settings_unavailable | Profile unavailable | Your profile could not be saved.",
      "404 | personalization_section_not_found | Section unavailable | Use an accepted personalization section link.",
      "403 | session_forbidden | Session forbidden | You can revoke only your own sessions.",
      "503 | settings_unavailable | Session unavailable | That session could not be revoked.",
      "404 | session_stale | Session unavailable | That session is no longer active.",
      "503 | settings_unavailable | Sessions unavailable | Your sessions could not be loaded.",
      "403 | member_ui_state_forbidden | UI state unavailable | The requested member UI state is not available in this workspace.",
      "400 | member_ui_state_validation_failed | Invalid UI state | Choose at least one recognised UI setting.",
      "503 | member_ui_state_unavailable | UI state unavailable | Your member UI state could not be loaded.",
      "503 | member_ui_state_unavailable | UI state unavailable | Your member UI state could not be saved.",
      "403 | member_ui_state_origin_invalid | Request forbidden | This request did not come from the configured application origin.",
      "401 | member_ui_state_session_invalid | Authentication required | Sign in with an active workspace membership.",
      "403 | workspace_forbidden | Workspace settings forbidden | Only an active workspace owner or admin may manage workspace settings.",
      "400 | validation_failed | Invalid workspace settings | Review the workspace identity and default values.",
      "503 | settings_unavailable | Workspace unavailable | Workspace settings could not be loaded.",
      "503 | settings_unavailable | Workspace unavailable | Workspace settings could not be saved.",
      "409 | workspace_slug_conflict | Workspace slug unavailable | Choose another workspace slug.",
    ].join("\n"),
    "SETTINGS_PROBLEMS",
  );
});

Deno.test("[GAP-020] the refusals workspace_lifecycle.ts answers are unchanged", () => {
  assertEquals(
    pinned(WORKSPACE_LIFECYCLE_FAILURES),
    [
      "confirmation-invalid | 400 | confirmation_invalid | Confirmation does not match | Type the exact confirmation from the current impact preview.",
      "forbidden | 403 | workspace_owner_required | Owner required | Only an active workspace owner can use the danger zone.",
      "rate-limited | 429 | authentication_rate_limited | Try again later | Too many recent password attempts. Wait before trying again.",
      "reauthentication-required | 403 | reauthentication_required | Recent authentication required | Enter your current password before continuing.",
      "stale-impact | 409 | stale_impact_preview | Impact changed | Reload the current impact before confirming this action.",
      "(fallback) | 503 | workspace_lifecycle_unavailable | Workspace lifecycle unavailable | Nothing was changed. Try again after the current impact can be revalidated.",
    ].join("\n"),
    "WORKSPACE_LIFECYCLE_FAILURES",
  );
  assertEquals(
    listed(WORKSPACE_LIFECYCLE_PROBLEMS),
    [
      "400 | validation_failed | Current confirmation required | Submit the current impact token, exact confirmation, and current password.",
    ].join("\n"),
    "WORKSPACE_LIFECYCLE_PROBLEMS",
  );
});

Deno.test("[GAP-020] the two authentication tables answer what the domain says", () => {
  for (
    const [name, table] of [
      ["sign-in", SIGN_IN_FAILURES],
      ["second factor", MFA_FAILURES],
    ] as const
  ) {
    for (const [status, definition] of failureDefinitions(table)) {
      assertEquals(
        definition.status,
        protectedSessionHttpStatus(
          { status } as Parameters<typeof protectedSessionHttpStatus>[0],
        ),
        `${name}: ${status} keeps the status the domain gives it`,
      );
    }
  }
  assertEquals(
    [SIGN_IN_FAILURES.fallback.status, MFA_FAILURES.fallback.status],
    [
      protectedSessionHttpStatus({ status: "invalid-credentials" }),
      protectedSessionHttpStatus({ status: "invalid-mfa" }),
    ],
    "both fallbacks are the domain's answer to a wrong secret",
  );
});

Deno.test("[GAP-020] the refusals that name what they refused are unchanged", () => {
  assertEquals(
    listed([
      importSourceInvalid("The contacts table is not a list."),
      finalOwnerProblem([
        { id: "w1", name: "Family" },
        { id: "w2", name: "Choir" },
      ]),
      finalOwnerProblem(undefined),
      replacementRequired(3),
      possibleDuplicate("Ada Lovelace"),
    ]),
    [
      "400 | import_invalid | Import source invalid | The contacts table is not a list.",
      "409 | final_owner | Final owner protected | Transfer ownership in Members before leaving Family, Choir. Workspace deletion is a separate owner action.",
      "409 | final_owner | Final owner protected | Transfer ownership in Members before leaving an owned workspace. Workspace deletion is a separate owner action.",
      "409 | personalization_replacement_required | Replacement required | 3 references must be moved before this option can be deleted.",
      "409 | possible_duplicate | Possible duplicate | A person named Ada Lovelace already exists in this workspace. Review the match or create anyway.",
    ].join("\n"),
    "every built refusal",
  );
});

Deno.test("[GAP-045] the refusals avatar.ts answers are pinned", () => {
  assertEquals(
    pinned(AVATAR_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore this person before changing their avatar.",
      "forbidden | 403 | people_forbidden | Avatar unavailable | Your active workspace membership no longer permits this change.",
      "not-found | 404 | person_not_found | Person not found | No person with this identifier exists in the current workspace.",
      "quarantined | 423 | avatar_quarantined | Image held for review | This image did not pass the file check and was held for review. Choose another image.",
      "rejected-media | 415 | avatar_media_rejected | Image type rejected | Choose a JPEG, PNG, or WebP image.",
      "storage-limit | 413 | avatar_too_large | Image too large | Choose an image of 1 MB or less.",
      "validation-error | 400 | avatar_invalid | Invalid image | Choose a non-empty image with a filename.",
      "(fallback) | 503 | avatar_unavailable | Avatar unavailable | The avatar could not be changed right now.",
    ].join("\n"),
    "AVATAR_FAILURES",
  );
});

Deno.test("[GAP-053] the refusals star.ts answers are pinned", () => {
  assertEquals(
    pinned(STAR_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore this person before starring or unstarring them.",
      "forbidden | 403 | people_forbidden | Star unavailable | Your active workspace membership no longer permits this change.",
      "not-found | 404 | person_not_found | Person not found | No person with this identifier exists in the current workspace.",
      "(fallback) | 503 | person_star_unavailable | Star unavailable | The star could not be changed right now.",
    ].join("\n"),
    "STAR_FAILURES",
  );
});

Deno.test("[GAP-049] the refusals merge.ts answers are pinned", () => {
  assertEquals(
    pinned(MERGE_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore both people before merging them.",
      "both-members | 409 | merge_both_members | Both people represent members | Both people are workspace members' own records. Merging them would leave one member without theirs, so they cannot be merged.",
      "forbidden | 403 | people_forbidden | People unavailable | Your active workspace membership no longer permits this change.",
      "conflicts-changed | 409 | merge_conflicts_changed | Merge changed | What this merge would discard changed since it was reviewed. Review it again before merging.",
      "not-found | 404 | person_not_found | Person not found | Both people must exist in the current workspace to be merged.",
      "self-merge | 400 | merge_self | A person cannot be merged into themselves | Choose two different people to merge.",
      "stale | 409 | person_stale | Person changed | One of these people changed. Review them again before merging.",
      "(fallback) | 503 | people_unavailable | People could not be merged | Nothing was merged. The person service is temporarily unavailable.",
    ].join("\n"),
    "MERGE_FAILURES",
  );
});

Deno.test("[REL-064] the refusals a duplicate dismissal answers are pinned", () => {
  assertEquals(
    pinned(DUPLICATE_DISMISSAL_FAILURES),
    [
      "forbidden | 403 | people_forbidden | People unavailable | Your active workspace membership no longer permits this change.",
      "not-found | 404 | person_not_found | Person not found | Both people must exist in the current workspace.",
      "same-person | 400 | duplicate_same_person | A person cannot be their own duplicate | Choose two different people.",
      "(fallback) | 503 | people_unavailable | Pair could not be dismissed | Nothing was saved. The person service is temporarily unavailable.",
    ].join("\n"),
    "DUPLICATE_DISMISSAL_FAILURES",
  );
});

Deno.test("[AUD-K1] the admission pipeline's own refusals are pinned", () => {
  assertEquals(
    listed([WORKSPACE_HEADER_INVALID, UNSUPPORTED_MEDIA_TYPE]),
    [
      "400 | workspace_header_invalid | Invalid workspace | Send X-Workspace-Id as a workspace identifier, or leave it out.",
      "415 | unsupported_media_type | Unsupported media type | Send the request body as application/json.",
    ].join("\n"),
    "admission refusals",
  );
  assertEquals(
    NUL_MESSAGE,
    "Text may not contain a NUL character.",
    "the field message a NUL character earns",
  );
});
