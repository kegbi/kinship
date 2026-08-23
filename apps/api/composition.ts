import { Hono } from "hono";
import { sql } from "kysely";
import { HEALTH_RESPONSE } from "../../packages/contracts/health.ts";
import {
  AesGcmMfaSecretBox,
  Argon2idPasswordHasher,
  createPasswordRecovery,
  type MfaEncryptionKeyset,
  PostgresEmailVerification,
  PostgresIdentityAccountSettings,
  PostgresIdentityAuthentication,
  PostgresIdentityPersonalLifecycle,
  PostgresIdentityRegistration,
  PostgresInvitationIdentity,
  PostgresPasswordRecoveryRepository,
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  type AuthenticationResponseEqualizer,
  createPersonalizationManagement,
  createPersonalLifecycle,
  createProtectedSessionCoordinator,
  createRecentPeopleManagement,
  createVerificationDeliveryRetry,
  PostgresActiveWorkspaceResolver,
  PostgresPersonalLifecycleMemberships,
  PostgresProfileFactConfiguration,
  PostgresRecentPeopleRepository,
  PostgresRegistrationTransaction,
  PostgresRelationshipWorkspaceBoundary,
  PostgresWorkspaceCurrencyBoundary,
  PostgresWorkspaceInvitations,
  PostgresWorkspacePersonalization,
  PostgresWorkspaceRegistration,
  PostgresWorkspaceSettings,
  type SettingsPlanningPublisher,
} from "../../packages/backend/modules/workspaces/public.ts";
import {
  createFirstWorkspaceRegistration,
  type VerificationMail,
} from "../../packages/backend/modules/workspaces/public.ts";
import { SmtpVerificationMail } from "../../packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail.ts";
import {
  createLegalAcceptance,
  type LegalAcceptance,
  PostgresAuthenticationAudit,
  PostgresCommunicationAudit,
  PostgresExportAudit,
  PostgresFileAudit,
  PostgresGiftAudit,
  PostgresImportantDateAudit,
  PostgresImportAudit,
  PostgresInteractionAudit,
  PostgresInvitationAudit,
  PostgresJournalAudit,
  PostgresLegalAcceptanceRepository,
  PostgresPersonalLifecycleAudit,
  PostgresPersonCreatedAudit,
  PostgresPersonLifecycleAudit,
  PostgresProfileFactAudit,
  PostgresRegistrationAudit,
  PostgresRelationshipAudit,
  PostgresReminderAudit,
  PostgresSettingsAudit,
  PostgresTaskAudit,
} from "../../packages/backend/modules/governance/public.ts";
import { createWorkspaceInvitationCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import {
  AuthenticationSubjectDigester,
  type AuthenticationSubjectKeyset,
  PostgresAuthenticationAttemptBudget,
} from "../../packages/backend/modules/api-access/public.ts";
import {
  createRegistrationRoutes,
  type RegistrationHttpServices,
} from "./registration.ts";
import {
  type AuthenticationHttpServices,
  createAuthenticationRoutes,
} from "./authentication.ts";
import {
  createInvitationRoutes,
  type InvitationHttpServices,
} from "./invitations.ts";
import {
  type BrowserSecurityPolicy,
  browserSecurityPolicy,
} from "./security_config.ts";
import { createSettingsRoutes, type SettingsHttpServices } from "./settings.ts";
import {
  createPersonalLifecycleRoutes,
  type PersonalLifecycleHttpServices,
} from "./personal_lifecycle.ts";
import { createSettingsManagement } from "../../packages/backend/modules/workspaces/public.ts";
import {
  createImportantDateManagement,
  createPeopleManagement,
  createPersonLifecycle,
  createProfileFactManagement,
  type ImportantDateManagement,
  PostgresImportantDateRepository,
  PostgresPeopleExportBoundary,
  PostgresPeopleImportBoundary,
  PostgresPeoplePersonalizationReferences,
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
  PostgresPersonLifecycleRepository,
  PostgresProfileFactOrganizations,
  PostgresProfileFactRepository,
  PostgresRelationshipPersonBoundary,
  PostgresTagPersonalization,
} from "../../packages/backend/modules/people/public.ts";
import {
  createReminderManagement,
  createTaskManagement,
  PostgresPersonDateReminderPublisher,
  PostgresReminderRepository,
  PostgresReminderRulePersonalization,
  PostgresReminderWorkspaceBoundary,
  PostgresTaskRepository,
  type ReminderManagement,
  type TaskManagement,
} from "../../packages/backend/modules/planning/public.ts";
import {
  type CommunicationManagement,
  createCommunicationManagement,
  createInteractionManagement,
  type InteractionManagement,
  PostgresCommunicationRepository,
  PostgresInteractionPersonalizationReferences,
  PostgresInteractionRepository,
  PostgresJournalActivityBoundary,
} from "../../packages/backend/modules/interactions/public.ts";
import {
  createJournalManagement,
  type JournalManagement,
  PostgresJournalPersonalizationReferences,
  PostgresJournalRepository,
} from "../../packages/backend/modules/journal/public.ts";
import { createPeopleRoutes, type PeopleHttpServices } from "./people.ts";
import { createRelationshipRoutes } from "./relationships.ts";
import { createInteractionRoutes } from "./interactions.ts";
import {
  createRelationshipManagement,
  PostgresRelationshipPersonalizationReferences,
  PostgresRelationshipRepository,
  type RelationshipManagement,
} from "../../packages/backend/modules/relationships/public.ts";
import {
  createPeopleDirectory,
  createPeopleTagOptions,
  type PeopleDirectory,
  type PeopleTagOptions,
  PostgresPeopleDirectoryRepository,
} from "../../packages/backend/read-models/people-directory/public.ts";
import {
  createPersonProfile,
  type PersonProfile,
  PostgresPersonProfileRepository,
} from "../../packages/backend/read-models/person-profile/public.ts";
import {
  createAuthenticationResponseEqualizer,
  DEFAULT_AUTHENTICATION_RESPONSE_FLOOR_MS,
} from "./authentication_response.ts";
import { PersonalizationRepositoryRouter } from "./personalization_repository.ts";
import { PostgresInteractionWorkspaceBoundary } from "../../packages/backend/modules/workspaces/public.ts";
import {
  type ActivityReport,
  createActivityReport,
  PostgresActivityReportRepository,
} from "../../packages/backend/read-models/activity-report/public.ts";
import {
  createTodayAttention,
  createTodayInteractions,
  createTodayRecentPeople,
  createTodayReminders,
  createTodayTasks,
  PostgresTodayAttentionRepository,
  PostgresTodayInteractionsRepository,
  PostgresTodayRecentPeopleRepository,
  PostgresTodayRemindersRepository,
  PostgresTodayTasksRepository,
  type TodayAttention,
  type TodayInteractions,
  type TodayRecentPeople,
  type TodayReminders,
  type TodayTasks,
} from "../../packages/backend/read-models/today/public.ts";
import {
  type AuditHistory,
  createAuditHistory,
  PostgresAuditHistoryRepository,
} from "../../packages/backend/read-models/audit-history/public.ts";
import {
  createGovernanceRoutes,
  createLegalRequirementGuard,
} from "./governance.ts";
import { createPlanningRoutes } from "./planning.ts";
import { createFileRoutes } from "./files.ts";
import { createGiftRoutes } from "./gifts.ts";
import { createJournalRoutes } from "./journal.ts";
import { createImportRoutes } from "./imports.ts";
import {
  createJournalTimeline,
  type JournalTimeline,
  PostgresJournalTimelineRepository,
} from "../../packages/backend/read-models/journal-timeline/public.ts";
import {
  createObjectStorageRequestTransport,
  createPersonFileManagement,
  createStorageSettings,
  DeclaredMediaScanner,
  type ObjectStorage,
  PERSON_FILE_MAX_BYTES,
  type PersonFileManagement,
  PostgresExportFileBoundary,
  PostgresFileImportBoundary,
  PostgresFileMetadataRepository,
  PostgresGiftAttachmentBoundary,
  PostgresStorageSettingsRepository,
  S3CompatibleObjectStorage,
  type StorageSettings,
  WebCryptoFileIdentifiers,
  WebCryptoObjectKeys,
} from "../../packages/backend/modules/files/public.ts";
import {
  createGiftManagement,
  type GiftManagement,
  PostgresGiftRepository,
} from "../../packages/backend/modules/gifts/public.ts";
import { Client as MinioClient } from "minio";
import { resolveObjectStorageConfiguration } from "./file_storage_config.ts";
import {
  createExportManagement,
  createImportManagement,
  type ExportManagement,
  type ImportManagement,
  PostgresExportRepository,
  PostgresExportTransaction,
  PostgresImportRepository,
  PostgresImportTransaction,
} from "../../packages/backend/modules/import-export/public.ts";
import { createExportRoutes } from "./exports.ts";

export interface ApiServices extends RegistrationHttpServices {
  readonly activityReport?: ActivityReport;
  readonly auditHistory?: AuditHistory;
  readonly directory?: PeopleDirectory;
  readonly files?: PersonFileManagement;
  readonly storageSettings?: StorageSettings;
  readonly gifts?: GiftManagement;
  readonly journal?: JournalManagement;
  readonly journalTimeline?: JournalTimeline;
  readonly imports?: ImportManagement;
  readonly exports?: ExportManagement;
  readonly legal?: LegalAcceptance;
  readonly invitations?: InvitationHttpServices["invitations"];
  readonly importantDates?: ImportantDateManagement;
  readonly interactions?: InteractionManagement & CommunicationManagement;
  readonly profileFacts?: PeopleHttpServices["profileFacts"];
  readonly passwordRecovery?: AuthenticationHttpServices["passwordRecovery"];
  readonly personalLifecycle?:
    PersonalLifecycleHttpServices["personalLifecycle"];
  readonly protectedSessions?: AuthenticationHttpServices["protectedSessions"];
  readonly settings?: SettingsHttpServices["settings"];
  readonly personalization?: SettingsHttpServices["personalization"];
  readonly people?: PeopleHttpServices["people"];
  readonly recentPeople?: PeopleHttpServices["recentPeople"];
  readonly profile?: PersonProfile;
  readonly relationships?: RelationshipManagement;
  readonly reminders?: ReminderManagement;
  readonly tagOptions?: PeopleTagOptions;
  readonly tasks?: TaskManagement;
  readonly today?: TodayInteractions;
  readonly todayAttention?: TodayAttention;
  readonly todayTasks?: TodayTasks;
  readonly todayReminders?: TodayReminders;
  readonly todayRecentPeople?: TodayRecentPeople;
  readonly readiness?: () => Promise<boolean>;
}

export class CapturedVerificationMail implements VerificationMail {
  readonly #messages = new Map<string, string[]>();
  readonly #passwordResets = new Map<string, string[]>();
  readonly #invitations = new Map<string, string[]>();

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

export function createApiApp(services?: ApiServices): Hono {
  const api = new Hono();

  api.get("/api/v1/health", async (context) => {
    context.header("Cache-Control", "no-store");
    if (services?.readiness && !(await services.readiness())) {
      return context.json({ status: "healthy", readiness: "unavailable" }, 503);
    }
    return context.json(HEALTH_RESPONSE);
  });

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
      if (services.settings && services.personalization) {
        api.route(
          "/",
          createSettingsRoutes({
            browserSecurity: services.browserSecurity,
            protectedSessions: services.protectedSessions,
            personalization: services.personalization,
            settings: services.settings,
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
    if (
      services.directory && services.people && services.profile &&
      services.protectedSessions && services.tagOptions
    ) {
      api.route(
        "/",
        createPeopleRoutes({
          browserSecurity: services.browserSecurity,
          directory: services.directory,
          ...(services.importantDates
            ? { importantDates: services.importantDates }
            : {}),
          ...(services.profileFacts
            ? { profileFacts: services.profileFacts }
            : {}),
          people: services.people,
          profile: services.profile,
          protectedSessions: services.protectedSessions,
          ...(services.recentPeople
            ? { recentPeople: services.recentPeople }
            : {}),
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
          browserSecurity: services.browserSecurity,
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

export function createConfiguredApiApp(
  databaseUrl: string,
  mailAdapter?: VerificationMail,
  policy: BrowserSecurityPolicy = browserSecurityPolicy("test", undefined),
  mfaKeysetOverride?: MfaEncryptionKeyset,
  subjectKeysetOverride?: AuthenticationSubjectKeyset,
  responseEqualizerOverride?: AuthenticationResponseEqualizer,
  objectStorageOverride?: ObjectStorage,
): { readonly app: Hono; readonly close: () => Promise<void> } {
  const random = new WebCryptoRandomSource();
  const tokens = new SecureTokenService(random);
  const clock = { now: () => new Date() };
  const ids = { create: () => crypto.randomUUID() };
  const environment = Deno.env.get("APP_ENV") ?? "development";
  const mail = mailAdapter ?? new SmtpVerificationMail({
    environment,
    from: Deno.env.get("SMTP_FROM") ?? "hello@kinship.local",
    host: Deno.env.get("SMTP_HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("SMTP_PORT") ?? "1025"),
    webOrigin: Deno.env.get("PUBLIC_WEB_ORIGIN") ?? "http://127.0.0.1:4321",
  });
  const connection = connectDatabase(databaseUrl);
  const hasher = new Argon2idPasswordHasher(random, {
    memoryKiB: 19_456,
    iterations: 2,
    parallelism: 1,
    saltLength: 16,
    hashLength: 32,
  });
  if (environment === "production" && !mfaKeysetOverride) {
    throw new Error("AUTH_MFA_ENCRYPTION_KEYSET is required in production.");
  }
  const mfaKeyset = mfaKeysetOverride ?? {
    activeKeyId: "local-development",
    keys: new Map([["local-development", new Uint8Array(32).fill(0x4b)]]),
  };
  if (environment === "production" && !subjectKeysetOverride) {
    throw new Error("AUTH_THROTTLE_SUBJECT_KEYSET is required in production.");
  }
  const subjectKeyset = subjectKeysetOverride ?? {
    activeVersion: 1,
    keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
  };
  const authentication = new PostgresIdentityAuthentication(
    connection.db,
    hasher,
    tokens,
    new AesGcmMfaSecretBox(mfaKeyset, random),
    clock,
    ids,
  );
  const transaction = new PostgresRegistrationTransaction(connection.db);
  const registrationDependencies = {
    audit: new PostgresRegistrationAudit(),
    clock,
    identity: new PostgresIdentityRegistration(),
    ids,
    mail,
    tokens,
    transaction,
    workspace: new PostgresWorkspaceRegistration(),
  };
  const registration = createFirstWorkspaceRegistration(
    registrationDependencies,
  );
  const verification = new PostgresEmailVerification(
    connection.db,
    tokens,
    clock,
    ids,
  );
  const attemptBudget = new PostgresAuthenticationAttemptBudget(
    connection.db,
    new AuthenticationSubjectDigester(subjectKeyset),
  );
  const authenticationAudit = new PostgresAuthenticationAudit();
  const protectedSessions = createProtectedSessionCoordinator({
    attemptBudget,
    audit: authenticationAudit,
    clock,
    identity: authentication,
    identityEntry: verification,
    responseEqualizer: responseEqualizerOverride ??
      createAuthenticationResponseEqualizer(
        DEFAULT_AUTHENTICATION_RESPONSE_FLOOR_MS,
      ),
    transaction,
    workspace: new PostgresActiveWorkspaceResolver(),
  });
  const passwordRecovery = createPasswordRecovery({
    clock,
    hasher,
    ids,
    mail: {
      sendPasswordReset: (message) => {
        if (!mail.sendPasswordReset) {
          return Promise.reject(new Error("Password-reset mail unavailable."));
        }
        return mail.sendPasswordReset(message);
      },
    },
    repository: new PostgresPasswordRecoveryRepository(),
    tokens,
    transaction,
  });
  const invitationIdentity = new PostgresInvitationIdentity();
  const invitations = createWorkspaceInvitationCoordinator({
    audit: new PostgresInvitationAudit(),
    clock,
    ids,
    identity: {
      assertPendingUserPostconditions: (command) =>
        registrationDependencies.identity.assertPendingUserPostconditions(
          command,
        ),
      assertSessionPostcondition: (command) =>
        authentication.assertSessionPostcondition(command),
      consumeVerifiedIdentityEntry: (command) =>
        verification.consumeVerifiedIdentityEntry(command),
      createPendingUser: (command) =>
        registrationDependencies.identity.createPendingUser(command),
      createRetryVerificationToken: (command) =>
        registrationDependencies.identity.createRetryVerificationToken(
          command,
        ),
      findIdentityIdByEmail: (command) =>
        invitationIdentity.findIdentityIdByEmail(command),
      isVerifiedInvitationIdentity: (command) =>
        invitationIdentity.isVerifiedInvitationIdentity(command),
      issueSession: (command) => authentication.issueSession(command),
      listIdentityDisplaySummaries: (command) =>
        invitationIdentity.listIdentityDisplaySummaries(command),
    },
    mail: {
      sendInvitation: (message) => {
        if (!mail.sendInvitation) {
          return Promise.reject(new Error("Invitation mail unavailable."));
        }
        return mail.sendInvitation(message);
      },
      sendVerification: (message) => mail.sendVerification(message),
    },
    repository: new PostgresWorkspaceInvitations(),
    tokens,
    transaction,
  });
  const settingsPlanningPublisher: {
    current?: SettingsPlanningPublisher;
  } = {};
  const settings = createSettingsManagement({
    audit: new PostgresSettingsAudit(),
    clock,
    identity: new PostgresIdentityAccountSettings(tokens),
    identityDisplay: invitationIdentity,
    planningPublisher: {
      timezoneChanged: (actor, settingsTransaction) =>
        settingsPlanningPublisher.current?.timezoneChanged(
          actor,
          settingsTransaction,
        ) ??
          Promise.resolve(),
      workspaceTimezoneChanged: (actor, timezone, settingsTransaction) =>
        settingsPlanningPublisher.current?.workspaceTimezoneChanged(
          actor,
          timezone,
          settingsTransaction,
        ) ?? Promise.resolve(),
    },
    transaction,
    workspace: new PostgresWorkspaceSettings(),
  });
  const personalLifecycle = createPersonalLifecycle({
    attemptBudget,
    audit: new PostgresPersonalLifecycleAudit(),
    authenticationAudit,
    clock,
    identity: new PostgresIdentityPersonalLifecycle(hasher),
    memberships: new PostgresPersonalLifecycleMemberships(),
    transaction,
  });
  const workspacePersonalization = new PostgresWorkspacePersonalization();
  const personalization = createPersonalizationManagement({
    audit: new PostgresSettingsAudit(),
    clock,
    repository: new PersonalizationRepositoryRouter(
      workspacePersonalization,
      new PostgresTagPersonalization(),
      new PostgresReminderRulePersonalization(),
      new PostgresPeoplePersonalizationReferences(),
      new PostgresRelationshipPersonalizationReferences(),
      new PostgresInteractionPersonalizationReferences(),
      new PostgresJournalPersonalizationReferences(),
    ),
    transaction,
  });
  const peopleTransaction = new PostgresPeopleTransaction(connection.db);
  const objectStorage = objectStorageOverride ?? (() => {
    const configuration = resolveObjectStorageConfiguration(Deno.env);
    return new S3CompatibleObjectStorage(
      new MinioClient({
        accessKey: configuration.accessKey,
        endPoint: configuration.host,
        port: configuration.port,
        secretKey: configuration.secretKey,
        transport: createObjectStorageRequestTransport(
          configuration.useSsl,
          configuration.requestTimeoutMs,
        ),
        useSSL: configuration.useSsl,
      }) as unknown as ConstructorParameters<
        typeof S3CompatibleObjectStorage
      >[0],
      configuration.bucket,
    );
  })();
  const files = createPersonFileManagement({
    audit: new PostgresFileAudit(),
    clock,
    ids: new WebCryptoFileIdentifiers(),
    keys: new WebCryptoObjectKeys(),
    repository: new PostgresFileMetadataRepository(),
    scanner: new DeclaredMediaScanner(),
    storage: objectStorage,
    transaction: peopleTransaction,
  });
  const storageSettings = createStorageSettings({
    maximumUploadBytes: PERSON_FILE_MAX_BYTES,
    provider: { bucket: objectStorage.bucket, name: objectStorage.provider },
    providerHealth: () => objectStorage.health(),
    repository: new PostgresStorageSettingsRepository(),
    transaction: peopleTransaction,
  });
  const gifts = createGiftManagement({
    attachments: new PostgresGiftAttachmentBoundary(),
    audit: new PostgresGiftAudit(),
    clock,
    currencies: new PostgresWorkspaceCurrencyBoundary(),
    ids: { next: () => ids.create() },
    repository: new PostgresGiftRepository(),
    transaction: peopleTransaction,
  });
  const journal = createJournalManagement({
    activities: new PostgresJournalActivityBoundary(),
    audit: new PostgresJournalAudit(),
    clock,
    ids: { next: () => ids.create() },
    repository: new PostgresJournalRepository(),
    transaction: peopleTransaction,
  });
  const imports = createImportManagement({
    audit: new PostgresImportAudit(),
    files: new PostgresFileImportBoundary(),
    ids: { next: () => ids.create() },
    people: new PostgresPeopleImportBoundary(),
    repository: new PostgresImportRepository(connection.db),
    transaction: new PostgresImportTransaction(connection.db),
  });
  const exports = createExportManagement({
    audit: new PostgresExportAudit(),
    clock,
    files: new PostgresExportFileBoundary(connection.db, {
      ids: new WebCryptoFileIdentifiers(),
      keys: new WebCryptoObjectKeys(),
      storage: objectStorage,
    }),
    ids: { next: () => ids.create() },
    people: new PostgresPeopleExportBoundary(),
    repository: new PostgresExportRepository(),
    tokens: { next: () => crypto.randomUUID() },
    transaction: new PostgresExportTransaction(connection.db),
  });
  const peopleRepository = new PostgresPeopleRepository();
  const peopleManagement = createPeopleManagement({
    audit: new PostgresPersonCreatedAudit(),
    clock,
    ids,
    repository: peopleRepository,
    transaction: peopleTransaction,
  });
  const recentPeople = createRecentPeopleManagement({
    repository: new PostgresRecentPeopleRepository(),
    transaction,
  });
  const peopleLifecycle = createPersonLifecycle({
    audit: new PostgresPersonLifecycleAudit(),
    clock,
    repository: new PostgresPersonLifecycleRepository(),
    transaction: peopleTransaction,
  });
  const importantDates = createImportantDateManagement({
    audit: new PostgresImportantDateAudit(),
    clock,
    ids,
    publisher: new PostgresPersonDateReminderPublisher(),
    repository: new PostgresImportantDateRepository(),
    transaction: peopleTransaction,
  });
  const profileFacts = createProfileFactManagement({
    audit: new PostgresProfileFactAudit(),
    clock,
    ids,
    organizations: new PostgresProfileFactOrganizations(),
    repository: new PostgresProfileFactRepository(),
    transaction: peopleTransaction,
    workspace: new PostgresProfileFactConfiguration(),
  });
  const relationships = createRelationshipManagement({
    audit: new PostgresRelationshipAudit(),
    clock,
    ids,
    people: new PostgresRelationshipPersonBoundary(),
    peopleCreation: peopleManagement,
    repository: new PostgresRelationshipRepository(),
    transaction: peopleTransaction,
    workspace: new PostgresRelationshipWorkspaceBoundary(),
  });
  const interactionWorkspace = new PostgresInteractionWorkspaceBoundary();
  const interactionPeople = new PostgresRelationshipPersonBoundary();
  const reminders = createReminderManagement({
    audit: new PostgresReminderAudit(),
    clock,
    people: interactionPeople,
    repository: new PostgresReminderRepository(),
    transaction: peopleTransaction,
    workspace: new PostgresReminderWorkspaceBoundary(),
  });
  settingsPlanningPublisher.current = reminders;
  const interactions = {
    ...createInteractionManagement({
      audit: new PostgresInteractionAudit(),
      clock,
      people: interactionPeople,
      publisher: reminders,
      repository: new PostgresInteractionRepository(),
      transaction: peopleTransaction,
      workspace: interactionWorkspace,
    }),
    ...createCommunicationManagement({
      audit: new PostgresCommunicationAudit(),
      clock,
      people: interactionPeople,
      publisher: reminders,
      repository: new PostgresCommunicationRepository(),
      transaction: peopleTransaction,
      workspace: interactionWorkspace,
    }),
  };
  const tasks = createTaskManagement({
    audit: new PostgresTaskAudit(),
    clock,
    cursorKeyset: subjectKeyset,
    people: interactionPeople,
    repository: new PostgresTaskRepository(),
    transaction: peopleTransaction,
    workspace: interactionWorkspace,
  });
  const people = { ...peopleManagement, ...peopleLifecycle };
  const directoryRepository = new PostgresPeopleDirectoryRepository(
    connection.db,
  );
  const directory = createPeopleDirectory({ repository: directoryRepository });
  const tagOptions = createPeopleTagOptions({
    repository: directoryRepository,
  });
  const profile = createPersonProfile({
    repository: new PostgresPersonProfileRepository(connection.db),
  });
  const activityReport = createActivityReport({
    repository: new PostgresActivityReportRepository(connection.db),
  });
  const journalTimeline = createJournalTimeline({
    repository: new PostgresJournalTimelineRepository(connection.db),
  });
  const auditHistory = createAuditHistory({
    cursorKeyset: subjectKeyset,
    repository: new PostgresAuditHistoryRepository(connection.db),
  });
  const legal = createLegalAcceptance({
    clock,
    ids: { next: () => ids.create() },
    repository: new PostgresLegalAcceptanceRepository(connection.db),
  });
  const today = createTodayInteractions({
    repository: new PostgresTodayInteractionsRepository(connection.db),
  });
  const todayAttention = createTodayAttention({
    clock,
    repository: new PostgresTodayAttentionRepository(connection.db),
  });
  const todayTasks = createTodayTasks({
    clock,
    repository: new PostgresTodayTasksRepository(connection.db),
  });
  const todayReminders = createTodayReminders({
    clock,
    repository: new PostgresTodayRemindersRepository(connection.db),
  });
  const todayRecentPeople = createTodayRecentPeople({
    repository: new PostgresTodayRecentPeopleRepository(connection.db),
  });
  const app = createApiApp({
    activityReport,
    auditHistory,
    browserSecurity: policy,
    directory,
    files,
    storageSettings,
    gifts,
    hasher,
    invitations,
    importantDates,
    imports,
    exports,
    interactions,
    journal,
    journalTimeline,
    legal,
    passwordRecovery,
    personalLifecycle,
    people,
    profile,
    profileFacts,
    recentPeople,
    relationships,
    reminders,
    protectedSessions,
    personalization,
    settings,
    tagOptions,
    tasks,
    today,
    todayAttention,
    todayReminders,
    todayRecentPeople,
    todayTasks,
    register: registration,
    retryVerificationDelivery: createVerificationDeliveryRetry(
      registrationDependencies,
    ),
    verification,
    establishVerifiedEntry: (command) =>
      protectedSessions.establishVerifiedEntry(command),
    readiness: async () => {
      try {
        const probe = await Promise.race([
          sql<{ ready: number }>`select 1 as ready`.execute(connection.db),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), 1_500)
          ),
        ]);
        return probe !== undefined;
      } catch {
        return false;
      }
    },
  });
  return { app, close: connection.destroy };
}
