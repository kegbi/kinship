import {
  getSession,
  type SessionContext,
} from "../../../../packages/contracts/generated/auth-client.ts";

export const ACTIVE_WORKSPACE_KEY = "kinship.active-workspace";
export const WORKSPACE_CHANGE_REQUEST_EVENT =
  "kinship:workspace-change-request";

export interface WorkspaceChangeRequestDetail {
  readonly fromWorkspaceId: string;
  readonly toWorkspaceId: string;
  onProceed(callback: () => void): void;
}

export interface WorkspaceChangeDecision {
  readonly allowed: boolean;
  proceed(): void;
}

export type WorkspaceSessionResolution =
  | { readonly status: "ready"; readonly session: SessionContext }
  | { readonly status: "access-lost" }
  | { readonly status: "unavailable" };

let activeResolution: Promise<WorkspaceSessionResolution> | undefined;

async function resolveWorkspaceSessionSelection(): Promise<
  WorkspaceSessionResolution
> {
  const savedWorkspace = sessionStorage.getItem(ACTIVE_WORKSPACE_KEY) ??
    undefined;
  let result = await getSession(savedWorkspace).catch(() => undefined);
  if (!result) return { status: "unavailable" };
  if (result.ok) return { status: "ready", session: result.value };
  if (result.problem.status !== 401) return { status: "unavailable" };
  if (savedWorkspace) {
    result = await getSession().catch(() => undefined);
    if (!result) return { status: "unavailable" };
    if (result.ok) {
      sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      return { status: "ready", session: result.value };
    }
    if (result.problem.status !== 401) return { status: "unavailable" };
  }
  return { status: "access-lost" };
}

export function resolveWorkspaceSession(): Promise<WorkspaceSessionResolution> {
  if (activeResolution) return activeResolution;
  activeResolution = resolveWorkspaceSessionSelection().finally(() => {
    activeResolution = undefined;
  });
  return activeResolution;
}

export function requestWorkspaceChange(
  fromWorkspaceId: string,
  toWorkspaceId: string,
): WorkspaceChangeDecision {
  const proceedCallbacks: Array<() => void> = [];
  const event = new CustomEvent<WorkspaceChangeRequestDetail>(
    WORKSPACE_CHANGE_REQUEST_EVENT,
    {
      cancelable: true,
      detail: {
        fromWorkspaceId,
        toWorkspaceId,
        onProceed(callback) {
          proceedCallbacks.push(callback);
        },
      },
    },
  );
  const allowed = globalThis.dispatchEvent(event);
  return {
    allowed,
    proceed() {
      if (!allowed) return;
      for (const callback of proceedCallbacks) callback();
    },
  };
}
