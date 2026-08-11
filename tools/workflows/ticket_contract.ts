export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Intentional bootstrap seam for PILOT-001. The pilot must replace this
 * not-implemented result through a recorded RED -> GREEN -> REFACTOR cycle.
 */
export function validateTicketBundle(
  _bundle: unknown,
  _availableTasks: ReadonlySet<string>,
): readonly ValidationIssue[] {
  return [{
    path: "$",
    code: "not_implemented",
    message: "Ticket validation is not implemented",
  }];
}
