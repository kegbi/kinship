/**
 * Which permission of the authorization matrix each route exercises (AUD-K5).
 *
 * `docs/architecture/authorization-matrix.yaml` names the permissions and the
 * roles that hold them; the route registry names the routes. Until SECT-08
 * nothing tied the two together, so a route could be added — or a role check
 * changed — without anybody saying which permission it served. This table is
 * that statement, one line per operation, and `apps/api/role_matrix_test.ts`
 * holds the running app to it: every registered route has exactly one entry,
 * every entry names a permission the matrix defines, and every route of a
 * role-granted permission answers each role the way the matrix says.
 *
 * `public` marks the few routes no permission of the matrix covers because
 * they take no principal at all: the probes, the published legal documents,
 * and the calendar feed, whose secret is its path. A route with a `security`
 * requirement may never be public.
 *
 * Read routes that are not about one person (Today, the journal, tasks, the
 * vocabularies) ride on `workspace.read`; reads of one person's records, of
 * whichever module, ride on `people.read`. The 2026-11-07 audit
 * (`04-security-tenant-isolation-and-authorization.md`, SECT-08) records the
 * routes that ride on a neighbouring permission because the matrix has no
 * row of their own.
 */

/** Every permission id the matrix defines, in its order. */
export const PERMISSION_IDS = [
  "registration.create",
  "session.create",
  "legal.accept",
  "member.self.manage",
  "member.self.delete",
  "workspace.read",
  "workspace.manage",
  "workspace.delete",
  "workspace.reset",
  "workspace.members.invite",
  "workspace.members.manage",
  "workspace.personalization.manage",
  "people.read",
  "people.write",
  "people.delete",
  "people.merge",
  "people.vcard.export",
  "relationships.write",
  "interactions.write",
  "journal.write",
  "tasks.write",
  "reminders.write",
  "reminder-delivery.execute",
  "files.read",
  "files.write",
  "gifts.write",
  "recurring-debts.charge",
  "data.import",
  "data.export",
  "audit.read",
  "api-tokens.manage",
  "integrations.manage",
  "calendar-feed.manage",
  "billing.manage",
] as const;

export type PermissionId = typeof PERMISSION_IDS[number];

/** A route's permission, or `public` for a route that takes no principal. */
export type RoutePermission = PermissionId | "public";

