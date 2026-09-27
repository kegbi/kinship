import { schemaDatabaseFromSession } from "../../../../platform/postgres/session.ts";
import type { GiftAttachmentTarget } from "../../../files/public.ts";

/**
 * The `gifts` side of the attachment edge. `files` owns `gift_file_links` and
 * must not read `crm.gifts`, so this module answers which of the named gifts
 * the workspace owns and `files` links only those.
 */
export class PostgresGiftAttachmentTarget implements GiftAttachmentTarget {
  async ownedGiftIds(
    command: Parameters<GiftAttachmentTarget["ownedGiftIds"]>[0],
  ): Promise<readonly string[]> {
    if (command.giftIds.length === 0) return [];
    const rows = await schemaDatabaseFromSession(command.transaction)
      .selectFrom("crm.gifts as gift")
      .select((eb) => eb.cast<string>(eb.ref("gift.id"), "text").as("id"))
      .where("gift.workspace_id", "=", command.workspaceId)
      .where("gift.id", "in", command.giftIds)
      .orderBy("gift.id")
      .execute();
    return rows.map((row) => row.id);
  }
}
