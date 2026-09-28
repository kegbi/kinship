export interface ExportContactMethod {
  readonly kind: "email" | "phone" | "other";
  readonly label: string;
  readonly value: string;
}

/** A remembered date, as the CSV export writes it (GAP-050). */
export interface ExportDate {
  readonly day?: number;
  readonly kind: string;
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
}

export interface ExportPerson {
  readonly archived?: boolean;
  readonly contactMethods: readonly ExportContactMethod[];
  readonly dates: readonly ExportDate[];
  readonly deletedAt?: string;
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

export interface PeopleExportBoundary {
  getPerson(command: {
    readonly actor: {
      readonly memberId: string;
      readonly role: "admin" | "member" | "owner";
      readonly userId: string;
      readonly workspaceId: string;
    };
    readonly personId: string;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<ExportPerson | undefined>;
  listWorkspace(command: {
    readonly actor: {
      readonly memberId: string;
      readonly role: "admin" | "member" | "owner";
      readonly userId: string;
      readonly workspaceId: string;
    };
    readonly transaction: { readonly opaque: unknown };
  }): Promise<readonly ExportPerson[]>;
}
