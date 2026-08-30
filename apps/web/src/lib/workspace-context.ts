import {
  consumeApplicationEntry,
  getSession,
  type MemberUiState,
  type SessionContext,
} from "../../../../packages/contracts/generated/auth-client.ts";

export const ACTIVE_WORKSPACE_KEY = "kinship.active-workspace";
export const SESSION_CACHE_KEY = "kinship.session";
const SESSION_CACHE_TTL_MS = 60_000;
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
  | {
    readonly status: "ready";
    readonly session: SessionContext;
    readonly entryFirstName?: string;
  }
  | { readonly status: "access-lost" }
  | { readonly status: "unavailable" };

let activeResolution: Promise<WorkspaceSessionResolution> | undefined;
let activeRevalidation:
  | Promise<WorkspaceSessionResolution | undefined>
  | undefined;
let completedRevalidation: WorkspaceSessionResolution | undefined;
// This is a cross-document accelerator, not a same-document memo:
// optimisticSession serves concurrent startup consumers during revalidation,
// while later resolutions in a long-lived document make a real round trip.
let optimisticSession: SessionContext | undefined;
let sessionCacheChecked = false;

interface SessionCacheEntry {
  readonly savedAt: number;
  readonly session: SessionContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkspace(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" &&
    typeof value.name === "string";
}

function isSessionCacheEntry(value: unknown): value is SessionCacheEntry {
  if (
    !isRecord(value) || typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt) ||
    !isRecord(value.session)
  ) return false;
  const session = value.session;
  return session.status === "authenticated" &&
    isRecord(session.principal) &&
    typeof session.principal.userId === "string" &&
    isWorkspace(session.workspace) &&
    isRecord(session.member) &&
    typeof session.member.id === "string" &&
    (session.member.role === "owner" || session.member.role === "admin" ||
      session.member.role === "member") &&
    Array.isArray(session.workspaces) &&
    session.workspaces.every(isWorkspace) &&
    (session.requiredLegalDocuments === undefined ||
      Array.isArray(session.requiredLegalDocuments));
}

function isCurrentSessionCacheEntry(
  value: unknown,
): value is SessionCacheEntry {
  if (!isSessionCacheEntry(value)) return false;
  const age = Date.now() - value.savedAt;
  const activeWorkspace = sessionStorage.getItem(ACTIVE_WORKSPACE_KEY);
  return age >= 0 && age < SESSION_CACHE_TTL_MS &&
    (activeWorkspace === null ||
      activeWorkspace === value.session.workspace.id);
}

function readSessionCache(): SessionCacheEntry | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return undefined;
    const entry: unknown = JSON.parse(raw);
    if (!isCurrentSessionCacheEntry(entry)) {
      clearSessionCache();
      return undefined;
    }
    return entry;
  } catch {
    clearSessionCache();
    return undefined;
  }
}

function writeSessionCache(session: SessionContext): void {
  try {
    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), session }),
    );
  } catch {
    // Storage can be full or disabled without preventing session resolution.
  }
}

export function updateCachedSessionUiState(uiState: MemberUiState): void {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return;
    const entry: unknown = JSON.parse(raw);
    if (!isCurrentSessionCacheEntry(entry)) return;
    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({
        savedAt: entry.savedAt,
        session: { ...entry.session, uiState },
      }),
    );
  } catch {
    // Disabled storage degrades to an unchanged cached session.
  }
}

export function clearSessionCache(): void {
  completedRevalidation = undefined;
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // Disabled storage degrades to uncached session resolution.
  }
}

export function setActiveWorkspace(workspaceId: string): void {
  sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
  clearSessionCache();
}

export function clearActiveWorkspace(): void {
  sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  clearSessionCache();
}

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
      clearActiveWorkspace();
      return { status: "ready", session: result.value };
    }
    if (result.problem.status !== 401) return { status: "unavailable" };
  }
  const entry = await consumeApplicationEntry().catch(() => undefined);
  if (!entry) return { status: "unavailable" };
  if (!entry.ok) {
    return entry.problem.status >= 500
      ? { status: "unavailable" }
      : { status: "access-lost" };
  }
  const entered = await getSession().catch(() => undefined);
  if (!entered) return { status: "unavailable" };
  if (!entered.ok) {
    return entered.problem.status >= 500
      ? { status: "unavailable" }
      : { status: "access-lost" };
  }
  if (savedWorkspace) clearActiveWorkspace();
  return {
    entryFirstName: entry.value.member.firstName,
    session: entered.value,
    status: "ready",
  };
}

async function revalidateSession(
  cachedSession: SessionContext,
): Promise<WorkspaceSessionResolution | undefined> {
  const resolution = await resolveWorkspaceSessionSelection();
  if (resolution.status === "unavailable") return undefined;
  if (resolution.status === "access-lost") {
    clearSessionCache();
    return resolution;
  }
  writeSessionCache(resolution.session);
  return JSON.stringify(resolution.session) === JSON.stringify(cachedSession)
    ? undefined
    : { session: resolution.session, status: "ready" };
}

function startSessionRevalidation(cachedSession: SessionContext): void {
  if (activeRevalidation) return;
  completedRevalidation = undefined;
  optimisticSession = cachedSession;
  const revalidation = revalidateSession(cachedSession);
  activeRevalidation = revalidation;
  void revalidation.then((resolution) => {
    completedRevalidation = resolution;
  }).finally(() => {
    if (activeRevalidation === revalidation) {
      activeRevalidation = undefined;
      optimisticSession = undefined;
    }
  });
}

export function resolveWorkspaceSession(): Promise<WorkspaceSessionResolution> {
  if (activeResolution) return activeResolution;
  if (activeRevalidation && optimisticSession) {
    return Promise.resolve({ session: optimisticSession, status: "ready" });
  }
  if (!sessionCacheChecked) {
    sessionCacheChecked = true;
    const cached = readSessionCache();
    if (cached) {
      startSessionRevalidation(cached.session);
      return Promise.resolve({ session: cached.session, status: "ready" });
    }
  }
  completedRevalidation = undefined;
  activeResolution = resolveWorkspaceSessionSelection().then((resolution) => {
    if (resolution.status === "ready") writeSessionCache(resolution.session);
    return resolution;
  }).finally(() => {
    activeResolution = undefined;
  });
  return activeResolution;
}

export function onSessionRevalidated(
  handler: (resolution: WorkspaceSessionResolution) => void,
): void {
  if (activeRevalidation) {
    void activeRevalidation.then((resolution) => {
      if (resolution) handler(resolution);
    });
    return;
  }
  const resolution = completedRevalidation;
  if (resolution) queueMicrotask(() => handler(resolution));
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
