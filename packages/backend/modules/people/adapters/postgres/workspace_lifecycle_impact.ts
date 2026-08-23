import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresPeopleWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<{ people: number; revision: string }>`
      select count(*)::int people,
        md5(jsonb_build_object(
          'people', coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb),
          'avatars', coalesce((select jsonb_agg(to_jsonb(t) order by t.person_id) from crm.person_avatars t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'dates', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.person_dates t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'meetings', coalesce((select jsonb_agg(to_jsonb(t) order by t.person_id) from crm.person_first_meetings t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'contacts', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.person_contact_methods t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'contactLabels', coalesce((select jsonb_agg(to_jsonb(t) order by t.contact_method_id, t.label_id) from crm.person_contact_method_labels t join crm.person_contact_methods method on method.id=t.contact_method_id join crm.people owned on owned.id=method.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'locations', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.locations t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'addresses', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.person_addresses t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'addressLabels', coalesce((select jsonb_agg(to_jsonb(t) order by t.address_id, t.label_id) from crm.person_address_labels t join crm.person_addresses address on address.id=t.address_id join crm.people owned on owned.id=address.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'organizations', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.organizations t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'occupations', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.person_occupations t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.tags t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'personTags', coalesce((select jsonb_agg(to_jsonb(t) order by t.person_id, t.tag_id) from crm.person_tags t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'pets', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.pets t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
      from crm.people p where p.workspace_id=${command.workspaceId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return { counts: { people: row.people }, revision: row.revision };
  }
}
