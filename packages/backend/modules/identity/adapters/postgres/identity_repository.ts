import { sql } from "kysely";
import { isUniqueViolation } from "../../../../platform/postgres/errors.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { IdentityConflictError } from "../../domain/identity_rules.ts";
import type {
  CreatePendingUserCommand,
  IdentityRegistrationFacade,
  PendingUser,
} from "../../ports/registration.ts";

export class PostgresIdentityRegistration
  implements IdentityRegistrationFacade {
  async createPendingUser(
    command: CreatePendingUserCommand,
  ): Promise<PendingUser> {
    const database = databaseFromSession(command.transaction);
    try {
      await sql`
        insert into crm.users (
          id, email, password_hash, first_name, last_name, status,
          email_verified_at, password_changed_at, created_at, updated_at
        ) values (
          ${command.userId}::uuid, ${command.email}, ${command.passwordHash},
          ${command.firstName}, ${command.lastName}, 'active', null, now(), now(), now()
        )
      `.execute(database);
      await sql`
        insert into crm.email_verification_tokens (
          id, user_id, email, token_hash, expires_at, created_at
        ) values (
          ${command.verificationTokenId}::uuid, ${command.userId}::uuid,
          ${command.email}, ${command.tokenHash}, ${command.expiresAt}, now()
        )
      `.execute(database);
      return { userId: command.userId };
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityConflictError();
      throw error;
    }
  }

  async assertPendingUserPostconditions(command: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
    readonly tokenHash: string;
    readonly transaction: CreatePendingUserCommand["transaction"];
    readonly userId: string;
    readonly verificationTokenId: string;
  }): Promise<void> {
    const result = await sql<{ valid: boolean }>`
      select
        (select count(*) = 1 from crm.users
          where id = ${command.userId}::uuid
            and email = ${command.email}
            and first_name = ${command.firstName}
            and last_name = ${command.lastName}
            and password_hash = ${command.passwordHash}
            and status = 'active'
            and email_verified_at is null) and
        (select count(*) = 1 from crm.email_verification_tokens
          where id = ${command.verificationTokenId}::uuid
            and user_id = ${command.userId}::uuid
            and email = ${command.email}
            and token_hash = ${command.tokenHash}
            and expires_at = ${command.expiresAt}
            and used_at is null)
        as valid
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Pending identity postconditions failed.");
    }
  }

  async createRetryVerificationToken(command: {
    readonly createdAt: Date;
    readonly email: string;
    readonly expiresAt: Date;
    readonly tokenHash: string;
    readonly transaction: CreatePendingUserCommand["transaction"];
    readonly verificationTokenId: string;
  }): Promise<
    { readonly email: string; readonly created: boolean } | undefined
  > {
    const database = databaseFromSession(command.transaction);
    const user = await sql<{ email: string; user_id: string }>`
      select id::text as user_id, email::text
      from crm.users
      where email = ${command.email}
        and status = 'active'
        and email_verified_at is null
      for update
    `.execute(database);
    const pending = user.rows[0];
    if (!pending) return undefined;
    const tokens = await sql<{ created_at: Date }>`
      select created_at
      from crm.email_verification_tokens
      where user_id = ${pending.user_id}::uuid and used_at is null
      order by created_at desc, id desc
      for update
    `.execute(database);
    if (tokens.rows.length === 0) return undefined;
    const latest = tokens.rows[0];
    if (
      tokens.rows.length > 1 && latest &&
      new Date(latest.created_at).getTime() >
        command.createdAt.getTime() - 5 * 60_000
    ) {
      return { email: pending.email, created: false };
    }
    await sql`
      insert into crm.email_verification_tokens (
        id, user_id, email, token_hash, expires_at, created_at
      ) values (
        ${command.verificationTokenId}::uuid, ${pending.user_id}::uuid,
        ${pending.email}, ${command.tokenHash}, ${command.expiresAt},
        ${command.createdAt}
      )
    `.execute(database);
    return { email: pending.email, created: true };
  }
}
