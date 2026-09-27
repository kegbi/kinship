/**
 * Files composition. Only a declared composition root imports it.
 *
 * Two roots do. The API composes person files, the storage settings page, and
 * the import and export boundaries; the worker only needs the object store,
 * which `composeObjectStorage` builds on its own so neither root has to repeat
 * the S3 client wiring.
 */

import { Client as MinioClient } from "minio";
import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresFilePersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import {
  WebCryptoFileIdentifiers,
  WebCryptoObjectKeys,
} from "./adapters/crypto/file_identifiers.ts";
import {
  createObjectStorageRequestTransport,
  S3CompatibleObjectStorage,
} from "./adapters/object_storage/s3_compatible_object_storage.ts";
import { PostgresExportFileBoundary } from "./adapters/postgres/export_file_boundary.ts";
import { PostgresFileMetadataRepository } from "./adapters/postgres/file_metadata_repository.ts";
import { PostgresGiftAttachmentBoundary } from "./adapters/postgres/gift_attachment_boundary.ts";
import { PostgresFileImportBoundary } from "./adapters/postgres/import_file_boundary.ts";
import { PostgresStorageSettingsRepository } from "./adapters/postgres/storage_settings_repository.ts";
import { PostgresFileWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import { DeclaredMediaScanner } from "./adapters/scanning/declared_media_scanner.ts";
import {
  createPersonFileManagement,
  createStorageSettings,
  fileAuditFrom,
  type GiftAttachmentTarget,
  type ObjectStorage,
  PERSON_FILE_MAX_BYTES,
} from "./public.ts";

/** The deployment's S3-compatible endpoint, as a root resolves it. */
export interface ObjectStorageOptions {
  readonly accessKey: string;
  readonly bucket: string;
  readonly host: string;
  readonly port: number;
  readonly requestTimeoutMs: number;
  readonly secretKey: string;
  readonly useSsl: boolean;
}

export function composeObjectStorage(
  options: ObjectStorageOptions,
): ObjectStorage {
  return new S3CompatibleObjectStorage(
    new MinioClient({
      accessKey: options.accessKey,
      endPoint: options.host,
      port: options.port,
      secretKey: options.secretKey,
      transport: createObjectStorageRequestTransport(
        options.useSsl,
        options.requestTimeoutMs,
      ),
      useSSL: options.useSsl,
    }) as unknown as ConstructorParameters<typeof S3CompatibleObjectStorage>[0],
    options.bucket,
  );
}

export interface FilePorts {
  /** The gift a file may be attached to, composed by gifts. */
  readonly giftTarget: GiftAttachmentTarget;
  readonly objectStore: ObjectStorage;
}

export function composeFiles(shared: SharedComposition, ports: FilePorts) {
  const objects = {
    ids: new WebCryptoFileIdentifiers(),
    keys: new WebCryptoObjectKeys(),
    storage: ports.objectStore,
  };
  return {
    exportBoundary: new PostgresExportFileBoundary(shared.database, objects),
    files: createPersonFileManagement({
      actors: shared.actors,
      audit: fileAuditFrom(shared.audit),
      clock: shared.clock,
      ...objects,
      repository: new PostgresFileMetadataRepository(),
      scanner: new DeclaredMediaScanner(),
      transaction: shared.peopleTransaction,
    }),
    giftAttachments: new PostgresGiftAttachmentBoundary(ports.giftTarget),
    importBoundary: new PostgresFileImportBoundary(),
    lifecycleImpact: PostgresFileWorkspaceLifecycleImpact,
    storageSettings: createStorageSettings({
      actors: shared.actors,
      maximumUploadBytes: PERSON_FILE_MAX_BYTES,
      provider: {
        bucket: ports.objectStore.bucket,
        name: ports.objectStore.provider,
      },
      providerHealth: () => ports.objectStore.health(),
      repository: new PostgresStorageSettingsRepository(),
      transaction: shared.peopleTransaction,
    }),
  };
}

/**
 * This module's rows in a person merge (person file links, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function filePersonMergeParticipant(): PostgresFilePersonMergeParticipant {
  return new PostgresFilePersonMergeParticipant();
}
