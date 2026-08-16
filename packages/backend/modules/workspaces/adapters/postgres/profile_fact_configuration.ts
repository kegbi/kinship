import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

type Section =
  | "addresses"
  | "contact-methods"
  | "first-meeting"
  | "food-preferences"
  | "pets"
  | "tags"
  | "work";

interface InspectionCommand {
  readonly includeOptions?: boolean;
  readonly lock?: boolean;
  readonly optionAfter?: OptionAnchor;
  readonly optionLimit?: number;
  readonly optionSearch?: string;
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly section: Section;
  readonly selectedOptionIds?: readonly string[];
  readonly selectedOnly?: boolean;
  readonly transaction: { readonly opaque: unknown };
  readonly userId: string;
  readonly value?: unknown;
  readonly workspaceId: string;
}

interface Option {
  readonly id: string;
  readonly kind?: "contact-label" | "contact-type" | "pet-category";
  readonly name: string;
}

interface OptionAnchor {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
}

interface OptionRow extends Option {
  readonly sort_primary: string;
  readonly sort_secondary: string;
}

export class PostgresProfileFactConfiguration {
  async inspect(command: InspectionCommand): Promise<{
    readonly hasMore?: boolean;
    readonly nextOptionAnchor?: OptionAnchor;
    readonly options: readonly Option[];
    readonly status: "hidden" | "invalid-reference" | "ready" | "stale-cursor";
  }> {
    const database = databaseFromSession(command.transaction);
    const optionLimit = Math.min(
      Math.max(command.optionLimit ?? 100, 1),
      1_051,
    );
    const optionSearch = command.optionSearch?.trim().toLowerCase() ?? "";
    const selectedOnly = command.selectedOnly === true ||
      command.value !== undefined;
    const queryLimit = selectedOnly ? optionLimit : optionLimit + 1;
    const moduleLock = command.lock ? sql`for update` : sql``;
    const module = await sql<{ readonly is_active: boolean }>`
      select is_active from crm.workspace_profile_modules
      where workspace_id = ${command.workspaceId}::uuid
        and key = ${command.section}
      ${moduleLock}
    `.execute(database);
    if (module.rows[0]?.is_active === false) {
      return { options: [], status: "hidden" };
    }
    if (
      command.includeOptions === false && command.value === undefined &&
      !command.selectedOptionIds?.length
    ) {
      return { options: [], status: "ready" };
    }
    if (command.section === "contact-methods") {
      const value = command.value as {
        readonly labelIds?: readonly string[];
        readonly typeId?: string;
      } | undefined;
      const selected = command.selectedOptionIds ?? [
        ...(value?.typeId ? [value.typeId] : []),
        ...(value?.labelIds ?? []),
      ];
      if (command.optionAfter) {
        const anchor = await sql<OptionRow>`
          select option.id, option.kind, option.name,
            case when option.kind = 'contact-type' then '0' else '1' end as sort_primary,
            lower(option.name) as sort_secondary
          from (
            select id::text, 'contact-type'::text as kind, name
            from crm.contact_method_types
            where id = ${command.optionAfter.id}::uuid
              and workspace_id = ${command.workspaceId}::uuid
              and not is_archived
            union all
            select id::text, 'contact-label'::text as kind,
              coalesce(label, translation_key, 'Contact label') as name
            from crm.contact_labels
            where id = ${command.optionAfter.id}::uuid
              and workspace_id = ${command.workspaceId}::uuid
              and applies_to in ('any', 'contact_method')
          ) option
          where ${optionSearch} = '' or
            strpos(lower(option.name), ${optionSearch}) > 0
        `.execute(database);
        if (
          !anchor.rows.some((row) =>
            row.sort_primary === command.optionAfter?.primary &&
            row.sort_secondary === command.optionAfter?.secondary
          )
        ) return { options: [], status: "stale-cursor" };
      }
      const after = command.optionAfter
        ? sql`where (ranked.sort_primary, ranked.sort_secondary, ranked.id) >
            (${command.optionAfter.primary}, ${command.optionAfter.secondary}, ${command.optionAfter.id})`
        : sql``;
      const options = await sql<OptionRow>`
        select ranked.id, ranked.kind, ranked.name,
          ranked.sort_primary, ranked.sort_secondary
        from (
          select option.id, option.kind, option.name,
            case when option.kind = 'contact-type' then '0' else '1' end as sort_primary,
            lower(option.name) as sort_secondary
          from (
            select id::text, 'contact-type'::text as kind, name
          from crm.contact_method_types
          where workspace_id = ${command.workspaceId}::uuid and not is_archived
              and (not ${selectedOnly} or id = any(${selected}::uuid[]))
            union all
            select id::text, 'contact-label'::text as kind,
              coalesce(label, translation_key, 'Contact label') as name
            from crm.contact_labels
            where workspace_id = ${command.workspaceId}::uuid
              and applies_to in ('any', 'contact_method')
              and (not ${selectedOnly} or id = any(${selected}::uuid[]))
          ) option
          where ${selectedOnly} or ${optionSearch} = ''
              or strpos(lower(name), ${optionSearch}) > 0
        ) ranked
        ${after}
        order by ranked.sort_primary, ranked.sort_secondary, ranked.id
        limit ${queryLimit}
      `.execute(database);
      const pageRows = options.rows.slice(0, optionLimit);
      const page: Option[] = pageRows.map(({ id, kind, name }) => ({
        id,
        ...(kind ? { kind } : {}),
        name,
      }));
      if (value) {
        const allowed = new Set(page.map((option) => option.id));
        if (
          !value.typeId || !allowed.has(value.typeId) ||
          (value.labelIds ?? []).some((id) => !allowed.has(id))
        ) {
          return {
            options: page,
            status: "invalid-reference",
          };
        }
      }
      const final = pageRows.at(-1);
      return {
        hasMore: !selectedOnly && options.rows.length > optionLimit,
        ...(!selectedOnly && options.rows.length > optionLimit && final
          ? {
            nextOptionAnchor: {
              id: final.id,
              primary: final.sort_primary,
              secondary: final.sort_secondary,
            },
          }
          : {}),
        options: page,
        status: "ready",
      };
    }
    if (command.section === "addresses") {
      const labelIds = (command.value as {
        readonly labelIds?: readonly string[];
      } | undefined)?.labelIds ?? [];
      const selected = command.selectedOptionIds ?? labelIds;
      if (command.optionAfter) {
        const anchor = await sql<OptionRow>`
          select id::text, 'contact-label'::text as kind,
            coalesce(label, translation_key, 'Address label') as name,
            lower(coalesce(label, translation_key, 'Address label')) as sort_primary,
            ''::text as sort_secondary
          from crm.contact_labels
          where id = ${command.optionAfter.id}::uuid
            and workspace_id = ${command.workspaceId}::uuid
            and applies_to in ('any', 'address')
            and (${optionSearch} = '' or strpos(lower(coalesce(
              label, translation_key, 'Address label')), ${optionSearch}) > 0)
        `.execute(database);
        if (
          !anchor.rows.some((row) =>
            row.sort_primary === command.optionAfter?.primary &&
            row.sort_secondary === command.optionAfter?.secondary
          )
        ) return { options: [], status: "stale-cursor" };
      }
      const after = command.optionAfter
        ? sql`and (lower(coalesce(label, translation_key, 'Address label')), id::text) >
            (${command.optionAfter.primary}, ${command.optionAfter.id})`
        : sql``;
      const options = await sql<OptionRow>`
        select id::text, 'contact-label'::text as kind,
          coalesce(label, translation_key, 'Address label') as name,
          lower(coalesce(label, translation_key, 'Address label')) as sort_primary,
          ''::text as sort_secondary
        from crm.contact_labels
        where workspace_id = ${command.workspaceId}::uuid
          and applies_to in ('any', 'address')
          and (not ${selectedOnly} or id = any(${selected}::uuid[]))
          and (${selectedOnly} or ${optionSearch} = ''
            or strpos(lower(coalesce(label, translation_key, 'Address label')), ${optionSearch}) > 0)
          ${after}
        order by sort_primary, id
        limit ${queryLimit}
      `.execute(database);
      const pageRows = options.rows.slice(0, optionLimit);
      const page: Option[] = pageRows.map(({ id, kind, name }) => ({
        id,
        ...(kind ? { kind } : {}),
        name,
      }));
      const allowed = new Set(page.map((option) => option.id));
      const final = pageRows.at(-1);
      return {
        hasMore: !selectedOnly && options.rows.length > optionLimit,
        ...(!selectedOnly && options.rows.length > optionLimit && final
          ? {
            nextOptionAnchor: {
              id: final.id,
              primary: final.sort_primary,
              secondary: final.sort_secondary,
            },
          }
          : {}),
        options: page,
        status: labelIds.some((id) => !allowed.has(id))
          ? "invalid-reference"
          : "ready",
      };
    }
    if (command.section === "pets") {
      const categoryId = (command.value as {
        readonly categoryId?: string;
      } | undefined)?.categoryId;
      const selected = command.selectedOptionIds ??
        (categoryId ? [categoryId] : []);
      if (command.optionAfter) {
        const anchor = await sql<OptionRow>`
          select id::text, 'pet-category'::text as kind, name,
            (case when is_common then '0' else '1' end) || ':' ||
              lpad((sort_order + 1000000000)::text, 10, '0') as sort_primary,
            lower(name) as sort_secondary
          from crm.pet_categories
          where id = ${command.optionAfter.id}::uuid and is_active
            and (${optionSearch} = '' or strpos(lower(name), ${optionSearch}) > 0)
        `.execute(database);
        if (
          !anchor.rows.some((row) =>
            row.sort_primary === command.optionAfter?.primary &&
            row.sort_secondary === command.optionAfter?.secondary
          )
        ) return { options: [], status: "stale-cursor" };
      }
      const after = command.optionAfter
        ? sql`and ((case when is_common then '0' else '1' end) || ':' ||
              lpad((sort_order + 1000000000)::text, 10, '0'), lower(name), id::text) >
            (${command.optionAfter.primary}, ${command.optionAfter.secondary}, ${command.optionAfter.id})`
        : sql``;
      const options = await sql<OptionRow>`
        select id::text, 'pet-category'::text as kind, name,
          (case when is_common then '0' else '1' end) || ':' ||
            lpad((sort_order + 1000000000)::text, 10, '0') as sort_primary,
          lower(name) as sort_secondary
        from crm.pet_categories where is_active
          and (not ${selectedOnly} or id = any(${selected}::uuid[]))
          and (${selectedOnly} or ${optionSearch} = ''
            or strpos(lower(name), ${optionSearch}) > 0)
          ${after}
        order by sort_primary, sort_secondary, id
        limit ${queryLimit}
      `.execute(database);
      const pageRows = options.rows.slice(0, optionLimit);
      const page: Option[] = pageRows.map(({ id, kind, name }) => ({
        id,
        ...(kind ? { kind } : {}),
        name,
      }));
      const final = pageRows.at(-1);
      return {
        hasMore: !selectedOnly && options.rows.length > optionLimit,
        ...(!selectedOnly && options.rows.length > optionLimit && final
          ? {
            nextOptionAnchor: {
              id: final.id,
              primary: final.sort_primary,
              secondary: final.sort_secondary,
            },
          }
          : {}),
        options: page,
        status: categoryId && !page.some((option) => option.id === categoryId)
          ? "invalid-reference"
          : "ready",
      };
    }
    return { options: [], status: "ready" };
  }
}
