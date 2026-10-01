/**
 * Member and workspace settings: the shapes this surface accepts and answers
 * with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/settings` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 *
 * Part of what this surface enforces renders nothing at all: a field the
 * route trims before it looks at it, an update that has to change something,
 * and the zone, locale, and slug the document has always published as a bare
 * string. Those arrived from `apps/api/settings` as checks rather than as
 * constraints, so every shape parses exactly what it parsed before and the
 * document says exactly what it said.
 */

import { z } from "zod";

/** A language tag, as the member's and the workspace's locales are spelled. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
/** A workspace's URL name: lowercase words joined by single hyphens. */
const WORKSPACE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The shape of a time zone, not its meaning.
 *
 * Whether the calendar can actually schedule in it is the settings use case's
 * question, because a stored zone decides when every reminder a member or
 * workspace owns comes due.
 */
const timezone = z.string().trim().refine(
  (value) => value.length >= 1 && value.length <= 100,
);

/** A language tag, checked for shape and published as a bare string. */
const locale = z.string().trim().refine(
  (value) => value.length <= 35 && LANGUAGE_TAG.test(value),
);

/** A slug, lower-cased before it is checked, so a typed capital still saves. */
const workspaceSlug = z.string().trim().toLowerCase().refine(
  (value) => value.length <= 100 && WORKSPACE_SLUG.test(value),
);

/** A local time of day as the digest is set: `HH:MM` on a 24-hour clock. */
const digestTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

/**
 * Where a member's newly generated reminders are delivered (PLANNING-003).
 * Email needs a verified address; without one, reminders stay in the app.
 */
const reminderDelivery = z.enum(["in_app", "email", "both"]);

/** A currency as a form sends it: upper-cased before it is recognised. */
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

/**
 * Every update must change something.
 *
 * A body carrying only the version it was decided against is a no-op the
 * route refuses rather than an edit it applies, which is what the `anyOf`
 * beside each update shape publishes.
 */
const changesSomething = (value: object): boolean =>
  Object.keys(value).length > 1;

export const managedMember = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  status: z.enum(["active", "suspended"]),
}).meta({ id: "ManagedMember" });

export const managedMemberResult = z.strictObject({
  status: z.literal("ready"),
  member: managedMember,
}).meta({ id: "ManagedMemberResult" });

export const managedMembers = z.strictObject({
  status: z.literal("ready"),
  members: z.array(managedMember),
}).meta({ id: "ManagedMembers" });

/**
 * The notifications read-through watermark (GAP-053, `TODAY-002`): a UTC
 * instant with at most millisecond precision. A save only ever moves it
 * forward.
 */
const notificationsReadThrough = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
).refine((value) => {
  // A date that does not exist (February 30) is refused, not rolled over.
  const instant = new Date(value);
  return !Number.isNaN(instant.getTime()) &&
    instant.toISOString().slice(0, 19) === value.slice(0, 19);
}).meta({ format: "date-time" }).optional();

