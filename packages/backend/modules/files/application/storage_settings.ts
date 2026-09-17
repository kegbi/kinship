/**
 * What an administrator is shown about the workspace's storage.
 *
 * Two things happen here and only two: a member is refused before anything is
 * read, because the page is an administrator's, and the provider's health is
 * asked outside the transaction, because it is a network call to a service
 * that is not in the database's unit of work and a slow or broken provider
 * must not hold a transaction open. The totals and the lookup are the
 * repository's; the shapes they come back in are the port's.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type {
  PersonFileActor,
  PersonFileTransactionRunner,
} from "../ports/context.ts";
import type {
  StorageFileLookupItem,
  StorageSettingsRepository,
  StorageUsage,
} from "../ports/storage_settings_repository.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface StorageSettingsDependencies {
  readonly actors: ActorRevalidation;
  readonly maximumUploadBytes: number;
  readonly provider: { readonly bucket: string; readonly name: string };
  readonly providerHealth: () => Promise<
    "available" | "not-initialized" | "unavailable"
  >;
  readonly repository: StorageSettingsRepository;
  readonly transaction: PersonFileTransactionRunner;
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
  // A rejected query names no field, so this is the module's own bare
  // `validation-error` rather than the kernel's payload-carrying one.
  | Failure<"forbidden" | "unavailable", "validation-error">;

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
      const result = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          const standing = await dependencies.actors.revalidate({
            ...actor,
            lock: false,
            transaction,
          });
          if (standing === "revoked") return { status: "forbidden" as const };
          return await dependencies.repository.read({
            ...actor,
            ...(query ? { query } : {}),
            transaction,
          });
        },
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
    },
  };
}

export type StorageSettings = ReturnType<typeof createStorageSettings>;
