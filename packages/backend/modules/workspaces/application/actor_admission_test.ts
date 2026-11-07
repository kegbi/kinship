import {
  actorMayRead,
  ADMISSION_WINDOW_MS,
  admitResolved,
  carryAdmission,
  isAdmitted,
} from "./actor_admission.ts";
import type { ActorStanding } from "../ports/actors.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

/** A revalidation that records whether it was asked, and answers `standing`. */
function revalidation(standing: ActorStanding) {
  const asked: string[] = [];
  return {
    asked,
    dependencies: {
      actors: {
        revalidate(command: { readonly lock: boolean }) {
          asked.push(`revalidate lock=${command.lock}`);
          return Promise.resolve(standing);
        },
      },
      transaction: {
        run<Result>(
          work: (transaction: { readonly opaque: unknown }) => Promise<Result>,
        ) {
          asked.push("transaction");
          return work({ opaque: undefined });
        },
      },
    },
  };
}

Deno.test("[AUD-K3] the actor a request resolved reads without revalidating", async () => {
  const resolved = admitResolved({
    ...fixtures.actor(),
    accessibleWorkspaces: [],
  });
  const narrowed = carryAdmission(resolved, {
    memberId: resolved.memberId,
    requestId: "request-1",
    role: resolved.role,
    userId: resolved.userId,
    workspaceId: resolved.workspaceId,
  });
  const { asked, dependencies } = revalidation("revoked");
  assert(
    await actorMayRead(dependencies, narrowed),
    "the admitted actor may read",
  );
  assert(asked.length === 0, "no transaction and no revalidation");
  assert(Object.isFrozen(narrowed), "the admitted copy cannot be changed");
});

Deno.test("[AUD-K3] any other actor is revalidated without a lock", async () => {
  const forged = { ...fixtures.actor() };
  const revoked = revalidation("revoked");
  assert(
    !await actorMayRead(revoked.dependencies, forged),
    "a hand-built actor whose standing is revoked may not read",
  );
  assert(
    revoked.asked.join(",") === "transaction,revalidate lock=false",
    "it is revalidated in a transaction of its own, without a lock",
  );
  const active = revalidation("active");
  assert(
    await actorMayRead(active.dependencies, forged),
    "a hand-built actor in good standing may read",
  );
});

Deno.test("[AUD-K3] an admission vouches only for what was resolved", async () => {
  const resolved = admitResolved({ ...fixtures.actor() });
  const copy = { ...resolved };
  assert(!isAdmitted(copy), "a spread copy is a new, unadmitted object");
  const moved = carryAdmission(resolved, {
    ...resolved,
    workspaceId: "00000000-0000-4000-8000-0000000000ff",
  });
  assert(!isAdmitted(moved), "a copy naming another workspace is not admitted");
  const promoted = carryAdmission(resolved, {
    ...resolved,
    role: "owner" as const,
  });
  assert(!isAdmitted(promoted), "a copy naming another role is not admitted");
  const unadmitted = carryAdmission({ ...fixtures.actor() }, {
    ...fixtures.actor(),
  });
  assert(!isAdmitted(unadmitted), "nothing is carried from nothing");
  const { asked, dependencies } = revalidation("revoked");
  assert(
    !await actorMayRead(dependencies, moved),
    "a moved copy is revalidated like any other actor",
  );
  assert(asked.length === 2, "the revalidation ran");
});

Deno.test("[AUD-K3] an admission lapses after its window", () => {
  const admittedAt = 1_000_000;
  const resolved = admitResolved({ ...fixtures.actor() }, admittedAt);
  assert(
    isAdmitted(resolved, admittedAt + ADMISSION_WINDOW_MS - 1),
    "admitted inside the window",
  );
  assert(
    !isAdmitted(resolved, admittedAt + ADMISSION_WINDOW_MS),
    "revalidated once the window has passed",
  );
});
