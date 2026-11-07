/**
 * Who may do what inside a workspace.
 *
 * Three roles and two questions, and they are here rather than in each use
 * case because the same two questions were being spelled out again in five
 * places — `role === "owner" || role === "admin"` in invitations, in
 * personalization, in api tokens' own copy, and `role !== "owner"` in both
 * lifecycles. A role comparison written out is a role comparison that can be
 * written out slightly differently.
 *
 * `privileged` is the only copy in the backend (AUD-K5): api-access and
 * integrations, which each used to keep their own, ask it through this
 * module's `public.ts`, and `apps/api/role_matrix_test.ts` holds every route
 * to the roles `docs/architecture/authorization-matrix.yaml` grants.
 *
 * There is no `member` predicate on purpose. A member is not a permission; it
 * is the absence of the other two, and code that asks "is this only a member?"
 * is usually about to get an edge case wrong.
 */

/** Every standing a workspace membership may hold. */
export type WorkspaceRole = "admin" | "member" | "owner";

/** The roles somebody may be invited into; ownership is not handed out. */
export type InvitationRole = Exclude<WorkspaceRole, "owner">;

/** Administrative work: invitations, personalization, workspace settings. */
export function privileged(actor: { readonly role: WorkspaceRole }): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/** The irreversible things: resetting or deleting the workspace itself. */
export function owner(actor: { readonly role: WorkspaceRole }): boolean {
  return actor.role === "owner";
}
