/**
 * Producing a workspace's portable artifact.
 *
 * The run is claimed in one transaction and the work is done in a second, so a
 * member who asks twice joins the run that already exists instead of starting
 * a rival one. The second transaction re-reads the run under lock, and then
 * asks the files module whether the bytes are already there: an interrupted
 * run that got as far as storing its artifact finishes from those bytes rather
 * than rebuilding them, and one whose stored bytes no longer verify discards
 * them and starts again. `domain/formats/portable_json.ts` decides what
 * verifying means, because that is a question about the format.
 *
 * The size limit is a failure of the run rather than a refusal of the request:
 * the member asked for something this profile cannot produce, and the run
 * records why so the answer survives being asked again.
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import { displayName, type ExportPerson } from "../../people/public.ts";
import {
  EXPORT_WINDOWS,
  type ExportFormat,
  type ExportManifest,
  publicSummary,
} from "../domain/export_rules.ts";
import { sha256Hex } from "../domain/formats/canonical.ts";
import {
  csvArtifact,
  vcardArtifact,
} from "../domain/formats/contacts_export.ts";
import {
  MAX_PORTABLE_PEOPLE,
  PORTABLE_MIME_TYPE,
  PORTABLE_TOO_LARGE,
  portableArtifact,
  portableFilename,
  readPortableArtifact,
} from "../domain/formats/portable_json.ts";
import type { ExportActor } from "../ports/context.ts";
import { active, type ExportManagementDependencies } from "./export_context.ts";

/** What any format answers with, ready to be stored. */
interface BuiltArtifact {
  readonly bytes: Uint8Array;
  readonly checksumSha256: string;
  readonly filename: string;
  readonly manifest: ExportManifest;
  readonly mimeType: string;
  readonly people: number;
}

/** The artifact of `format` for `people`. */
async function built(
  format: ExportFormat,
  people: readonly ExportPerson[],
  exportId: string,
): Promise<BuiltArtifact> {
  if (format === "csv") return await csvArtifact(people, exportId);
  if (format === "vcard") {
    return await vcardArtifact(people, displayName, exportId);
  }
  return {
    ...await portableArtifact(people),
    filename: portableFilename(exportId),
    mimeType: PORTABLE_MIME_TYPE,
  };
}

export function createExportArtifact(
  dependencies: ExportManagementDependencies,
) {
  return {
    /**
     * Produces the workspace's artifact in `format` (GAP-050 adds `csv` and
     * `vcard` beside the portable JSON). A stored JSON artifact re-verifies
     * itself; a stored CSV or vCard artifact is kept when rebuilding it from
     * the same people produces the same bytes, and discarded otherwise.
     */
    createWorkspace: async (
      actor: ExportActor,
      format: ExportFormat = "json",
    ) => {
      if (actor.role === "member") return { status: "forbidden" as const };
      const startedAt = dependencies.clock.now();
      const claimed = await dependencies.transaction.run(
        async (transaction) => {
          if (!(await active(dependencies, actor, transaction))) {
            return undefined;
          }
          const claim = await dependencies.repository.startOrResume({
            actor,
            exportId: dependencies.ids.next(),
            format,
            startedAt,
            transaction,
          });
          if (claim.created) {
            await dependencies.audit.record({
              action: "requested",
              actor,
              exportId: claim.exportId,
              occurredAt: startedAt,
              payload: { format },
              transaction,
            });
          }
          return claim;
        },
        { workspaceId: actor.workspaceId },
      );
      if (!claimed) return { status: "forbidden" as const };
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          const locked = await dependencies.repository.lock(
            actor,
            claimed.exportId,
            transaction,
          );
          if (!locked) return { status: "unavailable" as const };
          if (locked.status === "completed") return publicSummary(locked);
          if (locked.status !== "running") {
            return { status: "unavailable" as const };
          }

          const listPeople = async () => {
            const people = await dependencies.people.listWorkspace({
              actor,
              transaction,
            });
            return people.length > MAX_PORTABLE_PEOPLE ? undefined : people;
          };
          let artifact = await dependencies.files.recover({
            ...actor,
            exportId: claimed.exportId,
          }).catch(() => ({ status: "unavailable" as const }));
          let prepared: BuiltArtifact | undefined;
          if (artifact.status === "stored") {
            const bytes = artifact.bytes;
            if (format === "json") {
              const portable = await readPortableArtifact(bytes);
              prepared = portable && {
                ...portable,
                filename: portableFilename(claimed.exportId),
                mimeType: PORTABLE_MIME_TYPE,
              };
            } else {
              const people = await listPeople();
              const rebuilt = people &&
                await built(format, people, claimed.exportId);
              prepared = rebuilt &&
                  rebuilt.checksumSha256 === await sha256Hex(bytes)
                ? rebuilt
                : undefined;
            }
          }
          if (artifact.status === "stored" && !prepared) {
            const discarded = await dependencies.files.discard({
              ...actor,
              fileId: artifact.fileId,
            }).catch(() => ({ status: "unavailable" as const }));
            if (discarded.status !== "discarded") {
              return { status: "unavailable" as const };
            }
            artifact = { status: "absent" as const };
          }
          if (
            artifact.status === "unavailable" || artifact.status === "forbidden"
          ) {
            return { status: "unavailable" as const };
          }

          if (artifact.status === "absent") {
            const people = await listPeople();
            if (!people) {
              await dependencies.repository.fail({
                actor,
                error: PORTABLE_TOO_LARGE,
                exportId: claimed.exportId,
                failedAt: dependencies.clock.now(),
                transaction,
              });
              return { status: "too-large" as const };
            }
            const next = await built(format, people, claimed.exportId);
            const stored = await dependencies.files.store({
              ...actor,
              bytes: next.bytes,
              checksumSha256: next.checksumSha256,
              exportId: claimed.exportId,
              filename: next.filename,
              mimeType: next.mimeType,
            }).catch(() => ({ status: "unavailable" as const }));
            if (stored.status !== "stored") return stored;
            artifact = { ...stored, bytes: next.bytes };
            prepared = next;
          }
          if (!prepared || artifact.status !== "stored") {
            return { status: "unavailable" as const };
          }
          const completedAt = dependencies.clock.now();
          const summary = await dependencies.repository.complete({
            actor,
            completedAt,
            expiresAt: new Date(
              completedAt.getTime() + EXPORT_WINDOWS.artifactMs,
            ),
            exportId: claimed.exportId,
            fileId: artifact.fileId,
            manifest: prepared.manifest,
            transaction,
          });
          await dependencies.audit.record({
            action: "completed",
            actor,
            exportId: claimed.exportId,
            occurredAt: completedAt,
            payload: {
              checksumSha256: prepared.checksumSha256,
              people: prepared.people,
            },
            transaction,
          });
          return summary;
        },
        { workspaceId: actor.workspaceId },
      );
    },
  };
}
