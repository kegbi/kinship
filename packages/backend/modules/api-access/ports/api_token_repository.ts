/**
 * How the module stores personal access tokens.
 *
 * `create` takes the actor, because a token belongs to its issuer and its
 * workspace. Listing and revoking are scoped by the workspace alone: owners
 * and administrators oversee every token in it (SECT-07), and the use case has
 * already established that the caller is one. `revokeHeldBy` ends every
 * credential one user holds in a workspace when they stop belonging to it.
 * The two methods that take no workspace are the authentication path:
 * `findForAuthentication` is reached by somebody who has presented a token and
 * nothing else, so it looks the row up by identifier alone and answers with
 * the user and workspace it names, and `markUsed` records that the token was
 * accepted. Both leave deciding whether that adds up to an actor to the
 * workspaces module.
 *
 * The stored hash never leaves this contract for anywhere but the secret
 * comparison, and the record beside it never carries one.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { ApiTokenRecord, ApiTokenScope } from "../domain/token_rules.ts";
import type { ApiTokenActor, ApiTokenTransaction } from "./context.ts";

export interface ApiTokenRepository {
  create(
    command: ApiTokenActor & {
      readonly expiresAt?: Date;
      readonly hash: string;
      readonly id: string;
      readonly name: string;
      readonly occurredAt: Date;
      readonly scopes: readonly ApiTokenScope[];
      readonly transaction: ApiTokenTransaction;
    },
  ): Promise<
    | { readonly record: ApiTokenRecord; readonly status: "created" }
    | Failure<"forbidden">
  >;
  findForAuthentication(command: {
    readonly id: string;
    readonly transaction: ApiTokenTransaction;
  }): Promise<
    | {
      readonly hash: string;
      readonly record: ApiTokenRecord;
      readonly status: "found";
      readonly userId: string;
      readonly workspaceId: string;
    }
    | Failure<"not-found">
  >;
  /** Every personal token of the workspace, newest first, with its issuer. */
  list(command: {
    readonly transaction: ApiTokenTransaction;
    readonly workspaceId: string;
  }): Promise<readonly IssuedApiTokenRecord[]>;
  /**
   * Records the use at `occurredAt` only when the stored last use is missing,
   * earlier than `staleBefore`, or later than `occurredAt` (a skewed clock);
   * otherwise the row is left untouched.
   */
  markUsed(command: {
    readonly id: string;
    readonly occurredAt: Date;
    readonly staleBefore: Date;
    readonly transaction: ApiTokenTransaction;
  }): Promise<void>;
  /** Revokes one live personal token of the workspace, whoever issued it. */
  revoke(command: {
    readonly id: string;
    readonly occurredAt: Date;
    readonly transaction: ApiTokenTransaction;
    readonly workspaceId: string;
  }): Promise<
    | { readonly record: ApiTokenRecord; readonly status: "revoked" }
    | Failure<"not-found">
  >;
  /**
   * Revokes every live token `userId` holds in the workspace, calendar feeds
   * included, and answers with the rows it revoked.
   */
  revokeHeldBy(command: {
    readonly occurredAt: Date;
    readonly transaction: ApiTokenTransaction;
    readonly userId: string;
    readonly workspaceId: string;
  }): Promise<readonly ApiTokenRecord[]>;
}

/** A listed token and the user who minted it. */
export interface IssuedApiTokenRecord extends ApiTokenRecord {
  readonly userId: string;
}
