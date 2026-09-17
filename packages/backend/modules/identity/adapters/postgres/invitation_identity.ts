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
      for share
    `.execute(databaseFromSession(command.transaction));
    return result.rows;
  }
}
