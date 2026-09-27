/**
 * What the client calls the published shapes.
 *
 * Until GAP-022 this was the third hand-written copy of every schema: the route
 * validated one shape in Zod, the generator hand-encoded a second in OpenAPI,
 * and the client printed a third as TypeScript. Nothing compared them. Every
 * name here that the document publishes is now an alias into
 * `generated/api-types.ts`, which `openapi-typescript` derives from the
 * document, which is derived in turn from the Zod schemas the routes parse
 * with. One shape, three views of it.
 *
 * What is left as its own declaration is the handful of things the document
 * does not describe: the query-string inputs a caller assembles, the
 * section-keyed maps that give a caller the right body for the section it
 * named, and `PersonalizationAtLeastOne`, which is the TypeScript reading of an
 * `anyOf` constraint.
 */

import type { components } from "../generated/api-types.ts";

/**
 * What every list call accepts beyond its own filters.
 *
 * The document publishes the same two query parameters on every collection,
 * so the client names them once rather than restating them per function.
 */
export interface PageInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export type RegistrationInput = components["schemas"]["RegistrationInput"];

export type ApplicationEntry = components["schemas"]["ApplicationEntry"];

export type Authenticated = components["schemas"]["Authenticated"];

export type SessionContext = components["schemas"]["SessionContext"];

export type WorkspaceMembers = components["schemas"]["WorkspaceMembers"];

export type InvitationInspection =
  components["schemas"]["InvitationInspection"];

/** The member's own profile, which the document carries inside its answer. */
export type ProfileSettings =
  components["schemas"]["ProfileSettings"]["profile"];

export type BlockingWorkspace = components["schemas"]["BlockingWorkspace"];

export type PersonalLifecyclePreview =
  components["schemas"]["PersonalLifecyclePreview"];

export type WorkspaceLifecyclePreview =
  components["schemas"]["WorkspaceLifecyclePreview"];

export interface MemberPreferences {
  readonly contactNameOrder: "given_family_nickname" | "family_given_nickname";
  readonly contactSortOrder: "given_name_asc" | "family_name_asc";
  readonly currencyCode?: string;
  /** `null` stops the daily digest; absent keeps the member's choice. */
  readonly digestTime?: string | null;
  readonly fluidLayout: boolean;
  readonly locale: string;
  readonly measurementSystem: "metric" | "imperial";
  /** Absent keeps the member's choice. */
  readonly reminderDelivery?: "in_app" | "email" | "both";
  readonly temperatureScale: "celsius" | "fahrenheit";
  readonly timezone?: string;
}

export type ResolvedMemberPreferences =
  components["schemas"]["ResolvedMemberPreferences"];

export type PersonWorkspaceView =
  | "all"
  | "timeline"
  | "planning"
  | "things"
  | "admin";

export type MemberUiState = components["schemas"]["MemberUiState"];

