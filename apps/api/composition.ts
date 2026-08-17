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
  createProtectedSessionCoordinator,
  createVerificationDeliveryRetry,
  PostgresActiveWorkspaceResolver,
  PostgresProfileFactConfiguration,
  PostgresRegistrationTransaction,
  PostgresRelationshipWorkspaceBoundary,
  PostgresWorkspaceInvitations,
  PostgresWorkspacePersonalization,
  PostgresWorkspaceRegistration,
  PostgresWorkspaceSettings,
} from "../../packages/backend/modules/workspaces/public.ts";
import {
  createFirstWorkspaceRegistration,
  type VerificationMail,
} from "../../packages/backend/modules/workspaces/public.ts";
import { SmtpVerificationMail } from "../../packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail.ts";
import {
  PostgresAuthenticationAudit,
  PostgresCommunicationAudit,
  PostgresImportantDateAudit,
  PostgresInteractionAudit,
  PostgresInvitationAudit,
  PostgresPersonCreatedAudit,
  PostgresPersonLifecycleAudit,
  PostgresProfileFactAudit,
  PostgresRegistrationAudit,
  PostgresRelationshipAudit,
  PostgresSettingsAudit,
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
import { createSettingsManagement } from "../../packages/backend/modules/workspaces/public.ts";
import {
  createImportantDateManagement,
  createPeopleManagement,
  createPersonLifecycle,
  createProfileFactManagement,
  type ImportantDateManagement,
  PostgresImportantDateRepository,
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
  PostgresPersonDateReminderPublisher,
  PostgresReminderRulePersonalization,
} from "../../packages/backend/modules/planning/public.ts";
import {
  type CommunicationManagement,
  createCommunicationManagement,
  createInteractionManagement,
  type InteractionManagement,
  PostgresCommunicationRepository,
  PostgresInteractionPersonalizationReferences,
  PostgresInteractionRepository,
} from "../../packages/backend/modules/interactions/public.ts";
import { PostgresJournalPersonalizationReferences } from "../../packages/backend/modules/journal/public.ts";
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
  createTodayInteractions,
  PostgresTodayInteractionsRepository,
  type TodayInteractions,
} from "../../packages/backend/read-models/today/public.ts";
import {
  type AuditHistory,
  createAuditHistory,
  PostgresAuditHistoryRepository,
} from "../../packages/backend/read-models/audit-history/public.ts";
import { createGovernanceRoutes } from "./governance.ts";

export interface ApiServices extends RegistrationHttpServices {
  readonly activityReport?: ActivityReport;
  readonly auditHistory?: AuditHistory;
  readonly directory?: PeopleDirectory;
  readonly invitations?: InvitationHttpServices["invitations"];
  readonly importantDates?: ImportantDateManagement;
  readonly interactions?: InteractionManagement & CommunicationManagement;
  readonly profileFacts?: PeopleHttpServices["profileFacts"];
  readonly passwordRecovery?: AuthenticationHttpServices["passwordRecovery"];
  readonly protectedSessions?: AuthenticationHttpServices["protectedSessions"];
  readonly settings?: SettingsHttpServices["settings"];
  readonly personalization?: SettingsHttpServices["personalization"];
  readonly people?: PeopleHttpServices["people"];
  readonly profile?: PersonProfile;
  readonly relationships?: RelationshipManagement;
  readonly tagOptions?: PeopleTagOptions;
  readonly today?: TodayInteractions;
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

  if (services) {
    api.route("/", createRegistrationRoutes(services));
    if (services.passwordRecovery && services.protectedSessions) {
      api.route(
        "/",
        createAuthenticationRoutes({
          browserSecurity: services.browserSecurity,
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
          tagOptions: services.tagOptions,
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
    if (services.auditHistory && services.protectedSessions) {
      api.route(
        "/",
        createGovernanceRoutes({
          auditHistory: services.auditHistory,
          protectedSessions: services.protectedSessions,
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
  const protectedSessions = createProtectedSessionCoordinator({
    attemptBudget: new PostgresAuthenticationAttemptBudget(
      connection.db,
      new AuthenticationSubjectDigester(subjectKeyset),
    ),
    audit: new PostgresAuthenticationAudit(),
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
  const settings = createSettingsManagement({
    audit: new PostgresSettingsAudit(),
    clock,
    identity: new PostgresIdentityAccountSettings(tokens),
    identityDisplay: invitationIdentity,
    transaction,
    workspace: new PostgresWorkspaceSettings(),
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
  const peopleManagement = createPeopleManagement({
    audit: new PostgresPersonCreatedAudit(),
    clock,
    ids,
    repository: new PostgresPeopleRepository(),
    transaction: peopleTransaction,
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
  const interactions = {
    ...createInteractionManagement({
      audit: new PostgresInteractionAudit(),
      clock,
      people: interactionPeople,
      repository: new PostgresInteractionRepository(),
      transaction: peopleTransaction,
      workspace: interactionWorkspace,
    }),
    ...createCommunicationManagement({
      audit: new PostgresCommunicationAudit(),
      clock,
      people: interactionPeople,
      repository: new PostgresCommunicationRepository(),
      transaction: peopleTransaction,
      workspace: interactionWorkspace,
    }),
  };
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
  const auditHistory = createAuditHistory({
    cursorKeyset: subjectKeyset,
    repository: new PostgresAuditHistoryRepository(connection.db),
  });
  const today = createTodayInteractions({
    repository: new PostgresTodayInteractionsRepository(connection.db),
  });
  const app = createApiApp({
    activityReport,
    auditHistory,
    browserSecurity: policy,
    directory,
    hasher,
    invitations,
    importantDates,
    interactions,
    passwordRecovery,
    people,
    profile,
    profileFacts,
    relationships,
    protectedSessions,
    personalization,
    settings,
    tagOptions,
    today,
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
