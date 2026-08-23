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
}
