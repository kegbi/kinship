import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { GiftAttachmentBoundary } from "../../application/person_files.ts";

const activeActor = (command: {
  readonly memberId: string;
  readonly role: string;
  readonly userId: string;
  readonly workspaceId: string;
}) =>
  sql`
    account.id = ${command.userId}::uuid
    and account.status = 'active' and account.deleted_at is null
    and member.id = ${command.memberId}::uuid
    and member.workspace_id = ${command.workspaceId}::uuid
    and member.user_id = account.id and member.role = ${command.role}
    and member.status = 'active' and member.left_at is null
    and workspace.id = ${command.workspaceId}::uuid
    and workspace.status = 'active' and workspace.deleted_at is null
  `;

export class PostgresGiftAttachmentBoundary implements GiftAttachmentBoundary {
  async listForGifts(
    command: Parameters<GiftAttachmentBoundary["listForGifts"]>[0],
  ): Promise<Awaited<ReturnType<GiftAttachmentBoundary["listForGifts"]>>> {
    const database = databaseFromSession(command.transaction);
    const authorized = await sql<{ readonly authorized: boolean }>`
      select true as authorized
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where ${activeActor(command)}
    `.execute(database);
    if (authorized.rows[0]?.authorized !== true) {
      return { status: "forbidden" };
    }
    if (command.giftIds.length === 0) {
      return { links: [], status: "ready" };
    }
    const links = await sql<{
      readonly file_id: string;
      readonly gift_id: string;
    }>`
      select distinct on (link.gift_id)
        link.gift_id::text, link.file_id::text
      from crm.gift_file_links link
      join crm.gifts gift on gift.id = link.gift_id
        and gift.workspace_id = ${command.workspaceId}::uuid
      where link.gift_id = any(${command.giftIds}::uuid[])
      order by link.gift_id, link.sort_order, link.file_id
    `.execute(database);
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
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      join crm.files stored on stored.workspace_id = workspace.id
        and stored.id = ${command.fileId}::uuid
        and stored.status = 'available'
      where ${activeActor(command)}
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? { status: "ready" } : { status: "not-found" };
  }

  async attachToGift(
    command: Parameters<GiftAttachmentBoundary["attachToGift"]>[0],
  ): Promise<Awaited<ReturnType<GiftAttachmentBoundary["attachToGift"]>>> {
    const result = await sql<{ readonly gift_id: string }>`
      with authorized as (
        select gift.id
        from crm.users account
        join crm.workspace_members member on member.user_id = account.id
        join crm.workspaces workspace on workspace.id = member.workspace_id
        join crm.gifts gift on gift.workspace_id = workspace.id
          and gift.id = ${command.giftId}::uuid
        join crm.files stored on stored.workspace_id = workspace.id
          and stored.id = ${command.fileId}::uuid
          and stored.status = 'available'
        where ${activeActor(command)}
      )
      insert into crm.gift_file_links (gift_id, file_id, role, sort_order)
      select authorized.id, ${command.fileId}::uuid, 'photo', 0
      from authorized
      returning gift_id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? { status: "attached" } : { status: "not-found" };
  }
}
