import { PostgresImportChoicesBoundary } from "./adapters/postgres/import_choices.ts";
import { PostgresWorkspaceBusinessImportBoundary } from "./adapters/postgres/import_business_boundary.ts";
import { PostgresVocabularyBusinessImportBoundary } from "./adapters/postgres/business_vocabulary_import.ts";
/**
 * Workspaces composition. Only a declared composition root imports it.
 *
 * Three of the objects built here are not workspaces' own business: the actor
 * revalidation every module writes behind, the workspace an authenticated
 * identity enters, and the account-scoped transaction runner. They are
 * separate exports because a root needs them before it composes anything —
 * they are fields of the shared composition context.
 *
 * The identity facades arrive as ports. Workspaces already declares identity
 * as a dependency, so it names those facade types, but it never reaches for
 * identity's adapters.
 */

import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../platform/postgres/database.ts";
import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresContactMethodTypeCatalog } from "./adapters/postgres/contact_method_types.ts";
import { SmtpReminderMail } from "./adapters/mail/smtp_reminder_mail.ts";
import {
  resolveSmtpVerificationMailOptions,
  SmtpVerificationMail,
} from "./adapters/mail/smtp_verification_mail.ts";
import {
  PostgresActiveWorkspaceResolver,
  PostgresActorRevalidation,
} from "./adapters/postgres/actor_revalidation.ts";
import { PostgresWorkspaceCurrencyBoundary } from "./adapters/postgres/currency_boundary.ts";
import { PostgresWorkspaceCalendarBoundary } from "./adapters/postgres/workspace_calendar.ts";
import { PostgresInteractionWorkspaceBoundary } from "./adapters/postgres/interaction_workspace_boundary.ts";
import { PostgresGenderOptionBoundary } from "./adapters/postgres/gender_option_boundary.ts";
import { PostgresLifeEventWorkspaceBoundary } from "./adapters/postgres/life_event_workspace_boundary.ts";
import { PostgresMemberUiStateRepository } from "./adapters/postgres/member_ui_state.ts";
import { PostgresPersonalLifecycleMemberships } from "./adapters/postgres/personal_lifecycle.ts";
import { PostgresWorkspacePersonalization } from "./adapters/postgres/personalization.ts";
import { PostgresProfileFactConfiguration } from "./adapters/postgres/profile_fact_configuration.ts";
import { PostgresRecentPeopleRepository } from "./adapters/postgres/recent_people.ts";
import {
  PostgresRegistrationTransaction,
  PostgresWorkspaceRegistration,
} from "./adapters/postgres/registration_repository.ts";
import { PostgresRelationshipWorkspaceBoundary } from "./adapters/postgres/relationship_workspace_boundary.ts";
import { PostgresSelfPersonMergeParticipant } from "./adapters/postgres/self_person_merge.ts";
import { PostgresReminderDeliveryPreferences } from "./adapters/postgres/reminder_delivery_preferences.ts";
import { PostgresWorkspaceSettings } from "./adapters/postgres/settings_management.ts";
import {
  PostgresWorkspaceLifecycleRepository,
  PostgresWorkspaceLifecycleSecurityAudit,
} from "./adapters/postgres/workspace_lifecycle.ts";
import { PostgresWorkspaceInvitations } from "./adapters/postgres/workspace_invitations.ts";
import {
  type AuthenticationAttemptBudget,
  authenticationAuditFrom,
  type AuthenticationResponseEqualizer,
  createFirstWorkspaceRegistration,
  createMemberUiStateManagement,
  createPersonalLifecycle,
  createProtectedSessionCoordinator,
  createRecentPeopleManagement,
  createSettingsManagement,
  createVerificationDeliveryRetry,
  createWorkspaceCleanupReconciler,
  createWorkspaceInvitationCoordinator,
  createWorkspaceLifecycle,
  invitationAuditFrom,
  type InvitationMail,
  type InvitationTokens,
  type MemberCredentialRevocation,
  personalLifecycleAuditFrom,
  type RecentPersonScope,
  registrationAuditFrom,
  settingsAuditFrom,
  type SettingsPlanningPublisher,
  type VerificationMail,
  type VerificationTokens,
  type WorkspaceLifecycleCascadeParticipants,
  type WorkspaceLifecycleDependentErasures,
  workspaceResetActivityAuditFrom,
} from "./public.ts";
import type {
  IdentityAccountSettingsFacade,
  IdentityAuthenticationFacade,
  IdentityPersonalLifecycleFacade,
  IdentityRegistrationFacade,
  InvitationIdentityFacade,
  VerifiedIdentityEntryFacade,
} from "../identity/public.ts";

