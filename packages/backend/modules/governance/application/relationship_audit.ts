export interface GovernanceRelationshipTransaction {
  readonly opaque: unknown;
}

export interface GovernanceRelationshipActor {
  readonly memberId: string;
  readonly workspaceId: string;
}

export interface GovernanceRelationshipRecord {
  readonly fromPersonId: string;
  readonly id: string;
  readonly relationshipTypeId: string;
  readonly toPersonId: string;
}

export interface RelationshipAuditCommand {
  readonly action: "create" | "delete" | "update";
  readonly actor: GovernanceRelationshipActor;
  readonly after?: GovernanceRelationshipRecord;
  readonly before?: GovernanceRelationshipRecord;
  readonly occurredAt: Date;
  readonly transaction: GovernanceRelationshipTransaction;
}

export interface RelationshipAudit {
  record(command: RelationshipAuditCommand): Promise<string>;
  assertPostcondition(
    command: RelationshipAuditCommand & { readonly auditId: string },
  ): Promise<void>;
}
