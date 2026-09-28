/**
 * What an export is, and what a member is allowed to see of one.
 *
 * An export run carries three things no reader may have: the identifier of the
 * stored artifact, the digest of the download token that was handed out, and
 * when that token stops working. `publicSummary` is the whole rule — the
 * record a member receives is the stored one minus exactly those three — and
 * it is here rather than beside the repository because forgetting it would
 * publish a token digest, not because it would read a row wrongly.
 *
 * The two windows are here for the same reason. How long a download link lives
 * and how long an artifact is kept are decisions about the product, not about
 * the clock the use case happens to hold.
 */

/** The formats a workspace export is produced in (GAP-050 adds two). */
export type ExportFormat = "csv" | "json" | "vcard";

/** One signed table of an artifact. */
export interface ExportRowSet {
  readonly count: number;
  readonly sha256: string;
}

/** What an artifact contains and what it is worth, signed row by row. */
export interface ExportManifest {
  readonly attachments: {
    readonly count: number;
    readonly items: readonly {
      readonly byteSize: number;
      readonly filename: string;
      readonly sha256: string;
    }[];
    readonly sha256: string;
  };
  readonly limitations: readonly string[];
  readonly profile: "csv" | "monica-json" | "vcard";
  readonly rows: {
    readonly contactMethods?: ExportRowSet;
    readonly dates?: ExportRowSet;
    readonly people: ExportRowSet;
  };
  readonly version: 1;
}

/** One export run, as a member sees it listed. */
export interface ExportSummary {
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly error?: string;
  readonly expiresAt?: string;
  readonly exportId: string;
  readonly format: ExportFormat;
  readonly manifest: ExportManifest;
  readonly status:
    | "cancelled"
    | "completed"
    | "expired"
    | "failed"
    | "pending"
    | "running";
}

/** The run with the three fields only this module may see. */
export interface StoredExport extends ExportSummary {
  readonly downloadDigest?: string;
  readonly downloadExpiresAt?: string;
  readonly fileId?: string;
}

/** How long a download link works, and how long the artifact is kept. */
export const EXPORT_WINDOWS = {
  /** A download link is a one-shot credential, so it lives for minutes. */
  downloadMs: 5 * 60 * 1_000,
  /** The artifact itself outlives a weekend away from the laptop. */
  artifactMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

/** The run without the artifact identifier or the download credential. */
export function publicSummary(stored: StoredExport): ExportSummary {
  const {
    downloadDigest: _digest,
    downloadExpiresAt: _downloadExpiry,
    fileId: _fileId,
    ...summary
  } = stored;
  return summary;
}
