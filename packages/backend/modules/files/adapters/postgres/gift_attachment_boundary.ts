import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  GiftAttachmentBoundary,
  GiftAttachmentTarget,
} from "../../ports/gift_attachment.ts";

/**
 * `files` owns the gift-to-file links, not the gift rows themselves. Which
 * gifts a workspace owns is the `gifts` module's question, so it arrives
 * through `GiftAttachmentTarget` rather than a join this module is not allowed
 * to write. The actor's standing is established by `ActorRevalidation` before
 * any of this runs.
 */
export class PostgresGiftAttachmentBoundary implements GiftAttachmentBoundary {
  constructor(private readonly gifts: GiftAttachmentTarget) {}

  async listForGifts(
    command: Parameters<GiftAttachmentBoundary["listForGifts"]>[0],
  ): Promise<Awaited<ReturnType<GiftAttachmentBoundary["listForGifts"]>>> {
    if (command.giftIds.length === 0) {
      return { links: [], status: "ready" };
    }
    const owned = await this.gifts.ownedGiftIds({
      giftIds: command.giftIds,
      transaction: command.transaction,
      workspaceId: command.workspaceId,
    });
    if (owned.length === 0) return { links: [], status: "ready" };
    const links = await sql<{
      readonly file_id: string;
      readonly gift_id: string;
    }>`
      select distinct on (link.gift_id)
        link.gift_id::text, link.file_id::text
      from crm.gift_file_links link
      where link.gift_id = any(${owned}::uuid[])
      order by link.gift_id, link.sort_order, link.file_id
    `.execute(databaseFromSession(command.transaction));
    return {
      links: links.rows.map((link) => ({
        fileId: link.file_id,
        giftId: link.gift_id,
      })),
      status: "ready",
    };
  }

  async validateForGift(
    command: Parameters<GiftAttachmentBoundary["validateForGift"]>[0],
  ): Promise<Awaited<ReturnType<GiftAttachmentBoundary["validateForGift"]>>> {
    const result = await sql<{ readonly id: string }>`
      select stored.id::text
      from crm.files stored
      where stored.id = ${command.fileId}::uuid
        and stored.workspace_id = ${command.workspaceId}::uuid
        and stored.status = 'available'
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? { status: "ready" } : { status: "not-found" };
  }

  async attachToGift(
    command: Parameters<GiftAttachmentBoundary["attachToGift"]>[0],
  ): Promise<Awaited<ReturnType<GiftAttachmentBoundary["attachToGift"]>>> {
    const owned = await this.gifts.ownedGiftIds({
      giftIds: [command.giftId],
      transaction: command.transaction,
      workspaceId: command.workspaceId,
    });
    if (owned.length === 0) return { status: "not-found" };
    const result = await sql<{ readonly gift_id: string }>`
      insert into crm.gift_file_links (gift_id, file_id, role, sort_order)
      select ${command.giftId}::uuid, stored.id, 'photo', 0
      from crm.files stored
      where stored.id = ${command.fileId}::uuid
        and stored.workspace_id = ${command.workspaceId}::uuid
        and stored.status = 'available'
      returning gift_id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? { status: "attached" } : { status: "not-found" };
  }
}
