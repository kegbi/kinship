/**
 * The eleven cascade participants, run against real PostgreSQL.
 *
 * Every module answers `inspectBeforeCascade` from a spec compiled by
 * `platform/postgres/lifecycle_impact.ts`, and the workspace lifecycle use case
 * folds the answers into the impact token that authorises a reset or a delete —
 * and, for files, into the storage keys the cleanup removes. Nothing else in
 * the suite executes those statements, so a mistyped ownership step or sort
 * column would only show up in production. This suite runs all eleven against
 * the canonical schema: once on a workspace that owns nothing, and once on a
 * workspace seeded through the owning modules so each join path carries a row.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import type {
  WorkspaceLifecycleCascadeParticipant,
  WorkspaceLifecycleImpactContribution,
} from "../../packages/backend/modules/workspaces/public.ts";
import {
  PostgresFileWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/files/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresGiftWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/gifts/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresGovernanceWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/governance/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresImportExportWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/import-export/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresIntegrationWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/integrations/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresInteractionWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/interactions/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresJournalWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/journal/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresOperationsWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/operations/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresPeopleWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/people/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresPlanningWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/planning/adapters/postgres/workspace_lifecycle_impact.ts";
import {
  PostgresRelationshipWorkspaceLifecycleImpact,
} from "../../packages/backend/modules/relationships/adapters/postgres/workspace_lifecycle_impact.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import {
  apiSupport,
  type HttpMethod,
  type SignedInFixture,
} from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 4, prepare: false });
const connection = connectDatabase(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);

/** The wiring `apps/api/composition.ts` gives the lifecycle use case. */
const impact: Readonly<Record<string, WorkspaceLifecycleCascadeParticipant>> = {
  files: PostgresFileWorkspaceLifecycleImpact,
  gifts: PostgresGiftWorkspaceLifecycleImpact,
  governance: PostgresGovernanceWorkspaceLifecycleImpact,
  importExport: PostgresImportExportWorkspaceLifecycleImpact,
  integrations: PostgresIntegrationWorkspaceLifecycleImpact,
  interactions: PostgresInteractionWorkspaceLifecycleImpact,
  journal: PostgresJournalWorkspaceLifecycleImpact,
  operations: PostgresOperationsWorkspaceLifecycleImpact,
  people: PostgresPeopleWorkspaceLifecycleImpact,
  planning: PostgresPlanningWorkspaceLifecycleImpact,
  relationships: PostgresRelationshipWorkspaceLifecycleImpact,
};

type Contributions = Readonly<
  Record<string, WorkspaceLifecycleImpactContribution>
>;

/** Every participant, in one transaction, exactly as the use case asks them. */
async function inspectAll(workspaceId: string): Promise<Contributions> {
  return await connection.db.transaction().execute(async (transaction) => {
    const seen: Record<string, WorkspaceLifecycleImpactContribution> = {};
    for (const [name, participant] of Object.entries(impact)) {
      seen[name] = await participant.inspectBeforeCascade({
        transaction: { opaque: transaction },
        workspaceId,
      });
    }
    return seen;
  });
}

type Fixture = SignedInFixture;

/** A workspace with nothing in it, on a database with nothing else in it. */
async function freshWorkspace(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  await resetDatabase(sql);
  const owner = await api.register(email, workspaceName, {
    firstName: "Impact",
    lastName: "Owner",
  });
  // Registration audits the new workspace. The preview is about what the
  // cascade destroys, so the trail is cleared to keep the empty counts exact.
  await sql`delete from crm.audit_events
    where workspace_id = ${owner.workspaceId}::uuid`;
  return owner;
}

function request(
  fixture: Fixture,
  path: string,
  options: { readonly body?: unknown; readonly method?: HttpMethod } = {},
): Promise<Response> {
  return api.request(fixture, path, options.method, options.body);
}

