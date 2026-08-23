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

export interface PeopleImportBoundary {
  create(command: {
    readonly actor: PeopleImportActor;
    readonly occurredAt: Date;
    readonly person: ImportedPerson;
    readonly transaction: PeopleImportTransaction;
  }): Promise<void>;
  exists(command: {
    readonly actor: PeopleImportActor;
    readonly personId: string;
    readonly transaction: PeopleImportTransaction;
  }): Promise<boolean>;
  linkAvatar(command: {
    readonly actor: PeopleImportActor;
    readonly fileId: string;
    readonly personId: string;
    readonly transaction: PeopleImportTransaction;
  }): Promise<void>;
}
