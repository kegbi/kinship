/**
 * Integrations composition. Only a declared composition root imports it.
 *
 * The bridges that turn a remote card into a person or a task belong to the
 * root, because they cross into people and planning; everything a DAV
 * subscription needs of its own is built here.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresDavPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import { AesGcmDavSecretBox } from "./adapters/crypto/dav_secret_box.ts";
import { HttpDavClient } from "./adapters/dav/http_dav_client.ts";
import { PostgresDavRepository } from "./adapters/postgres/dav_repository.ts";
import { PostgresIntegrationWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import type { DavEncryptionKeyset } from "./adapters/crypto/dav_secret_box.ts";
import type { DavSyncDependencies } from "./application/dav_context.ts";
import {
  createDavSyncManagement,
  davAuditFrom,
  type DavRemoteClient,
} from "./public.ts";

export { decodeDavEncryptionKeyset } from "./adapters/crypto/dav_secret_box.ts";

/**
 * The local identifier a remote object keeps across syncs.
 *
 * A remote href is not a UUID, and the same card must land on the same row
 * every time it is seen, so the href is hashed into a stable v8-shaped UUID
 * inside the `kinship.dav.remote.v1` namespace.
 */
export async function remoteObjectId(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`kinship.dav.remote.v1\u0000${value}`),
    ),
  );
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

export interface DavPorts {
  readonly keyset: DavEncryptionKeyset;
  /** The person side of a synchronized contact card. */
  readonly people: DavSyncDependencies["people"];
  /** A test double, or the real CardDAV client when absent. */
  readonly remote: DavRemoteClient | undefined;
  /** The task side of a synchronized to-do. */
  readonly tasks: DavSyncDependencies["tasks"];
}

/** The share of a workspace cascade integrations contributes. */
export function composeIntegrations() {
  return { lifecycleImpact: PostgresIntegrationWorkspaceLifecycleImpact };
}

/** The optional DAV provider, absent when the deployment disables it. */
export function composeDavSync(
  shared: SharedComposition,
  ports: DavPorts,
) {
  return createDavSyncManagement({
    clock: shared.clock,
    ids: { create: () => shared.ids.create(), fromRemote: remoteObjectId },
    people: ports.people,
    remote: ports.remote ?? new HttpDavClient(),
    repository: new PostgresDavRepository(
      shared.database,
      davAuditFrom(shared.audit),
      shared.actors,
    ),
    secrets: new AesGcmDavSecretBox(ports.keyset),
    tasks: ports.tasks,
  });
}

/**
 * This module's rows in a person merge (DAV objects, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function davPersonMergeParticipant(): PostgresDavPersonMergeParticipant {
  return new PostgresDavPersonMergeParticipant();
}
