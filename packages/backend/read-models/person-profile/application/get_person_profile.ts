export const PERSON_PROFILE_TAG_PREVIEW_LIMIT = 8;

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
  readonly id:
    | "activities"
    | "addresses"
    | "contact-methods"
    | "calls"
    | "conversations"
    | "first-meeting"
    | "food-preferences"
    | "life-events"
    | "notes"
    | "pets"
    | "relationships"
    | "tasks"
    | "tags"
    | "work";
  readonly status: "hidden" | "ready";
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

export interface PersonLifeEvent {
  readonly date: {
    readonly day?: number;
    readonly happenedAt?: string;
    readonly month?: number;
    readonly precision:
      | "day"
      | "full"
      | "month"
      | "month_day"
      | "unknown"
      | "year"
      | "year_month";
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
  }
  | {
    readonly dueInformation: PersonDueProjection;
    readonly person: PersonProfileIdentity;
    readonly status: "archived";
  }
  | { readonly status: "not-found" }
  | { readonly status: "forbidden" };

export interface PersonProfileRepository {
  get(
    command: PersonProfileActor & { readonly personId: string },
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

export function createPersonProfile(dependencies: {
  readonly repository: PersonProfileRepository;
}) {
  return {
    get: async (
      actor: PersonProfileActor,
      personId: string,
    ): Promise<GetPersonProfileResult> => {
      const result = await dependencies.repository.get({ ...actor, personId });
      if (result.status !== "ready" && result.status !== "archived") {
        return result;
      }
      const tagsHidden =
        result.person.profileSections?.some((section) =>
          section.id === "tags" && section.status === "hidden"
        ) === true;
      return {
        dueInformation: dueInformation(result.dueInformation),
        person: {
          ...result.person,
          tagCount: tagsHidden ? 0 : result.person.tagCount,
          tags: tagsHidden
            ? []
            : result.person.tags.slice(0, PERSON_PROFILE_TAG_PREVIEW_LIMIT),
        },
        status: result.status,
      };
    },
    listLifeEvents: async (actor: PersonProfileActor, personId: string) =>
      await dependencies.repository.listLifeEvents({ ...actor, personId }),
  };
}

export type PersonProfile = ReturnType<typeof createPersonProfile>;
