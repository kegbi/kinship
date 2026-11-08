import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import {
  settlementAnchor,
  settlementCursor,
  type SettlementDetails,
} from "../domain/debt_settlements.ts";
import type { GiftActor, GiftTransaction } from "../ports/context.ts";
import {
  active,
  AttachmentFailure,
  type GiftManagementDependencies,
} from "./gift_context.ts";

/** Called only after a debt actually enters settled, inside its write transaction. */
export async function recordSettlement(
  dependencies: GiftManagementDependencies,
  actor: GiftActor,
  personId: string,
  debtId: string,
  occurredAt: Date,
  details: SettlementDetails,
  transaction: GiftTransaction,
): Promise<void> {
  let photo: { photoFileId: string; photoFilename: string } | undefined;
  if (details.settlementPhotoFileId) {
    const checked = await dependencies.attachments.validateSettlementPhoto({
      ...actor,
      personId,
      fileId: details.settlementPhotoFileId,
      transaction,
    });
    if (checked.status !== "ready") throw new AttachmentFailure(checked.status);
    photo = {
      photoFileId: details.settlementPhotoFileId,
      photoFilename: checked.filename,
    };
  }
  await dependencies.repository.recordSettlement({
    ...actor,
    id: dependencies.ids.next(),
    debtId,
    occurredAt,
    ...(details.settlementReason ? { reason: details.settlementReason } : {}),
    ...photo,
    transaction,
  });
}

export function createDebtSettlementReads(
  dependencies: GiftManagementDependencies,
) {
  return async (
    actor: GiftActor,
    personId: string,
    debtId: string,
    input: { readonly cursor?: string; readonly limit?: number } = {},
  ) => {
    const after = input.cursor
      ? settlementAnchor(input.cursor, actor.workspaceId, personId, debtId)
      : undefined;
    if (input.cursor && !after) return { status: "validation-error" as const };
    return await runOrUnavailable(
      dependencies.transaction,
      async (transaction) => {
        if (!await active(dependencies, actor, transaction, false)) {
          return {
            status: "forbidden" as const,
          };
        }
        const result = await dependencies.repository.listSettlements({
          ...actor,
          personId,
          debtId,
          ...(after ? { after } : {}),
          limit: Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))),
          transaction,
        });
        if (result.status !== "ready") return result;
        const available = await dependencies.attachments
          .availableSettlementPhotos({
            ...actor,
            personId,
            fileIds: result.settlements.flatMap((event) =>
              event.photoFileId ? [event.photoFileId] : []
            ),
            transaction,
          });
        return {
          status: "ready" as const,
          settlements: result.settlements.map((event) => ({
            ...event,
            ...(event.photoFilename
              ? {
                photoAvailable: event.photoFileId !== undefined &&
                  available.includes(event.photoFileId),
              }
              : {}),
          })),
          ...(result.next
            ? {
              nextCursor: settlementCursor(
                result.next,
                actor.workspaceId,
                personId,
                debtId,
              ),
            }
            : {}),
        };
      },
      { workspaceId: actor.workspaceId },
    );
  };
}