async function created(
  response: Response,
  what: string,
): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  assert(
    response.status === 200 || response.status === 201,
    `${what} failed with ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
}

Deno.test({
  name:
    "WORKSPACE-002 every cascade participant inspects an empty workspace in PostgreSQL",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await freshWorkspace(
      "lifecycle-impact-empty@example.test",
      "Empty circle",
    );
    const contributions = await inspectAll(owner.workspaceId);
    assert(
      Object.keys(contributions).length === 11,
      `eleven modules answered, received ${Object.keys(contributions).length}`,
    );
    for (const [module, contribution] of Object.entries(contributions)) {
      const counts = Object.entries(contribution.counts);
      assert(counts.length > 0, `${module} reports at least one count`);
      for (const [name, value] of counts) {
        assert(
          value === 0,
          `${module}.${name} counted ${value} in an empty workspace`,
        );
      }
      assert(
        /^[0-9a-f]{32}$/.test(contribution.revision),
        `${module} produced no digest, received ${contribution.revision}`,
      );
      if (module === "files") {
        assert(
          JSON.stringify(contribution.objectKeys) === "[]",
          `files contributed ${JSON.stringify(contribution.objectKeys)}`,
        );
        continue;
      }
      assert(
        !("objectKeys" in contribution),
        `${module} owns no stored object yet contributed keys`,
      );
    }
  },
});

Deno.test({
  name:
    "WORKSPACE-002 seeded rows reach every cascade participant through its ownership path",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await freshWorkspace(
      "lifecycle-impact-seeded@example.test",
      "Seeded circle",
    );
    const empty = await inspectAll(owner.workspaceId);

    // People, one step: a person and one of their important dates.
    const person = (await created(
      await request(owner, "/api/v1/people", {
        body: { givenName: "Ada", isPartial: false },
        method: "POST",
      }),
      "person",
    )).person as { readonly id: string };
    const other = (await created(
      await request(owner, "/api/v1/people", {
        body: { givenName: "Grace", isPartial: false },
        method: "POST",
      }),
      "second person",
    )).person as { readonly id: string };
    await created(
      await request(owner, `/api/v1/people/${person.id}/dates`, {
        body: {
          day: 10,
          isAgeBased: false,
          isYearApproximate: false,
          kind: "birthday",
          month: 12,
          precision: "full",
          year: 1815,
        },
        method: "POST",
      }),
      "important date",
    );
    const withPeople = await inspectAll(owner.workspaceId);
    assert(
      withPeople.people?.revision !== empty.people?.revision,
      "the person and their date did not reach the people digest",
    );

    // People, two steps: a contact method that carries a workspace label.
    const type = (await created(
      await request(
        owner,
        "/api/v1/settings/personalization/contact-method-types",
        {
          body: { name: "Email", sortOrder: 10 },
          method: "POST",
        },
      ),
      "contact method type",
    )).entry as { readonly id: string };
    const label = (await created(
      await request(owner, "/api/v1/settings/personalization/contact-labels", {
        body: { name: "Home" },
        method: "POST",
      }),
      "contact label",
    )).entry as { readonly id: string };
    const facts = await created(
      await request(owner, `/api/v1/people/${person.id}/facts/contact-methods`),
      "contact method revision",
    ) as { readonly personUpdatedAt: string };
    await created(
      await request(
        owner,
        `/api/v1/people/${person.id}/facts/contact-methods`,
        {
          body: {
            expectedPersonUpdatedAt: facts.personUpdatedAt,
            isPrimary: true,
            labelIds: [],
            section: "contact-methods",
            typeId: type.id,
            value: "ada@example.test",
          },
          method: "POST",
        },
      ),
      "contact method",
    );
    const withContact = await inspectAll(owner.workspaceId);
    assert(
      withContact.people?.revision !== withPeople.people?.revision,
      "the contact method did not reach the people digest",
    );

    // The label junction is the only two-step path: a label row is owned by a
    // contact method, which is owned by a person, which the workspace owns.
    await sql`
      insert into crm.person_contact_method_labels (contact_method_id, label_id)
      select method.id, ${label.id}::uuid from crm.person_contact_methods method
      where method.person_id = ${person.id}::uuid`;
    const withLabel = await inspectAll(owner.workspaceId);
    assert(
      withLabel.people?.revision !== withContact.people?.revision,
      "the label two steps from the workspace did not reach the people digest",
    );

    // A pair marked not duplicates is people's too (REL-064), and a reset or
    // deletion destroys it with the workspace.
    await created(
      await request(owner, "/api/v1/people/duplicates/dismissals", {
        body: { personIds: [person.id, other.id] },
        method: "POST",
      }),
      "duplicate dismissal",
    );
    const withDismissal = await inspectAll(owner.workspaceId);
    assert(
      withDismissal.people?.revision !== withLabel.people?.revision,
      "the dismissed duplicate pair did not reach the people digest",
    );

    // Relationships: the workspace's own seeded parent type relates the pair.
    const [parentType] = await sql<{ readonly id: string }[]>`
      select id::text as id from crm.relationship_types
      where workspace_id = ${owner.workspaceId}::uuid and is_system = true
        and forward_label = 'parent' and reverse_label = 'child'`;
    assert(parentType, "a fresh workspace seeds the parent relationship type");
    await created(
      await request(owner, `/api/v1/people/${person.id}/relationships`, {
        body: { relationshipTypeId: parentType.id, targetPersonId: other.id },
        method: "POST",
      }),
      "relationship",
    );

    // Files and interactions have no facade for a stored object or a thread
    // that does not go through object storage, so their rows are written here.
    const storageKey = `workspaces/${owner.workspaceId}/impact-fixture.png`;
    const [file] = await sql<{ readonly id: string }[]>`
      insert into crm.files (workspace_id, storage_key, original_filename)
      values (${owner.workspaceId}::uuid, ${storageKey}, 'impact-fixture.png')
      returning id::text as id`;
    assert(file, "the stored object is recorded");
    const withFile = await inspectAll(owner.workspaceId);
    assert(
      JSON.stringify(withFile.files?.objectKeys) ===
        JSON.stringify([storageKey]),
      `files contributed ${JSON.stringify(withFile.files?.objectKeys)}`,
    );
    assert(
      withFile.files?.revision !== empty.files?.revision,
      "the stored object did not reach the files digest",
    );
    await sql`insert into crm.person_file_links (person_id, file_id, kind)
      values (${person.id}::uuid, ${file.id}::uuid, 'document')`;
    const withLink = await inspectAll(owner.workspaceId);
    assert(
      withLink.files?.revision !== withFile.files?.revision,
      "the person link owned through its file did not reach the files digest",
    );
    const [thread] = await sql<{ readonly id: string }[]>`
      insert into crm.conversation_threads (workspace_id, person_id, happened_at)
      values (${owner.workspaceId}::uuid, ${person.id}::uuid, now())
      returning id::text as id`;
    assert(thread, "the conversation thread is recorded");
    await sql`insert into crm.messages (conversation_id, content, written_at, direction)
      values (${thread.id}::uuid, 'Hello', now(), 'inbound')`;

    const seeded = await inspectAll(owner.workspaceId);
    const counted = (module: string, name: string): number =>
      seeded[module]?.counts[name] ?? -1;
    assert(
      counted("people", "people") === 2,
      `people counted ${counted("people", "people")}`,
    );
    assert(
      counted("relationships", "relationships") === 1,
      `relationships counted ${counted("relationships", "relationships")}`,
    );
    assert(
      counted("files", "files") === 1,
      `files counted ${counted("files", "files")}`,
    );
    assert(
      counted("interactions", "messages") === 1,
      `the message through its thread counted ${
        counted("interactions", "messages")
      }`,
    );
    assert(
      counted("interactions", "activities") === 0 &&
        counted("interactions", "calls") === 0 &&
        counted("interactions", "notes") === 0,
      "only the seeded interaction is counted",
    );
    assert(
      seeded.interactions?.revision !== withLink.interactions?.revision,
      "the message owned through its thread did not reach the digest",
    );
    for (const module of ["people", "relationships", "files", "interactions"]) {
      assert(
        seeded[module]?.revision !== empty[module]?.revision,
        `${module} kept its empty-workspace digest after seeding`,
      );
    }
    for (const module of ["gifts", "operations", "journal"]) {
      assert(
        seeded[module]?.revision === empty[module]?.revision,
        `${module} owns nothing that was seeded yet its digest moved`,
      );
    }
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events
      restart identity cascade`;
  },
});

Deno.test({
  name: "WORKSPACE-002 PostgreSQL impact resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([sql.end(), connection.destroy(), configured.close()]);
  },
});
