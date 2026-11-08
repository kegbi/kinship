import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type { DatePrecision } from "../../../shared-kernel/partial_date.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";
import type { PersonAvatarRecord } from "../../../modules/people/public.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}
import {
  createPersonTimeline,
  type PersonTimelineRepository,
} from "./list_person_timeline.ts";
import {
  createPersonRail,
  type PersonRail,
  type PersonRailSources,
} from "./compose_person_rail.ts";

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
  /** The stored colour, and the image file only while it can be drawn. */
  readonly avatar?: PersonAvatarRecord;
  readonly description?: string;
  readonly familyName?: string;
  readonly gender?: string;
  /** The workspace gender option the person is described with (GAP-047). */
  readonly genderOptionId?: string;
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

/** The shared partial-date precision, named for this read model's readers. */
export type PersonLifeEventPrecision = DatePrecision;

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
  readonly typeId?: string;
  readonly typeName?: string;
  /** The revision an edit or removal of this event must name. */
  readonly updatedAt: string;
}

/**
 * One choice the identity editor offers from the workspace's gender
 * vocabulary (GAP-047): every current option, and an archived one only while
 * it is the person's own.
 */
export interface PersonGenderOption {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
}

/** A current choice from the workspace's life-event type vocabulary. */
export interface PersonLifeEventType {
  readonly id: string;
  readonly name: string;
}

export type PersonProfileRepositoryResult =
  | {
    readonly dueInformation: PersonDueProjection;
    readonly genderOptions?: readonly PersonGenderOption[];
    readonly person: PersonProfileIdentity;
    readonly status: "ready";
    readonly summary?: PersonProfileSummaryProjection;
  }
  | {
    readonly dueInformation: PersonDueProjection;
    readonly genderOptions?: readonly PersonGenderOption[];
    readonly person: PersonProfileIdentity;
    readonly status: "archived";
    readonly summary?: PersonProfileSummaryProjection;
  }
  | Failure<"forbidden" | "not-found">;

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
    | {
      readonly events: readonly PersonLifeEvent[];
      readonly status: "hidden" | "ready";
      /** What an editor may choose from; archived types are left out. */
      readonly types: readonly PersonLifeEventType[];
    }
    | Failure<"not-found" | "forbidden">
  >;
}

export type GetPersonProfileResult =
  | {
    readonly dueInformation: PersonDueInformation;
    readonly genderOptions?: readonly PersonGenderOption[];
    readonly person: PersonProfileIdentity;
    readonly rail?: PersonRail;
    readonly status: "ready" | "archived";
    readonly summary?: PersonProfileSummary;
  }
  | Failure<"forbidden" | "not-found">;

/** What a person read may add to the identity and due information. */
export interface PersonProfileReadOptions {
  readonly includeSummary?: boolean;
  /** The summary and the first page of every rail section (AUD-Q3). */
  readonly includeRail?: boolean;
}

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

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 *
 * The rail is composed only for a person the actor may read, after the
 * profile has found them, from the owning modules' reads in `rail`; a
 * composition without them answers every rail section as unavailable.
 */
export function createPersonProfile(dependencies: {
  readonly actors: ActorRevalidation;
  readonly rail?: PersonRailSources;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
      scope?: TransactionScope,
    ): Promise<T>;
  };
  readonly repository: PersonProfileRepository;
}) {
  const readable = async (actor: PersonProfileActor): Promise<boolean> =>
    await actorMayRead(dependencies, actor);
  const rail = dependencies.rail
    ? createPersonRail(dependencies.rail)
    : undefined;

  return {
    get: async (
      actor: PersonProfileActor,
      personId: string,
      options: PersonProfileReadOptions = {},
    ): Promise<GetPersonProfileResult> => {
      if (!await readable(actor)) return { status: "forbidden" };
      const includeSummary = options.includeSummary === true ||
        options.includeRail === true;
      const result = await dependencies.repository.get({
        ...actor,
        ...(includeSummary ? { includeSummary: true } : {}),
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
      const composed = options.includeRail
        ? rail ? await rail(actor, personId) : unavailableRail()
        : undefined;
      return {
        dueInformation: due,
        ...(result.genderOptions
          ? { genderOptions: result.genderOptions }
          : {}),
        person: {
          ...result.person,
          tagCount: tagsHidden ? 0 : result.person.tagCount,
          tags: tagsHidden
            ? []
            : result.person.tags.slice(0, PERSON_PROFILE_TAG_PREVIEW_LIMIT),
        },
        ...(composed ? { rail: composed } : {}),
        status: result.status,
        ...(includeSummary && result.summary
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
      await readable(actor)
        ? await dependencies.repository.listLifeEvents({ ...actor, personId })
        : { status: "forbidden" as const },
    ...createPersonTimeline(dependencies),
  };
}

/** The rail of a composition that was given no module reads. */
function unavailableRail(): PersonRail {
  const unavailable = { status: "unavailable" } as const;
  return {
    addresses: unavailable,
    "contact-methods": unavailable,
    "first-meeting": unavailable,
    "food-preferences": unavailable,
    "important-dates": unavailable,
    pets: unavailable,
    relationships: unavailable,
    reminders: unavailable,
    tags: unavailable,
    work: unavailable,
  };
}

export type PersonProfile = ReturnType<typeof createPersonProfile>;
