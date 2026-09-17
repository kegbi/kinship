/**
 * Where the bytes live, and who looks at them first.
 *
 * Object storage is the one port with no transaction: an object store is not
 * in the database's unit of work, which is exactly why the upload is staged —
 * the row is reserved, the bytes are put, and only then is the row finalised,
 * so a put that fails leaves a row that says so rather than a row that lies.
 * `bucket` and `provider` are on the port because the reserved row records
 * where the bytes were sent.
 *
 * The scanner is the other half of that staging: it answers about bytes it was
 * handed, before anything is written, so a file that is not clean is stored
 * quarantined rather than served and withdrawn later.
 */

export interface ObjectStorage {
  readonly bucket: string;
  readonly provider: string;
  get(command: { readonly key: string }): Promise<Uint8Array | undefined>;
  health(): Promise<"available" | "not-initialized" | "unavailable">;
  put(command: {
    readonly bytes: Uint8Array;
    readonly key: string;
    readonly mimeType?: string;
  }): Promise<void>;
  remove(command: { readonly key: string }): Promise<void>;
}

export interface FileScanner {
  inspect(command: {
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly mimeType: string;
  }): Promise<"clean" | "quarantined">;
}
