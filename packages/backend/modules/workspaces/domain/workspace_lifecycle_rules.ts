/**
 * What resetting or deleting a workspace would destroy, and how that is
 * proved not to have changed since it was shown.
 *
 * The impact token is the interesting rule. A member is shown exactly what
 * they are about to lose and has to send that token back with the request; if
 * the workspace changed in between, the token no longer matches and the
 * request is refused instead of destroying something the member never saw. So
 * the token has to cover everything the page showed and nothing that varies on
 * its own: the base revision, each module's own revision, the merged counts,
 * and the sorted object keys.
 *
 * `mergeImpact` is what makes it stable. Eleven modules each contribute counts
 * and stored-object keys, the counts are merged by name and the keys are
 * de-duplicated and sorted, so two inspections of an unchanged workspace
 * produce the same token whatever order the contributions arrived in.
 *
 * The confirmation phrase is the other half of the same idea, and it names the
 * workspace: typing `DELETE` is a reflex, typing `DELETE Ada's workspace` is a
 * decision.
 */

/** Everything a workspace holds, counted before it is destroyed. */
export interface WorkspaceLifecycleCounts {
  readonly activities: number;
  readonly auditEvents: number;
  readonly calls: number;
  readonly debts: number;
  readonly exports: number;
  readonly files: number;
  readonly imports: number;
  readonly integrations: number;
  readonly journalPosts: number;
  readonly gifts: number;
  readonly lifeEvents: number;
  readonly members: number;
  readonly people: number;
  readonly messages: number;
  readonly notes: number;
  readonly operations: number;
  readonly relationships: number;
  readonly reminders: number;
  readonly tasks: number;
}

/** One module's share of the cascade. */
export interface WorkspaceLifecycleImpactContribution {
  readonly counts: Readonly<Record<string, number>>;
  readonly objectKeys?: readonly string[];
  readonly revision: string;
}

/** What the confirmation page shows, and what the token is derived from. */
export interface WorkspaceLifecycleSnapshot {
  readonly activeSessionCount: number;
  readonly counts: WorkspaceLifecycleCounts;
  readonly impactToken: string;
  readonly objectKeys: readonly string[];
  readonly workspaceName: string;
}

/** Every way a reset or a delete can end, recorded against the actor. */
export type WorkspaceLifecycleOutcome =
  | "confirmation-invalid"
  | "forbidden"
  | "rate-limited"
  | "reauthentication-required"
  | "stale-impact"
  | "transactional-failure";

/** The phrase a member has to type to go ahead. */
export function lifecycleConfirmation(
  action: "delete" | "reset",
  workspaceName: string,
): string {
  return `${action === "reset" ? "RESET" : "DELETE"} ${workspaceName}`;
}

/**
 * The token that proves the workspace has not changed since it was shown.
 *
 * It is a digest of a JSON rendering rather than of the page, so the token
 * changes exactly when what the page said changes.
 */
export async function hashImpact(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The workspace's own snapshot with every module's contribution folded in.
 *
 * Counts are merged by name, so a module may only report its own; keys are
 * de-duplicated and sorted, so the same set of objects always renders the same
 * way and the token is stable across inspections.
 */
export async function mergeImpact(
  snapshot: WorkspaceLifecycleSnapshot,
  contributions: readonly WorkspaceLifecycleImpactContribution[],
): Promise<WorkspaceLifecycleSnapshot> {
  const counts = Object.assign(
    {},
    snapshot.counts,
    ...contributions.map((item) => item.counts),
  ) as WorkspaceLifecycleCounts;
  const objectKeys = [
    ...new Set([
      ...snapshot.objectKeys,
      ...contributions.flatMap((item) => item.objectKeys ?? []),
    ]),
  ].sort();
  return {
    ...snapshot,
    counts,
    impactToken: await hashImpact({
      base: snapshot.impactToken,
      contributions: contributions.map((item) => item.revision),
      counts,
      objectKeys,
    }),
    objectKeys,
  };
}
