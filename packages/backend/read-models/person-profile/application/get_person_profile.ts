import {
  createPersonTimeline,
  type PersonTimelineRepository,
} from "./list_person_timeline.ts";

export const PERSON_PROFILE_TAG_PREVIEW_LIMIT = 8;
export const PERSON_PROFILE_PRIMARY_CONTACT_LIMIT = 3;

export const PERSON_PROFILE_SECTION_IDS = [
  "contact-methods",
  "addresses",
  "first-meeting",
  "relationships",
  "work",
  "food-preferences",
  "pets",
  "tags",
  "notes",
  "activities",
  "conversations",
  "calls",
  "tasks",
  "life-events",
] as const;

export type PersonProfileSectionId = typeof PERSON_PROFILE_SECTION_IDS[number];

export interface PersonProfileActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface PersonProfileTag {
  readonly id: string;
  readonly name: string;
}

export interface PersonProfileSection {
  readonly id: PersonProfileSectionId;
  readonly status: "hidden" | "ready";
}

export interface PersonPrimaryContactMethod {
  readonly href?: string;
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly value: string;
}

export interface PersonRelationshipCount {
  readonly count: number;
  readonly label: string;
  readonly relationshipTypeId: string;
}

export interface PersonProfileSectionRecordCount {
  readonly count: number;
  readonly id: PersonProfileSectionId;
}

export type PersonProfileSectionCount =
  | {
    readonly count: number;
    readonly id: PersonProfileSectionId;
    readonly status: "ready";
  }
  | {
    readonly id: PersonProfileSectionId;
    readonly status: "hidden";
  };

export interface PersonProfileSummaryProjection {
  readonly primaryContactMethods: readonly PersonPrimaryContactMethod[];
  readonly relationshipCounts: readonly PersonRelationshipCount[];
  readonly sectionCounts: readonly PersonProfileSectionRecordCount[];
}

export interface PersonProfileSummary {
  readonly nextReminderAt?: string;
  readonly primaryContactMethods: readonly PersonPrimaryContactMethod[];
  readonly relationshipCounts: readonly PersonRelationshipCount[];
  readonly sectionCounts: readonly PersonProfileSectionCount[];
  readonly stayInTouchAt?: string;
}

export interface PersonProfileIdentity {
  readonly description?: string;
  readonly familyName?: string;
  readonly gender?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isDeceased: boolean;
  readonly isPartial: boolean;
  readonly isSelf: boolean;
  readonly isStarred: boolean;
  readonly lastContactAt?: string;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly profileSections?: readonly PersonProfileSection[];
  readonly tagCount: number;
  readonly tags: readonly PersonProfileTag[];
  readonly updatedAt: string;
}

export interface PersonDueInformation {
  readonly detail: string;
  readonly nextReminderAt?: string;
  readonly openTaskCount: number;
  readonly stayInTouchAt?: string;
  readonly status: "ready";
}

export interface PersonDueProjection {
  readonly nextReminderAt?: string;
  readonly openTaskCount: number;
  readonly stayInTouchAt?: string;
}

export type PersonLifeEventPrecision =
  | "day"
  | "full"
  | "month"
  | "month_day"
  | "unknown"
  | "year"
  | "year_month";

export interface PersonLifeEvent {
  readonly date: {
    readonly day?: number;
    readonly happenedAt?: string;
    readonly month?: number;
    readonly precision: PersonLifeEventPrecision;
    readonly year?: number;
  };
  readonly id: string;
  readonly name?: string;
  readonly note?: string;
  readonly typeName?: string;
}

export type PersonProfileRepositoryResult =
  | {
    readonly dueInformation: PersonDueProjection;
    readonly person: PersonProfileIdentity;
    readonly status: "ready";
    readonly summary?: PersonProfileSummaryProjection;
  }
  | {
    readonly dueInformation: PersonDueProjection;
    readonly person: PersonProfileIdentity;
    readonly status: "archived";
    readonly summary?: PersonProfileSummaryProjection;
  }
  | { readonly status: "not-found" }
  | { readonly status: "forbidden" };

