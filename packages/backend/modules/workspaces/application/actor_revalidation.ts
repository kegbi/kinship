/**
 * The one actor-context read every module shares.
 *
 * Before this port, each adapter carried its own copy of the same
 * account -> member -> workspace join: "is this actor still allowed to act
 * here?". The copies drifted, crossed `identity` ownership without declaring
 * it, and two repositories skipped the question entirely.
 *
 * `workspaces` owns membership and already depends on `identity`, so it owns
 * the question. A caller opens its transaction, revalidates the actor, and
 * only then touches its own tables, which it scopes by `workspaceId` and
 * aggregate ownership alone.
 *
 * The answer is only trustworthy for the life of the caller's transaction:
 * `lock` takes row locks on the user, the membership, and the workspace so a
 * concurrent revocation cannot commit between the answer and the write. Read
 * paths that took no locks before pass `lock: false` and keep their original
 * concurrency.
 */

/** The caller's open transaction, opaque to this module. */
export interface ActorRevalidationTransaction {
  readonly opaque: unknown;
}

/** The actor context a request claims, exactly as it was authenticated. */
export interface RevalidatedActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/**
 * `active` means the user is active, the membership is active with the claimed
 * role, and the workspace is active. Anything else is `revoked`: a disabled or
 * deleted user, a departed or suspended member, a changed role, a suspended or
 * deleted workspace, or a context that never existed.
 */
export type ActorStanding = "active" | "revoked";

export interface ActorRevalidationCommand extends RevalidatedActor {
  /** Lock the actor's rows for the rest of the caller's transaction. */
  readonly lock: boolean;
  readonly transaction: ActorRevalidationTransaction;
}

export interface ActorRevalidation {
  revalidate(command: ActorRevalidationCommand): Promise<ActorStanding>;
}