/** Operation id to the permission it exercises. */
export const ROUTE_PERMISSIONS: Readonly<Record<string, RoutePermission>> = {
  // Probes.
  readHealth: "public",
  readLiveness: "public",
  readReadiness: "public",

  // Registration and authentication.
  consumeApplicationEntry: "session.create",
  retryVerificationDelivery: "registration.create",
  verifyEmail: "registration.create",
  createFirstWorkspace: "registration.create",
  completeMfa: "session.create",
  requestPasswordReset: "session.create",
  resetPassword: "session.create",
  getSession: "workspace.read",
  signIn: "session.create",
  signOut: "member.self.manage",

  // Invitations.
  createWorkspaceInvitation: "workspace.members.invite",
  acceptWorkspaceInvitation: "session.create",
  authenticateWorkspaceInvitation: "session.create",
  inspectWorkspaceInvitation: "registration.create",
  completeWorkspaceInvitationMfa: "session.create",
  registerInvitedIdentity: "registration.create",
  retryInvitedVerificationDelivery: "registration.create",
  listWorkspaceMembers: "workspace.members.invite",

  // Settings.
  getMemberUiState: "member.self.manage",
  saveMemberUiState: "member.self.manage",
  listManagedMembers: "workspace.members.manage",
  updateManagedMember: "workspace.members.manage",
  listPersonalizationEntries: "workspace.personalization.manage",
  createPersonalizationEntry: "workspace.personalization.manage",
  deletePersonalizationEntry: "workspace.personalization.manage",
  updatePersonalizationEntry: "workspace.personalization.manage",
  getMemberPreferences: "member.self.manage",
  updateMemberPreferences: "member.self.manage",
  getSettingsProfile: "member.self.manage",
  updateSettingsProfile: "member.self.manage",
  listMemberSessions: "member.self.manage",
  revokeMemberSession: "member.self.manage",
  getWorkspaceSettings: "workspace.manage",
  updateWorkspaceSettings: "workspace.manage",
  getStorageSettings: "workspace.manage",

  // API tokens, calendar feeds, and integrations.
  getApiTokens: "api-tokens.manage",
  createApiToken: "api-tokens.manage",
  revokeApiToken: "api-tokens.manage",
  getCalendarFeed: "calendar-feed.manage",
  createCalendarFeed: "calendar-feed.manage",
  rotateCalendarFeed: "calendar-feed.manage",
  revokeCalendarFeed: "calendar-feed.manage",
  getCalendarFeedDocument: "public",
  getDavSubscriptions: "integrations.manage",
  createDavSubscription: "integrations.manage",
  disableDavSubscription: "integrations.manage",
  synchronizeDavSubscription: "integrations.manage",

  // Personal and workspace lifecycle.
  deletePersonalIdentity: "member.self.delete",
  getPersonalLifecyclePreview: "member.self.delete",
  leaveCurrentWorkspace: "member.self.delete",
  deleteWorkspace: "workspace.delete",
  getWorkspaceLifecyclePreview: "workspace.delete",
  resetWorkspace: "workspace.reset",

  // Files.
  listPersonFiles: "files.read",
  uploadPersonFile: "files.write",
  removePersonFile: "files.write",
  downloadPersonFile: "files.read",

  // Gifts and debts.
  listDebtSettlements: "people.read",
  createDebt: "gifts.write",
  changeDebtStatus: "gifts.write",
  deleteDebt: "gifts.write",
  listPersonGiftsAndDebts: "people.read",
  createGift: "gifts.write",
  changeGiftStatus: "gifts.write",
  createRecurringDebt: "gifts.write",
  updateRecurringDebt: "gifts.write",
  deleteRecurringDebt: "gifts.write",

  // Journal.
  listJournal: "workspace.read",
  linkJournalActivity: "journal.write",
  saveJournalDayRating: "journal.write",
  deleteJournalItem: "journal.write",
  getJournalItem: "workspace.read",
  createJournalPost: "journal.write",
  updateJournalPost: "journal.write",

  // Imports and exports.
  listImports: "data.import",
  createImportDryRun: "data.import",
  getImportReport: "data.import",
  mapImportColumns: "data.import",
  commitImport: "data.import",
  listExports: "data.export",
  createWorkspaceExport: "data.export",
  downloadExport: "data.export",
  createExportDownload: "data.export",
  exportPeopleVCards: "people.vcard.export",
  exportPersonVCard: "people.vcard.export",

  // People.
  listPeople: "people.read",
  createPerson: "people.write",
  listPeopleTagOptions: "people.read",
  listPeopleTagFacet: "people.read",
  listPeopleDuplicates: "people.read",
  dismissPeopleDuplicate: "people.write",
  bulkPeople: "people.write",
  deletePerson: "people.delete",
  getPerson: "people.read",
  getPersonIdentity: "people.read",
  editPerson: "people.write",
  archivePerson: "people.write",
  replacePersonAvatar: "people.write",
  removePersonAvatar: "people.write",
  starPerson: "people.write",
  unstarPerson: "people.write",
  listImportantDates: "people.read",
  createImportantDate: "people.write",
  deleteImportantDate: "people.write",
  updateImportantDate: "people.write",
  getPersonDeletionImpact: "people.read",
  listProfileFacts: "people.read",
  createProfileFact: "people.write",
  deleteProfileFact: "people.write",
  updateProfileFact: "people.write",
  listPersonLifeEvents: "people.read",
  createPersonLifeEvent: "journal.write",
  updatePersonLifeEvent: "journal.write",
  deletePersonLifeEvent: "journal.write",
  restorePerson: "people.write",
  previewPeopleMerge: "people.read",
  mergePeople: "people.merge",
  listPersonTimeline: "people.read",
  recordPersonView: "member.self.manage",
  getTodayRecentPeople: "workspace.read",
  searchWorkspace: "people.read",

  // Relationships.
  listRelationships: "people.read",
  createRelationship: "relationships.write",
  createRelatedPersonRelationship: "relationships.write",
  deleteRelationship: "relationships.write",
  updateRelationship: "relationships.write",
  listRelationshipTypes: "workspace.read",

  // Interactions.
  listCommunicationOptions: "workspace.read",
  listInteractionOptions: "workspace.read",
  recordInteraction: "interactions.write",
  getActivityReport: "people.read",
  listPersonCommunications: "people.read",
  getTodayFavoriteNotes: "workspace.read",
  getTodayRecentActivity: "workspace.read",

  // Governance.
  listWorkspaceAudit: "audit.read",
  acceptLegalDocument: "legal.accept",
  getPublicLegalDocument: "public",
  getLegalRequirements: "legal.accept",
  listPersonAudit: "audit.read",

  // Planning.
  listPersonReminders: "people.read",
  createReminder: "reminders.write",
  setReminderActive: "reminders.write",
  acknowledgeReminderOccurrence: "reminders.write",
  createStayInTouchCadence: "reminders.write",
  listTasks: "workspace.read",
  getTask: "workspace.read",
  createTask: "tasks.write",
  changeTask: "tasks.write",
  setTaskCompletion: "tasks.write",
  getTodayAttention: "workspace.read",
  getTodayReminders: "workspace.read",
  getTodayTasks: "workspace.read",
  listNotifications: "workspace.read",
};
