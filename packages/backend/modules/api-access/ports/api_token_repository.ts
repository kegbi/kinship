/**
 * How the module stores personal access tokens.
 *
 * Every method except two takes the actor, because a token belongs to a
 * workspace and the repository scopes each row by the standing the use case
 * just established. The two exceptions are the authentication path:
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
  list(
    command: ApiTokenActor & { readonly transaction: ApiTokenTransaction },
  ): Promise<readonly ApiTokenRecord[]>;
  /**
   * Records the use at `occurredAt` only when the stored last use is missing
   * or earlier than `staleBefore`; otherwise the row is left untouched.
   */
  markUsed(command: {
    readonly id: string;
    readonly occurredAt: Date;
    readonly staleBefore: Date;
    readonly transaction: ApiTokenTransaction;
  }): Promise<void>;
  revoke(
    command: ApiTokenActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: ApiTokenTransaction;
    },
  ): Promise<
    | { readonly record: ApiTokenRecord; readonly status: "revoked" }
    | Failure<"forbidden" | "not-found">
  >;
}
