/**
 * How the module stores a member's calendar feed (GAP-052,
 * `INTEGRATION-002`).
 *
 * A feed is an `api_tokens` row with the one scope `calendar.read`, owned by
 * the member's user in one workspace, so the same hashing, revocation, and
 * authentication serve it as serve a personal token. What this contract adds
 * is only what a personal token never needs: the member's one active feed,
 * and revoking it without knowing its identifier. Every method runs under the
 * standing the use case just established, inside its transaction.
 */

import type { CalendarFeedRecord } from "../domain/token_rules.ts";
import type { ApiTokenActor, ApiTokenTransaction } from "./context.ts";

export interface CalendarFeedRepository {
  /** The member's feed that is neither revoked nor expired, if any. */
  active(
    command: ApiTokenActor & { readonly transaction: ApiTokenTransaction },
  ): Promise<CalendarFeedRecord | undefined>;
  create(
    command: ApiTokenActor & {
      readonly hash: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: ApiTokenTransaction;
    },
  ): Promise<CalendarFeedRecord>;
  /** Revokes every feed of the member's that is still live. */
  revokeActive(
    command: ApiTokenActor & {
      readonly occurredAt: Date;
      readonly transaction: ApiTokenTransaction;
    },
  ): Promise<readonly CalendarFeedRecord[]>;
}