export { resolveSmtpVerificationMailOptions };

interface MailEnvironment {
  get(name: string): string | undefined;
}

/** The deployment's SMTP transport, as both the API and the preflight see it. */
export function composeVerificationMail(
  environment: MailEnvironment,
): VerificationMail {
  return new SmtpVerificationMail(
    resolveSmtpVerificationMailOptions(environment),
  );
}

/**
 * Reminder email over the same SMTP transport and configuration (PLANNING-003).
 * Only the worker sends it; planning's email channel port is its shape.
 */
export function composeReminderMail(
  environment: MailEnvironment,
): SmtpReminderMail {
  return new SmtpReminderMail(resolveSmtpVerificationMailOptions(environment));
}

/**
 * The optional deliveries of a `VerificationMail`, narrowed to the total ports
 * password recovery and invitations require. A transport that cannot send them
 * fails the one delivery rather than the composition.
 */
export function passwordResetMail(mail: VerificationMail) {
  return {
    sendPasswordChanged: (message: { readonly email: string }): Promise<void> =>
      mail.sendPasswordChanged
        ? mail.sendPasswordChanged(message)
        : Promise.reject(new Error("Password-changed mail unavailable.")),
    sendPasswordReset: (
      message: Parameters<
        NonNullable<VerificationMail["sendPasswordReset"]>
      >[0],
    ): Promise<void> =>
      mail.sendPasswordReset
        ? mail.sendPasswordReset(message)
        : Promise.reject(new Error("Password-reset mail unavailable.")),
  };
}

export function invitationMail(mail: VerificationMail): InvitationMail {
  return {
    sendInvitation: (message) =>
      mail.sendInvitation
        ? mail.sendInvitation(message)
        : Promise.reject(new Error("Invitation mail unavailable.")),
    sendVerification: (message) => mail.sendVerification(message),
  };
}

/** The one approved actor-context read, shared by every module. */
export function workspaceActors(): PostgresActorRevalidation {
  return new PostgresActorRevalidation();
}

/** The workspace an authenticated identity may enter. */
export function activeWorkspaceResolver(): PostgresActiveWorkspaceResolver {
  return new PostgresActiveWorkspaceResolver();
}

/** The account-scoped transaction the workspace-owned use cases share. */
export function workspaceTransactionRunner(
  database: Kysely<ApplicationDatabase>,
): PostgresRegistrationTransaction {
  return new PostgresRegistrationTransaction(database);
}

/**
 * The boundaries neighbouring modules read workspace configuration through.
 * None of them depends on anything else, so a root builds them first.
 */
export function composeWorkspaceBoundaries() {
  return {
    importChoices: new PostgresImportChoicesBoundary(),
    businessImportBoundary: new PostgresWorkspaceBusinessImportBoundary(),
    vocabularyImportBoundary: new PostgresVocabularyBusinessImportBoundary(),
    calendar: workspaceCalendar(),
    contactMethodTypes: new PostgresContactMethodTypeCatalog(),
    currencies: workspaceCurrencies(),
    genders: new PostgresGenderOptionBoundary(),
    interactions: new PostgresInteractionWorkspaceBoundary(),
    lifeEvents: new PostgresLifeEventWorkspaceBoundary(),
    personalization: new PostgresWorkspacePersonalization(),
    profileFacts: new PostgresProfileFactConfiguration(),
    relationships: new PostgresRelationshipWorkspaceBoundary(),
    reminderDelivery: reminderDeliveryPreferences(),
  };
}

