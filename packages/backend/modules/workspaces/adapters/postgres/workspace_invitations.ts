import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  InvitationAcceptance,
  InvitationInspection,
  WorkspaceInvitationRecord,
  WorkspaceInvitationRepository,
  WorkspaceMemberRecord,
} from "../../application/invite_member.ts";

export class PostgresWorkspaceInvitations
  implements WorkspaceInvitationRepository {
  async create(
    command: Parameters<WorkspaceInvitationRepository["create"]>[0],
  ): Promise<"created" | "already-member" | "forbidden"> {
    const database = databaseFromSession(command.transaction);
    const authorized = await sql<{ readonly authorized: boolean }>`
      select true as authorized
      from crm.workspace_members wm
      join crm.workspaces w on w.id = wm.workspace_id
      where wm.id = ${command.actor.memberId}::uuid
        and wm.user_id = ${command.actor.userId}::uuid
        and wm.workspace_id = ${command.actor.workspaceId}::uuid
        and wm.role in ('owner', 'admin') and wm.status = 'active'
        and wm.left_at is null and w.status = 'active' and w.deleted_at is null
      limit 1 for share of wm, w
    `.execute(database);
    if (authorized.rows[0]?.authorized !== true) return "forbidden";
    await sql`
      select pg_advisory_xact_lock(hashtextextended(
        ${command.actor.workspaceId}::text || ':' || lower(${command.email}::text), 0
      ))
    `.execute(database);
    await sql`
      select id
      from crm.workspace_invitations
      where workspace_id = ${command.actor.workspaceId}::uuid
        and email = ${command.email} and status = 'pending'
      order by id
      for update
    `.execute(database);
    if (command.existingUserId) {
      const existing = await sql<{ readonly present: boolean }>`
        select exists (
          select 1 from crm.workspace_members
          where workspace_id = ${command.actor.workspaceId}::uuid
            and user_id = ${command.existingUserId}::uuid
        ) as present
      `.execute(database);
      if (existing.rows[0]?.present === true) return "already-member";
    }
    await sql`
      update crm.workspace_invitations
      set status = 'revoked', updated_at = now()
      where workspace_id = ${command.actor.workspaceId}::uuid
        and email = ${command.email} and status = 'pending'
    `.execute(database);
    await sql`
      insert into crm.workspace_invitations (
        id, workspace_id, invited_by_member_id, email, token_hash, role,
        status, expires_at, created_at, updated_at
      ) values (
        ${command.invitationId}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid, ${command.email}, ${command.tokenHash},
        ${command.role}, 'pending', ${command.expiresAt}, now(), now()
      )
    `.execute(database);
    return "created";
  }

  async list(
    command: Parameters<WorkspaceInvitationRepository["list"]>[0],
  ): ReturnType<WorkspaceInvitationRepository["list"]> {
    const database = databaseFromSession(command.transaction);
    const authorized = await sql<{ readonly authorized: boolean }>`
      select true as authorized from crm.workspace_members
      where id = ${command.actor.memberId}::uuid
        and user_id = ${command.actor.userId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and role in ('owner', 'admin') and status = 'active' and left_at is null
      limit 1
    `.execute(database);
    if (authorized.rows[0]?.authorized !== true) {
      return { status: "forbidden" };
    }
    await sql`
      update crm.workspace_invitations set status = 'expired', updated_at = now()
      where workspace_id = ${command.actor.workspaceId}::uuid
        and status = 'pending' and expires_at <= ${command.now}
    `.execute(database);
    const members = await sql<WorkspaceMemberRecord>`
      select id::text as id, user_id::text as "userId", role, status
      from crm.workspace_members
      where workspace_id = ${command.actor.workspaceId}::uuid
        and status = 'active' and left_at is null
      order by id
    `.execute(database);
    const invitations = await sql<WorkspaceInvitationRecord>`
      select id::text, email::text, role, status,
        created_at as "createdAt", expires_at as "expiresAt"
      from crm.workspace_invitations
      where workspace_id = ${command.actor.workspaceId}::uuid
        and status = 'pending' and expires_at > ${command.now}
      order by created_at desc, id
    `.execute(database);
    return {
      invitations: invitations.rows,
      members: members.rows,
      status: "ready",
    };
  }

  async inspect(
    command: Parameters<WorkspaceInvitationRepository["inspect"]>[0],
  ): Promise<InvitationInspection> {
    const database = databaseFromSession(command.transaction);
    const result = await sql<{
      readonly email: string;
      readonly expiresAt: Date | string | null;
      readonly invitationId: string;
      readonly role: "admin" | "member";
      readonly status: "accepted" | "expired" | "pending" | "revoked";
      readonly workspaceName: string;
    }>`
      select wi.id::text as "invitationId", wi.email::text, wi.role, wi.status,
        wi.expires_at as "expiresAt",
        w.name as "workspaceName"
      from crm.workspace_invitations wi
      join crm.workspaces w on w.id = wi.workspace_id
      where wi.token_hash = ${command.tokenHash}
        and w.status = 'active' and w.deleted_at is null
      for update of wi
    `.execute(database);
    const invitation = result.rows[0];
    if (!invitation) return { status: "invalid" };
    if (invitation.status === "accepted") return { status: "used" };
    if (invitation.status === "revoked") return { status: "revoked" };
    const expiresAt = invitation.expiresAt === null
      ? undefined
      : new Date(invitation.expiresAt);
    if (!expiresAt || expiresAt <= command.now) {
      await sql`
        update crm.workspace_invitations
        set status = 'expired', updated_at = now()
        where token_hash = ${command.tokenHash} and status = 'pending'
      `.execute(database);
      return { status: "expired" };
    }
    if (invitation.status === "expired") return { status: "expired" };
    return {
      email: invitation.email,
      role: invitation.role,
      status: "pending",
      workspaceName: invitation.workspaceName,
    };
  }

  async accept(
    command: Parameters<WorkspaceInvitationRepository["accept"]>[0],
  ): Promise<InvitationAcceptance> {
    const database = databaseFromSession(command.transaction);
    const result = await sql<{
      readonly email: string;
      readonly expiresAt: Date | string | null;
      readonly invitationId: string;
      readonly invitedByMemberId: string | null;
      readonly role: "admin" | "member";
      readonly status: "accepted" | "expired" | "pending" | "revoked";
      readonly workspaceId: string;
      readonly workspaceName: string;
    }>`
      select wi.id::text as "invitationId", wi.email::text, wi.role, wi.status,
        wi.expires_at as "expiresAt",
        wi.invited_by_member_id::text as "invitedByMemberId",
        wi.workspace_id::text as "workspaceId", w.name as "workspaceName"
      from crm.workspace_invitations wi
      join crm.workspaces w on w.id = wi.workspace_id
      where wi.token_hash = ${command.tokenHash}
        and w.status = 'active' and w.deleted_at is null
      for update of wi
    `.execute(database);
    const invitation = result.rows[0];
    if (!invitation) return { status: "invalid" };
    if (invitation.status === "accepted") return { status: "used" };
    if (invitation.status === "revoked") return { status: "revoked" };
    const expiresAt = invitation.expiresAt === null
      ? undefined
      : new Date(invitation.expiresAt);
    if (
      invitation.status === "expired" || !expiresAt || expiresAt <= command.now
    ) {
      await sql`
        update crm.workspace_invitations set status = 'expired', updated_at = now()
        where token_hash = ${command.tokenHash} and status = 'pending'
      `.execute(database);
      return { status: "expired" };
    }
    const existing = await sql<{ readonly id: string }>`
      select id::text from crm.workspace_members
      where workspace_id = ${invitation.workspaceId}::uuid
        and user_id = ${command.userId}::uuid
      for update
    `.execute(database);
    if (existing.rows[0]) {
      return { status: "already-member" };
    }
    await sql`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, invited_by_member_id,
        joined_at, created_at, updated_at
      ) values (
        ${command.memberId}::uuid, ${invitation.workspaceId}::uuid,
        ${command.userId}::uuid, ${invitation.role}, 'active',
        ${invitation.invitedByMemberId}::uuid, ${command.now}, now(), now()
      )
    `.execute(database);
    await sql`
      insert into crm.member_preferences (member_id)
      values (${command.memberId}::uuid)
    `.execute(database);
    await sql`
      update crm.workspace_invitations
      set status = 'accepted', accepted_at = ${command.now}, updated_at = now()
      where token_hash = ${command.tokenHash} and status = 'pending'
    `.execute(database);
    return {
      invitationId: invitation.invitationId,
      invitedByMemberId: invitation.invitedByMemberId,
      memberId: command.memberId,
      role: invitation.role,
      status: "accepted",
      workspaceId: invitation.workspaceId,
      workspaceName: invitation.workspaceName,
    };
  }

  async assertAcceptancePostcondition(
    command: Parameters<
      WorkspaceInvitationRepository["assertAcceptancePostcondition"]
    >[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select
        (select count(*) = 1 from crm.workspace_members
          where id = ${command.memberId}::uuid
            and workspace_id = ${command.workspaceId}::uuid
            and user_id = ${command.userId}::uuid
            and role = ${command.role} and status = 'active'
            and invited_by_member_id is not distinct from ${command.invitedByMemberId}::uuid
            and self_person_id is null and joined_at = ${command.acceptedAt}
            and left_at is null) and
        (select count(*) = 1 from crm.member_preferences
          where member_id = ${command.memberId}::uuid and timezone is null
            and locale = 'en' and temperature_scale = 'celsius'
            and measurement_system = 'metric' and currency_code is null
            and contact_sort_order = 'given_name_asc'
            and contact_name_order = 'given_family_nickname'
            and fluid_layout = false and ui_state = '{}'::jsonb) and
        (select count(*) = 1 from crm.workspace_invitations
          where id = ${command.invitationId}::uuid
            and workspace_id = ${command.workspaceId}::uuid
            and token_hash = ${command.tokenHash} and role = ${command.role}
            and invited_by_member_id is not distinct from ${command.invitedByMemberId}::uuid
            and status = 'accepted' and accepted_at = ${command.acceptedAt})
        as valid
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Workspace invitation acceptance postcondition failed.");
    }
  }
}
