import type { Failure } from "../../../shared-kernel/result.ts";
import type { ObjectStorage } from "../ports/object_storage.ts";

export interface ExportFileActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ExportFileBoundary {
  discard(command: ExportFileActor & { readonly fileId: string }): Promise<
    Failure<"forbidden" | "unavailable", "discarded">
  >;
  recover(command: ExportFileActor & { readonly exportId: string }): Promise<
    | {
      readonly bytes: Uint8Array;
      readonly fileId: string;
      readonly status: "stored";
    }
    | Failure<"forbidden" | "unavailable", "absent">
  >;
  read(command: ExportFileActor & { readonly fileId: string }): Promise<
    | {
      readonly bytes: Uint8Array;
      readonly filename: string;
      readonly mimeType: string;
      readonly status: "ready";
    }
    | Failure<"forbidden" | "not-found" | "unavailable", "missing">
  >;
  store(
    command: ExportFileActor & {
      readonly bytes: Uint8Array;
      readonly checksumSha256: string;
      readonly exportId: string;
      readonly filename: string;
      readonly mimeType: string;
    },
  ): Promise<
    | { readonly fileId: string; readonly status: "stored" }
    | Failure<"forbidden" | "unavailable">
  >;
}

export interface ExportFileBoundaryDependencies {
  readonly ids: { next(): string };
  readonly keys: { next(): string };
  readonly storage: ObjectStorage;
}
