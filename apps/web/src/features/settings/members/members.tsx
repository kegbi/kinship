/**
 * The members page (GAP-033): inviting a member, the active members and
 * pending invitations, and the role controls an owner or admin may use.
 *
 * One read slot loads the lists and then the role controls. The invitation
 * form is wired from its first render: an invitation sent before the page
 * has loaded is held, never submitted natively (REL-041, which would put the
 * invitee's email in the URL), and sent once the lists are in. Each role
 * save, and each invitation revocation (SECT-04), holds only its own control,
 * and a revocation that lands refreshes the lists from the server.
 */

import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
} from "react";
import {
  createWorkspaceInvitation,
  getWorkspaceMembers,
  listManagedMembers,
  type ManagedMember,
  revokeWorkspaceInvitation,
  updateManagedMember,
  type WorkspaceMembers,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  badgeVariants,
  buttonVariants,
  cardVariants,
} from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { formatInstant } from "../../../lib/time-presentation.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { resolveSettingsContext } from "../shared/context.ts";
import {
  initialMembers,
  INVITATION_SENT,
  invitationRefusal,
  invitationSender,
  listWords,
  membersReducer,
  optionLabel,
  REVOCATION_FAILED,
} from "./members.ts";

export const MEMBERS_ISLAND = "settings-members";

interface Invitation {
  readonly email: string;
  readonly role: "admin" | "member";
}

