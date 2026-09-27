/**
 * What a settings surface needs before its first read (GAP-033): the active
 * workspace, the member's role in it, and, for a surface that shows
 * instants, the member's time preferences. It renders nothing.
 */

import type { SessionContext } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  loadTimePreferences,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";

export interface SettingsContext {
  readonly workspaceId: string;
  readonly role: SessionContext["member"]["role"];
  readonly timePreferences?: TimePreferences | undefined;
}

/**
 * Resolves the session, and the time preferences when `timePreferences` is
 * set; answers `undefined` when the session could not be confirmed.
 */
export async function resolveSettingsContext(
  options: { readonly timePreferences?: boolean } = {},
): Promise<SettingsContext | undefined> {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") return undefined;
  const workspaceId = session.session.workspace.id;
  const role = session.session.member.role;
  if (!options.timePreferences) return { role, workspaceId };
  return {
    role,
    timePreferences: await loadTimePreferences(workspaceId),
    workspaceId,
  };
}

/** Where a settings island sends the reader after an action ends the page. */
export type Navigate = (path: string) => void;

/** The browser's own navigation, which the islands use outside tests. */
export const browserNavigate: Navigate = (path) =>
  globalThis.location.assign(path);

/** Whether `role` manages workspace-wide settings. */
export function managesWorkspace(role: SettingsContext["role"]): boolean {
  return role === "owner" || role === "admin";
}
