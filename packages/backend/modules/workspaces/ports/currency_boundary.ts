/**
 * What neighbouring modules ask the workspace about money.
 *
 * The currency catalog and both currency preferences — the member's own and
 * the workspace default — are workspace configuration, so a module that
 * records money asks here rather than reading those tables.
 */

export interface CurrencyBoundaryTransaction {
  readonly opaque: unknown;
}

export interface WorkspaceCurrencyBoundary {
  isSupported(command: {
    readonly code: string;
    readonly transaction: CurrencyBoundaryTransaction;
  }): Promise<boolean>;
  listSupported(command: {
    readonly transaction: CurrencyBoundaryTransaction;
  }): Promise<readonly string[]>;
  /**
   * The member's preferred currency, else the workspace's default currency,
   * else nothing. A preference naming a currency the catalog no longer
   * supports counts as unset.
   */
  preferredFor(command: {
    readonly memberId: string;
    readonly transaction: CurrencyBoundaryTransaction;
    readonly workspaceId: string;
  }): Promise<string | undefined>;
}
