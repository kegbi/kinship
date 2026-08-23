import type { PeopleTransaction } from "../../people/public.ts";
import type { PersonFileActor, PersonFileStatus } from "./person_files.ts";

export interface StorageFileLookupItem {
  readonly byteSize: number;
  readonly createdAt: string;
  readonly fileId: string;
  readonly filename: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly personId?: string;
  readonly personName?: string;
  readonly status: PersonFileStatus;
  readonly title: string;
}

export interface StorageUsage {
  readonly available: number;
  readonly missing: number;
  readonly processing: number;
  readonly quarantined: number;
  readonly totalBytes: number;
  readonly totalFiles: number;
}

export interface StorageSettingsRepository {
  read(
    command: PersonFileActor & {
      readonly query?: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly files: readonly StorageFileLookupItem[];
      readonly status: "ready";
      readonly usage: StorageUsage;
    }
    | { readonly status: "forbidden" }
  >;
}

export interface StorageSettingsDependencies {
  readonly maximumUploadBytes: number;
  readonly provider: { readonly bucket: string; readonly name: string };
  readonly providerHealth: () => Promise<
    "available" | "not-initialized" | "unavailable"
  >;
  readonly repository: StorageSettingsRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export type StorageSettingsResult =
  | {
    readonly files: readonly StorageFileLookupItem[];
    readonly maximumUploadBytes: number;
    readonly provider: {
      readonly bucket: string;
      readonly health: "available" | "not-initialized" | "unavailable";
      readonly name: string;
    };
    readonly status: "ready";
    readonly usage: StorageUsage;
  }
  | { readonly status: "forbidden" | "unavailable" | "validation-error" };

export function createStorageSettings(
  dependencies: StorageSettingsDependencies,
) {
  return {
    get: async (
      actor: PersonFileActor,
      inputQuery?: string,
    ): Promise<StorageSettingsResult> => {
      if (actor.role === "member") return { status: "forbidden" };
      const query = inputQuery?.trim();
      if (query && query.length > 100) return { status: "validation-error" };
      try {
        const result = await dependencies.transaction.run((transaction) =>
          dependencies.repository.read({
            ...actor,
            ...(query ? { query } : {}),
            transaction,
          })
        );
        if (result.status !== "ready") return result;
        const health = await dependencies.providerHealth().catch(() =>
          "unavailable" as const
        );
        return {
          ...result,
          maximumUploadBytes: dependencies.maximumUploadBytes,
          provider: { ...dependencies.provider, health },
        };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

export type StorageSettings = ReturnType<typeof createStorageSettings>;
