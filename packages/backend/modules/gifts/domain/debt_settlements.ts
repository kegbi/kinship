import {
  decodeCursor,
  encodeCursor,
} from "../../../shared-kernel/pagination.ts";
import {
  boundedText,
  isInstant,
  uuid,
} from "../../../shared-kernel/validation.ts";

export interface SettlementDetails {
  readonly settlementReason?: string;
  readonly settlementPhotoFileId?: string;
}

export interface DebtSettlement {
  readonly id: string;
  readonly settledAt: string;
  readonly reason?: string;
  readonly photoFileId?: string;
  readonly photoFilename?: string;
  readonly photoAvailable?: boolean;
}

export interface SettlementAnchor {
  readonly id: string;
  readonly settledAt: string;
}

export function settlementDetails(
  input: SettlementDetails,
): SettlementDetails | undefined {
  const reason = boundedText(input.settlementReason, 10_000);
  if (
    (input.settlementReason !== undefined && !reason) ||
    (input.settlementPhotoFileId !== undefined &&
      !uuid(input.settlementPhotoFileId))
  ) return undefined;
  return {
    ...(reason ? { settlementReason: reason } : {}),
    ...(input.settlementPhotoFileId
      ? { settlementPhotoFileId: input.settlementPhotoFileId }
      : {}),
  };
}

export function settlementCursor(
  anchor: SettlementAnchor,
  workspaceId: string,
  personId: string,
  debtId: string,
): string {
  return encodeCursor({ ...anchor, workspaceId, personId, debtId, version: 1 });
}

export function settlementAnchor(
  value: string,
  workspaceId: string,
  personId: string,
  debtId: string,
): SettlementAnchor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<SettlementAnchor> & {
      workspaceId?: string;
      personId?: string;
      debtId?: string;
      version?: number;
    }
    | undefined;
  if (
    parsed?.version !== 1 || parsed.workspaceId !== workspaceId ||
    parsed.personId !== personId || parsed.debtId !== debtId ||
    !uuid(parsed.id) || !isInstant(parsed.settledAt)
  ) return undefined;
  return { id: parsed.id!, settledAt: parsed.settledAt! };
}
