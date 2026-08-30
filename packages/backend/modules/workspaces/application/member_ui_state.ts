export type PersonWorkspaceView =
  | "all"
  | "timeline"
  | "planning"
  | "things"
  | "admin";

export interface MemberUiState {
  readonly personWorkspaceView?: PersonWorkspaceView;
}

export interface MemberUiStateActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface MemberUiStateTransaction {
  readonly opaque: unknown;
}

type StoredUiState = Readonly<Record<string, unknown>>;

export interface MemberUiStateRepository {
  read(
    command: MemberUiStateActor & {
      readonly transaction: MemberUiStateTransaction;
    },
  ): Promise<
    | { readonly status: "forbidden" }
    | { readonly status: "ready"; readonly uiState: unknown }
  >;
  lock(
    command: MemberUiStateActor & {
      readonly transaction: MemberUiStateTransaction;
    },
  ): Promise<
    | { readonly status: "forbidden" }
    | { readonly status: "ready"; readonly uiState: unknown }
  >;
  save(
    command: MemberUiStateActor & {
      readonly transaction: MemberUiStateTransaction;
      readonly uiState: StoredUiState;
    },
  ): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isPersonWorkspaceView(value: unknown): value is PersonWorkspaceView {
  return value === "all" || value === "timeline" || value === "planning" ||
    value === "things" || value === "admin";
}

function projection(value: unknown): MemberUiState {
  const stored = decoded(value);
  if (!isRecord(stored) || !isPersonWorkspaceView(stored.personWorkspaceView)) {
    return {};
  }
  return { personWorkspaceView: stored.personWorkspaceView };
}

function validInput(value: unknown): value is MemberUiState {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => key !== "personWorkspaceView")) {
    return false;
  }
  return value.personWorkspaceView === undefined ||
    isPersonWorkspaceView(value.personWorkspaceView);
}

export function createMemberUiStateManagement(dependencies: {
  readonly repository: MemberUiStateRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: MemberUiStateTransaction) => Promise<T>,
    ): Promise<T>;
  };
}) {
  return {
    async read(actor: MemberUiStateActor) {
      return await dependencies.transaction.run(async (transaction) => {
        const result = await dependencies.repository.read({
          ...actor,
          transaction,
        });
        return result.status === "ready"
          ? { status: "ready" as const, uiState: projection(result.uiState) }
          : result;
      });
    },

    async save(actor: MemberUiStateActor, input: MemberUiState) {
      if (!validInput(input)) return { status: "forbidden" as const };
      return await dependencies.transaction.run(async (transaction) => {
        const locked = await dependencies.repository.lock({
          ...actor,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        const decodedState = decoded(locked.uiState);
        const stored = isRecord(decodedState) ? decodedState : {};
        const uiState = input.personWorkspaceView === undefined
          ? stored
          : { ...stored, personWorkspaceView: input.personWorkspaceView };
        return await dependencies.repository.save({
            ...actor,
            transaction,
            uiState,
          })
          ? { status: "ready" as const, uiState: projection(uiState) }
          : { status: "forbidden" as const };
      });
    },
  };
}

export type MemberUiStateManagement = ReturnType<
  typeof createMemberUiStateManagement
>;
