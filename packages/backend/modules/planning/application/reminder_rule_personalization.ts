export interface ReminderRulePersonalizationCommand {
  readonly action?: "create" | "delete" | "update";
  readonly daysBefore?: number;
  readonly expectedUpdatedAt?: string;
  readonly id?: string;
  readonly isActive?: boolean;
  readonly section: string;
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}

export interface ReminderRulePersonalizationFacade {
  inspect(command: ReminderRulePersonalizationCommand): Promise<unknown>;
  list(command: ReminderRulePersonalizationCommand): Promise<unknown>;
  mutate(command: ReminderRulePersonalizationCommand): Promise<unknown>;
}
