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
import { publicSummary } from "../domain/export_rules.ts";
import { EXPORT_WINDOWS } from "../domain/export_rules.ts";
import {
  MAX_PORTABLE_PEOPLE,
  PORTABLE_MIME_TYPE,
  PORTABLE_TOO_LARGE,
  type PortableArtifact,
  portableArtifact,
  portableFilename,
  readPortableArtifact,
} from "../domain/formats/portable_json.ts";
import type { ExportActor } from "../ports/context.ts";
import { active, type ExportManagementDependencies } from "./export_context.ts";

export function createExportArtifact(
  dependencies: ExportManagementDependencies,
) {
  return {
    createWorkspace: async (actor: ExportActor) => {
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
            startedAt,
            transaction,
          });
          if (claim.created) {
            await dependencies.audit.record({
              action: "requested",
              actor,
              exportId: claim.exportId,
              occurredAt: startedAt,
              payload: { format: "json" },
              transaction,
            });
          }
          return claim;
        },
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

          let artifact = await dependencies.files.recover({
            ...actor,
            exportId: claimed.exportId,
          }).catch(() => ({ status: "unavailable" as const }));
          let prepared: PortableArtifact | undefined =
            artifact.status === "stored"
              ? await readPortableArtifact(artifact.bytes)
              : undefined;
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
            const people = await dependencies.people.listWorkspace({
              actor,
              transaction,
            });
            if (people.length > MAX_PORTABLE_PEOPLE) {
              await dependencies.repository.fail({
                actor,
                error: PORTABLE_TOO_LARGE,
                exportId: claimed.exportId,
                failedAt: dependencies.clock.now(),
                transaction,
              });
              return { status: "too-large" as const };
            }
            const built = await portableArtifact(people);
            const stored = await dependencies.files.store({
              ...actor,
              bytes: built.bytes,
              checksumSha256: built.checksumSha256,
              exportId: claimed.exportId,
              filename: portableFilename(claimed.exportId),
              mimeType: PORTABLE_MIME_TYPE,
            }).catch(() => ({ status: "unavailable" as const }));
            if (stored.status !== "stored") return stored;
            artifact = { ...stored, bytes: built.bytes };
            prepared = built;
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
      );
    },
  };
}
