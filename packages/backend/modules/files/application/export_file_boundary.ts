import type { ObjectStorage } from "./person_files.ts";

export interface ExportFileActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ExportFileBoundary {
  discard(command: ExportFileActor & { readonly fileId: string }): Promise<
    { readonly status: "discarded" | "forbidden" | "unavailable" }
  >;
  recover(command: ExportFileActor & { readonly exportId: string }): Promise<
    | {
      readonly bytes: Uint8Array;
      readonly fileId: string;
      readonly status: "stored";
    }
    | { readonly status: "absent" | "forbidden" | "unavailable" }
  >;
  read(command: ExportFileActor & { readonly fileId: string }): Promise<
    | {
      readonly bytes: Uint8Array;
      readonly filename: string;
      readonly mimeType: string;
      readonly status: "ready";
    }
    | {
      readonly status:
        | "forbidden"
        | "missing"
        | "not-found"
        | "unavailable";
    }
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
    | { readonly status: "forbidden" | "unavailable" }
  >;
}

export interface ExportFileBoundaryDependencies {
  readonly ids: { next(): string };
  readonly keys: { next(): string };
  readonly storage: ObjectStorage;
}