export interface PersonProfileRepository extends PersonTimelineRepository {
  get(
    command: PersonProfileActor & {
      readonly includeSummary?: boolean;
      readonly personId: string;
    },
  ): Promise<PersonProfileRepositoryResult>;
  listLifeEvents(
    command: PersonProfileActor & { readonly personId: string },
  ): Promise<
    | { readonly events: readonly PersonLifeEvent[]; readonly status: "ready" }
    | { readonly events: readonly PersonLifeEvent[]; readonly status: "hidden" }
    | { readonly status: "not-found" | "forbidden" }
  >;
}

export type GetPersonProfileResult =
  | {
    readonly dueInformation: PersonDueInformation;
    readonly person: PersonProfileIdentity;
    readonly status: "ready" | "archived";
    readonly summary?: PersonProfileSummary;
  }
  | { readonly status: "not-found" }
  | { readonly status: "forbidden" };

function dueInformation(projection: PersonDueProjection): PersonDueInformation {
  const details = [
    `${projection.openTaskCount} open task${
      projection.openTaskCount === 1 ? "" : "s"
    }`,
  ];
  if (projection.nextReminderAt) {
    details.push(`next reminder ${projection.nextReminderAt}`);
  }
  if (projection.stayInTouchAt) {
    details.push(`stay in touch ${projection.stayInTouchAt}`);
  }
  return { ...projection, detail: `${details.join("; ")}.`, status: "ready" };
}

function summary(
  projection: PersonProfileSummaryProjection,
  sections: readonly PersonProfileSection[] | undefined,
  due: PersonDueInformation,
): PersonProfileSummary {
  const counts = new Map(
    projection.sectionCounts.map((section) => [section.id, section.count]),
  );
  const hidden = new Set(
    sections?.filter((section) => section.status === "hidden").map((section) =>
      section.id
    ) ?? [],
  );
  return {
    ...(due.nextReminderAt ? { nextReminderAt: due.nextReminderAt } : {}),
    primaryContactMethods: hidden.has("contact-methods")
      ? []
      : projection.primaryContactMethods.slice(
        0,
        PERSON_PROFILE_PRIMARY_CONTACT_LIMIT,
      ),
    relationshipCounts: hidden.has("relationships")
      ? []
      : projection.relationshipCounts,
    sectionCounts: PERSON_PROFILE_SECTION_IDS.map((id) =>
      hidden.has(id)
        ? { id, status: "hidden" as const }
        : { count: counts.get(id) ?? 0, id, status: "ready" as const }
    ),
    ...(due.stayInTouchAt ? { stayInTouchAt: due.stayInTouchAt } : {}),
  };
}

export function createPersonProfile(dependencies: {
  readonly repository: PersonProfileRepository;
}) {
  return {
    get: async (
      actor: PersonProfileActor,
      personId: string,
      options: { readonly includeSummary?: boolean } = {},
    ): Promise<GetPersonProfileResult> => {
      const result = await dependencies.repository.get({
        ...actor,
        ...(options.includeSummary ? { includeSummary: true } : {}),
        personId,
      });
      if (result.status !== "ready" && result.status !== "archived") {
        return result;
      }
      const tagsHidden =
        result.person.profileSections?.some((section) =>
          section.id === "tags" && section.status === "hidden"
        ) === true;
      const due = dueInformation(result.dueInformation);
      return {
        dueInformation: due,
        person: {
          ...result.person,
          tagCount: tagsHidden ? 0 : result.person.tagCount,
          tags: tagsHidden
            ? []
            : result.person.tags.slice(0, PERSON_PROFILE_TAG_PREVIEW_LIMIT),
        },
        status: result.status,
        ...(options.includeSummary && result.summary
          ? {
            summary: summary(
              result.summary,
              result.person.profileSections,
              due,
            ),
          }
          : {}),
      };
    },
    listLifeEvents: async (actor: PersonProfileActor, personId: string) =>
      await dependencies.repository.listLifeEvents({ ...actor, personId }),
    ...createPersonTimeline(dependencies),
  };
}

export type PersonProfile = ReturnType<typeof createPersonProfile>;
