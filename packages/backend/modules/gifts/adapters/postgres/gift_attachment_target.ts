import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
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
    const result = await sql<{ readonly id: string }>`
      select gift.id::text
      from crm.gifts gift
      where gift.workspace_id = ${command.workspaceId}::uuid
        and gift.id = any(${command.giftIds}::uuid[])
      order by gift.id
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => row.id);
  }
}
