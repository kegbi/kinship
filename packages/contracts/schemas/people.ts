/**
 * People: the shapes the directory, the page, and everything on it accept
 * and answer with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/people` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { interactionOption, interactionParticipant } from "./interactions.ts";
import { oneOf } from "./shared.ts";

/**
 * The three profile sections that refuse a fact made of nothing.
 *
 * An address with no line, a first meeting with no context, and a pet with
 * neither a name nor a category are all a section asked to remember nothing,
 * and the write is refused rather than stored. JSON Schema says the same thing
 * through the `anyOf` each input carries; these are what enforce it at
 * runtime, so the two spellings of one section cannot drift apart.
 */
const hasAddressDetail = (value: {
  readonly city?: string | undefined;
  readonly country?: string | undefined;
  readonly displayName?: string | undefined;
  readonly postalCode?: string | undefined;
  readonly region?: string | undefined;
  readonly street?: string | undefined;
}): boolean =>
  Boolean(
    value.city || value.country || value.displayName || value.postalCode ||
      value.region || value.street,
  );

const hasFirstMeetingContext = (value: {
  readonly introducedByPersonId?: string | undefined;
  readonly notes?: string | undefined;
  readonly placeText?: string | undefined;
}): boolean =>
  Boolean(value.introducedByPersonId || value.notes || value.placeText);

const hasPetDetail = (value: {
  readonly categoryId?: string | undefined;
  readonly name?: string | undefined;
}): boolean => Boolean(value.categoryId || value.name);

export const addressFact = z.strictObject({
  city: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
  displayName: z.string().max(200).optional(),
  isPrimary: z.boolean(),
  labelIds: z.array(z.uuid()).max(20),
  postalCode: z.string().max(50).optional(),
  region: z.string().max(200).optional(),
  street: z.string().max(500).optional(),
  section: z.literal("addresses"),
}).meta({ id: "AddressFact" });

