import type { ImportedPersonReference } from "../../../people/public.ts";
import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { GiftBusinessImportBoundary } from "../../application/import_business_boundary.ts";

export class PostgresGiftBusinessImportBoundary
  implements GiftBusinessImportBoundary {
  constructor(private readonly people: ImportedPersonReference) {}
  async importRecords(
    command: Parameters<GiftBusinessImportBoundary["importRecords"]>[0],
  ): Promise<void> {
    const db = databaseFromSession(command.transaction),
      workspace = command.actor.workspaceId;
    for (const { id, data: d, references: r } of command.records) {
      for (const personId of [r.personId, r.recipientId].filter(Boolean)) {
        const person = await this.people.existsForImport({
          ...command.actor,
          personIds: [personId!],
          transaction: command.transaction,
        });
        if (!person) {
          throw new Error(
            "Imported gift person reference is outside the workspace.",
          );
        }
      }
      const created = d.createdAt ?? null,
        updated = d.updatedAt ?? d.createdAt ?? null;
      if (d.kind === "debt") {
        if (d.repairBefore) {
          const old = d.repairExpected as
            | Readonly<Record<string, unknown>>
            | undefined;
          await sql`update crm.debts set amount=${d.amount}::numeric,currency_code=${d.currencyCode},updated_at=now() where id=${id}::uuid and workspace_id=${workspace}::uuid and person_id=${r.personId}::uuid and currency_code is null and updated_at <= ${d.repairBefore}::timestamptz and amount=${
            old?.amount ?? null
          }::numeric and direction=${d.direction} and status=${d.status} and reason is not distinct from ${
            d.reason ?? null
          }`.execute(db);
          continue;
        }
        const inserted = await sql<
          { readonly id: string }
        >`insert into crm.debts (id,workspace_id,person_id,direction,status,amount,currency_code,reason,settled_at,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${r.personId}::uuid,${d.direction},${d.status},${d.amount}::numeric,${
          d.currencyCode ?? null
        },${d.reason ?? null},${
          d.settledAt ?? null
        }::text::timestamptz,coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing returning id::text`
          .execute(db);
        if (d.status === "settled" && inserted.rows[0]) {
          await sql`insert into crm.debt_settlements (id,workspace_id,debt_id,settled_at)
            values (${id}::uuid,${workspace}::uuid,${id}::uuid,${d.settledAt}::text::timestamptz)
            on conflict (id) do nothing`.execute(db);
        }
      } else if (d.kind === "gift") {
        await sql`insert into crm.gifts (id,workspace_id,person_id,recipient_person_id,name,url,comment,status,event_at,amount,currency_code,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${r.personId}::uuid,${
          r.recipientId ?? null
        }::uuid,${d.name},${d.url ?? null},${d.comment ?? null},${d.status},${
          d.eventAt ?? null
        }::timestamptz,${d.amount ?? null}::numeric,${
          d.currencyCode ?? null
        },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
          .execute(db);
      } else throw new Error("Unsupported gift import record.");
    }
  }
}