export function MembersPage(props: { readonly onSettled?: () => void }) {
  const [state, dispatch] = useReducer(membersReducer, initialMembers);
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  // Where the first load stands for an invitation sent meanwhile: held while
  // it runs, sent once it is in, dropped when there is no session.
  const opened = useRef<"pending" | "ready" | "none">("pending");
  const held = useRef<Invitation | undefined>(undefined);
  const settled = useRef(props.onSettled);
  const form = useRef<HTMLFormElement>(null);

  /** Reads the lists, then the role controls; answers whether both landed. */
  const load = async (): Promise<boolean> => {
    const workspaceId = workspace.current!;
    const lists = await request(() => getWorkspaceMembers(workspaceId));
    if (!lists) return false;
    if (lists.status !== "ready" || !lists.data) {
      dispatch({ forbidden: lists.problem?.status === 403, type: "refused" });
      return false;
    }
    dispatch({ lists: lists.data, type: "loaded" });
    await manage();
    return true;
  };

  const manage = async (message?: string): Promise<void> => {
    const workspaceId = workspace.current!;
    const managed = await request(() => listManagedMembers(workspaceId));
    if (!managed) return;
    if (managed.status !== "ready" || !managed.data) {
      dispatch({
        message: managed.problem?.detail ??
          "Member administration is unavailable.",
        type: "managed",
      });
      return;
    }
    dispatch({
      members: managed.data.members,
      ...(message ? { message } : {}),
      type: "managed",
    });
  };

  const send = async (invitation: Invitation): Promise<void> => {
    const workspaceId = workspace.current!;
    const result = await settle(() =>
      createWorkspaceInvitation(invitation, workspaceId)
    );
    if (result.status !== "ready") {
      dispatch({ message: invitationRefusal(result.problem), type: "sent" });
      return;
    }
    form.current?.reset();
    dispatch({ message: INVITATION_SENT, type: "sent" });
    await load();
  };

  const first = useEffectEvent(async () => {
    const resolved = await resolveSettingsContext({ timePreferences: true });
    if (!resolved) {
      opened.current = "none";
      held.current = undefined;
      dispatch({ type: "no-session" });
      return;
    }
    workspace.current = resolved.workspaceId;
    dispatch({ timePreferences: resolved.timePreferences, type: "context" });
    await load();
    opened.current = "ready";
    const invitation = held.current;
    held.current = undefined;
    if (invitation) await send(invitation);
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  const invite = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.sending || opened.current === "none") return;
    const data = new FormData(event.currentTarget);
    const invitation: Invitation = {
      email: (data.get("email") as string).trim().toLowerCase(),
      role: data.get("role") === "admin" ? "admin" : "member",
    };
    dispatch({ type: "sending" });
    if (opened.current === "pending") held.current = invitation;
    else void send(invitation);
  };

  const save = async (member: ManagedMember, row: HTMLElement) => {
    const workspaceId = workspace.current!;
    const value = (name: string) =>
      row.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!.value;
    dispatch({ id: member.id, type: "saving" });
    const result = await settle(() =>
      updateManagedMember(member.id, {
        role: value("role") as ManagedMember["role"],
        status: value("status") as ManagedMember["status"],
      }, workspaceId)
    );
    if (result.status !== "ready") {
      dispatch({
        id: member.id,
        message: result.problem?.detail ?? "Member could not be updated.",
        type: "saved",
      });
      return;
    }
    const message = `${member.email} updated.`;
    dispatch({ id: member.id, message, type: "saved" });
    await manage(message);
  };

  const revoke = async (
    invitation: WorkspaceMembers["invitations"][number],
  ) => {
    const workspaceId = workspace.current!;
    dispatch({ id: invitation.id, type: "revoking" });
    const result = await settle(() =>
      revokeWorkspaceInvitation(invitation.id, workspaceId)
    );
    if (result.status !== "ready") {
      dispatch({
        id: invitation.id,
        message: result.problem?.detail ?? REVOCATION_FAILED,
        type: "revoked",
      });
      // Not pending any more — revoked or accepted elsewhere — so the row is
      // stale and the fresh list drops it.
      if (result.problem?.status === 404) await load();
      return;
    }
    dispatch({
      id: invitation.id,
      message: `Invitation for ${invitation.email} revoked.`,
      type: "revoked",
    });
    await load();
  };

  const words = listWords(state);
  const members = state.lists?.members ?? [];
  const invitations = state.lists?.invitations ?? [];
  const managed = state.managed ?? [];
  const { timePreferences } = state;
  const withdrawn = state.phase === "no-session" ||
    state.phase === "forbidden";

  return (
    <>
      <section
        aria-labelledby="invite-heading"
        className={cardVariants({ className: "member-section invite-panel" })}
      >
        <div className="section-heading">
          <div>
            <p className="section-kicker">Single-use access</p>
            <h2 id="invite-heading">Invite a member</h2>
          </div>
        </div>
        <p>
          The invitation is valid for seven days and can be accepted only by the
          invited email address.
        </p>
        <form
          className="invitation-form"
          hidden={withdrawn}
          id="invitation-form"
          method="post"
          noValidate
          onSubmit={invite}
          ref={form}
        >
          <label>
            Email address<input
              autoComplete="email"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </label>
          <label>
            Role<select name="role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button disabled={state.sending} type="submit">
            Send invitation
          </button>
        </form>
        <p
          aria-live="polite"
          className="inline-status"
          id="invitation-status"
          role="status"
        >
          {state.inviteStatus}
        </p>
      </section>

      <section
        aria-labelledby="active-members-heading"
        className={cardVariants({ className: "member-section" })}
      >
        <div className="section-heading">
          <h2 id="active-members-heading">Active members</h2>
          <span
            className={badgeVariants({ variant: "secondary" })}
            id="member-count"
          >
            {words.memberCount}
          </span>
        </div>
        <div
          aria-live="polite"
          className="list-state"
          hidden={state.phase === "ready" && members.length > 0}
          id="members-state"
          role="status"
        >
          {words.members}
        </div>
        <ul
          className="member-list"
          hidden={members.length === 0}
          id="member-list"
        >
          {members.map((member) => (
            <ListRow
              badge={member.role}
              key={member.id}
              primary={member.name || member.email}
              secondary={member.email}
            />
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="member-admin-heading"
        className={cardVariants({ className: "member-section" })}
      >
        <div className="section-heading">
          <h2 id="member-admin-heading">Member administration</h2>
          <span className={badgeVariants({ variant: "secondary" })}>
            Role-safe
          </span>
        </div>
        <p
          aria-live="polite"
          className="list-state"
          hidden={state.managedStatus === undefined}
          id="managed-state"
          role="status"
        >
          {state.managedStatus}
        </p>
        <ul
          className="member-list managed-list"
          hidden={managed.length === 0}
          id="managed-list"
        >
          {managed.map((member) => (
            <li key={`${member.id}:${member.role}:${member.status}`}>
              <span>
                <strong>{member.name || member.email}</strong>
              </span>
              <span className="member-controls">
                <select
                  aria-label={`Access level for ${member.email}`}
                  defaultValue={member.role}
                  name="role"
                >
                  {(["owner", "admin", "member"] as const).map((value) => (
                    <option key={value} value={value}>
                      {optionLabel(value)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Status for ${member.email}`}
                  defaultValue={member.status}
                  name="status"
                >
                  {(["active", "suspended"] as const).map((value) => (
                    <option key={value} value={value}>
                      {optionLabel(value)}
                    </option>
                  ))}
                </select>
                <button
                  className={buttonVariants()}
                  disabled={state.saving.includes(member.id)}
                  onClick={(event) =>
                    void save(member, event.currentTarget.closest("li")!)}
                  type="button"
                >
                  Save
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="pending-invitations-heading"
        className={cardVariants({ className: "member-section" })}
      >
        <div className="section-heading">
          <h2 id="pending-invitations-heading">Pending invitations</h2>
          <span
            className={badgeVariants({ variant: "secondary" })}
            id="invitation-count"
          >
            {words.invitationCount}
          </span>
        </div>
        <div
          aria-live="polite"
          className="list-state"
          hidden={state.phase === "ready" && invitations.length > 0}
          id="pending-state"
          role="status"
        >
          {words.pending}
        </div>
        <p
          aria-live="polite"
          className="list-state"
          hidden={state.pendingStatus === ""}
          id="pending-status"
          role="status"
        >
          {state.pendingStatus}
        </p>
        <ul
          className="member-list"
          hidden={invitations.length === 0}
          id="pending-list"
        >
          {invitations.map((invitation) => (
            <ListRow
              badge={invitation.role}
              key={invitation.id}
              primary={invitation.email}
              secondary={`${invitationSender(invitation)} · Expires ${
                formatInstant(invitation.expiresAt, timePreferences)
              }`}
            >
              <button
                aria-label={`Revoke invitation for ${invitation.email}`}
                className={buttonVariants({ variant: "outline" })}
                disabled={state.revoking.includes(invitation.id)}
                onClick={() => void revoke(invitation)}
                type="button"
              >
                Revoke
              </button>
            </ListRow>
          ))}
        </ul>
      </section>
    </>
  );
}

function ListRow(
  props: {
    readonly primary: string;
    readonly secondary: string;
    readonly badge: string;
    readonly children?: ReactNode;
  },
) {
  const badge = <span className="role-badge">{props.badge}</span>;
  return (
    <li>
      <span>
        <strong>{props.primary}</strong>
        <small>{props.secondary}</small>
      </span>
      {props.children
        ? (
          <span className="member-controls">
            {badge}
            {props.children}
          </span>
        )
        : badge}
    </li>
  );
}

/** Mounts the members page over the region `members.astro` drew. */
export function mountMembersPage(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-settings-members]",
    MEMBERS_ISLAND,
    (onSettled) => <MembersPage onSettled={onSettled} />,
  );
}
