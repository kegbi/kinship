import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  InvitationIdentityDisplaySummary,
  InvitationIdentityFacade,
} from "../../ports/invitation_identity.ts";

export class PostgresInvitationIdentity implements InvitationIdentityFacade {
  async findIdentityIdByEmail(
    command: Parameters<InvitationIdentityFacade["findIdentityIdByEmail"]>[0],
  ): Promise<string | undefined> {
    const result = await sql<{ readonly userId: string }>`
      select id::text as "userId" from crm.users
      where email = ${command.email}
      for share
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.userId;
  }

  async isAddressVerifiedBy(
    command: Parameters<InvitationIdentityFacade["isAddressVerifiedBy"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly established: boolean }>`
      select true established from crm.users
      where id = ${command.userId}::uuid and status = 'active'
        and email_verified_at is not null
        and email_verified_at <= ${command.verifiedBy}
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.established === true;
  }

  async isVerifiedInvitationIdentity(
    command: Parameters<
      InvitationIdentityFacade["isVerifiedInvitationIdentity"]
    >[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly eligible: boolean }>`
      select true eligible from crm.users
      where id = ${command.userId}::uuid and email = ${command.expectedEmail}
        and status = 'active' and email_verified_at is not null
      for share
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.eligible === true;
  }

  /**
   * Names and addresses to show beside members, tokens, and invitations. It
   * takes no row lock: a member change reads it while it holds member rows,
   * and a write by that member holds their account row and then waits for
   * their member row, so a lock here would wait for that write in the
   * opposite order (MCP-F4). No caller decides anything from what it reads.
   */
  async listIdentityDisplaySummaries(
    command: Parameters<
      InvitationIdentityFacade["listIdentityDisplaySummaries"]
    >[0],
  ): Promise<readonly InvitationIdentityDisplaySummary[]> {
    if (command.userIds.length === 0) return [];
    const result = await sql<InvitationIdentityDisplaySummary>`
      select id::text as "userId", email::text as email,
        trim(concat(first_name, ' ', last_name)) as name
      from crm.users
      where id = any(${command.userIds}::uuid[])
    `.execute(databaseFromSession(command.transaction));
    return result.rows;
  }
}
