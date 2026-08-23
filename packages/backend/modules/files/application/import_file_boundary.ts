import { PERSON_FILE_MAX_BYTES } from "./person_files.ts";

export interface FileImportBoundary {
  representMissing(command: {
    readonly actor: {
      readonly memberId: string;
      readonly role: "admin" | "member" | "owner";
      readonly userId: string;
      readonly workspaceId: string;
    };
    readonly byteSize: number;
    readonly fileId: string;
    readonly importId: string;
    readonly originalFilename: string;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}

export function assertImportFileRepresentable(command: {
  readonly byteSize: number;
  readonly originalFilename: string;
}): void {
  if (
    !Number.isSafeInteger(command.byteSize) || command.byteSize < 0 ||
    command.byteSize > PERSON_FILE_MAX_BYTES ||
    !command.originalFilename.trim()
  ) throw new Error("Imported file manifest entry is not representable.");
}