export const addressFactCreateInput = z.strictObject({
  city: z.string().trim().max(200).optional(),
  country: z.string().trim().max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  isPrimary: z.boolean(),
  labelIds: z.array(z.uuid()).max(20),
  postalCode: z.string().trim().max(50).optional(),
  region: z.string().trim().max(200).optional(),
  street: z.string().trim().max(500).optional(),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  section: z.literal("addresses"),
}).refine(hasAddressDetail, { message: "Enter an address detail." }).meta({
  id: "AddressFactCreateInput",
  anyOf: [{
    "required": ["city"],
    "properties": {
      "city": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["country"],
    "properties": {
      "country": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["displayName"],
    "properties": {
      "displayName": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["postalCode"],
    "properties": {
      "postalCode": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["region"],
    "properties": {
      "region": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["street"],
    "properties": {
      "street": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }],
});

export const addressFactUpdateInput = z.strictObject({
  city: z.string().trim().max(200).optional(),
  country: z.string().trim().max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  isPrimary: z.boolean(),
  labelIds: z.array(z.uuid()).max(20),
  postalCode: z.string().trim().max(50).optional(),
  region: z.string().trim().max(200).optional(),
  street: z.string().trim().max(500).optional(),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  section: z.literal("addresses"),
}).refine(hasAddressDetail, { message: "Enter an address detail." }).meta({
  id: "AddressFactUpdateInput",
  anyOf: [{
    "required": ["city"],
    "properties": {
      "city": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["country"],
    "properties": {
      "country": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["displayName"],
    "properties": {
      "displayName": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["postalCode"],
    "properties": {
      "postalCode": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["region"],
    "properties": {
      "region": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["street"],
    "properties": {
      "street": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }],
});

export const contactMethodFact = z.strictObject({
  isPrimary: z.boolean(),
  labelIds: z.array(z.uuid()).max(20),
  notes: z.string().max(2000).optional(),
  typeId: z.uuid(),
  value: z.string().min(1).max(2000).regex(/\S/),
  section: z.literal("contact-methods"),
}).meta({ id: "ContactMethodFact" });

export const contactMethodFactCreateInput = z.strictObject({
  isPrimary: z.boolean(),
  labelIds: z.array(z.uuid()).max(20),
  notes: z.string().trim().max(2000).optional(),
  typeId: z.uuid(),
  value: z.string().trim().min(1).max(2000).regex(/\S/),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  section: z.literal("contact-methods"),
}).meta({ id: "ContactMethodFactCreateInput" });

export const contactMethodFactUpdateInput = z.strictObject({
  isPrimary: z.boolean(),
  labelIds: z.array(z.uuid()).max(20),
  notes: z.string().trim().max(2000).optional(),
  typeId: z.uuid(),
  value: z.string().trim().min(1).max(2000).regex(/\S/),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  section: z.literal("contact-methods"),
}).meta({ id: "ContactMethodFactUpdateInput" });

export const firstMeetingFact = z.strictObject({
  introducedByPersonId: z.uuid().optional(),
  notes: z.string().max(2000).optional(),
  placeText: z.string().max(500).optional(),
  section: z.literal("first-meeting"),
}).meta({ id: "FirstMeetingFact" });

export const firstMeetingFactCreateInput = z.strictObject({
  introducedByPersonId: z.uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  placeText: z.string().trim().max(500).optional(),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  section: z.literal("first-meeting"),
}).refine(hasFirstMeetingContext, {
  message: "Enter first-meeting context.",
}).meta({
  id: "FirstMeetingFactCreateInput",
  anyOf: [{ "required": ["introducedByPersonId"] }, {
    "required": ["notes"],
    "properties": {
      "notes": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["placeText"],
    "properties": {
      "placeText": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }],
});

export const firstMeetingFactUpdateInput = z.strictObject({
  introducedByPersonId: z.uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  placeText: z.string().trim().max(500).optional(),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  section: z.literal("first-meeting"),
}).refine(hasFirstMeetingContext, {
  message: "Enter first-meeting context.",
}).meta({
  id: "FirstMeetingFactUpdateInput",
  anyOf: [{ "required": ["introducedByPersonId"] }, {
    "required": ["notes"],
    "properties": {
      "notes": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }, {
    "required": ["placeText"],
    "properties": {
      "placeText": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }],
});

export const foodPreferencesFact = z.strictObject({
  foodPreferences: z.string().min(1).max(2000).regex(/\S/).optional(),
  section: z.literal("food-preferences"),
}).meta({ id: "FoodPreferencesFact" });

export const foodPreferencesFactCreateInput = z.strictObject({
  foodPreferences: z.string().trim().min(1).max(2000).regex(/\S/),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  section: z.literal("food-preferences"),
}).meta({ id: "FoodPreferencesFactCreateInput" });

export const foodPreferencesFactUpdateInput = z.strictObject({
  foodPreferences: z.string().trim().min(1).max(2000).regex(/\S/),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  section: z.literal("food-preferences"),
}).meta({ id: "FoodPreferencesFactUpdateInput" });

export const importantDate = z.strictObject({
  day: z.number().int().min(1).max(31).optional(),
  isAgeBased: z.boolean(),
  isYearApproximate: z.boolean(),
  kind: z.enum(["birthday", "custom", "deceased", "first_met"]),
  label: z.string().max(200).optional(),
  month: z.number().int().min(1).max(12).optional(),
  notes: z.string().max(2000).optional(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  year: z.number().int().min(1).max(9999).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  personId: z.uuid(),
  scheduling: z.enum(["annual-reminder", "not-schedulable"]),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "ImportantDate" });

export const importantDateChanged = z.strictObject({
  date: importantDate,
  status: z.enum(["created", "updated"]),
}).meta({ id: "ImportantDateChanged" });

export const importantDateDeleted = z.strictObject({
  dateId: z.uuid(),
  status: z.literal("deleted"),
}).meta({ id: "ImportantDateDeleted" });

export const importantDateInput = z.strictObject({
  day: z.number().int().min(1).max(31).optional(),
  isAgeBased: z.boolean(),
  isYearApproximate: z.boolean(),
  kind: z.enum(["birthday", "custom", "deceased", "first_met"]),
  label: z.string().trim().max(200).optional(),
  month: z.number().int().min(1).max(12).optional(),
  notes: z.string().trim().max(2000).optional(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  year: z.number().int().min(1).max(9999).optional(),
}).meta({ id: "ImportantDateInput" });

export const importantDateList = z.strictObject({
  dates: z.array(importantDate),
  status: z.enum(["ready", "archived"]),
}).meta({ id: "ImportantDateList" });

export const importantDateUpdateInput = z.strictObject({
  day: z.number().int().min(1).max(31).optional(),
  isAgeBased: z.boolean(),
  isYearApproximate: z.boolean(),
  kind: z.enum(["birthday", "custom", "deceased", "first_met"]),
  label: z.string().trim().max(200).optional(),
  month: z.number().int().min(1).max(12).optional(),
  notes: z.string().trim().max(2000).optional(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  year: z.number().int().min(1).max(9999).optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "ImportantDateUpdateInput" });

export const occupationFact = z.strictObject({
  description: z.string().max(2000).optional(),
  endOn: z.iso.date().optional(),
  isCurrent: z.boolean(),
  organizationId: z.uuid().optional(),
  organizationName: z.string().max(200).optional(),
  startOn: z.iso.date().optional(),
  title: z.string().min(1).max(200).regex(/\S/),
  section: z.literal("work"),
}).meta({ id: "OccupationFact" });

export const occupationFactCreateInput = z.strictObject({
  description: z.string().trim().max(2000).optional(),
  endOn: z.iso.date().optional(),
  isCurrent: z.boolean(),
  organizationId: z.uuid().optional(),
  organizationName: z.string().trim().max(200).optional(),
  startOn: z.iso.date().optional(),
  title: z.string().trim().min(1).max(200).regex(/\S/),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  section: z.literal("work"),
}).meta({ id: "OccupationFactCreateInput" });

export const occupationFactUpdateInput = z.strictObject({
  description: z.string().trim().max(2000).optional(),
  endOn: z.iso.date().optional(),
  isCurrent: z.boolean(),
  organizationId: z.uuid().optional(),
  organizationName: z.string().trim().max(200).optional(),
  startOn: z.iso.date().optional(),
  title: z.string().trim().min(1).max(200).regex(/\S/),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  section: z.literal("work"),
}).meta({ id: "OccupationFactUpdateInput" });

export const peopleDirectoryTag = z.strictObject({
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "PeopleDirectoryTag" });

/**
 * How a person is drawn (GAP-045): the colour their initials sit on and, when
 * an uploaded image backs the avatar, the private URL that serves it through
 * the person-file download route. The initials are the reader's: they follow
 * the name in the member's own name order, so the web app derives them.
 */
export const personAvatar = z.strictObject({
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  imageUrl: z.string().regex(
    /^\/api\/v1\/people\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\/content$/,
  ).optional(),
}).meta({ id: "PersonAvatar" });

/** A person's avatar after it changed. */
export const personAvatarChanged = z.strictObject({
  avatar: personAvatar,
  status: z.enum(["removed", "updated"]),
}).meta({ id: "PersonAvatarChanged" });

/**
 * One person of a possible duplicate pair (GAP-049): enough to tell the two
 * apart, and the revision a merge of the pair is decided against.
 */
export const peopleDuplicatePerson = z.strictObject({
  avatar: personAvatar.optional(),
  familyName: z.string().optional(),
  givenName: z.string(),
  id: z.uuid(),
  middleName: z.string().optional(),
  nickname: z.string().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PeopleDuplicatePerson" });

/** Two active people who look like one, the one added first first. */
export const peopleDuplicatePair = z.strictObject({
  people: z.array(peopleDuplicatePerson).length(2),
  reasons: z.array(z.enum(["email", "name", "phone"])).min(1).max(3),
}).meta({ id: "PeopleDuplicatePair" });

/** The bounded duplicate review on the people directory. */
export const peopleDuplicates = z.strictObject({
  pairs: z.array(peopleDuplicatePair).max(20),
  status: z.literal("ready"),
  truncated: z.boolean(),
}).meta({ id: "PeopleDuplicates" });

export const peopleDirectoryPerson = z.strictObject({
  avatar: personAvatar.optional(),
  familyName: z.string().optional(),
  givenName: z.string(),
  id: z.uuid(),
  isPartial: z.boolean(),
  isStarred: z.boolean(),
  lifecycle: z.enum(["active", "archived"]),
  middleName: z.string().optional(),
  nickname: z.string().optional(),
  tagCount: z.number().int().min(0),
  tags: z.array(peopleDirectoryTag).max(5),
}).meta({ id: "PeopleDirectoryPerson" });

export const peopleDirectoryPage = z.strictObject({
  status: z.literal("ready"),
  lifecycle: z.enum(["active", "archived"]),
  people: z.array(peopleDirectoryPerson),
  nextCursor: z.string().optional(),
  selected: peopleDirectoryPerson.optional(),
}).meta({ id: "PeopleDirectoryPage" });

export const peopleTagOptionsPage = z.strictObject({
  status: z.literal("ready"),
  options: z.array(peopleDirectoryTag).max(20),
  nextCursor: z.string().optional(),
  selected: peopleDirectoryTag.optional(),
}).meta({ id: "PeopleTagOptionsPage" });

export const personIdentity = z.strictObject({
  familyName: z.string().optional(),
  givenName: z.string(),
  id: z.uuid(),
  isPartial: z.boolean(),
  middleName: z.string().optional(),
  nickname: z.string().optional(),
}).meta({ id: "PersonIdentity" });

export const personCreated = z.strictObject({
  status: z.literal("created"),
  person: personIdentity,
  next: z.string().regex(new RegExp("^/app/people/[0-9a-f-]+$")),
}).meta({ id: "PersonCreated" });

export const personDeleteInput = z.strictObject({
  confirmation: z.string().min(1).max(500),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonDeleteInput" });

export const personDeleted = z.strictObject({
  next: z.literal("/app/people"),
  personId: z.uuid(),
  status: z.literal("deleted"),
}).meta({ id: "PersonDeleted" });

export const personLifecycleIdentity = z.strictObject({
  description: z.string().optional(),
  familyName: z.string().optional(),
  genderOptionId: z.uuid().optional(),
  givenName: z.string(),
  id: z.uuid(),
  isDeceased: z.boolean(),
  isPartial: z.boolean(),
  lifecycle: z.enum(["active", "archived", "deleted"]),
  middleName: z.string().optional(),
  nickname: z.string().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonLifecycleIdentity" });

export const personDeletionImpact = z.strictObject({
  impact: z.strictObject({
    confirmation: z.string(),
    dependentRecordPolicy: z.literal("retained"),
    person: personLifecycleIdentity,
  }),
  status: z.literal("ready"),
}).meta({ id: "PersonDeletionImpact" });

export const personDueInformation = z.strictObject({
  status: z.literal("ready"),
  detail: z.string(),
  nextReminderAt: z.iso.datetime({ offset: true }).optional(),
  openTaskCount: z.number().int().min(0),
  stayInTouchAt: z.iso.datetime({ offset: true }).optional(),
}).meta({ id: "PersonDueInformation" });

/**
 * An identity edit. The names are replaced whole; the description, gender
 * option, and deceased state (GAP-047) are kept when left out, and empty
 * text clears the description or the gender option.
 */
export const personEditInput = z.strictObject({
  description: z.string().trim().max(2000).optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  familyName: z.string().trim().max(200).optional(),
  genderOptionId: z.union([z.uuid(), z.literal("")]).optional(),
  givenName: z.string().trim().max(200),
  isDeceased: z.boolean().optional(),
  isPartial: z.boolean(),
  middleName: z.string().trim().max(200).optional(),
  nickname: z.string().trim().max(200).optional(),
}).meta({ id: "PersonEditInput" });

export const personInput = z.strictObject({
  duplicateOverride: z.boolean().optional(),
  familyName: z.string().trim().max(200).optional(),
  givenName: z.string().trim().max(200),
  isPartial: z.boolean(),
  middleName: z.string().trim().max(200).optional(),
  nickname: z.string().trim().max(200).optional(),
}).meta({ id: "PersonInput" });

export const personLifeEventDate = z.strictObject({
  day: z.number().int().min(1).max(31).optional(),
  happenedAt: z.iso.datetime({ offset: true }).optional(),
  month: z.number().int().min(1).max(12).optional(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  year: z.number().int().min(1).max(9999).optional(),
}).meta({ id: "PersonLifeEventDate" });

export const personLifeEvent = z.strictObject({
  date: personLifeEventDate,
  id: z.uuid(),
  name: z.string().optional(),
  note: z.string().optional(),
  typeId: z.uuid().optional(),
  typeName: z.string().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonLifeEvent" });

/** One choice from the workspace's current life-event type vocabulary. */
export const personLifeEventType = z.strictObject({
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "PersonLifeEventType" });

export const personLifeEventsReady = z.strictObject({
  events: z.array(personLifeEvent).max(100),
  status: z.enum(["hidden", "ready"]),
  types: z.array(personLifeEventType).max(100),
}).meta({ id: "PersonLifeEventsReady" });

/**
 * What a member writes to record a life event (JOURNAL-002): the calendar
 * components its precision declares, and a name, a type, or both.
 */
export const personLifeEventInput = z.strictObject({
  day: z.number().int().min(1).max(31).optional(),
  month: z.number().int().min(1).max(12).optional(),
  name: z.string().trim().max(200).optional(),
  note: z.string().trim().max(10000).optional(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  typeId: z.uuid().optional(),
  year: z.number().int().min(1).max(9999).optional(),
}).meta({ id: "PersonLifeEventInput" });

/** An edit replaces the event's value while it still has this revision. */
export const personLifeEventUpdateInput = personLifeEventInput.extend({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonLifeEventUpdateInput" });

export const personLifeEventChanged = z.strictObject({
  event: personLifeEvent,
  status: z.enum(["created", "updated"]),
}).meta({ id: "PersonLifeEventChanged" });

export const personLifeEventDeleted = z.strictObject({
  lifeEventId: z.uuid(),
  status: z.literal("deleted"),
}).meta({ id: "PersonLifeEventDeleted" });

export const personLifecycleChanged = z.strictObject({
  person: personLifecycleIdentity,
  status: z.enum(["updated", "archived", "restored"]),
}).meta({ id: "PersonLifecycleChanged" });

/** The merge preview's fingerprint of what a merge discards: SHA-256, hex. */
const conflictsDigest = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Merge the duplicate into the person named in the path (GAP-049), confirmed
 * against the revisions of both people the member reviewed and the digest of
 * the conflicts the preview listed; any of them no longer current is refused.
 * A merge cannot be undone.
 */
export const personMergeInput = z.strictObject({
  /** The member read the confirmation, which says a merge cannot be undone. */
  confirmed: z.literal(true),
  /** `conflictsDigest` of the merge preview the member confirmed. */
  conflictsDigest,
  duplicateId: z.uuid(),
  duplicateRevision: z.iso.datetime({ offset: true }),
  primaryRevision: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonMergeInput" });

/** A single-valued fact only the primary keeps, and what is discarded. */
export const personMergeConflict = z.strictObject({
  discarded: z.string(),
  fact: z.enum([
    "avatar",
    "birthday",
    "deceased",
    "first-meeting",
    "first_met",
    "stay-in-touch",
  ]),
  kept: z.string(),
}).meta({ id: "PersonMergeConflict" });

/**
 * What merging the duplicate into the primary would do, and the revisions and
 * conflicts digest a confirmation of it names.
 */
export const personMergePreview = z.strictObject({
  conflicts: z.array(personMergeConflict).max(20),
  conflictsDigest,
  duplicate: personLifecycleIdentity,
  moves: z.number().int().min(0),
  primary: personLifecycleIdentity,
  status: z.literal("ready"),
}).meta({ id: "PersonMergePreview" });

/** The person who is left, and where their workspace is. */
export const personMerged = z.strictObject({
  duplicateId: z.uuid(),
  moved: z.number().int().min(0),
  next: z.string().regex(/^\/app\/people\/[0-9a-f-]{36}$/),
  person: personLifecycleIdentity,
  status: z.literal("merged"),
}).meta({ id: "PersonMerged" });

export const personPrimaryContactMethod = z.strictObject({
  href: z.string().optional(),
  id: z.uuid(),
  kind: z.string(),
  label: z.string(),
  value: z.string(),
}).meta({ id: "PersonPrimaryContactMethod" });

export const personProfileSectionId = z.enum([
  "activities",
  "addresses",
  "calls",
  "contact-methods",
  "conversations",
  "first-meeting",
  "food-preferences",
  "life-events",
  "notes",
  "pets",
  "relationships",
  "tasks",
  "tags",
  "work",
]).meta({ id: "PersonProfileSectionId" });

export const personProfileIdentity = z.strictObject({
  avatar: personAvatar.optional(),
  description: z.string().optional(),
  familyName: z.string().optional(),
  gender: z.string().optional(),
  genderOptionId: z.uuid().optional(),
  givenName: z.string(),
  id: z.uuid(),
  isDeceased: z.boolean(),
  isPartial: z.boolean(),
  isSelf: z.boolean(),
  isStarred: z.boolean(),
  lastContactAt: z.iso.datetime({ offset: true }).optional(),
  middleName: z.string().optional(),
  nickname: z.string().optional(),
  profileSections: z.array(z.strictObject({
    id: personProfileSectionId,
    status: z.enum(["hidden", "ready"]),
  })).optional(),
  tagCount: z.number().int().min(0),
  tags: z.array(peopleDirectoryTag).max(8),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonProfileIdentity" });

export const personProfileSectionCount = oneOf([
  z.strictObject({
    count: z.number().int().min(0),
    id: personProfileSectionId,
    status: z.literal("ready"),
  }),
  z.strictObject({
    id: personProfileSectionId,
    status: z.literal("hidden"),
  }),
]).meta({ id: "PersonProfileSectionCount" });

export const personRelationshipCount = z.strictObject({
  count: z.number().int().min(0),
  label: z.string(),
  relationshipTypeId: z.uuid(),
}).meta({ id: "PersonRelationshipCount" });

export const personProfileSummary = z.strictObject({
  nextReminderAt: z.iso.datetime({ offset: true }).optional(),
  primaryContactMethods: z.array(personPrimaryContactMethod).max(3),
  relationshipCounts: z.array(personRelationshipCount),
  sectionCounts: z.array(personProfileSectionCount).min(14).max(14),
  stayInTouchAt: z.iso.datetime({ offset: true }).optional(),
}).meta({ id: "PersonProfileSummary" });

/**
 * One choice from the workspace's gender vocabulary (GAP-047). An archived
 * option is listed only while it is the person's own, so it can be kept.
 */
export const personGenderOption = z.strictObject({
  archived: z.boolean(),
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "PersonGenderOption" });

export const personReady = z.strictObject({
  status: z.enum(["ready", "archived"]),
  person: personProfileIdentity,
  dueInformation: personDueInformation,
  /** The options the identity editor offers, current ones first. */
  genderOptions: z.array(personGenderOption).max(101).optional(),
  summary: personProfileSummary.optional(),
}).meta({ id: "PersonReady" });

export const personTimelineMessage = z.strictObject({
  content: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  writtenAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonTimelineMessage" });

export const personTimelineItem = z.strictObject({
  calendarDate: z.strictObject({
    year: z.number().int().min(1).max(9999).optional(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
  }).meta({
    description:
      "Recorded calendar components for component-backed life events; occurredAt remains their ordering key, not an event instant.",
  }).optional(),
  datePrecision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  activityType: z.string().optional(),
  channelType: z.string().optional(),
  contactMethod: z.string().optional(),
  contactWasCaller: z.boolean().optional(),
  emotions: z.array(interactionOption).max(20).optional(),
  excerpt: z.string().optional(),
  id: z.uuid(),
  kind: z.enum(["activity", "call", "conversation", "life-event", "note"]),
  messages: z.array(personTimelineMessage).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  participants: z.array(interactionParticipant).max(50).optional(),
  title: z.string().optional(),
}).meta({ id: "PersonTimelineItem" });

export const personTimelinePage = z.strictObject({
  items: z.array(personTimelineItem).max(50),
  nextCursor: z.string().optional(),
  status: z.enum(["archived", "ready"]),
}).meta({ id: "PersonTimelinePage" });

export const personTransitionInput = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonTransitionInput" });

export const personViewRecorded = z.strictObject({
  status: z.literal("recorded"),
}).meta({ id: "PersonViewRecorded" });

export const petFact = z.strictObject({
  categoryId: z.uuid().optional(),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  section: z.literal("pets"),
}).meta({ id: "PetFact" });

export const petFactCreateInput = z.strictObject({
  categoryId: z.uuid().optional(),
  name: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  section: z.literal("pets"),
}).refine(hasPetDetail, { message: "Enter a pet detail." }).meta({
  id: "PetFactCreateInput",
  anyOf: [{ "required": ["categoryId"] }, {
    "required": ["name"],
    "properties": {
      "name": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }],
});

export const petFactUpdateInput = z.strictObject({
  categoryId: z.uuid().optional(),
  name: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  section: z.literal("pets"),
}).refine(hasPetDetail, { message: "Enter a pet detail." }).meta({
  id: "PetFactUpdateInput",
  anyOf: [{ "required": ["categoryId"] }, {
    "required": ["name"],
    "properties": {
      "name": { "type": "string", "minLength": 1, "pattern": "\\S" },
    },
  }],
});

export const profileFactOption = z.strictObject({
  id: z.uuid(),
  kind: z.enum([
    "contact-label",
    "contact-type",
    "organization",
    "pet-category",
  ]).optional(),
  name: z.string(),
}).meta({ id: "ProfileFactOption" });

export const profileFactSectionId = z.enum([
  "addresses",
  "contact-methods",
  "first-meeting",
  "food-preferences",
  "pets",
  "tags",
  "work",
]).meta({ id: "ProfileFactSectionId" });

export const tagsFact = z.strictObject({
  tagIds: z.array(z.uuid()).max(500),
  section: z.literal("tags"),
}).meta({ id: "TagsFact" });

export const profileFactValue = oneOf([
  addressFact,
  contactMethodFact,
  firstMeetingFact,
  foodPreferencesFact,
  petFact,
  tagsFact,
  occupationFact,
]).meta({
  // A discriminator with no mapping means the property carries the schema's
  // own name, which is not what a section is called. The map says so.
  discriminator: {
    propertyName: "section",
    mapping: {
      "addresses": "#/components/schemas/AddressFact",
      "contact-methods": "#/components/schemas/ContactMethodFact",
      "first-meeting": "#/components/schemas/FirstMeetingFact",
      "food-preferences": "#/components/schemas/FoodPreferencesFact",
      "pets": "#/components/schemas/PetFact",
      "tags": "#/components/schemas/TagsFact",
      "work": "#/components/schemas/OccupationFact",
    },
  },
  id: "ProfileFactValue",
});

export const profileFactRecord = z.strictObject({
  id: z.uuid(),
  referencesResolved: z.boolean().optional(),
  section: profileFactSectionId,
  selectedOptions: z.array(profileFactOption).optional(),
  updatedAt: z.iso.datetime({ offset: true }),
  value: profileFactValue,
}).meta({ id: "ProfileFactRecord" });

export const profileFactChanged = z.strictObject({
  status: z.literal("saved"),
  personUpdatedAt: z.iso.datetime({ offset: true }),
  record: profileFactRecord,
}).meta({ id: "ProfileFactChanged" });

export const tagsFactCreateInput = z.strictObject({
  tagIds: z.array(z.uuid()).max(500),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  section: z.literal("tags"),
}).meta({ id: "TagsFactCreateInput" });

export const profileFactCreateInput = oneOf([
  addressFactCreateInput,
  contactMethodFactCreateInput,
  firstMeetingFactCreateInput,
  foodPreferencesFactCreateInput,
  petFactCreateInput,
  tagsFactCreateInput,
  occupationFactCreateInput,
]).meta({
  // A discriminator with no mapping means the property carries the schema's
  // own name, which is not what a section is called. The map says so.
  discriminator: {
    propertyName: "section",
    mapping: {
      "addresses": "#/components/schemas/AddressFactCreateInput",
      "contact-methods": "#/components/schemas/ContactMethodFactCreateInput",
      "first-meeting": "#/components/schemas/FirstMeetingFactCreateInput",
      "food-preferences": "#/components/schemas/FoodPreferencesFactCreateInput",
      "pets": "#/components/schemas/PetFactCreateInput",
      "tags": "#/components/schemas/TagsFactCreateInput",
      "work": "#/components/schemas/OccupationFactCreateInput",
    },
  },
  id: "ProfileFactCreateInput",
});

export const profileFactDeleteInput = z.strictObject({
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  section: profileFactSectionId,
}).meta({ id: "ProfileFactDeleteInput" });

export const profileFactDeleted = z.strictObject({
  status: z.literal("deleted"),
  factId: z.uuid(),
  personUpdatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "ProfileFactDeleted" });

export const profileFactSection = z.strictObject({
  nextCursor: z.string().optional(),
  nextOptionsCursor: z.string().optional(),
  status: z.enum(["ready", "archived", "hidden"]),
  options: z.array(profileFactOption),
  personUpdatedAt: z.iso.datetime({ offset: true }),
  records: z.array(profileFactRecord),
}).meta({ id: "ProfileFactSection" });

export const tagsFactUpdateInput = z.strictObject({
  tagIds: z.array(z.uuid()).max(500),
  expectedPersonUpdatedAt: z.iso.datetime({ offset: true }),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  section: z.literal("tags"),
}).meta({ id: "TagsFactUpdateInput" });

export const profileFactUpdateInput = oneOf([
  addressFactUpdateInput,
  contactMethodFactUpdateInput,
  firstMeetingFactUpdateInput,
  foodPreferencesFactUpdateInput,
  petFactUpdateInput,
  tagsFactUpdateInput,
  occupationFactUpdateInput,
]).meta({
  // A discriminator with no mapping means the property carries the schema's
  // own name, which is not what a section is called. The map says so.
  discriminator: {
    propertyName: "section",
    mapping: {
      "addresses": "#/components/schemas/AddressFactUpdateInput",
      "contact-methods": "#/components/schemas/ContactMethodFactUpdateInput",
      "first-meeting": "#/components/schemas/FirstMeetingFactUpdateInput",
      "food-preferences": "#/components/schemas/FoodPreferencesFactUpdateInput",
      "pets": "#/components/schemas/PetFactUpdateInput",
      "tags": "#/components/schemas/TagsFactUpdateInput",
      "work": "#/components/schemas/OccupationFactUpdateInput",
    },
  },
  id: "ProfileFactUpdateInput",
});

export const todayRecentPerson = z.strictObject({
  archived: z.boolean(),
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "TodayRecentPerson" });

export const todayRecentPeople = z.strictObject({
  people: z.array(todayRecentPerson).max(8),
  status: z.literal("ready"),
}).meta({ id: "TodayRecentPeople" });