export const memberUiState = z.strictObject({
  notificationsReadThrough,
  personWorkspaceView: z.enum([
    "all",
    "timeline",
    "planning",
    "things",
    "admin",
  ]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
}).meta({ id: "MemberUiState" });

export const memberUiStateInput = z.strictObject({
  notificationsReadThrough,
  personWorkspaceView: z.enum([
    "all",
    "timeline",
    "planning",
    "things",
    "admin",
  ]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
}).refine(
  (value) =>
    value.notificationsReadThrough !== undefined ||
    value.personWorkspaceView !== undefined || value.theme !== undefined,
).meta({ minProperties: 1, id: "MemberUiStateInput" });

export const memberUiStateReady = z.strictObject({
  status: z.literal("ready"),
  uiState: memberUiState,
}).meta({ id: "MemberUiStateReady" });

export const memberUpdateInput = z.strictObject({
  role: z.enum(["owner", "admin", "member"]),
  status: z.enum(["active", "suspended"]),
}).meta({ id: "MemberUpdateInput" });

export const personalizationNameOnlyCreate = z.strictObject({
  name: z.string().trim().min(1).max(200),
}).meta({ id: "PersonalizationNameOnlyCreate" });

export const personalizationNamedCreate = z.strictObject({
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).meta({ id: "PersonalizationNamedCreate" });

/**
 * The broad kinds of a contact-method type (GAP-050): the values the v8
 * `contact_method_types.kind` column comment lists, `custom` by default.
 */
export const CONTACT_METHOD_KINDS = [
  "email",
  "phone",
  "url",
  "social",
  "im",
  "username",
  "custom",
] as const;

export const contactMethodKind = z.enum(CONTACT_METHOD_KINDS).meta({
  id: "ContactMethodKind",
});

/** A new contact-method type: a named option with an optional kind. */
export const personalizationContactTypeCreate = z.strictObject({
  contactKind: contactMethodKind.optional(),
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).meta({ id: "PersonalizationContactTypeCreate" });

export const personalizationRelationshipCreate = z.strictObject({
  forwardLabel: z.string().trim().min(1).max(200),
  reverseLabel: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).meta({ id: "PersonalizationRelationshipCreate" });

export const personalizationReminderCreate = z.strictObject({
  daysBefore: z.number().int().min(0).max(3650),
}).meta({ id: "PersonalizationReminderCreate" });

export const personalizationCreate = z.union([
  personalizationContactTypeCreate,
  personalizationNamedCreate,
  personalizationNameOnlyCreate,
  personalizationRelationshipCreate,
  personalizationReminderCreate,
]).meta({
  "x-sectionSchemas": {
    "profile-modules": "#/components/schemas/PersonalizationNamedCreate",
    "gender-options": "#/components/schemas/PersonalizationNamedCreate",
    "contact-method-types":
      "#/components/schemas/PersonalizationContactTypeCreate",
    "contact-labels": "#/components/schemas/PersonalizationNameOnlyCreate",
    "activity-types": "#/components/schemas/PersonalizationNamedCreate",
    "emotion-options": null,
    "life-event-types": "#/components/schemas/PersonalizationNamedCreate",
    "relationship-types":
      "#/components/schemas/PersonalizationRelationshipCreate",
    "pet-categories": null,
    "reminder-rules": "#/components/schemas/PersonalizationReminderCreate",
    "tags": "#/components/schemas/PersonalizationNameOnlyCreate",
  },
  id: "PersonalizationCreate",
});

export const personalizationDeleted = z.strictObject({
  id: z.uuid(),
  status: z.literal("deleted"),
}).meta({ id: "PersonalizationDeleted" });

export const personalizationEntry = z.strictObject({
  capabilities: z.strictObject({
    delete: z.boolean(),
    disable: z.boolean(),
    editValue: z.boolean(),
    rename: z.boolean(),
    reorder: z.boolean(),
    replace: z.boolean(),
    setDefault: z.boolean(),
  }),
  canDelete: z.boolean(),
  contactKind: contactMethodKind.optional(),
  daysBefore: z.number().int().min(0).max(3650).optional(),
  forwardLabel: z.string().optional(),
  id: z.uuid(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  kind: z.enum(["named", "relationship-type", "reminder-rule"]),
  name: z.string(),
  readOnly: z.boolean(),
  referenceCount: z.number().int().min(0),
  reverseLabel: z.string().optional(),
  sortOrder: z.number().int().min(0),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "PersonalizationEntry" });

export const personalizationGenderUpdate = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  isActive: z.boolean().optional(),
  isDefault: z.literal(true).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).refine(changesSomething).meta({
  id: "PersonalizationGenderUpdate",
  anyOf: [{ "required": ["isActive"] }, { "required": ["isDefault"] }, {
    "required": ["name"],
  }, { "required": ["sortOrder"] }],
});

export const personalizationSection = z.enum([
  "profile-modules",
  "gender-options",
  "contact-method-types",
  "contact-labels",
  "activity-types",
  "emotion-options",
  "life-event-types",
  "relationship-types",
  "pet-categories",
  "reminder-rules",
  "tags",
]).meta({ id: "PersonalizationSection" });

export const personalizationList = z.strictObject({
  capabilities: z.strictObject({
    create: z.boolean(),
    editValue: z.boolean(),
  }),
  entries: z.array(personalizationEntry),
  readOnly: z.boolean(),
  section: personalizationSection,
  status: z.literal("ready"),
}).meta({ id: "PersonalizationList" });

export const personalizationNameOnlyUpdate = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(200),
}).meta({ id: "PersonalizationNameOnlyUpdate" });

export const personalizationNamedUpdate = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).refine(changesSomething).meta({
  id: "PersonalizationNamedUpdate",
  anyOf: [{ "required": ["isActive"] }, { "required": ["name"] }, {
    "required": ["sortOrder"],
  }],
});

/** A contact-method type's edit: a named update that may also set a kind. */
export const personalizationContactTypeUpdate = z.strictObject({
  contactKind: contactMethodKind.optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).refine(changesSomething).meta({
  id: "PersonalizationContactTypeUpdate",
  anyOf: [{ "required": ["contactKind"] }, { "required": ["isActive"] }, {
    "required": ["name"],
  }, { "required": ["sortOrder"] }],
});

export const personalizationRelationshipUpdate = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  forwardLabel: z.string().trim().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
  reverseLabel: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).refine(changesSomething).refine(
  (value) =>
    (value.forwardLabel === undefined) === (value.reverseLabel === undefined),
).meta({
  dependentRequired: {
    "forwardLabel": ["reverseLabel"],
    "reverseLabel": ["forwardLabel"],
  },
  id: "PersonalizationRelationshipUpdate",
  anyOf: [{ "required": ["forwardLabel", "reverseLabel"] }, {
    "required": ["isActive"],
  }, { "required": ["sortOrder"] }],
});

export const personalizationReminderUpdate = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  daysBefore: z.number().int().min(0).max(3650).optional(),
  isActive: z.boolean().optional(),
}).refine(changesSomething).meta({
  id: "PersonalizationReminderUpdate",
  anyOf: [{ "required": ["daysBefore"] }, { "required": ["isActive"] }],
});

