/**
 * The API composition root.
 *
 * Every adapter in this deployment is built by the module that owns it, in
 * that module's `composition.ts`. What is left here is what no single module
 * owns: the shared context they all receive, the order they are composed in,
 * and the four seams that cross modules — the workspace-cascade impact map,
 * the personalization router, the DAV bridges into people and planning, and
 * planning's hook into a settings timezone change.
 *
 * The routes are not here either. Each module owns its own in
 * `transport/http/routes.ts`, built on `packages/http-kit`, and this root
 * imports that one file per module and mounts what it returns.
 *
 * `createApiApp` is the route wiring and takes services; `createConfiguredApiApp`
 * is the real deployment; `createApiRuntime` reads the environment and is what
 * `main.ts` serves.
 */

import { type Context, Hono } from "hono";
import { type Kysely, sql } from "kysely";
import {
  type ApplicationDatabase,
  connectDatabase,
} from "../../packages/backend/platform/postgres/database.ts";
import type { SharedComposition } from "../../packages/backend/platform/composition.ts";
import {
  type EnvironmentReader,
  resolveDatabaseUrl,
} from "../../packages/backend/platform/postgres/config.ts";
import {
  composeApiAccess,
} from "../../packages/backend/modules/api-access/composition.ts";
import {
  type ApiTokenManagement,
  type AuthenticationSubjectKeyset,
  type CalendarFeedTokens,
  decodeAuthenticationSubjectKeyset,
} from "../../packages/backend/modules/api-access/public.ts";
import {
  composeFiles,
  composeObjectStorage,
  filePersonMergeParticipant,
} from "../../packages/backend/modules/files/composition.ts";
import type {
  ObjectStorage,
  PersonFileManagement,
  StorageSettings,
} from "../../packages/backend/modules/files/public.ts";
import {
  composeGifts,
  giftAttachmentTarget,
  giftPersonMergeParticipant,
} from "../../packages/backend/modules/gifts/composition.ts";
import type { GiftManagement } from "../../packages/backend/modules/gifts/public.ts";
import {
  auditPersonMergeParticipant,
  composeGovernance,
  governanceAuditRecorder,
  historicalAuditImportBoundary,
} from "../../packages/backend/modules/governance/composition.ts";
import type { LegalAcceptance } from "../../packages/backend/modules/governance/public.ts";
import {
  composeIdentity,
  decodeMfaEncryptionKeyset,
} from "../../packages/backend/modules/identity/composition.ts";
import type { MfaEncryptionKeyset } from "../../packages/backend/modules/identity/public.ts";
import {
  composeImportExport,
  importPersonMergeParticipant,
} from "../../packages/backend/modules/import-export/composition.ts";
import type {
  ExportManagement,
  ImportManagement,
} from "../../packages/backend/modules/import-export/public.ts";
import {
  composeDavSync,
  composeIntegrations,
  davPersonMergeParticipant,
  type DavPorts,
  decodeDavEncryptionKeyset,
} from "../../packages/backend/modules/integrations/composition.ts";
import {
  type CalendarFeedPublication,
  createCalendarFeedPublication,
  type DavEncryptionKeyset,
  type DavRemoteClient,
  type DavSyncManagement,
} from "../../packages/backend/modules/integrations/public.ts";
import {
  composeInteractions,
  interactionPersonMergeParticipant,
  journalActivityBoundary,
} from "../../packages/backend/modules/interactions/composition.ts";
import type {
  CommunicationManagement,
  InteractionManagement,
} from "../../packages/backend/modules/interactions/public.ts";
import {
  composeJournal,
  journalPersonMergeParticipant,
} from "../../packages/backend/modules/journal/composition.ts";
import type {
  JournalManagement,
  LifeEventManagement,
} from "../../packages/backend/modules/journal/public.ts";
import { composeOperations } from "../../packages/backend/modules/operations/composition.ts";
import {
  composePeople,
  peopleTransactionRunner,
  personBoundary,
} from "../../packages/backend/modules/people/composition.ts";
import type {
  ImportantDateManagement,
  PersonAvatarImages,
  PersonMerge,
  PersonMergeParticipant,
} from "../../packages/backend/modules/people/public.ts";
import {
  composePlanning,
  personDateReminderPublisher,
  personRestoreReminderPublisher,
  planningPersonMergeParticipant,
} from "../../packages/backend/modules/planning/composition.ts";
import type {
  ReminderManagement,
  TaskManagement,
} from "../../packages/backend/modules/planning/public.ts";
import {
  composeRelationships,
  relationshipPersonMergeParticipant,
} from "../../packages/backend/modules/relationships/composition.ts";
import type { RelationshipManagement } from "../../packages/backend/modules/relationships/public.ts";
import {
  activeWorkspaceResolver,
  composeVerificationMail,
  composeWorkspaceBoundaries,
  composeWorkspaces,
  passwordResetMail,
  selfPersonMergeParticipant,
  workspaceActors,
  workspaceTransactionRunner,
} from "../../packages/backend/modules/workspaces/composition.ts";
import {
  type AuthenticationResponseEqualizer,
  createPersonalizationManagement,
  type MemberUiStateManagement,
  settingsAuditFrom,
  type VerificationMail,
} from "../../packages/backend/modules/workspaces/public.ts";
import { composeActivityReport } from "../../packages/backend/read-models/activity-report/composition.ts";
import type { ActivityReport } from "../../packages/backend/read-models/activity-report/public.ts";
import { composeAuditHistory } from "../../packages/backend/read-models/audit-history/composition.ts";
import { composeCalendarFeed } from "../../packages/backend/read-models/calendar-feed/composition.ts";
import type { AuditHistory } from "../../packages/backend/read-models/audit-history/public.ts";
import { composeJournalTimeline } from "../../packages/backend/read-models/journal-timeline/composition.ts";
import type { JournalTimeline } from "../../packages/backend/read-models/journal-timeline/public.ts";
import { composePeopleDirectory } from "../../packages/backend/read-models/people-directory/composition.ts";
import type {
  PeopleDirectory,
  PeopleDuplicates,
  PeopleTagOptions,
} from "../../packages/backend/read-models/people-directory/public.ts";
import { composePersonProfile } from "../../packages/backend/read-models/person-profile/composition.ts";
import type { PersonProfile } from "../../packages/backend/read-models/person-profile/public.ts";
import { composeNotifications } from "../../packages/backend/read-models/notifications/composition.ts";
import type { Notifications } from "../../packages/backend/read-models/notifications/public.ts";
import { composeSearch } from "../../packages/backend/read-models/search/composition.ts";
import type { WorkspaceSearch } from "../../packages/backend/read-models/search/public.ts";
import { composeToday } from "../../packages/backend/read-models/today/composition.ts";
import type {
  TodayAttention,
  TodayInteractions,
  TodayRecentPeople,
  TodayReminders,
  TodayTasks,
} from "../../packages/backend/read-models/today/public.ts";
import {
  createApiTokenRoutes,
  createCalendarFeedSettingsRoutes,
} from "../../packages/backend/modules/api-access/transport/http/routes.ts";
import { createFileRoutes } from "../../packages/backend/modules/files/transport/http/routes.ts";
import { createGiftRoutes } from "../../packages/backend/modules/gifts/transport/http/routes.ts";
import {
  createGovernanceRoutes,
  createLegalRequirementGuard,
} from "../../packages/backend/modules/governance/transport/http/routes.ts";
import {
  createExportRoutes,
  createImportRoutes,
  installExportLinkSessions,
} from "../../packages/backend/modules/import-export/transport/http/routes.ts";
import {
  createCalendarFeedRoutes,
  createIntegrationRoutes,
} from "../../packages/backend/modules/integrations/transport/http/routes.ts";
import { createInteractionRoutes } from "../../packages/backend/modules/interactions/transport/http/routes.ts";
import { createJournalRoutes } from "../../packages/backend/modules/journal/transport/http/routes.ts";
import {
  createPeopleRoutes,
  type PeopleHttpServices,
} from "../../packages/backend/modules/people/transport/http/routes.ts";
import { createPlanningRoutes } from "../../packages/backend/modules/planning/transport/http/routes.ts";
import { createRelationshipRoutes } from "../../packages/backend/modules/relationships/transport/http/routes.ts";
import {
  type AuthenticationHttpServices,
  createAuthenticationRoutes,
  createInvitationRoutes,
  createPersonalLifecycleRoutes,
  createRegistrationRoutes,
  createSettingsRoutes,
  createWorkspaceLifecycleRoutes,
  type InvitationHttpServices,
  type PersonalLifecycleHttpServices,
  type RegistrationHttpServices,
  type SettingsHttpServices,
  type WorkspaceLifecycleHttpServices,
} from "../../packages/backend/modules/workspaces/transport/http/routes.ts";
import {
  JSON_BODY_MAX_BYTES,
  requestBodyLimit,
} from "../../packages/http-kit/body_limit.ts";
import { sameOriginCors } from "../../packages/http-kit/cors.ts";
import { healthRoutes } from "../../packages/http-kit/health.ts";
import { requestLogging } from "../../packages/http-kit/logging.ts";
import {
  requestId,
  type RequestIdEnv,
} from "../../packages/http-kit/request_id.ts";
import { apiSecureHeaders } from "../../packages/http-kit/secure_headers.ts";
import { sessionResolution } from "../../packages/http-kit/session.ts";
import {
  createAuthenticationResponseEqualizer,
  DEFAULT_AUTHENTICATION_RESPONSE_FLOOR_MS,
  resolveAuthenticationResponseFloor,
} from "./authentication_response.ts";
import { jsonLogger } from "../../packages/backend/platform/telemetry/json_logger.ts";
import type { Logger } from "../../packages/backend/shared-kernel/telemetry.ts";
import { resolveObjectStorageConfiguration } from "./file_storage_config.ts";
import { PersonalizationRouter } from "./personalization_router.ts";
import {
  type BrowserSecurityPolicy,
  browserSecurityPolicy,
} from "./security_config.ts";

