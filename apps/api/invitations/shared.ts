/**
 * What more than one step of the invitation flow needs.
 *
 * GAP-021 split the flow into the three things that happen to an invitation:
 * an owner creates one, an invitee registers against it, and somebody accepts
 * it. Three things cross those steps — the bundle `composition.ts` builds
 * once, the path the invitation routes are rooted at, and the cookie the
 * token travels in between them — and they live here.
 *
 * The cookie is scoped to the invitation path and nothing wider, so a token
 * that is still in flight is never sent to a route that has no business
 * reading it.
 */

import { type Context } from "hono";
import type { createWorkspaceInvitationCoordinator } from "../../../packages/backend/modules/workspaces/public.ts";
import type { createProtectedSessionCoordinator } from "../../../packages/backend/modules/workspaces/public.ts";
import type { PasswordHasher } from "../../../packages/backend/modules/identity/public.ts";
import type { BrowserSecurityPolicy } from "../security_config.ts";
import { cookieValue } from "../http/cookies.ts";

type Invitations = ReturnType<typeof createWorkspaceInvitationCoordinator>;
type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface InvitationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly hasher: PasswordHasher;
  readonly invitations: Invitations;
  readonly protectedSessions: ProtectedSessions;
}

/** The cookie the invitation token travels in, and the path it is scoped to. */
export const INVITATION_COOKIE = "kinship_invitation";
export const INVITATION_PATH = "/api/v1/workspace-invitations";
/** A day for the invitation itself. */
export const INVITATION_COOKIE_SECONDS = 24 * 60 * 60;

/** The invitation token this request carries in its cookie. */
export function invitationToken(context: Context): string | undefined {
  return cookieValue(context.req.header("Cookie"), INVITATION_COOKIE);
}
