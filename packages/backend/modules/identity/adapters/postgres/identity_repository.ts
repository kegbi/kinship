import { sql } from "kysely";
import { isUniqueViolation } from "../../../../platform/postgres/errors.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import {
  IdentityConflictError,
  passwordResetExpiry,
} from "../../domain/identity_rules.ts";
import type { IdentityTokenService } from "../../ports/password_recovery.ts";
import type {
  CreatePendingUserCommand,
  IdentityRegistrationFacade,
  PendingUser,
  RegistrationAddressClaim,
} from "../../ports/registration.ts";
import { PostgresPasswordRecoveryRepository } from "./password_recovery.ts";
import {
  REGISTRANT_VERIFIER_PATTERN,
  registrantVerifierDigest,
} from "./registrant_verifier.ts";

export class PostgresIdentityRegistration
  implements IdentityRegistrationFacade {
  readonly #recovery = new PostgresPasswordRecoveryRepository();

  constructor(private readonly tokens: Pick<IdentityTokenService, "hash">) {}

  async claimRegistrationAddress(command: {
    readonly email: string;
    readonly transaction: CreatePendingUserCommand["transaction"];
  }): Promise<RegistrationAddressClaim> {
    const database = databaseFromSession(command.transaction);
    // The same key password recovery serializes on, so a registration and a
    // reset request for one address never interleave.
    await sql`
      select pg_advisory_xact_lock(hashtextextended(lower(${command.email}), 0))
    `.execute(database);
    const result = await sql<{ pending: boolean; user_id: string }>`
      select u.id::text user_id,
        (u.status = 'active' and u.email_verified_at is null and exists (
          select 1 from crm.email_verification_tokens evt
          where evt.user_id = u.id
        )) pending
      from crm.users u
      where u.email = ${command.email}
      for update
    `.execute(database);
    const user = result.rows[0];
    if (!user) return { status: "available" };
    return user.pending
      ? { status: "pending", userId: user.user_id }
      : { status: "registered" };
  }

  async discardPendingUser(command: {
    readonly transaction: CreatePendingUserCommand["transaction"];
    readonly userId: string;
  }): Promise<void> {
    // The tokens, handoff sessions, and reset requests cascade with the user.
    const deleted = await sql<{ id: string }>`
      delete from crm.users
      where id = ${command.userId}::uuid and status = 'active'
        and email_verified_at is null
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (deleted.rows.length !== 1) {
      throw new Error("Pending identity could not be discarded.");
    }
  }

  async createExistingAccountRecovery(command: {
    readonly email: string;
    readonly id: string;
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: CreatePendingUserCommand["transaction"];
  }): Promise<
    { readonly email: string; readonly expiresAt: Date } | undefined
  > {
    const expiresAt = passwordResetExpiry(command.now);
    const request = await this.#recovery.createRequest({
      email: command.email,
      expiresAt,
      id: command.id,
      now: command.now,
      tokenHash: command.tokenHash,
      transaction: command.transaction,
    });
    return request.deliveryEmail
      ? { email: request.deliveryEmail, expiresAt }
      : undefined;
  }

  async createPendingUser(
    command: CreatePendingUserCommand,
  ): Promise<PendingUser> {
    const database = databaseFromSession(command.transaction);
    const verifierDigest = await registrantVerifierDigest(
      this.tokens,
      command.registrantVerifier,
    );
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
        ), (
          gen_random_uuid(), ${command.userId}::uuid,
          ${command.email}, ${verifierDigest}, ${command.expiresAt}, now()
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
            and used_at is null) and
        (select count(*) = 1 from crm.email_verification_tokens
          where user_id = ${command.userId}::uuid
            and token_hash like ${REGISTRANT_VERIFIER_PATTERN}
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
        and token_hash not like ${REGISTRANT_VERIFIER_PATTERN}
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
