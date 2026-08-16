export interface PeoplePersonalizationTransaction {
  readonly opaque: unknown;
}

export interface TagPersonalizationCommand {
  readonly action?: "create" | "delete" | "update";
  readonly expectedUpdatedAt?: string;
  readonly id?: string;
  readonly isActive?: boolean;
  readonly isDefault?: boolean;
  readonly memberId: string;
  readonly name?: string;
  readonly replacementId?: string;
  readonly role: "admin" | "member" | "owner";
  readonly section: string;
  readonly sortOrder?: number;
  readonly transaction: PeoplePersonalizationTransaction;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface TagPersonalizationEntry {
  readonly capabilities: {
    readonly delete: boolean;
    readonly disable: boolean;
    readonly editValue: boolean;
    readonly rename: boolean;
    readonly reorder: boolean;
    readonly replace: boolean;
    readonly setDefault: boolean;
  };
  readonly canDelete: boolean;
  readonly id: string;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly kind: "named";
  readonly name: string;
  readonly readOnly: boolean;
  readonly referenceCount: number;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface TagPersonalizationFacade {
  inspect(command: TagPersonalizationCommand): Promise<unknown>;
  list(command: TagPersonalizationCommand): Promise<unknown>;
  mutate(command: TagPersonalizationCommand): Promise<unknown>;
}
