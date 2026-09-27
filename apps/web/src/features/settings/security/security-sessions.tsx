/**
 * The member's active sessions (GAP-033), each revocable. Revoking the
 * current session signs the member out at once; revoking another refreshes
 * the list. One read slot owns the list; each revocation holds only its own
 * control.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  listMemberSessions,
  revokeMemberSession,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { badgeVariants, buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { formatInstant } from "../../../lib/time-presentation.ts";
import {
  mountSettingsSurface,
  SESSION_UNCONFIRMED,
} from "../form/settings-form.tsx";
import {
  browserNavigate,
  type Navigate,
  resolveSettingsContext,
} from "../shared/context.ts";
import {
  initialSessions,
  sessionDetail,
  sessionsReducer,
} from "./security-sessions.ts";

export const SECURITY_SESSIONS_ISLAND = "settings-security";

export function SecuritySessions(
  props: { readonly navigate: Navigate; readonly onSettled?: () => void },
) {
  const [state, dispatch] = useReducer(sessionsReducer, initialSessions);
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const settled = useRef(props.onSettled);
  const { navigate } = props;

  const load = async () => {
    const workspaceId = workspace.current!;
    const answer = await request(() => listMemberSessions(workspaceId));
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        message: "Your sessions could not be loaded.",
        type: "status",
      });
      return;
    }
    dispatch({ sessions: answer.data.sessions, type: "loaded" });
  };

  const first = useEffectEvent(async () => {
    const resolved = await resolveSettingsContext({ timePreferences: true });
    if (!resolved) {
      dispatch({ message: SESSION_UNCONFIRMED, type: "status" });
      return;
    }
    workspace.current = resolved.workspaceId;
    dispatch({ timePreferences: resolved.timePreferences, type: "context" });
    await load();
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  const revoke = async (id: string) => {
    const workspaceId = workspace.current!;
    if (state.revoking.includes(id)) return;
    dispatch({ id, type: "revoking" });
    const result = await settle(() => revokeMemberSession(id, workspaceId));
    if (result.status !== "ready" || !result.data) {
      dispatch({
        id,
        message: result.problem?.detail ?? "Session could not be revoked.",
        type: "revoked",
      });
      return;
    }
    if (result.data.current) {
      navigate("/auth/sign-in");
      return;
    }
    dispatch({ id, message: "Session revoked.", type: "revoked" });
    await load();
  };

  const { sessions } = state;
  return (
    <>
      <div className="section-heading">
        <h2>Active sessions</h2>
        <span
          className={badgeVariants({ variant: "secondary" })}
          id="session-count"
        >
          {sessions ? `${sessions.length} active` : "Loading…"}
        </span>
      </div>
      <p aria-live="polite" id="settings-status" role="status">
        {state.status}
      </p>
      <ul className="member-list" id="session-list">
        {sessions?.map((session) => (
          <li key={session.id}>
            <span>
              <strong>
                {session.current
                  ? "This session"
                  : session.userAgent ?? "Browser session"}
              </strong>
              <small>
                {sessionDetail(
                  session,
                  formatInstant(session.lastSeenAt, state.timePreferences),
                )}
              </small>
            </span>
            <button
              className={buttonVariants()}
              disabled={state.revoking.includes(session.id)}
              onClick={() => void revoke(session.id)}
              type="button"
            >
              {session.current ? "Revoke and sign out" : "Revoke"}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Mounts the sessions list over the section `security.astro` drew. */
export function mountSecuritySettings(
  root: ParentNode = document,
  navigate: Navigate = browserNavigate,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-settings-security]",
    SECURITY_SESSIONS_ISLAND,
    (onSettled) => (
      <SecuritySessions navigate={navigate} onSettled={onSettled} />
    ),
  );
}
