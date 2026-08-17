export interface InteractionWorkspaceTransaction {
  readonly opaque: unknown;
}

export interface InteractionWorkspaceActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface WorkspaceInteractionOption {
  readonly id: string;
  readonly name: string;
}

export interface InteractionWorkspaceBoundary {
  authorize(
    command: InteractionWorkspaceActor & {
      readonly transaction: InteractionWorkspaceTransaction;
    },
  ): Promise<{ readonly status: "forbidden" | "ready" }>;
  describe(
    command: {
      readonly activityTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly transaction: InteractionWorkspaceTransaction;
      readonly workspaceId: string;
    },
  ): Promise<{
    readonly activityType?: WorkspaceInteractionOption;
    readonly emotions: readonly WorkspaceInteractionOption[];
  }>;
  describeCommunication(
    command: {
      readonly channelTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly transaction: InteractionWorkspaceTransaction;
      readonly workspaceId: string;
    },
  ): Promise<{
    readonly channelType?: WorkspaceInteractionOption;
    readonly emotions: readonly WorkspaceInteractionOption[];
  }>;
  describeCommunicationReferences(
    command: {
      readonly channelTypeIds: readonly string[];
      readonly emotionIds: readonly string[];
      readonly transaction: InteractionWorkspaceTransaction;
      readonly workspaceId: string;
    },
  ): Promise<{
    readonly channelTypes: readonly WorkspaceInteractionOption[];
    readonly emotions: readonly WorkspaceInteractionOption[];
  }>;
  inspect(
    command: InteractionWorkspaceActor & {
      readonly activityTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly kind: "activity" | "note";
      readonly lock: boolean;
      readonly transaction: InteractionWorkspaceTransaction;
    },
  ): Promise<
    | {
      readonly activityType?: WorkspaceInteractionOption;
      readonly emotions: readonly WorkspaceInteractionOption[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" | "hidden" | "not-found" }
  >;
  options(
    command: InteractionWorkspaceActor & {
      readonly activityTypeCursor?: string;
      readonly activityTypeSearch?: string;
      readonly emotionCursor?: string;
      readonly emotionSearch?: string;
      readonly limit: number;
      readonly transaction: InteractionWorkspaceTransaction;
    },
  ): Promise<
    | {
      readonly activityTypes: readonly WorkspaceInteractionOption[];
      readonly activityTypesNextCursor?: string;
      readonly availability: {
        readonly activity: boolean;
        readonly note: boolean;
      };
      readonly emotions: readonly WorkspaceInteractionOption[];
      readonly emotionsNextCursor?: string;
      readonly status: "ready";
    }
    | { readonly status: "forbidden" | "stale-cursor" }
  >;
  inspectCommunication(
    command: InteractionWorkspaceActor & {
      readonly channelTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly kind: "call" | "conversation";
      readonly lock: boolean;
      readonly transaction: InteractionWorkspaceTransaction;
    },
  ): Promise<
    | {
      readonly channelType?: WorkspaceInteractionOption;
      readonly emotions: readonly WorkspaceInteractionOption[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" | "hidden" | "not-found" }
  >;
  communicationOptions(
    command: InteractionWorkspaceActor & {
      readonly transaction: InteractionWorkspaceTransaction;
    },
  ): Promise<
    | {
      readonly availability: {
        readonly call: boolean;
        readonly conversation: boolean;
      };
      readonly channelTypes: readonly WorkspaceInteractionOption[];
      readonly emotions: readonly WorkspaceInteractionOption[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" }
  >;
}
