/**
 * Which actors this request has just resolved, so a read need not ask again.
 *
 * Every protected request resolves its session once, through
 * `ProtectedSessionCoordinator.resolve`, and that resolution reads the same
 * user, membership, and workspace rows, under the same predicate, that
 * `ActorRevalidation.revalidate` reads. A read use case that then revalidated
 * the actor spent three more round trips — a transaction around one select —
 * to learn what the request had learned a moment before (BEQ-04).
 *
 * The resolution therefore admits what it returns: the object is frozen and
 * remembered here, by identity. A read use case asks `actorMayRead`, which
 * answers at once for an admitted actor and revalidates any other — one a
 * test built by hand, one an API token authenticated, one a background job
 * holds — exactly as before. Nothing but the coordinator admits; the HTTP kit
 * only carries an admission over to the narrower copy it hands a route.
 *
 * - **Identity, not value.** A copy with any field changed is a new object
 *   and is not admitted, and a frozen admitted object cannot be changed, so
 *   an admission never vouches for a workspace or a role it did not resolve.
 * - **Short-lived.** An admission lapses after `ADMISSION_WINDOW_MS`, longer
 *   than any request the gateway lets run, so an actor somebody kept is
 *   revalidated rather than trusted. A revoked or suspended member is refused
 *   on their next request, because that request resolves afresh.
 * - **Reads only.** A write still revalidates with a lock inside its own
 *   transaction; nothing here is consulted for one.
 */

import type {
  ActorRevalidation,
  ActorRevalidationTransaction,
  RevalidatedActor,
} from "../ports/actors.ts";

/** How long an admission vouches for its actor, in milliseconds. */
export const ADMISSION_WINDOW_MS = 15_000;

const admissions = new WeakMap<object, number>();

/** Freezes and admits a resolution the coordinator has just made. */
export function admitResolved<Resolved extends object>(
  resolved: Resolved,
  now: number = Date.now(),
): Resolved {
  admissions.set(Object.freeze(resolved), now);
  return resolved;
}

/**
 * Carries an admission from a resolution to a narrower copy of it.
 *
 * `copy` is frozen and admitted for the rest of the original's window, but
 * only if `from` is admitted and every field `copy` shares with it is equal,
 * so a copy that changed what was resolved is never admitted.
 */
export function carryAdmission<Copy extends object>(
  from: object,
  copy: Copy,
): Copy {
  const admittedAt = admissions.get(from);
  if (admittedAt === undefined) return copy;
  const source = from as Record<string, unknown>;
  const same = ["memberId", "role", "userId", "workspaceId"].every((key) =>
    source[key] === (copy as Record<string, unknown>)[key]
  );
  if (same) admissions.set(Object.freeze(copy), admittedAt);
  return copy;
}

/** Whether `actor` is a resolution admitted within its window. */
export function isAdmitted(actor: object, now: number = Date.now()): boolean {
  const admittedAt = admissions.get(actor);
  return admittedAt !== undefined && now - admittedAt < ADMISSION_WINDOW_MS;
}

/** What `actorMayRead` needs to revalidate an actor that is not admitted. */
export interface ActorReadDependencies<
  Transaction extends ActorRevalidationTransaction,
> {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<Result>(
      work: (transaction: Transaction) => Promise<Result>,
    ): Promise<Result>;
  };
}

/**
 * Whether the actor may still read its workspace: at once for the actor this
 * request resolved, otherwise by revalidating it, without a lock, in a
 * transaction of its own.
 */
export async function actorMayRead<
  Transaction extends ActorRevalidationTransaction,
>(
  dependencies: ActorReadDependencies<Transaction>,
  actor: RevalidatedActor,
): Promise<boolean> {
  if (isAdmitted(actor)) return true;
  return await dependencies.transaction.run((transaction) =>
    dependencies.actors.revalidate({ ...actor, lock: false, transaction })
  ) === "active";
}