export interface ApiServices extends RegistrationHttpServices {
  readonly apiTokens?: ApiTokenManagement;
  readonly avatars?: PeopleHttpServices["avatars"];
  readonly bulk?: PeopleHttpServices["bulk"];
  readonly activityReport?: ActivityReport;
  readonly auditHistory?: AuditHistory;
  /** The subscribed iCalendar feed itself (GAP-052), read by its secret. */
  readonly calendarFeed?: Pick<CalendarFeedPublication, "publish">;
  /** Each member's own calendar feed secret, managed from settings. */
  readonly calendarFeeds?: CalendarFeedTokens;
  readonly directory?: PeopleDirectory;
  readonly duplicateDismissals?: PeopleHttpServices["duplicateDismissals"];
  readonly duplicates?: PeopleDuplicates;
  readonly merge?: Pick<PersonMerge, "merge" | "preview">;
  readonly files?: PersonFileManagement;
  readonly storageSettings?: StorageSettings;
  readonly gifts?: GiftManagement;
  readonly journal?: JournalManagement;
  readonly journalTimeline?: JournalTimeline;
  readonly lifeEvents?: LifeEventManagement;
  readonly imports?: ImportManagement;
  readonly exports?: ExportManagement;
  readonly legal?: LegalAcceptance;
  readonly memberUiState?: MemberUiStateManagement;
  readonly notifications?: Notifications;
  readonly invitations?: InvitationHttpServices["invitations"];
  readonly importantDates?: ImportantDateManagement;
  readonly interactions?: InteractionManagement & CommunicationManagement;
  readonly profileFacts?: PeopleHttpServices["profileFacts"];
  readonly passwordRecovery?: AuthenticationHttpServices["passwordRecovery"];
  readonly personalLifecycle?:
    PersonalLifecycleHttpServices["personalLifecycle"];
  readonly workspaceLifecycle?:
    WorkspaceLifecycleHttpServices["workspaceLifecycle"];
  readonly protectedSessions?: AuthenticationHttpServices["protectedSessions"];
  readonly settings?: SettingsHttpServices["settings"];
  readonly personalization?: SettingsHttpServices["personalization"];
  readonly people?: PeopleHttpServices["people"];
  readonly recentPeople?: PeopleHttpServices["recentPeople"];
  readonly profile?: PersonProfile;
  readonly relationships?: RelationshipManagement;
  readonly reminders?: ReminderManagement;
  readonly search?: WorkspaceSearch;
  readonly stars?: PeopleHttpServices["stars"];
  readonly tagFacet?: PeopleHttpServices["tagFacet"];
  readonly tagOptions?: PeopleTagOptions;
  readonly tasks?: TaskManagement;
  readonly dav?: DavSyncManagement;
  readonly today?: TodayInteractions;
  readonly todayAttention?: TodayAttention;
  readonly todayTasks?: TodayTasks;
  readonly todayReminders?: TodayReminders;
  readonly todayRecentPeople?: TodayRecentPeople;
  readonly readiness?: () => Promise<boolean>;
  /**
   * Where the request log goes. A composition that passes none — every unit
   * suite, and every integration suite — produces no log output at all.
   */
  readonly logger?: Logger;
}

