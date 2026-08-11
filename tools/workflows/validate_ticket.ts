/**
 * Intentional bootstrap seam for PILOT-001. It is not exposed as a root task
 * until the ticket supplies tested file loading and validation behavior.
 */
export function runTicketValidator(_args: readonly string[]): number {
  console.error("Ticket validation is not implemented");
  return 1;
}

if (import.meta.main) {
  Deno.exit(runTicketValidator(Deno.args));
}