export const personalizationSaved = z.strictObject({
  entry: personalizationEntry,
  status: z.literal("saved"),
}).meta({ id: "PersonalizationSaved" });

export const personalizationUpdate = z.union([
  personalizationContactTypeUpdate,
  personalizationNamedUpdate,
  personalizationGenderUpdate,
  personalizationNameOnlyUpdate,
  personalizationRelationshipUpdate,
  personalizationReminderUpdate,
]).meta({
  "x-sectionSchemas": {
    "profile-modules": "#/components/schemas/PersonalizationNamedUpdate",
    "gender-options": "#/components/schemas/PersonalizationGenderUpdate",
    "contact-method-types":
      "#/components/schemas/PersonalizationContactTypeUpdate",
    "contact-labels": "#/components/schemas/PersonalizationNameOnlyUpdate",
    "activity-types": "#/components/schemas/PersonalizationNamedUpdate",
    "emotion-options": null,
    "life-event-types": "#/components/schemas/PersonalizationNamedUpdate",
    "relationship-types":
      "#/components/schemas/PersonalizationRelationshipUpdate",
    "pet-categories": null,
    "reminder-rules": "#/components/schemas/PersonalizationReminderUpdate",
    "tags": "#/components/schemas/PersonalizationNameOnlyUpdate",
  },
  id: "PersonalizationUpdate",
});

export const resolvedMemberPreferences = z.strictObject({
  effectiveTimezone: z.string().meta({ readOnly: true }),
  contactNameOrder: z.enum(["given_family_nickname", "family_given_nickname"]),
  contactSortOrder: z.enum(["given_name_asc", "family_name_asc"]),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  /** Absent when each email reminder is sent as it comes due. */
  digestTime: digestTime.optional(),
  fluidLayout: z.boolean(),
  locale: z.string(),
  measurementSystem: z.enum(["metric", "imperial"]),
  reminderDelivery,
  temperatureScale: z.enum(["celsius", "fahrenheit"]),
  timezone: z.string().optional(),
}).meta({ id: "ResolvedMemberPreferences" });

/** The supported currency codes a currency preference may name. */
const supportedCurrencyCodes = z.array(z.string().regex(/^[A-Z]{3}$/));

export const preferenceSettings = z.strictObject({
  status: z.literal("ready"),
  preferences: resolvedMemberPreferences,
  supportedCurrencyCodes,
}).meta({ id: "PreferenceSettings" });

export const preferencesInput = z.strictObject({
  contactNameOrder: z.enum(["given_family_nickname", "family_given_nickname"]),
  contactSortOrder: z.enum(["given_name_asc", "family_name_asc"]),
  currencyCode: currencyCode.optional(),
  /** `null` stops the digest; absent keeps what the member chose. */
  digestTime: digestTime.nullable().optional(),
  fluidLayout: z.boolean(),
  locale: locale,
  measurementSystem: z.enum(["metric", "imperial"]),
  /** Absent keeps what the member chose. */
  reminderDelivery: reminderDelivery.optional(),
  temperatureScale: z.enum(["celsius", "fahrenheit"]),
  timezone: timezone.optional(),
}).meta({ id: "PreferencesInput" });

export const profileInput = z.strictObject({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
}).meta({ id: "ProfileInput" });

export const profileSettings = z.strictObject({
  status: z.literal("ready"),
  profile: z.strictObject({
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
  }),
}).meta({ id: "ProfileSettings" });

export const sessionRevoked = z.strictObject({
  status: z.literal("revoked"),
  current: z.boolean(),
}).meta({ id: "SessionRevoked" });

export const sessionSettings = z.strictObject({
  status: z.literal("ready"),
  sessions: z.array(z.strictObject({
    id: z.uuid(),
    current: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    lastSeenAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
  })),
}).meta({ id: "SessionSettings" });

export const workspaceSettingsInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  slug: workspaceSlug.optional(),
  defaultLocale: locale,
  defaultTimezone: timezone.optional(),
  defaultCurrencyCode: currencyCode.optional(),
  defaultReminderTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).meta({ id: "WorkspaceSettingsInput" });

export const workspaceSettings = z.strictObject({
  status: z.literal("ready"),
  supportedCurrencyCodes,
  workspace: workspaceSettingsInput,
}).meta({ id: "WorkspaceSettings" });