/** The currency catalog and preferences; the worker root builds it alone. */
export function workspaceCurrencies(): PostgresWorkspaceCurrencyBoundary {
  return new PostgresWorkspaceCurrencyBoundary();
}

/** Each workspace's time zone; the worker root builds it alone. */
export function workspaceCalendar(): PostgresWorkspaceCalendarBoundary {
  return new PostgresWorkspaceCalendarBoundary();
}

/**
 * What members chose about reminder delivery (PLANNING-003). Planning reads
 * it through this boundary; the worker root builds it on its own.
 */
export function reminderDeliveryPreferences(): PostgresReminderDeliveryPreferences {
  return new PostgresReminderDeliveryPreferences();
}

/** The identity facades workspaces composes its account use cases over. */
export interface WorkspaceIdentityPorts {
  readonly accountSettings: IdentityAccountSettingsFacade;
  readonly authentication: IdentityAuthenticationFacade;
  readonly invitations: InvitationIdentityFacade;
  readonly personalLifecycle: IdentityPersonalLifecycleFacade;
  readonly registration: IdentityRegistrationFacade;
  readonly verification: VerifiedIdentityEntryFacade;
}

export interface WorkspacePorts {
  readonly attemptBudget: AuthenticationAttemptBudget;
  /** The modules that erase their rows before the workspace cascade. */
  readonly erasure: WorkspaceLifecycleDependentErasures;
  readonly identity: WorkspaceIdentityPorts;
  /** Every module's share of a workspace cascade, assembled by the root. */
  readonly impact: WorkspaceLifecycleCascadeParticipants;
  readonly mail: VerificationMail;
  /** API access's hook: a removed member's tokens are revoked (SECT-07). */
  readonly memberCredentials: MemberCredentialRevocation;
  /** Planning's late-bound hook for a timezone change. */
  readonly planningPublisher: SettingsPlanningPublisher;
  /** People's word on whether a recent person is in the actor's workspace. */
  readonly recentPeople: RecentPersonScope;
  readonly responseEqualizer: AuthenticationResponseEqualizer;
  readonly storage: {
    remove(command: { readonly key: string }): Promise<void>;
  };
  readonly tokens: InvitationTokens & VerificationTokens;
}

