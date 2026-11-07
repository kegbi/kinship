/**
 * What a DAV subscription is, and what it is allowed to point at.
 *
 * `validConfiguration` is the rule that matters. A subscription is a standing
 * instruction to fetch somebody else's URL with a stored password, which makes
 * it the most dangerous thing a member can configure, so it is refused unless
 * it is plain HTTPS with a real host and no credentials smuggled into the URL
 * itself. Normalising the URL through the platform's own parser before
 * measuring it is deliberate: the bytes that are stored are the bytes that
 * were checked, so a URL cannot be measured in one spelling and fetched in
 * another.
 *
 * `remoteIdentity` is the other rule worth naming. The same remote card must
 * land on the same local row every time it is seen, so the request identifier
 * a sync derives is built from the workspace, the subscription, the kind, and
 * the remote UID — never from the href, which a server may move.
 *
 * `publicFailure` decides what a member is told when a remote fails, and the
 * mapping is narrow on purpose: an authentication failure and a token conflict
 * are actionable and named, and everything else is one partial sync. The
 * remote's own message never reaches a member, which is why `DavRemoteFailure`
 * carries a fixed sentence and discards the detail it was constructed with.
 */

/** The standing a member has to hold to configure or run a sync. */
export type DavRole = "admin" | "member" | "owner";

/** The longest remote URL a subscription may carry, as the column holds. */
export const DAV_REMOTE_URL_MAX_BYTES = 2_048;

/** How the last run of a subscription ended. */
export type DavOutcome =
  | "auth-failure"
  | "conflict"
  | "never"
  | "partial"
  | "success";

/** One subscription, as a member sees it listed. */
export interface DavSubscription {
  readonly id: string;
  readonly isActive: boolean;
  readonly lastError?: string;
  readonly lastOutcome: DavOutcome;
  readonly lastSyncedAt?: string;
  readonly name: string;
  readonly remoteSyncToken?: string;
  readonly remoteUrl: string;
  readonly username?: string;
}

/** The subscription with the two fields only this module may see. */
export interface StoredDavSubscription extends DavSubscription {
  readonly claimToken: string;
  readonly encryptedPassword: string;
}

/** What the module remembers about one remote object between runs. */
export interface DavObjectCheckpoint {
  readonly coreId: string;
  readonly etag: string;
  readonly kind: "person" | "task";
  readonly status: "conflict" | "deleted" | "error" | "synced";
}

/** The checkpoint plus what was last seen of the object itself. */
export interface DavObjectRecord extends DavObjectCheckpoint {
  readonly href: string;
  readonly payload: string;
  readonly uid: string;
}

/** The only failure codes a member is ever shown. */
export type DavPublicErrorCode =
  | "dav_authentication_failed"
  | "dav_claim_lost"
  | "dav_remote_conflict"
  | "dav_sync_failed";

/** What the module records about itself when a subscription changes or runs. */
export interface DavAuditEvent {
  readonly action: "configure" | "disable" | "sync";
  readonly code?: DavPublicErrorCode;
  readonly occurredAt: Date;
  readonly outcome: "conflict" | "failure" | "partial" | "success";
  readonly subscriptionId: string;
}

/** The person side of a synchronized contact card. */
export interface ContactPayload {
  readonly familyName?: string;
  readonly givenName: string;
  readonly nickname?: string;
}

/** The task side of a synchronized to-do. */
export interface TaskPayload {
  readonly description?: string;
  readonly dueAt?: string;
  readonly title: string;
}

type DavUpsertChange =
  | {
    readonly changeType: "create" | "update";
    readonly etag: string;
    readonly href: string;
    readonly kind: "person";
    readonly payload: ContactPayload;
    readonly raw?: string;
    readonly uid: string;
  }
  | {
    readonly changeType: "create" | "update";
    readonly etag: string;
    readonly href: string;
    readonly kind: "task";
    readonly payload: TaskPayload;
    readonly raw?: string;
    readonly uid: string;
  };

/** One thing the remote says has happened since the last run. */
export type DavRemoteChange = DavUpsertChange | {
  readonly changeType: "delete";
  readonly etag: string;
  readonly href: string;
  readonly kind: "person" | "task";
  readonly uid: string;
};

/** What a member is told about a remote, whatever the remote said. */
const REMOTE_MESSAGES = {
  auth: "Remote DAV authentication failed.",
  conflict: "Remote DAV state changed. A full retry is required.",
  temporary: "Remote DAV is temporarily unavailable.",
} as const;

/**
 * A remote that would not cooperate.
 *
 * The detail the caller supplies is deliberately discarded: it comes from
 * somebody else's server, and this message reaches a member.
 */
export class DavRemoteFailure extends Error {
  constructor(readonly kind: keyof typeof REMOTE_MESSAGES, _detail?: string) {
    super(REMOTE_MESSAGES[kind]);
  }
}

/** What a member has to type to configure a subscription. */
export interface DavConfigurationInput {
  readonly name: string;
  readonly password: string;
  readonly remoteUrl: string;
  readonly username?: string;
}

/** The canonical subscription a write proceeds with. */
export interface DavConfigurationValues {
  readonly name: string;
  readonly remoteUrl: string;
  readonly username?: string;
}

/** The canonical subscription, or nothing when it may not be stored. */
export function validConfiguration(
  input: DavConfigurationInput,
): DavConfigurationValues | undefined {
  try {
    const parsed = new URL(input.remoteUrl);
    const remoteUrl = parsed.toString();
    const name = input.name.trim();
    const username = input.username?.trim();
    if (
      new TextEncoder().encode(remoteUrl).length > DAV_REMOTE_URL_MAX_BYTES ||
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !parsed.hostname || !name || name.length > 100 || !input.password ||
      input.password.length > 4096 || (username?.length ?? 0) > 255
    ) return undefined;
    return {
      name,
      remoteUrl,
      ...(username ? { username } : {}),
    };
  } catch {
    return undefined;
  }
}

/** The stable request identifier one remote object is created under. */
export function remoteIdentity(
  actor: { readonly workspaceId: string },
  subscriptionId: string,
  change: DavRemoteChange,
): string {
  return `${actor.workspaceId}:${subscriptionId}:${change.kind}:${change.uid}`;
}

/** What a member is told a failed run failed of, and how it is recorded. */
export function publicFailure(
  error: unknown,
): {
  readonly code: DavPublicErrorCode;
  readonly status: "auth-failure" | "conflict" | "partial";
} {
  if (error instanceof DavRemoteFailure && error.kind === "auth") {
    return { code: "dav_authentication_failed", status: "auth-failure" };
  }
  if (error instanceof DavRemoteFailure && error.kind === "conflict") {
    return { code: "dav_remote_conflict", status: "conflict" };
  }
  return { code: "dav_sync_failed", status: "partial" };
}