export interface MemberSession {
  readonly id: string;
  readonly current: boolean;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/** The workspace configuration itself, which the document carries inside its answer. */
export type WorkspaceSettings = components["schemas"]["WorkspaceSettingsInput"];

export type ImportReport = components["schemas"]["ImportReport"];

export type ImportSummary = components["schemas"]["ImportSummary"];

export type ExportManifest = components["schemas"]["ExportManifest"];

export type ExportSummary = components["schemas"]["ExportSummary"];

export type StorageFileLookupItem =
  components["schemas"]["StorageFileLookupItem"];

export type StorageSettings = components["schemas"]["StorageSettings"];

export type ApiTokenScope = "people:read";

export type ApiTokenRecord = components["schemas"]["ApiTokenRecord"];

export type ApiTokenList = components["schemas"]["ApiTokenList"];

export type ApiTokenCreated = components["schemas"]["ApiTokenCreated"];

export type DavSubscription = components["schemas"]["DavSubscription"];

export type DavSubscriptionList = components["schemas"]["DavSubscriptionList"];

export type ManagedMember = components["schemas"]["ManagedMember"];

export type PersonalizationSection =
  components["schemas"]["PersonalizationSection"];

type PersonalizationAtLeastOne<T, K extends keyof T = keyof T> = K extends
  keyof T ? Required<Pick<T, K>> & Partial<Omit<T, K>> : never;

export interface PersonalizationNamedCreateInput {
  readonly name: string;
  readonly sortOrder?: number;
}

export interface PersonalizationNameOnlyCreateInput {
  readonly name: string;
}

export interface PersonalizationRelationshipCreateInput {
  readonly forwardLabel: string;
  readonly reverseLabel: string;
  readonly sortOrder?: number;
}

export interface PersonalizationReminderCreateInput {
  readonly daysBefore: number;
}

export type PersonalizationNamedUpdateInput =
  & { readonly expectedUpdatedAt: string }
  & PersonalizationAtLeastOne<{
    readonly isActive: boolean;
    readonly name: string;
    readonly sortOrder: number;
  }>;

export type PersonalizationGenderUpdateInput =
  & { readonly expectedUpdatedAt: string }
  & PersonalizationAtLeastOne<{
    readonly isActive: boolean;
    readonly isDefault: true;
    readonly name: string;
    readonly sortOrder: number;
  }>;

export interface PersonalizationNameOnlyUpdateInput {
  readonly expectedUpdatedAt: string;
  readonly name: string;
}

export type PersonalizationRelationshipUpdateInput =
  & { readonly expectedUpdatedAt: string }
  & (
    | {
      readonly forwardLabel: string;
      readonly isActive?: boolean;
      readonly reverseLabel: string;
      readonly sortOrder?: number;
    }
    | (
      & { readonly forwardLabel?: never; readonly reverseLabel?: never }
      & PersonalizationAtLeastOne<{
        readonly isActive: boolean;
        readonly sortOrder: number;
      }>
    )
  );

export type PersonalizationReminderUpdateInput =
  & { readonly expectedUpdatedAt: string }
  & PersonalizationAtLeastOne<{
    readonly daysBefore: number;
    readonly isActive: boolean;
  }>;

export interface PersonalizationCreateInputBySection {
  readonly "profile-modules": PersonalizationNamedCreateInput;
  readonly "gender-options": PersonalizationNamedCreateInput;
  readonly "contact-method-types": PersonalizationNamedCreateInput;
  readonly "contact-labels": PersonalizationNameOnlyCreateInput;
  readonly "activity-types": PersonalizationNamedCreateInput;
  readonly "emotion-options": never;
  readonly "life-event-types": PersonalizationNamedCreateInput;
  readonly "relationship-types": PersonalizationRelationshipCreateInput;
  readonly "pet-categories": never;
  readonly "reminder-rules": PersonalizationReminderCreateInput;
  readonly tags: PersonalizationNameOnlyCreateInput;
}

export interface PersonalizationUpdateInputBySection {
  readonly "profile-modules": PersonalizationNamedUpdateInput;
  readonly "gender-options": PersonalizationGenderUpdateInput;
  readonly "contact-method-types": PersonalizationNamedUpdateInput;
  readonly "contact-labels": PersonalizationNameOnlyUpdateInput;
  readonly "activity-types": PersonalizationNamedUpdateInput;
  readonly "emotion-options": never;
  readonly "life-event-types": PersonalizationNamedUpdateInput;
  readonly "relationship-types": PersonalizationRelationshipUpdateInput;
  readonly "pet-categories": never;
  readonly "reminder-rules": PersonalizationReminderUpdateInput;
  readonly tags: PersonalizationNameOnlyUpdateInput;
}

export type PersonalizationEntry =
  components["schemas"]["PersonalizationEntry"];

export type PersonIdentity = components["schemas"]["PersonIdentity"];

export type PersonProfileIdentity =
  components["schemas"]["PersonProfileIdentity"];

export type PersonFile = components["schemas"]["PersonFile"];

export type PersonLifecycleIdentity =
  components["schemas"]["PersonLifecycleIdentity"];

export type PersonGenderOption = components["schemas"]["PersonGenderOption"];

export type PersonEditInput = components["schemas"]["PersonEditInput"];

export type PersonTransitionInput =
  components["schemas"]["PersonTransitionInput"];

export type InteractionOption = components["schemas"]["InteractionOption"];

export type InteractionParticipant =
  components["schemas"]["InteractionParticipant"];

export type Interaction = components["schemas"]["Interaction"];

export type InteractionInput = components["schemas"]["InteractionInput"];

export type ActivityOrNoteInteraction =
  components["schemas"]["ActivityOrNoteInteraction"];

export type CommunicationOptions =
  components["schemas"]["CommunicationOptions"];

export type CommunicationList = components["schemas"]["CommunicationList"];

export type ActivityReport = components["schemas"]["ActivityReport"];

export type AuditDateDetail = components["schemas"]["AuditDateDetail"];

export type AuditDetail =
  | boolean
  | string
  | null
  | readonly string[]
  | AuditDateDetail;

export type AuditEvent = components["schemas"]["AuditEvent"];

export type AuditHistory = components["schemas"]["AuditHistory"];

export interface AuditHistoryInput {
  readonly action?: string;
  readonly actorMemberId?: string;
  readonly cursor?: string;
  readonly from?: string;
  readonly limit?: number;
  readonly personId?: string;
  readonly to?: string;
}

export type TodayFavoriteNotes = components["schemas"]["TodayFavoriteNotes"];

export type TodayRecentActivity = components["schemas"]["TodayRecentActivity"];

export type TaskPerson = components["schemas"]["TaskPerson"];

export type Task = components["schemas"]["Task"];

export type TaskCreateInput = components["schemas"]["TaskCreateInput"];

export type TaskChangeInput = components["schemas"]["TaskChangeInput"];

export type TaskList = components["schemas"]["TaskList"];

export type ReminderOccurrenceStatus =
  | "pending"
  | "claimed"
  | "retry"
  | "sent"
  | "skipped"
  | "failed"
  | "cancelled"
  | "manual_attention";

export type ReminderOccurrence = components["schemas"]["ReminderOccurrence"];

export type Reminder = components["schemas"]["Reminder"];

export type StayInTouchCadence = components["schemas"]["StayInTouchCadence"];

export type ReminderCreateInput = components["schemas"]["ReminderCreateInput"];

export type CadenceCreateInput = components["schemas"]["CadenceCreateInput"];

export type PersonReminders = components["schemas"]["PersonReminders"];

export type TodayAttentionPerson =
  components["schemas"]["TodayAttentionPerson"];

export type TodayAttentionItem = components["schemas"]["TodayAttentionItem"];

export type TodayAttention = components["schemas"]["TodayAttention"];

export type TodayRecentPerson = components["schemas"]["TodayRecentPerson"];

export type TodayRecentPeople = components["schemas"]["TodayRecentPeople"];

export type TodayReminderPerson = components["schemas"]["TodayReminderPerson"];

/**
 * A reminder occurrence, with the correlation the document states as a `oneOf`.
 *
 * `nextAttemptAt` is present exactly when the occurrence is retrying, which is
 * a correlation TypeScript can express and a flat component schema cannot, so
 * this one shape stays written out instead of aliased.
 */
interface TodayReminderBase {
  readonly attemptCount: number;
  readonly deliverAt: string;
  readonly id: string;
  readonly person: TodayReminderPerson;
  readonly title: string;
  readonly visibleAt?: string;
}

export type TodayReminderItem =
  | (TodayReminderBase & {
    readonly nextAttemptAt: string;
    readonly status: "retry";
  })
  | (TodayReminderBase & {
    readonly nextAttemptAt?: never;
    readonly status:
      | "pending"
      | "claimed"
      | "sent"
      | "failed"
      | "manual_attention";
  });

export type TodayCadenceItem = components["schemas"]["TodayCadenceItem"];

/** The Today reminder feed, carrying the correlated occurrence shape. */
export interface TodayReminders {
  readonly cadences: readonly TodayCadenceItem[];
  readonly reminders: readonly TodayReminderItem[];
  readonly status: "ready";
  readonly timezone: string;
}

export type RelationshipType = components["schemas"]["RelationshipType"];

export type Relationship = components["schemas"]["Relationship"];

export type RelationshipDisplay = components["schemas"]["RelationshipDisplay"];

export type RelationshipWithDisplay =
  components["schemas"]["RelationshipWithDisplay"];

export type RelationshipChanged = components["schemas"]["RelationshipChanged"];

export type RelatedPersonRelationshipInput =
  components["schemas"]["RelatedPersonRelationshipInput"];

export type RelatedPersonRelationshipChanged =
  components["schemas"]["RelatedPersonRelationshipChanged"];

export interface RelationshipListInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface RelationshipListPage {
  readonly nextCursor?: string;
  readonly relationships: readonly RelationshipWithDisplay[];
  readonly status: "archived" | "hidden" | "ready";
}

export type PersonDeletionImpact =
  components["schemas"]["PersonDeletionImpact"];

export type PersonDueInformation =
  components["schemas"]["PersonDueInformation"];

export type PersonPrimaryContactMethod =
  components["schemas"]["PersonPrimaryContactMethod"];

export type PersonRelationshipCount =
  components["schemas"]["PersonRelationshipCount"];

export type PersonProfileSectionCount =
  components["schemas"]["PersonProfileSectionCount"];

export type PersonProfileSummary =
  components["schemas"]["PersonProfileSummary"];

export type PersonLifeEventPrecision =
  | "day"
  | "full"
  | "month"
  | "month_day"
  | "unknown"
  | "year"
  | "year_month";

export type PersonLifeEvent = components["schemas"]["PersonLifeEvent"];

export type PersonLifeEventType = components["schemas"]["PersonLifeEventType"];

export type PersonLifeEventInput =
  components["schemas"]["PersonLifeEventInput"];

export type PersonLifeEventUpdateInput =
  components["schemas"]["PersonLifeEventUpdateInput"];

export type PersonTimelineKind =
  | "activity"
  | "call"
  | "conversation"
  | "life-event"
  | "note";

export type PersonTimelineMessage =
  components["schemas"]["PersonTimelineMessage"];

export type PersonTimelineItem = components["schemas"]["PersonTimelineItem"];

export type PersonTimelinePage = components["schemas"]["PersonTimelinePage"];

export type ImportantDateKind =
  | "birthday"
  | "custom"
  | "deceased"
  | "first_met";

export type ImportantDatePrecision =
  | "day"
  | "full"
  | "month"
  | "month_day"
  | "unknown"
  | "year"
  | "year_month";

export type ImportantDateInput = components["schemas"]["ImportantDateInput"];

export type ImportantDate = components["schemas"]["ImportantDate"];

export type PersonInput = components["schemas"]["PersonInput"];

export type PeopleDirectoryLifecycle = "active" | "archived";

export type PeopleDirectorySort =
  | "given-name"
  | "family-name"
  | "recently-added";

export type PeopleDirectoryTag = components["schemas"]["PeopleDirectoryTag"];

export type PeopleDirectoryPerson =
  components["schemas"]["PeopleDirectoryPerson"];
/** How a person is drawn: a colour, and an image when one backs it. */
export type PersonAvatar = components["schemas"]["PersonAvatar"];
export type PersonAvatarChanged = components["schemas"]["PersonAvatarChanged"];

export interface PeopleDirectoryInput {
  readonly cursor?: string;
  readonly excludePersonId?: string;
  readonly lifecycle?: PeopleDirectoryLifecycle;
  readonly limit?: number;
  readonly search?: string;
  readonly selectedPersonId?: string;
  readonly sort?: PeopleDirectorySort;
  readonly tagId?: string;
}

export type PeopleDirectoryPage = components["schemas"]["PeopleDirectoryPage"];

/** What `searchWorkspace` asks for: the query, and how many per group. */
export interface SearchWorkspaceInput {
  readonly limit?: number;
  readonly query: string;
  /** How people are ordered: the member's contact sort preference. */
  readonly sort?: "family-name" | "given-name";
}

export type SearchResults = components["schemas"]["SearchResults"];
export type SearchPersonResult = components["schemas"]["SearchPersonResult"];
export type SearchEntityResult = components["schemas"]["SearchEntityResult"];
export type SearchPersonReference =
  components["schemas"]["SearchPersonReference"];

export interface PeopleTagOptionsInput {
  readonly cursor?: string;
  readonly search?: string;
  readonly selectedTagId?: string;
}

export type PeopleTagOptionsPage =
  components["schemas"]["PeopleTagOptionsPage"];

export type ProfileFactSectionId =
  components["schemas"]["ProfileFactSectionId"];

export type PersonProfileSectionId =
  components["schemas"]["PersonProfileSectionId"];

export type ProfileFactOption = components["schemas"]["ProfileFactOption"];

export type AddressFact = components["schemas"]["AddressFact"];

export type ContactMethodFact = components["schemas"]["ContactMethodFact"];

export type FirstMeetingFact = components["schemas"]["FirstMeetingFact"];

export type FoodPreferencesFact = components["schemas"]["FoodPreferencesFact"];

export type PetFact = components["schemas"]["PetFact"];

export type TagsFact = components["schemas"]["TagsFact"];

export type OccupationFact = components["schemas"]["OccupationFact"];

export interface ProfileFactValueBySection {
  readonly addresses: AddressFact;
  readonly "contact-methods": ContactMethodFact;
  readonly "first-meeting": FirstMeetingFact;
  readonly "food-preferences": FoodPreferencesFact;
  readonly pets: PetFact;
  readonly tags: TagsFact;
  readonly work: OccupationFact;
}

export type ProfileFactValue = ProfileFactValueBySection[ProfileFactSectionId];

type ProfileFactCreateMetadata = {
  readonly expectedPersonUpdatedAt: string;
};

type ProfileFactUpdateMetadata = ProfileFactCreateMetadata & {
  readonly expectedUpdatedAt: string;
  readonly id: string;
};

type AddressFactInput<Metadata> =
  & AddressFact
  & Metadata
  & (
    | { readonly displayName: string }
    | { readonly street: string }
    | { readonly city: string }
    | { readonly region: string }
    | { readonly postalCode: string }
    | { readonly country: string }
  );

type FirstMeetingFactInput<Metadata> =
  & FirstMeetingFact
  & Metadata
  & (
    | { readonly introducedByPersonId: string }
    | { readonly notes: string }
    | { readonly placeText: string }
  );

type PetFactInput<Metadata> =
  & PetFact
  & Metadata
  & (
    | { readonly categoryId: string }
    | { readonly name: string }
  );

export type ProfileFactCreateInputBySection = {
  readonly addresses: AddressFactInput<ProfileFactCreateMetadata>;
  readonly "contact-methods": ContactMethodFact & ProfileFactCreateMetadata;
  readonly "first-meeting": FirstMeetingFactInput<ProfileFactCreateMetadata>;
  readonly "food-preferences":
    & Omit<FoodPreferencesFact, "foodPreferences">
    & ProfileFactCreateMetadata
    & { readonly foodPreferences: string };
  readonly pets: PetFactInput<ProfileFactCreateMetadata>;
  readonly tags: TagsFact & ProfileFactCreateMetadata;
  readonly work: OccupationFact & ProfileFactCreateMetadata;
};

export type ProfileFactCreateInput =
  ProfileFactCreateInputBySection[ProfileFactSectionId];

export type ProfileFactUpdateInputBySection = {
  readonly addresses: AddressFactInput<ProfileFactUpdateMetadata>;
  readonly "contact-methods": ContactMethodFact & ProfileFactUpdateMetadata;
  readonly "first-meeting": FirstMeetingFactInput<ProfileFactUpdateMetadata>;
  readonly "food-preferences":
    & Omit<FoodPreferencesFact, "foodPreferences">
    & ProfileFactUpdateMetadata
    & { readonly foodPreferences: string };
  readonly pets: PetFactInput<ProfileFactUpdateMetadata>;
  readonly tags: TagsFact & ProfileFactUpdateMetadata;
  readonly work: OccupationFact & ProfileFactUpdateMetadata;
};

export type ProfileFactUpdateInput =
  ProfileFactUpdateInputBySection[ProfileFactSectionId];

export type ProfileFactDeleteInput =
  components["schemas"]["ProfileFactDeleteInput"];

export type ProfileFactListInput =
  & {
    readonly cursor?: string;
    readonly optionSearch?: string;
  }
  & (
    | { readonly includeOptions: true; readonly optionCursor?: string }
    | { readonly includeOptions?: never; readonly optionCursor?: never }
  );

export type ProfileFactRecord = {
  readonly [Section in ProfileFactSectionId]: {
    readonly id: string;
    readonly referencesResolved?: boolean;
    readonly section: Section;
    readonly selectedOptions?: readonly ProfileFactOption[];
    readonly updatedAt: string;
    readonly value: ProfileFactValueBySection[Section];
  };
}[ProfileFactSectionId];

export interface ProfileFactSection {
  readonly nextCursor?: string;
  readonly nextOptionsCursor?: string;
  readonly options: readonly ProfileFactOption[];
  readonly personUpdatedAt: string;
  readonly records: readonly ProfileFactRecord[];
  readonly status: "ready" | "archived" | "hidden";
}

export type GiftStatus = "archived" | "given" | "idea" | "planned" | "received";

export type DebtStatus = "cancelled" | "open" | "settled";

export type Gift = components["schemas"]["Gift"];

export type Debt = components["schemas"]["Debt"];

export type GiftCreateInput = components["schemas"]["GiftCreateInput"];

export type DebtCreateInput = components["schemas"]["DebtCreateInput"];

export type GiftDebtList = components["schemas"]["GiftDebtList"];

export type JournalStoredPost = components["schemas"]["JournalStoredPost"];

export type JournalStoredDayRating =
  components["schemas"]["JournalStoredDayRating"];

export type JournalLinkableActivity =
  components["schemas"]["JournalLinkableActivity"];

export type JournalTimelineItem = components["schemas"]["JournalTimelineItem"];

export type JournalItemType = JournalTimelineItem["type"];

export type JournalPostInput = components["schemas"]["JournalPostInput"];

export type JournalDayRatingInput =
  components["schemas"]["JournalDayRatingInput"];

export type LegalDocument = components["schemas"]["LegalDocument"];