/**
 * The routes that bound their own request body: the person-file upload
 * streams against a ten megabyte ceiling, the avatar upload against its own
 * one megabyte (GAP-045), and the Monica import staging route refuses anything
 * past its 1.5 MB envelope. The global cap stays out of their way so each
 * keeps answering its own, more specific refusal.
 */
const SELF_BOUNDED_BODIES: readonly RegExp[] = [
  /^\/api\/v1\/people\/[^/]+\/files$/,
  /^\/api\/v1\/people\/[^/]+\/avatar$/,
  /^\/api\/v1\/imports\/dry-runs$/,
];

function boundsItsOwnBody(context: Context): boolean {
  return SELF_BOUNDED_BODIES.some((pattern) => pattern.test(context.req.path));
}

export class CapturedVerificationMail implements VerificationMail {
  readonly #messages = new Map<string, string[]>();
  readonly #passwordResets = new Map<string, string[]>();
  readonly #invitations = new Map<string, string[]>();
  readonly #accountExists = new Map<string, (string | undefined)[]>();
  readonly #passwordChanges = new Map<string, number>();

  sendVerification(
    message: { readonly email: string; readonly token: string },
  ): Promise<void> {
    const key = message.email.toLowerCase();
    this.#messages.set(key, [
      ...(this.#messages.get(key) ?? []),
      message.token,
    ]);
    return Promise.resolve();
  }

  latestToken(email: string): string | undefined {
    return this.#messages.get(email.toLowerCase())?.at(-1);
  }

  tokens(email: string): readonly string[] {
    return this.#messages.get(email.toLowerCase()) ?? [];
  }

  sendPasswordReset(
    message: { readonly email: string; readonly token: string },
  ): Promise<void> {
    const key = message.email.toLowerCase();
    this.#passwordResets.set(key, [
      ...(this.#passwordResets.get(key) ?? []),
      message.token,
    ]);
    return Promise.resolve();
  }

  latestPasswordResetToken(email: string): string | undefined {
    return this.#passwordResets.get(email.toLowerCase())?.at(-1);
  }

  sendAccountExists(
    message: {
      readonly email: string;
      readonly reset?: { readonly token: string };
    },
  ): Promise<void> {
    const key = message.email.toLowerCase();
    this.#accountExists.set(key, [
      ...(this.#accountExists.get(key) ?? []),
      message.reset?.token,
    ]);
    return Promise.resolve();
  }

  /**
   * The reset token of every "you already have an account" email, in order;
   * `undefined` where the email carried no reset link.
   */
  accountExistsTokens(email: string): readonly (string | undefined)[] {
    return this.#accountExists.get(email.toLowerCase()) ?? [];
  }

  sendPasswordChanged(message: { readonly email: string }): Promise<void> {
    const key = message.email.toLowerCase();
    this.#passwordChanges.set(key, (this.#passwordChanges.get(key) ?? 0) + 1);
    return Promise.resolve();
  }

  /** How many "your password was changed" emails the address received. */
  passwordChangeCount(email: string): number {
    return this.#passwordChanges.get(email.toLowerCase()) ?? 0;
  }

  sendInvitation(
    message: { readonly email: string; readonly token: string },
  ): Promise<void> {
    const key = message.email.toLowerCase();
    this.#invitations.set(key, [
      ...(this.#invitations.get(key) ?? []),
      message.token,
    ]);
    return Promise.resolve();
  }

  latestInvitationToken(email: string): string | undefined {
    return this.#invitations.get(email.toLowerCase())?.at(-1);
  }
}

