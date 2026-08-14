export type VerificationFailure = "expired" | "invalid" | "replayed";

export type VerificationResult =
  | { readonly status: "verified"; readonly entryToken: string }
  | { readonly status: VerificationFailure };

export interface ApplicationEntryContext {
  readonly firstName: string;
  readonly memberId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export interface EmailVerificationFacade {
  verify(rawToken: string): Promise<VerificationResult>;
  consumeApplicationEntry(
    rawToken: string,
  ): Promise<ApplicationEntryContext | undefined>;
}
