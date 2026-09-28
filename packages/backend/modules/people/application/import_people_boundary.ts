export interface PeopleImportActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface PeopleImportTransaction {
  readonly opaque: unknown;
}

export interface ImportedPerson {
  readonly archived: boolean;
  /**
   * The avatar presentation the source carried (GAP-045): a colour, and a
   * provider URL with its source. A file avatar is linked separately.
   */
  readonly avatar?: {
    readonly backgroundColor?: string;
    readonly externalUrl?: string;
    readonly source?: "default" | "external" | "gravatar";
  };
  readonly deletedAt?: Date;
  readonly description?: string;
  readonly familyName?: string;
  readonly foodPreferences?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isDeceased: boolean;
  readonly isPartial: boolean;
  readonly isStarred: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

/**
 * What a vCard or CSV contact adds to the person it creates (GAP-050): the
 * people-owned rows beside the person, each written through the same
 * repositories and validated by the same rules the profile editors use.
 */
export interface ImportedPersonDetails {
  readonly addresses: readonly {
    readonly city?: string;
    readonly country?: string;
    readonly postalCode?: string;
    readonly region?: string;
    readonly street?: string;
  }[];
  /** Contact methods whose type the importer resolved in the workspace. */
  readonly contactMethods: readonly {
    readonly typeId: string;
    readonly value: string;
  }[];
  readonly dates: readonly {
    readonly day?: number;
    readonly kind: "birthday" | "custom" | "deceased";
    readonly label?: string;
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
  }[];
  readonly occupation?: {
    readonly organizationName?: string;
    readonly title: string;
  };
}

/** Where an earlier import's person stands, as `presence` answers. */
export type PersonImportPresence = "absent" | "active" | "deleted";

export interface PeopleImportBoundary {
  /**
   * Writes a newly imported person's contact methods, addresses, dates, and
   * occupation, in the commit's transaction. A value the people rules refuse
   * fails the whole commit rather than being half written.
   */
  addDetails(command: {
    readonly actor: PeopleImportActor;
    readonly details: ImportedPersonDetails;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: PeopleImportTransaction;
  }): Promise<void>;
  create(command: {
    readonly actor: PeopleImportActor;
    readonly occurredAt: Date;
    readonly person: ImportedPerson;
    readonly transaction: PeopleImportTransaction;
  }): Promise<void>;
  /**
   * Where a person an earlier import made stands in the workspace (REL-065):
   * `absent` when there is no such row, `deleted` when a member deleted them,
   * and `active` otherwise, archived included. An import reuses an active
   * person, makes an absent one again, and leaves a deleted one deleted.
   */
  presence(command: {
    readonly actor: PeopleImportActor;
    readonly personId: string;
    readonly transaction: PeopleImportTransaction;
  }): Promise<PersonImportPresence>;
  linkAvatar(command: {
    readonly actor: PeopleImportActor;
    readonly fileId: string;
    readonly personId: string;
    readonly transaction: PeopleImportTransaction;
  }): Promise<void>;
}