export function createApiApp(services?: ApiServices): Hono<RequestIdEnv> {
  const api = new Hono<RequestIdEnv>();

  // The kit, in the one order it can run in: an identifier before the line
  // that quotes it, the log around everything it reports on, the response
  // headers around every answer including a refused one, the body cap before
  // a handler reads a body, the probes before the guard that would otherwise
  // ask a health check to accept a legal document, and the routes last. The
  // origin rule is not here: it belongs to the write routes that take it, so
  // a read is never asked for an `Origin` it never needed.
  api.use(requestId());
  if (services?.logger) api.use(requestLogging(services.logger));
  api.use(apiSecureHeaders());
  if (services) {
    api.use("/api/v1/*", sameOriginCors(services.browserSecurity));
  }
  api.use(
    "/api/v1/*",
    requestBodyLimit({
      exempt: boundsItsOwnBody,
      maxBytes: JSON_BODY_MAX_BYTES,
    }),
  );

  api.route(
    "/",
    healthRoutes(services?.readiness ? { readiness: services.readiness } : {}),
  );

  // One session resolution per request (AUD-K1): installed here, in front of
  // the guard that reads it, so every route's own `sessionActor` finds it and
  // the coordinator is asked once however many readers the request has. A
  // link that names its workspace in the query installs its resolution for
  // that workspace first, so the guard checks the workspace the route acts in.
  if (services?.protectedSessions) {
    installExportLinkSessions(api, services.protectedSessions);
    api.use("/api/v1/*", sessionResolution(services.protectedSessions));
  }
  if (services?.legal && services.protectedSessions) {
    api.use(
      "/api/v1/*",
      createLegalRequirementGuard({
        legal: services.legal,
        protectedSessions: services.protectedSessions,
      }),
    );
  }

  if (services) {
    api.route("/", createRegistrationRoutes(services));
    if (services.passwordRecovery && services.protectedSessions) {
      api.route(
        "/",
        createAuthenticationRoutes({
          browserSecurity: services.browserSecurity,
          ...(services.legal ? { legal: services.legal } : {}),
          ...(services.memberUiState
            ? { memberUiState: services.memberUiState }
            : {}),
          passwordRecovery: services.passwordRecovery,
          protectedSessions: services.protectedSessions,
        }),
      );
      if (services.invitations) {
        api.route(
          "/",
          createInvitationRoutes({
            browserSecurity: services.browserSecurity,
            hasher: services.hasher,
            invitations: services.invitations,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
      if (
        services.settings && services.personalization && services.memberUiState
      ) {
        api.route(
          "/",
          createSettingsRoutes({
            browserSecurity: services.browserSecurity,
            memberUiState: services.memberUiState,
            protectedSessions: services.protectedSessions,
            personalization: services.personalization,
            settings: services.settings,
          }),
        );
      }
      if (services.apiTokens) {
        api.route(
          "/",
          createApiTokenRoutes({
            apiTokens: services.apiTokens,
            browserSecurity: services.browserSecurity,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
      if (services.calendarFeeds) {
        api.route(
          "/",
          createCalendarFeedSettingsRoutes({
            browserSecurity: services.browserSecurity,
            calendarFeeds: services.calendarFeeds,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
      if (services.dav) {
        api.route(
          "/",
          createIntegrationRoutes({
            browserSecurity: services.browserSecurity,
            dav: services.dav,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
      if (services.personalLifecycle) {
        api.route(
          "/",
          createPersonalLifecycleRoutes({
            browserSecurity: services.browserSecurity,
            personalLifecycle: services.personalLifecycle,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
      if (services.workspaceLifecycle) {
        api.route(
          "/",
          createWorkspaceLifecycleRoutes({
            browserSecurity: services.browserSecurity,
            protectedSessions: services.protectedSessions,
            workspaceLifecycle: services.workspaceLifecycle,
          }),
        );
      }
      if (services.files) {
        api.route(
          "/",
          createFileRoutes({
            browserSecurity: services.browserSecurity,
            files: services.files,
            protectedSessions: services.protectedSessions,
            ...(services.storageSettings
              ? { storageSettings: services.storageSettings }
              : {}),
          }),
        );
      }
      if (services.gifts) {
        api.route(
          "/",
          createGiftRoutes({
            browserSecurity: services.browserSecurity,
            gifts: services.gifts,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
      if (services.journal && services.journalTimeline) {
        api.route(
          "/",
          createJournalRoutes({
            browserSecurity: services.browserSecurity,
            journal: services.journal,
            ...(services.lifeEvents ? { lifeEvents: services.lifeEvents } : {}),
            protectedSessions: services.protectedSessions,
            timeline: services.journalTimeline,
          }),
        );
      }
      if (services.imports) {
        api.route(
          "/",
          createImportRoutes({
            browserSecurity: services.browserSecurity,
            imports: services.imports,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
      if (services.exports) {
        api.route(
          "/",
          createExportRoutes({
            browserSecurity: services.browserSecurity,
            exports: services.exports,
            protectedSessions: services.protectedSessions,
          }),
        );
      }
    }
    // The calendar feed takes no session: its secret is its path.
    if (services.calendarFeed) {
      api.route(
        "/",
        createCalendarFeedRoutes({ calendarFeed: services.calendarFeed }),
      );
    }
    if (
      services.directory && services.people && services.profile &&
      services.protectedSessions && services.tagOptions
    ) {
      api.route(
        "/",
        createPeopleRoutes({
          ...(services.apiTokens ? { apiTokens: services.apiTokens } : {}),
          ...(services.avatars ? { avatars: services.avatars } : {}),
          browserSecurity: services.browserSecurity,
          ...(services.bulk ? { bulk: services.bulk } : {}),
          directory: services.directory,
          ...(services.duplicateDismissals
            ? { duplicateDismissals: services.duplicateDismissals }
            : {}),
          ...(services.duplicates ? { duplicates: services.duplicates } : {}),
          ...(services.importantDates
            ? { importantDates: services.importantDates }
            : {}),
          ...(services.profileFacts
            ? { profileFacts: services.profileFacts }
            : {}),
          ...(services.merge ? { merge: services.merge } : {}),
          people: services.people,
          profile: services.profile,
          protectedSessions: services.protectedSessions,
          ...(services.recentPeople
            ? { recentPeople: services.recentPeople }
            : {}),
          ...(services.search ? { search: services.search } : {}),
          ...(services.stars ? { stars: services.stars } : {}),
          ...(services.tagFacet ? { tagFacet: services.tagFacet } : {}),
          tagOptions: services.tagOptions,
          ...(services.todayRecentPeople
            ? { todayRecentPeople: services.todayRecentPeople }
            : {}),
        }),
      );
    }
    if (services.protectedSessions && services.relationships) {
      api.route(
        "/",
        createRelationshipRoutes({
          ...(services.apiTokens ? { apiTokens: services.apiTokens } : {}),
          browserSecurity: services.browserSecurity,
          protectedSessions: services.protectedSessions,
          relationships: services.relationships,
        }),
      );
    }
    if (
      services.activityReport && services.interactions &&
      services.protectedSessions && services.today
    ) {
      api.route(
        "/",
        createInteractionRoutes({
          ...(services.apiTokens ? { apiTokens: services.apiTokens } : {}),
          activityReport: services.activityReport,
          browserSecurity: services.browserSecurity,
          interactions: services.interactions,
          protectedSessions: services.protectedSessions,
          today: services.today,
        }),
      );
    }
    if (
      (services.auditHistory || services.legal) && services.protectedSessions
    ) {
      api.route(
        "/",
        createGovernanceRoutes({
          ...(services.auditHistory
            ? { auditHistory: services.auditHistory }
            : {}),
          browserSecurity: services.browserSecurity,
          ...(services.legal ? { legal: services.legal } : {}),
          protectedSessions: services.protectedSessions,
        }),
      );
    }
    if (services.protectedSessions && services.tasks && services.todayTasks) {
      api.route(
        "/",
        createPlanningRoutes({
          ...(services.apiTokens ? { apiTokens: services.apiTokens } : {}),
          browserSecurity: services.browserSecurity,
          ...(services.notifications
            ? { notifications: services.notifications }
            : {}),
          protectedSessions: services.protectedSessions,
          ...(services.reminders ? { reminders: services.reminders } : {}),
          tasks: services.tasks,
          ...(services.todayAttention
            ? { todayAttention: services.todayAttention }
            : {}),
          ...(services.todayReminders
            ? { todayReminders: services.todayReminders }
            : {}),
          todayTasks: services.todayTasks,
        }),
      );
    }
  }

  return api;
}

/**
 * The readiness probe behind `GET /api/v1/health`: one trivial statement,
 * bounded so a stalled pool answers "unavailable" instead of hanging the probe.
 */
async function databaseReadiness(
  database: Kysely<ApplicationDatabase>,
): Promise<boolean> {
  try {
    const probe = await Promise.race([
      sql<{ ready: number }>`select 1 as ready`.execute(database),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), 1_500)
      ),
    ]);
    return probe !== undefined;
  } catch {
    return false;
  }
}

/**
 * The DAV bridge into people.
 *
 * A remote contact card is a person, but integrations may not spend people's
 * use cases on its own authority, so the root lends them: every edit reads the
 * current revision first and hands it back as the expected one, which is what
 * turns a remote overwrite into an optimistic update.
 */
function davPeople(
  people: ReturnType<typeof composePeople>,
): DavPorts["people"] {
  const revised = async <Result>(
    actor: Parameters<typeof people.lifecycle.inspectInTransaction>[0],
    personId: string,
    transaction: Parameters<typeof people.lifecycle.inspectInTransaction>[2],
    apply: (expectedUpdatedAt: string) => Promise<Result>,
  ) => {
    const current = await people.lifecycle.inspectInTransaction(
      actor,
      personId,
      transaction,
    );
    if (current.status !== "ready") return current;
    return await apply(current.person.updatedAt);
  };
  return {
    ensure: (actor, input, transaction) => {
      const { requestId, ...identity } = input;
      return people.people.ensureInTransaction(actor, requestId, {
        ...identity,
        isPartial: !identity.givenName,
      }, transaction);
    },
    update: (actor, personId, input, transaction) =>
      revised(
        actor,
        personId,
        transaction,
        (expectedUpdatedAt) =>
          people.lifecycle.editInTransaction(actor, personId, {
            ...input,
            expectedUpdatedAt,
            isPartial: !input.givenName,
          }, transaction),
      ),
    archive: (actor, personId, transaction) =>
      revised(
        actor,
        personId,
        transaction,
        (expectedUpdatedAt) =>
          people.lifecycle.archiveInTransaction(actor, personId, {
            expectedUpdatedAt,
          }, transaction),
      ),
    restore: (actor, personId, transaction) =>
      revised(
        actor,
        personId,
        transaction,
        (expectedUpdatedAt) =>
          people.lifecycle.restoreInTransaction(actor, personId, {
            expectedUpdatedAt,
          }, transaction),
      ),
  };
}

/**
 * The avatar bridge into files (GAP-045).
 *
 * People owns which image a person is drawn with and files owns the bytes, but
 * people may not depend on files, so people names the port it needs and the
 * root fills it with the files facade: the `avatar` upload kind to store, and
 * the avatar discards (REL-056) to remove an image nobody draws, which the
 * generic person-file removal refuses. Both discards are best effort: an
 * answer that one is unavailable is passed on for people to record (REL-083)
 * rather than raised as a failure.
 */
export function avatarImages(files: PersonFileManagement): PersonAvatarImages {
  return {
    store: async ({ actor, personId, ...image }) => {
      const result = await files.uploadAvatar(actor, personId, image);
      return result.status === "created"
        ? {
          fileId: result.file.fileId,
          status: result.file.status === "quarantined"
            ? "quarantined"
            : "available",
        }
        : result;
    },
    discard: async ({ actor, fileId, personId }) => {
      const result = await files.discardAvatar(actor, personId, fileId);
      return { status: result.status };
    },
    discardHeld: async ({ actor, personId }) => {
      const result = await files.discardHeldAvatars(actor, personId);
      return { status: result.status };
    },
  };
}

/**
 * The person-merge participants (GAP-049), in the order a merge relinks them.
 *
 * People depends on none of these modules, so each hands the root the one
 * participant that rewrites its own rows and the root registers them here,
 * the way the workspace-cascade impact map is assembled. Planning runs before
 * people's own tables so the reminders a dropped date drives are already the
 * primary's when planning retires them. `person_merge_postgres_test.ts`
 * compares what these name with every foreign key to `crm.people`.
 */
export function personMergeParticipants(): readonly PersonMergeParticipant[] {
  return [
    relationshipPersonMergeParticipant(),
    interactionPersonMergeParticipant(),
    journalPersonMergeParticipant(),
    planningPersonMergeParticipant(),
    giftPersonMergeParticipant(),
    filePersonMergeParticipant(),
    davPersonMergeParticipant(),
    auditPersonMergeParticipant(),
    selfPersonMergeParticipant(),
    importPersonMergeParticipant(),
  ];
}

/** The DAV bridge into planning, on the same borrowed-use-case terms. */
function davTasks(
  tasks: ReturnType<typeof composePlanning>["tasks"],
): DavPorts["tasks"] {
  return {
    create: (actor, input, transaction) =>
      tasks.create(actor, input, transaction),
    update: async (actor, taskId, input, transaction) => {
      const current = await tasks.get(actor, taskId, transaction);
      if (current.status !== "ready") return current;
      return await tasks.change(actor, taskId, {
        ...input,
        expectedUpdatedAt: current.task.updatedAt,
      }, transaction);
    },
    complete: (actor, taskId, transaction) =>
      tasks.setCompletion(actor, taskId, true, transaction),
    reopen: (actor, taskId, transaction) =>
      tasks.setCompletion(actor, taskId, false, transaction),
  };
}

/**
 * A keyset the deployment must supply in production and may default locally.
 * The local value is a fixed pattern so a developer's data survives a restart.
 */
function configuredKeyset<Keyset>(
  environment: string,
  name: string,
  override: Keyset | undefined,
  local: () => Keyset,
  required = true,
): Keyset {
  if (override) return override;
  if (required && environment === "production") {
    throw new Error(`${name} is required in production.`);
  }
  return local();
}

function localKeyset(fill: number) {
  return () => ({
    activeKeyId: "local-development",
    keys: new Map([["local-development", new Uint8Array(32).fill(fill)]]),
  });
}

export function createConfiguredApiApp(
  databaseUrl: string,
  mailAdapter?: VerificationMail,
  policy: BrowserSecurityPolicy = browserSecurityPolicy("test", undefined),
  mfaKeysetOverride?: MfaEncryptionKeyset,
  subjectKeysetOverride?: AuthenticationSubjectKeyset,
  responseEqualizerOverride?: AuthenticationResponseEqualizer,
  objectStorageOverride?: ObjectStorage,
  davRemoteOverride?: DavRemoteClient,
  davKeysetOverride?: DavEncryptionKeyset,
  davEnabled = true,
  logger?: Logger,
): {
  readonly app: Hono<RequestIdEnv>;
  readonly close: () => Promise<void>;
} {
  const environment = Deno.env.get("APP_ENV") ?? "development";
  const davKeyset = configuredKeyset<DavEncryptionKeyset>(
    environment,
    "INTEGRATIONS_ENCRYPTION_KEYSET",
    davKeysetOverride,
    localKeyset(0x69),
    davEnabled,
  );
  const mfaKeyset = configuredKeyset<MfaEncryptionKeyset>(
    environment,
    "AUTH_MFA_ENCRYPTION_KEYSET",
    mfaKeysetOverride,
    localKeyset(0x4b),
  );
  const subjectKeyset = configuredKeyset<AuthenticationSubjectKeyset>(
    environment,
    "AUTH_THROTTLE_SUBJECT_KEYSET",
    subjectKeysetOverride,
    () => ({
      activeVersion: 1,
      keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
    }),
  );
  const mail = mailAdapter ?? composeVerificationMail(Deno.env);
  const objectStore = objectStorageOverride ??
    composeObjectStorage(resolveObjectStorageConfiguration(Deno.env));
  const connection = connectDatabase(databaseUrl);
  const app = createApiApp(composeApiServices(connection.db, {
    davEnabled,
    davKeyset,
    ...(davRemoteOverride ? { davRemote: davRemoteOverride } : {}),
    ...(logger ? { logger } : {}),
    mail,
    mfaKeyset,
    objectStore,
    policy,
    ...(responseEqualizerOverride
      ? { responseEqualizer: responseEqualizerOverride }
      : {}),
    subjectKeyset,
  }));
  return { app, close: connection.destroy };
}

/**
 * What `composeApiServices` takes beyond the database: everything the
 * environment decided, already decoded.
 */
export interface ApiCompositionOptions {
  readonly davEnabled: boolean;
  readonly davKeyset: DavEncryptionKeyset;
  readonly davRemote?: DavRemoteClient;
  readonly logger?: Logger;
  readonly mail: VerificationMail;
  readonly mfaKeyset: MfaEncryptionKeyset;
  readonly objectStore: ObjectStorage;
  readonly policy: BrowserSecurityPolicy;
  readonly responseEqualizer?: AuthenticationResponseEqualizer;
  readonly subjectKeyset: AuthenticationSubjectKeyset;
}

/**
 * Every module, composed over one database: the services `createApiApp`
 * mounts. It is apart from `createConfiguredApiApp` so a suite can compose the
 * real use cases over a database of its own choosing (AUD-K5's role table
 * composes them over one that refuses every connection).
 */
export function composeApiServices(
  database: Kysely<ApplicationDatabase>,
  options: ApiCompositionOptions,
): ApiServices {
  const {
    davEnabled,
    davKeyset,
    logger,
    mail,
    mfaKeyset,
    objectStore,
    policy,
    subjectKeyset,
  } = options;
  const shared: SharedComposition = {
    actors: workspaceActors(),
    audit: governanceAuditRecorder(),
    clock: { now: () => new Date() },
    database,
    ids: { create: () => crypto.randomUUID() },
    peopleTransaction: peopleTransactionRunner(database),
    transaction: workspaceTransactionRunner(database),
    workspaceEntry: activeWorkspaceResolver(),
  };

  // Composition order follows the ports, not the module list: a module is
  // composed once every port it takes has been produced.
  const identity = composeIdentity(shared, {
    mail: passwordResetMail(mail),
    mfaKeyset,
  });
  const apiAccess = composeApiAccess(shared, {
    // The names the workspace-wide token list shows beside each token.
    issuers: identity.invitations,
    subjectKeyset,
  });
  const configuration = composeWorkspaceBoundaries();
  const persons = personBoundary();
  const files = composeFiles(shared, {
    importPeople: persons,
    giftTarget: giftAttachmentTarget(),
    ...(logger ? { logger } : {}),
    objectStore,
  });
  const people = composePeople(shared, {
    importReferences: {
      vocabulary: (c) =>
        configuration.businessImportBoundary.referenceExists(c),
      file: (c) => files.businessImportBoundary.fileExists(c),
    },
    avatarImages: avatarImages(files.files),
    ...(logger ? { logger } : {}),
    genderOptions: configuration.genders,
    importantDatePublisher: personDateReminderPublisher(
      shared,
      configuration.reminderDelivery,
    ),
    mergeParticipants: personMergeParticipants(),
    profileFactWorkspace: configuration.profileFacts,
    importContactTypes: configuration.contactMethodTypes,
    restorePublisher: personRestoreReminderPublisher(
      shared,
      configuration.reminderDelivery,
    ),
  });
  const planning = composePlanning(shared, {
    importPeople: persons,
    importDateReference: (c) =>
      people.businessImportBoundary.dateBelongsToPerson(c),
    cursorKeyset: subjectKeyset,
    deliveryPreferences: configuration.reminderDelivery,
    people: persons,
  });
  const relationships = composeRelationships(shared, {
    importPeople: persons,
    importVocabulary: (c) =>
      configuration.businessImportBoundary.referenceExists(c),
    people: persons,
    peopleCreation: people.people,
    workspace: configuration.relationships,
  });
  const interactions = composeInteractions(shared, {
    importPeople: persons,
    importVocabulary: (c) =>
      configuration.businessImportBoundary.referenceExists(c),
    people: persons,
    publisher: planning.reminders,
    workspace: configuration.interactions,
  });
  const journal = composeJournal(shared, {
    activities: journalActivityBoundary(),
    people: persons,
    workspace: configuration.lifeEvents,
  });
  const gifts = composeGifts(shared, {
    importPeople: persons,
    attachments: files.giftAttachments,
    calendar: configuration.calendar,
    currencies: configuration.currencies,
  });
  const transfer = composeImportExport(shared, {
    exportFiles: files.exportBoundary,
    exportPeople: people.exportBoundary,
    business: {
      people: people.businessImportBoundary,
      gifts: gifts.businessImportBoundary,
      journal: journal.businessImportBoundary,
      files: files.businessImportBoundary,
      workspaces: configuration.businessImportBoundary,
      governance: historicalAuditImportBoundary(shared, {
        personExists: async (c) =>
          await people.importBoundary.presence({
            actor: c.actor,
            personId: c.personId,
            transaction: c.transaction,
          }) !== "absent",
        reminderExists: (c) =>
          planning.businessImportBoundary.assertReminder({
            workspaceId: c.actor.workspaceId,
            reminderId: c.reminderId,
            transaction: c.transaction,
          }),
      }),
      relationships: relationships.businessImportBoundary,
      interactions: interactions.businessImportBoundary,
      planning: planning.businessImportBoundary,
      vocabulary: configuration.vocabularyImportBoundary,
    },
    importContactTypes: configuration.contactMethodTypes,
    importChoices: configuration.importChoices,
    planning: planning.reminders,
    importFiles: files.importBoundary,
    importNotes: interactions.importBoundary,
    importPeople: people.importBoundary,
  });
  const governance = composeGovernance(shared);
  const workspaces = composeWorkspaces(shared, {
    attemptBudget: apiAccess.attemptBudget,
    // Rows a RESTRICT key keeps from the workspace cascade, erased first by
    // the modules that own them.
    erasure: {
      people: people.lifecycleErasure,
      relationships: relationships.lifecycleErasure,
    },
    identity: {
      accountSettings: identity.accountSettings,
      authentication: identity.authentication,
      invitations: identity.invitations,
      personalLifecycle: identity.personalLifecycle,
      registration: identity.registration,
      verification: identity.verification,
    },
    // The one cross-module map: what each module destroys when a workspace is
    // reset or deleted, assembled from the participants they each return.
    impact: {
      files: files.lifecycleImpact,
      gifts: gifts.lifecycleImpact,
      governance: governance.lifecycleImpact,
      importExport: transfer.lifecycleImpact,
      integrations: composeIntegrations().lifecycleImpact,
      interactions: interactions.lifecycleImpact,
      journal: journal.lifecycleImpact,
      operations: composeOperations().lifecycleImpact,
      people: people.lifecycleImpact,
      planning: planning.lifecycleImpact,
      relationships: relationships.lifecycleImpact,
    },
    mail,
    // API access's hook: suspending a member, or their leaving, revokes the
    // tokens and calendar feed they held in that workspace.
    memberCredentials: apiAccess.apiTokens,
    // Planning's hook: changing a timezone reschedules the reminders it owns.
    planningPublisher: planning.reminders,
    responseEqualizer: options.responseEqualizer ??
      createAuthenticationResponseEqualizer(
        DEFAULT_AUTHENTICATION_RESPONSE_FLOOR_MS,
      ),
    storage: objectStore,
    tokens: identity.tokens,
  });
  // Personalization is one settings page over seven owners; the router is the
  // only place that knows which module answers for which section.
  const personalization = createPersonalizationManagement({
    audit: settingsAuditFrom(shared.audit),
    clock: shared.clock,
    repository: new PersonalizationRouter(
      configuration.personalization,
      people.tagPersonalization,
      planning.personalizationReferences,
      people.personalizationReferences,
      relationships.personalizationReferences,
      interactions.personalizationReferences,
      journal.personalizationReferences,
    ),
    transaction: shared.transaction,
  });
  // The DAV bridges: a remote card is a person and a remote to-do is a task,
  // and only a root may spend one module's use case on another's behalf.
  const dav = davEnabled
    ? composeDavSync(shared, {
      keyset: davKeyset,
      people: davPeople(people),
      remote: options.davRemote,
      tasks: davTasks(planning.tasks),
    })
    : undefined;
  const directory = composePeopleDirectory(shared);
  const today = composeToday(shared);
  // The calendar feed (GAP-052): api-access accepts its secret, the
  // calendar-feed read model reads its events, and integrations writes them
  // as iCalendar with links at the configured public origin.
  const calendarFeed = createCalendarFeedPublication({
    authority: apiAccess.calendarFeeds,
    origin: policy.origin,
    source: composeCalendarFeed(shared),
  });

  return {
    activityReport: composeActivityReport(shared),
    apiTokens: apiAccess.apiTokens,
    avatars: people.avatars,
    auditHistory: composeAuditHistory(shared, { cursorKeyset: subjectKeyset }),
    browserSecurity: policy,
    bulk: people.bulk,
    calendarFeed,
    calendarFeeds: apiAccess.calendarFeeds,
    ...(dav ? { dav } : {}),
    directory: directory.directory,
    duplicateDismissals: people.duplicateDismissals,
    duplicates: directory.duplicates,
    establishVerifiedEntry: (command) =>
      workspaces.protectedSessions.establishVerifiedEntry(command),
    exports: transfer.exports,
    files: files.files,
    gifts: gifts.gifts,
    hasher: identity.hasher,
    importantDates: people.importantDates,
    imports: transfer.imports,
    interactions: interactions.interactions,
    invitations: workspaces.invitations,
    journal: journal.journal,
    journalTimeline: composeJournalTimeline(shared),
    legal: governance.legal,
    lifeEvents: journal.lifeEvents,
    ...(logger ? { logger } : {}),
    merge: people.merge,
    memberUiState: workspaces.memberUiState,
    notifications: composeNotifications(shared),
    passwordRecovery: identity.passwordRecovery,
    people: { ...people.people, ...people.lifecycle },
    personalization,
    personalLifecycle: workspaces.personalLifecycle,
    profile: composePersonProfile(shared),
    profileFacts: people.profileFacts,
    protectedSessions: workspaces.protectedSessions,
    readiness: () => databaseReadiness(database),
    recentPeople: workspaces.recentPeople,
    register: workspaces.registration,
    relationships: relationships.relationships,
    reminders: planning.reminders,
    retryVerificationDelivery: workspaces.retryVerificationDelivery,
    search: composeSearch(shared),
    settings: workspaces.settings,
    stars: people.stars,
    storageSettings: files.storageSettings,
    tagFacet: directory.tagFacet,
    tagOptions: directory.tagOptions,
    tasks: planning.tasks,
    today: today.interactions,
    todayAttention: today.attention,
    todayRecentPeople: today.recentPeople,
    todayReminders: today.reminders,
    todayTasks: today.tasks,
    verification: identity.verification,
    workspaceLifecycle: workspaces.workspaceLifecycle,
  };
}

/**
 * The deployment's runtime: the environment read once, decoded, and handed to
 * `createConfiguredApiApp`. Without a database URL the process still serves the
 * public health surface, which is what a container start probe needs.
 */
export function createApiRuntime(
  environment: EnvironmentReader,
  configure: typeof createConfiguredApiApp = createConfiguredApiApp,
):
  | ReturnType<typeof createConfiguredApiApp>
  | { readonly app: Hono<RequestIdEnv> } {
  const databaseUrl = resolveDatabaseUrl(environment);
  if (!databaseUrl) return { app: createApiApp() };

  const applicationEnvironment = environment.get("APP_ENV") ?? "development";
  const mfaKeysetValue = environment.get("AUTH_MFA_ENCRYPTION_KEYSET");
  const subjectKeysetValue = environment.get("AUTH_THROTTLE_SUBJECT_KEYSET");
  const davKeysetValue = environment.get("INTEGRATIONS_ENCRYPTION_KEYSET");
  const davEnabled = environment.get("INTEGRATIONS_DAV_ENABLED") !== "false";
  if (applicationEnvironment === "production" && !mfaKeysetValue) {
    throw new Error("AUTH_MFA_ENCRYPTION_KEYSET is required in production.");
  }
  if (applicationEnvironment === "production" && !subjectKeysetValue) {
    throw new Error("AUTH_THROTTLE_SUBJECT_KEYSET is required in production.");
  }
  if (
    applicationEnvironment === "production" && davEnabled && !davKeysetValue
  ) {
    throw new Error(
      "INTEGRATIONS_ENCRYPTION_KEYSET is required in production.",
    );
  }
  const policy = browserSecurityPolicy(
    applicationEnvironment,
    environment.get("PUBLIC_WEB_ORIGIN"),
  );
  return configure(
    databaseUrl,
    composeVerificationMail(environment),
    policy,
    mfaKeysetValue ? decodeMfaEncryptionKeyset(mfaKeysetValue) : undefined,
    subjectKeysetValue
      ? decodeAuthenticationSubjectKeyset(subjectKeysetValue)
      : undefined,
    createAuthenticationResponseEqualizer(
      resolveAuthenticationResponseFloor(
        environment.get("AUTH_MINIMUM_RESPONSE_MS"),
      ),
    ),
    undefined,
    undefined,
    davKeysetValue ? decodeDavEncryptionKeyset(davKeysetValue) : undefined,
    davEnabled,
    jsonLogger(),
  );
}
