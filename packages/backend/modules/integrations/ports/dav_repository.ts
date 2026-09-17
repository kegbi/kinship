/**
 * How the module stores subscriptions and what it has already synchronized.
 *
 * The claim is what makes this contract unusual. A sync is long, and two of
 * them running against one subscription would fight over the same rows, so
 * `claim` hands out a token and every later call carries it. `recordOutcome`
 * and `withClaimedObject` both answer with a refusal — `undefined` and
 * `claim-lost` — when the token has since been taken by another run, which is
 * how a superseded sync learns to stop rather than overwrite.
 *
 * `withClaimedObject` runs the caller's work inside one transaction with the
 * object's checkpoint read under that claim, so the decision about what to do
 * with a remote change and the write that follows it cannot be separated by
 * another run.
 */

import type {
  DavAuditEvent,
  DavObjectCheckpoint,
  DavObjectRecord,
  DavOutcome,
  DavPublicErrorCode,
  DavSubscription,
  StoredDavSubscription,
} from "../domain/dav_rules.ts";
import type { DavActor, DavTransaction } from "./context.ts";

/** A call made under a claim a sync is holding. */
export type DavClaimCommand = DavActor & {
  readonly claimToken: string;
  readonly subscriptionId: string;
};

export interface DavRepository {
  authorize(actor: DavActor): Promise<boolean>;
  claim(
    actor: DavActor,
    subscriptionId: string,
    claimToken: string,
    claimedAt: Date,
  ): Promise<StoredDavSubscription | undefined>;
  create(
    command: DavActor & {
      readonly encryptedPassword: string;
      readonly id: string;
      readonly name: string;
      readonly occurredAt: Date;
      readonly remoteUrl: string;
      readonly username?: string;
    },
  ): Promise<DavSubscription | undefined>;
  disable(
    actor: DavActor,
    subscriptionId: string,
    occurredAt?: Date,
  ): Promise<DavSubscription | undefined>;
  withClaimedObject(
    command: DavClaimCommand,
    href: string,
    work: (
      existing: DavObjectCheckpoint | undefined,
      transaction: DavTransaction,
    ) => Promise<DavObjectRecord | undefined>,
  ): Promise<"claim-lost" | "processed" | "skipped">;
  list(actor: DavActor): Promise<readonly DavSubscription[]>;
  recordAudit(actor: DavActor, event: DavAuditEvent): Promise<boolean>;
  recordOutcome(
    command: DavClaimCommand,
    outcome: {
      readonly clearRemoteSyncToken?: boolean;
      readonly error?: DavPublicErrorCode;
      readonly occurredAt: Date;
      readonly remoteSyncToken?: string;
      readonly status: Exclude<DavOutcome, "never">;
    },
  ): Promise<DavSubscription | undefined>;
}
