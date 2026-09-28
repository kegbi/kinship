import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ContactMethodTypeCatalog,
  ContactMethodTypeChoice,
  ContactMethodTypeKind,
} from "../../ports/contact_method_types.ts";

export class PostgresContactMethodTypeCatalog
  implements ContactMethodTypeCatalog {
  async byKind(
    command: Parameters<ContactMethodTypeCatalog["byKind"]>[0],
  ): Promise<
    Readonly<Partial<Record<ContactMethodTypeKind, ContactMethodTypeChoice>>>
  > {
    // A type with the kind wins over a custom type that only has the name.
    const result = await sql<{
      readonly by_name: boolean;
      readonly id: string;
      readonly kind: ContactMethodTypeKind;
      readonly name: string;
    }>`
      select distinct on (matched.kind) matched.kind, matched.id::text,
        matched.name, matched.by_name
      from (
        select kind, id, name, sort_order, false as by_name
        from crm.contact_method_types
        where workspace_id = ${command.workspaceId}::uuid and not is_archived
          and kind in ('email', 'phone', 'url')
        union all
        select case lower(trim(name))
            when 'email' then 'email' when 'phone' then 'phone' else 'url'
          end, id, name, sort_order, true
        from crm.contact_method_types
        where workspace_id = ${command.workspaceId}::uuid and not is_archived
          and kind = 'custom'
          and lower(trim(name)) in ('email', 'phone', 'website', 'url')
      ) matched
      order by matched.kind, matched.by_name, matched.sort_order,
        lower(matched.name), matched.id
    `.execute(databaseFromSession(command.transaction));
    return Object.fromEntries(
      result.rows.map((row) => [row.kind, {
        byName: row.by_name,
        id: row.id,
        name: row.name,
      }]),
    );
  }
}