export function composeWorkspaces(
  shared: SharedComposition,
  ports: WorkspacePorts,
) {
  const authenticationAudit = authenticationAuditFrom(shared.audit);
  const registrationDependencies = {
    audit: registrationAuditFrom(shared.audit),
    clock: shared.clock,
    identity: ports.identity.registration,
    ids: shared.ids,
    mail: ports.mail,
    responseEqualizer: ports.responseEqualizer,
    tokens: ports.tokens,
    transaction: shared.transaction,
    workspace: new PostgresWorkspaceRegistration(),
  };
  return {
    vocabularyImportBoundary: new PostgresVocabularyBusinessImportBoundary(),
    invitations: createWorkspaceInvitationCoordinator({
      audit: invitationAuditFrom(shared.audit),
      clock: shared.clock,
      ids: shared.ids,
      // One port assembled from four identity facades: the invitation flow
      // claims an address, creates a pending user, consumes a verified entry,
      // and issues the session, and identity keeps those on separate objects.
      identity: {
        assertPendingUserPostconditions: (command) =>
          ports.identity.registration.assertPendingUserPostconditions(command),
        assertSessionPostcondition: (command) =>
          ports.identity.authentication.assertSessionPostcondition(command),
        claimRegistrationAddress: (command) =>
          ports.identity.registration.claimRegistrationAddress(command),
        consumeVerifiedIdentityEntry: (command) =>
          ports.identity.verification.consumeVerifiedIdentityEntry(command),
        createExistingAccountRecovery: (command) =>
          ports.identity.registration.createExistingAccountRecovery(command),
        createPendingUser: (command) =>
          ports.identity.registration.createPendingUser(command),
        createRetryVerificationToken: (command) =>
          ports.identity.registration.createRetryVerificationToken(command),
        discardPendingUser: (command) =>
          ports.identity.registration.discardPendingUser(command),
        findIdentityIdByEmail: (command) =>
          ports.identity.invitations.findIdentityIdByEmail(command),
        isVerifiedInvitationIdentity: (command) =>
          ports.identity.invitations.isVerifiedInvitationIdentity(command),
        issueSession: (command) =>
          ports.identity.authentication.issueSession(command),
        listIdentityDisplaySummaries: (command) =>
          ports.identity.invitations.listIdentityDisplaySummaries(command),
      },
      mail: invitationMail(ports.mail),
      pendingWorkspaces: registrationDependencies.workspace,
      repository: new PostgresWorkspaceInvitations(),
      tokens: ports.tokens,
      transaction: shared.transaction,
    }),
    memberUiState: createMemberUiStateManagement({
      actors: shared.actors,
      repository: new PostgresMemberUiStateRepository(),
      transaction: shared.transaction,
    }),
    personalLifecycle: createPersonalLifecycle({
      attemptBudget: ports.attemptBudget,
      audit: personalLifecycleAuditFrom(shared.audit),
      authenticationAudit,
      clock: shared.clock,
      identity: ports.identity.personalLifecycle,
      memberCredentials: ports.memberCredentials,
      memberships: new PostgresPersonalLifecycleMemberships(),
      transaction: shared.transaction,
    }),
    protectedSessions: createProtectedSessionCoordinator({
      attemptBudget: ports.attemptBudget,
      audit: authenticationAudit,
      clock: shared.clock,
      identity: ports.identity.authentication,
      identityEntry: ports.identity.verification,
      responseEqualizer: ports.responseEqualizer,
      transaction: shared.transaction,
      workspace: shared.workspaceEntry,
    }),
    recentPeople: createRecentPeopleManagement({
      actors: shared.actors,
      people: ports.recentPeople,
      repository: new PostgresRecentPeopleRepository(),
      transaction: shared.transaction,
    }),
    registration: createFirstWorkspaceRegistration(registrationDependencies),
    retryVerificationDelivery: createVerificationDeliveryRetry(
      registrationDependencies,
    ),
    settings: createSettingsManagement({
      audit: settingsAuditFrom(shared.audit),
      clock: shared.clock,
      currencies: workspaceCurrencies(),
      identity: ports.identity.accountSettings,
      identityDisplay: ports.identity.invitations,
      memberCredentials: ports.memberCredentials,
      planningPublisher: ports.planningPublisher,
      transaction: shared.transaction,
      workspace: new PostgresWorkspaceSettings(),
    }),
    workspaceLifecycle: createWorkspaceLifecycle({
      activityAudit: workspaceResetActivityAuditFrom(shared.audit),
      attemptBudget: ports.attemptBudget,
      audit: new PostgresWorkspaceLifecycleSecurityAudit(),
      authenticationAudit,
      clock: shared.clock,
      erasure: ports.erasure,
      identity: ports.identity.personalLifecycle,
      ids: shared.ids,
      impact: ports.impact,
      repository: new PostgresWorkspaceLifecycleRepository(shared.database),
      storage: ports.storage,
      transaction: shared.transaction,
    }),
  };
}

/**
 * The worker half: the reconciler that finishes a workspace cascade's object
 * deletions after the request that started it has returned.
 */
export function composeWorkspaceCleanup(
  shared: SharedComposition,
  ports: {
    readonly storage: {
      remove(command: { readonly key: string }): Promise<void>;
    };
  },
) {
  return createWorkspaceCleanupReconciler({
    clock: shared.clock,
    repository: new PostgresWorkspaceLifecycleRepository(shared.database),
    storage: ports.storage,
  });
}

/**
 * The member a person represents, in a person merge (GAP-049). It answers
 * people's merge-participant port by shape, since workspaces does not depend
 * on people, and the root registers it beside the other modules'.
 */
export function selfPersonMergeParticipant(): PostgresSelfPersonMergeParticipant {
  return new PostgresSelfPersonMergeParticipant();
}
