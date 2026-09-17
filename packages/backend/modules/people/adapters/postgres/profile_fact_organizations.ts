import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { OccupationFact } from "../../domain/profile_facts/values.ts";
import type { ProfileFactOrganizationBoundary } from "../../ports/profile_fact_repository.ts";

interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly sort_primary: string;
  readonly sort_secondary: string;
}

export class PostgresProfileFactOrganizations
  implements ProfileFactOrganizationBoundary {
  async inspect(
    command: Parameters<ProfileFactOrganizationBoundary["inspect"]>[0],
  ) {
    if (command.section !== "work") {
      return { options: [], status: "ready" as const };
    }
    const database = databaseFromSession(command.transaction);
    const optionLimit = Math.min(
      Math.max(command.optionLimit ?? 100, 1),
      1_051,
    );
    const optionSearch = command.optionSearch?.trim().toLowerCase() ?? "";
    const organizationId = (command.value as OccupationFact | undefined)
      ?.organizationId;
    const selected = command.selectedOptionIds ??
      (organizationId ? [organizationId] : []);
    const selectedOnly = command.selectedOnly === true ||
      command.value !== undefined;
    const queryLimit = selectedOnly ? optionLimit : optionLimit + 1;

    if (command.optionAfter) {
      const anchor = await sql<OrganizationRow>`
        select id::text, name, lower(name) as sort_primary,
          ''::text as sort_secondary
        from crm.organizations
        where id = ${command.optionAfter.id}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and (${optionSearch} = '' or strpos(lower(name), ${optionSearch}) > 0)
      `.execute(database);
      if (
        !anchor.rows.some((row) =>
          row.sort_primary === command.optionAfter?.primary &&
          row.sort_secondary === command.optionAfter?.secondary
        )
      ) return { options: [], status: "stale-cursor" as const };
    }

    const after = command.optionAfter
      ? sql`and (lower(name), id::text) >
          (${command.optionAfter.primary}, ${command.optionAfter.id})`
      : sql``;
    const result = await sql<OrganizationRow>`
      select id::text, name, lower(name) as sort_primary,
        ''::text as sort_secondary
      from crm.organizations
      where workspace_id = ${command.workspaceId}::uuid
        and (not ${selectedOnly} or id = any(${selected}::uuid[]))
        and (${selectedOnly} or ${optionSearch} = ''
          or strpos(lower(name), ${optionSearch}) > 0)
        ${after}
      order by sort_primary, id
      limit ${queryLimit}
    `.execute(database);
    const pageRows = result.rows.slice(0, optionLimit);
    const options = pageRows.map(({ id, name }) => ({
      id,
      kind: "organization" as const,
      name,
    }));
    const final = pageRows.at(-1);
    return {
      hasMore: !selectedOnly && result.rows.length > optionLimit,
      ...(!selectedOnly && result.rows.length > optionLimit && final
        ? {
          nextOptionAnchor: {
            id: final.id,
            primary: final.sort_primary,
            secondary: final.sort_secondary,
          },
        }
        : {}),
      options,
      status: organizationId &&
          !options.some((option) => option.id === organizationId)
        ? "invalid-reference" as const
        : "ready" as const,
    };
  }
}
