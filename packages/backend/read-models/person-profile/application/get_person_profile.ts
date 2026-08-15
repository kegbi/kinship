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
  readonly middleName?: string;
  readonly nickname?: string;
  readonly tagCount: number;
  readonly tags: readonly PersonProfileTag[];
}

export interface PersonDueInformation {
  readonly detail: string;
  readonly status: "unavailable";
}

export type PersonProfileRepositoryResult =
  | { readonly person: PersonProfileIdentity; readonly status: "ready" }
  | { readonly person: PersonProfileIdentity; readonly status: "archived" }
  | { readonly status: "not-found" }
  | { readonly status: "forbidden" };

export interface PersonProfileRepository {
  get(
    command: PersonProfileActor & { readonly personId: string },
  ): Promise<PersonProfileRepositoryResult>;
}

export type GetPersonProfileResult =
  | {
    readonly dueInformation: PersonDueInformation;
    readonly person: PersonProfileIdentity;
    readonly status: "ready" | "archived";
  }
  | { readonly status: "not-found" }
  | { readonly status: "forbidden" };

const unavailableDueInformation: PersonDueInformation = {
  detail:
    "Due information will become available when planning and reminders are delivered.",
  status: "unavailable",
};

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
      return {
        dueInformation: unavailableDueInformation,
        person: {
          ...result.person,
          tags: result.person.tags.slice(0, PERSON_PROFILE_TAG_PREVIEW_LIMIT),
        },
        status: result.status,
      };
    },
  };
}

export type PersonProfile = ReturnType<typeof createPersonProfile>;
