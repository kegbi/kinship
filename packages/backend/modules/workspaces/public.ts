export type { InvitationRole, WorkspaceRole } from "./domain/roles.ts";
/**
 * The one answer to "may this membership do administrative work?" (AUD-K5).
 * Every module that grants owners and admins alone asks it here rather than
 * spelling the comparison out again.
 */
export { privileged } from "./domain/roles.ts";
export {
  DEFAULT_RELATIONSHIP_TYPE_VOCABULARY,
  RegistrationError,
  VERIFICATION_WINDOW_MS,
  VerificationDeliveryError,
} from "./domain/registration_rules.ts";
export type {
  DefaultRelationshipType,
  FirstWorkspaceRegistrationCommand,
  FirstWorkspaceRegistrationResult,
} from "./domain/registration_rules.ts";
export {
  createFirstWorkspaceRegistration,
  createVerificationDeliveryRetry,
} from "./application/register_first_workspace.ts";
export type { RegistrationDependencies } from "./application/register_first_workspace.ts";
export type {
  RegistrationAudit,
  VerificationMail,
  VerificationTokens,
  WorkspaceRegistrationWriter,
} from "./ports/registration_repository.ts";
export type {
  RegistrationTransaction,
  RegistrationTransactionRunner,
} from "./ports/context.ts";
export type {
  ActorContext,
  ActorRecipients,
  ActorRevalidation,
  ActorRevalidationCommand,
  ActorRevalidationTransaction,
  ActorStanding,
  EligibleRecipient,
  RevalidatedActor,
} from "./ports/actors.ts";
export {
  actorMayRead,
  type ActorReadDependencies,
  carryAdmission,
} from "./application/actor_admission.ts";
export { createProtectedSessionCoordinator } from "./application/protected_session.ts";
export { protectedSessionHttpStatus } from "./domain/session_rules.ts";
export type {
  AuthenticationRequestStatusCode,
  ProtectedSessionResult,
  SignInDevice,
} from "./domain/session_rules.ts";
export type {
  CompleteMfaCommand,
  ProtectedSessionDependencies,
  SignInCommand,
} from "./application/protected_session_context.ts";
export type {
  ActiveWorkspaceContext,
  ProtectedSessionTransaction,
  ProtectedSessionTransactionRunner,
  ResolvedSessionContext,
} from "./ports/context.ts";
export type {
  ActiveWorkspaceResolver,
  AuthenticationAttemptBudget,
  AuthenticationAttemptBudgetResult,
  AuthenticationAudit,
  AuthenticationResponseEqualizer,
  SignInDeviceIssuer,
} from "./ports/session.ts";
/** The durable mail budget api-access keeps (SECA-03, AUD-M3). */
export type {
  MailBudgetReservation,
  OutboundMailBudget,
} from "./ports/mail_budget.ts";
export { createSettingsManagement } from "./application/settings_management.ts";
export type {
  MemberSessionSummary,
  SettingsManagement,
  SettingsManagementDependencies,
} from "./application/settings_management.ts";
export type {
  ManagedMember,
  MemberPreferences,
  ResolvedMemberPreferences,
  WorkspaceConfiguration,
  WorkspaceMemberRecord,
} from "./domain/settings_rules.ts";
export type { SettingsActor, SettingsTransaction } from "./ports/context.ts";
export type {
  SettingsAudit,
  SettingsPlanningPublisher,
  WorkspaceSettingsRepository,
} from "./ports/settings_repository.ts";
export { createWorkspaceInvitationCoordinator } from "./application/invite_member.ts";
export type { WorkspaceInvitationDependencies } from "./application/invite_member.ts";
export type {
  InvitationAcceptance,
  InvitationInspection,
  InvitationSummary,
  WorkspaceMemberSummary,
} from "./domain/invitation_rules.ts";
export type { InvitationActor } from "./ports/context.ts";
export type {
  InvitationAudit,
  InvitationMail,
  InvitationTokens,
  WorkspaceInvitationRepository,
} from "./ports/invitation_repository.ts";
export { createPersonalLifecycle } from "./application/personal_lifecycle.ts";
export { createWorkspaceLifecycle } from "./application/workspace_lifecycle.ts";
export { createWorkspaceCleanupReconciler } from "./application/workspace_lifecycle.ts";
export type {
  PersonalLifecycle,
  PersonalLifecycleDependencies,
} from "./application/personal_lifecycle.ts";
export type { PersonalLifecycleMembership } from "./domain/personal_lifecycle_rules.ts";
export type {
  PersonalLifecycleActor,
  PersonalLifecycleTransaction,
} from "./ports/context.ts";
export type {
  PersonalLifecycleAudit,
  PersonalLifecycleMemberships,
} from "./ports/personal_lifecycle.ts";
export type { WorkspaceLifecycle } from "./application/workspace_lifecycle.ts";
export type { WorkspaceLifecycleDependencies } from "./application/workspace_lifecycle_context.ts";
export type {
  WorkspaceLifecycleCounts,
  WorkspaceLifecycleImpactContribution,
  WorkspaceLifecycleSnapshot,
} from "./domain/workspace_lifecycle_rules.ts";
export type {
  WorkspaceLifecycleActor,
  WorkspaceLifecycleTransaction,
} from "./ports/context.ts";
export type {
  WorkspaceLifecycleCascadeParticipant,
  WorkspaceLifecycleCascadeParticipants,
  WorkspaceLifecycleDependentErasure,
  WorkspaceLifecycleDependentErasures,
  WorkspaceLifecycleRepository,
  WorkspaceLifecycleSecurityAudit,
  WorkspaceResetActivityAudit,
} from "./ports/workspace_lifecycle_repository.ts";
export type {
  CurrencyBoundaryTransaction,
  WorkspaceCurrencyBoundary,
} from "./ports/currency_boundary.ts";
export type { MemberCredentialRevocation } from "./ports/member_credentials.ts";
export type {
  WorkspaceCalendarBoundary,
  WorkspaceCalendarTransaction,
} from "./ports/workspace_calendar.ts";
export type {
  MemberReminderDelivery,
  ReminderDeliveryPreferences,
  ReminderDeliveryPreferencesTransaction,
} from "./ports/reminder_delivery_preferences.ts";
export { createPersonalizationManagement } from "./application/personalization.ts";
export type {
  PersonalizationDependencies,
  PersonalizationManagement,
} from "./application/personalization.ts";
export {
  CONTACT_METHOD_KINDS,
  PERSONALIZATION_SECTIONS,
  PROFILE_MODULE_DEFAULTS,
} from "./domain/personalization_rules.ts";
export type {
  ContactMethodKind,
  PersonalizationEntry,
  PersonalizationItemCapabilities,
  PersonalizationMutation,
  PersonalizationMutationResult,
  PersonalizationResult,
  PersonalizationSection,
  PersonalizationSectionCapabilities,
} from "./domain/personalization_rules.ts";
export type { PersonalizationTransaction } from "./ports/context.ts";
export type {
  PersonalizationRepository,
  WorkspacePersonalizationDeleteCommand,
  WorkspacePersonalizationRepository,
} from "./ports/personalization_repository.ts";
export type {
  RelationshipWorkspaceActor,
  RelationshipWorkspaceBoundary,
  RelationshipWorkspaceDefaults,
  RelationshipWorkspaceInspection,
  RelationshipWorkspaceTransaction,
  WorkspaceRelationshipType,
  WorkspaceRelationshipTypeCursor,
  WorkspaceRelationshipTypePage,
  WorkspaceRelationshipTypeRecord,
} from "./ports/relationship_boundary.ts";
export type {
  LifeEventWorkspaceBoundary,
  LifeEventWorkspaceInspection,
  LifeEventWorkspaceTransaction,
  WorkspaceLifeEventType,
} from "./ports/life_event_boundary.ts";
export type {
  ContactMethodTypeCatalog,
  ContactMethodTypeChoice,
  ContactMethodTypeKind,
  ContactMethodTypeTransaction,
} from "./ports/contact_method_types.ts";
export type {
  InteractionWorkspaceActor,
  InteractionWorkspaceBoundary,
  InteractionWorkspaceTransaction,
  WorkspaceInteractionOption,
} from "./ports/interaction_boundary.ts";
export { createRecentPeopleManagement } from "./application/recent_people.ts";
export type { RecentPeopleManagement } from "./application/recent_people.ts";
export type {
  RecentPeopleActor,
  RecentPeopleTransaction,
} from "./ports/context.ts";
export type {
  RecentPeopleRepository,
  RecentPersonScope,
} from "./ports/ui_state_repository.ts";
export { createMemberUiStateManagement } from "./application/member_ui_state.ts";
/**
 * The notifications read-through watermark's rule (GAP-053), which the
 * notifications read model reads the stored value with.
 */
export { readThroughInstant } from "./domain/ui_state_rules.ts";
export type { MemberUiStateManagement } from "./application/member_ui_state.ts";
export type {
  MemberUiState,
  PersonWorkspaceView,
} from "./domain/ui_state_rules.ts";
export type {
  MemberUiStateActor,
  MemberUiStateTransaction,
} from "./ports/context.ts";
export type { MemberUiStateRepository } from "./ports/ui_state_repository.ts";
export {
  authenticationAuditFrom,
  invitationAuditFrom,
  personalLifecycleAuditFrom,
  registrationAuditFrom,
  settingsAuditFrom,
  workspaceResetActivityAuditFrom,
} from "./application/audit_events.ts";

export type {
  VocabularyBusinessImportBoundary,
  VocabularyBusinessImportRecord,
} from "./application/business_vocabulary_import.ts";

export type { WorkspaceBusinessImportBoundary } from "./application/import_business_boundary.ts";

export type { ImportChoicesBoundary } from "./ports/import_choices.ts";
