import {
  consumeApplicationEntry,
  getSession,
  type MemberUiState,
  type ResolvedMemberPreferences,
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
/**
 * The session this document resolved (FEQ-03, AUD-F3). Every later caller of
 * the document gets it, so an island whose chunk arrives after the first read
 * settled reads nothing; `sessionStorage` carries it to the next document.
 * It keeps the storage entry's lifetime and dies with the document: only
 * `clearSessionCache` (sign-out, a workspace switch, lost access) or its age
 * sends a caller back to the network.
 */
let documentSession: SessionCacheEntry | undefined;
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
      Array.isArray(session.requiredLegalDocuments)) &&
    // An entry without preferences was written before the session carried
    // them, or when they could not be read: the page reads them afresh.
    isRecord(session.preferences) &&
    typeof session.preferences.locale === "string" &&
    typeof session.preferences.effectiveTimezone === "string";
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

/**
 * The document's session while it is young, or while its revalidation is on
 * the wire, and while its workspace is the selected one.
 */
function currentDocumentSession(): SessionCacheEntry | undefined {
  const entry = documentSession;
  if (!entry) return undefined;
  const age = Date.now() - entry.savedAt;
  const activeWorkspace = readActiveWorkspace();
  if (
    (activeRevalidation !== undefined ||
      age >= 0 && age < SESSION_CACHE_TTL_MS) &&
    (activeWorkspace === undefined ||
      activeWorkspace === entry.session.workspace.id)
  ) return entry;
  documentSession = undefined;
  return undefined;
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
    // Use the accelerator only if cleanup and writes work. An undeletable
    // entry may belong to a previous identity whose sign-out could not clear
    // storage. Restore the same age so an offline revalidation keeps its TTL.
    sessionStorage.removeItem(SESSION_CACHE_KEY);
    sessionStorage.setItem(SESSION_CACHE_KEY, raw);
    return entry;
  } catch {
    clearSessionCache();
    return undefined;
  }
}

function writeSessionCache(session: SessionContext): void {
  documentSession = { savedAt: Date.now(), session };
  try {
    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), session }),
    );
  } catch {
    // Storage can be full or disabled without preventing session resolution.
  }
}

/**
 * Applies a saved change to the document's session and to the stored one,
 * without refreshing either's age; with a `workspaceId`, only to a session of
 * that workspace.
 */
function updateCachedSession(
  workspaceId: string | undefined,
  change: (session: SessionContext) => SessionContext,
): void {
  const belongs = (session: SessionContext): boolean =>
    workspaceId === undefined || session.workspace.id === workspaceId;
  const remembered = currentDocumentSession();
  if (remembered && belongs(remembered.session)) {
    documentSession = {
      savedAt: remembered.savedAt,
      session: change(remembered.session),
    };
  }
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return;
    const entry: unknown = JSON.parse(raw);
    if (!isCurrentSessionCacheEntry(entry) || !belongs(entry.session)) return;
    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({
        savedAt: entry.savedAt,
        session: change(entry.session),
      }),
    );
  } catch {
    // Disabled storage degrades to an unchanged cached session.
  }
}

export function updateCachedSessionUiState(uiState: MemberUiState): void {
  updateCachedSession(undefined, (session) => ({ ...session, uiState }));
}

/**
 * Replaces the preferences the session carries once the member saved them in
 * `workspaceId` (AUD-F3); a session of another workspace keeps its own.
 */
export function updateCachedSessionPreferences(
  workspaceId: string,
  preferences: ResolvedMemberPreferences,
): void {
  updateCachedSession(workspaceId, (session) => ({ ...session, preferences }));
}

export function clearSessionCache(): void {
  completedRevalidation = undefined;
  documentSession = undefined;
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // Disabled storage degrades to uncached session resolution.
  }
}

export function readActiveWorkspace(): string | undefined {
  try {
    return sessionStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? undefined;
  } catch {
    // The API can resolve the default workspace without a browser preference.
    return undefined;
  }
}

export function setActiveWorkspace(workspaceId: string): boolean {
  try {
    // A writable preference is useless if the next page cannot read it.
    sessionStorage.getItem(ACTIVE_WORKSPACE_KEY);
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    clearSessionCache();
    return true;
  } catch {
    return false;
  }
}

export function clearActiveWorkspace(): void {
  try {
    sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    // Failed preference cleanup must not interrupt server-confirmed sign-out.
  }
  clearSessionCache();
}

async function resolveWorkspaceSessionSelection(
  savedWorkspace = readActiveWorkspace(),
): Promise<
  WorkspaceSessionResolution
> {
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
  const resolution = await resolveWorkspaceSessionSelection(
    cachedSession.workspace.id,
  );
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
  const revalidation = revalidateSession(cachedSession);
  activeRevalidation = revalidation;
  void revalidation.then((resolution) => {
    completedRevalidation = resolution;
  }).finally(() => {
    if (activeRevalidation === revalidation) activeRevalidation = undefined;
  });
}

export function resolveWorkspaceSession(): Promise<WorkspaceSessionResolution> {
  if (activeResolution) return activeResolution;
  const remembered = currentDocumentSession();
  if (remembered) {
    return Promise.resolve({ session: remembered.session, status: "ready" });
  }
  if (!sessionCacheChecked) {
    sessionCacheChecked = true;
    const cached = readSessionCache();
    if (cached) {
      // The stored entry serves the document while it is revalidated.
      documentSession = cached;
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
