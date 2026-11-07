/**
 * Relationships (split from `people_postgres_test.ts`, GAP-035): directional
 * edges, the versioned default vocabulary, and lock order.
 *
 * Its final test closes the app and pools it loaded from
 * `people.test-helper.ts`.
 */

import {
  createPeopleManagement,
  type PeopleActor,
} from "../../packages/backend/modules/people/public.ts";
import { personCreatedAuditFrom } from "../../packages/backend/modules/people/public.ts";
import { relationshipAuditFrom } from "../../packages/backend/modules/relationships/public.ts";
import { DEFAULT_RELATIONSHIP_TYPE_VOCABULARY } from "../../packages/backend/modules/workspaces/public.ts";
import {
  createRelationshipManagement,
  type RelationshipDependencies,
} from "../../packages/backend/modules/relationships/public.ts";
import {
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresRelationshipPersonBoundary } from "../../packages/backend/modules/people/adapters/postgres/relationship_person_boundary.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresRelationshipWorkspaceBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/relationship_workspace_boundary.ts";
import { PostgresRelationshipRepository } from "../../packages/backend/modules/relationships/adapters/postgres/relationship_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  actors,
  configured,
  createPerson,
  type Fixture,
  peopleConnection,
  raceSql,
  register,
  relationshipRequest,
  sql,
} from "./people.test-helper.ts";

Deno.test({
  name:
    "RELATIONSHIP-001 PostgreSQL keeps directional edges tenant-safe, audited, idempotent, and archive-aware",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const own = await register(
      `relationships-${crypto.randomUUID()}@example.test`,
      "Relationship circle",
    );
    const foreign = await register(
      `relationships-foreign-${crypto.randomUUID()}@example.test`,
      "Other circle",
    );
    const sourceResponse = await createPerson(own, {
      givenName: "Ada",
      isPartial: false,
    });
    const targetResponse = await createPerson(own, {
      givenName: "Byron",
      isPartial: false,
    });
    const foreignResponse = await createPerson(foreign, {
      givenName: "Mallory",
      isPartial: false,
    });
    const sourceId = (await sourceResponse.json()).person.id as string;
    const targetId = (await targetResponse.json()).person.id as string;
    const foreignId = (await foreignResponse.json()).person.id as string;
    const [defaultParentType] = await sql<{ id: string }[]>`
      select id::text from crm.relationship_types
      where workspace_id = ${own.workspaceId}::uuid and is_system = true
        and forward_label = 'parent' and reverse_label = 'child'
    `;
    assert(defaultParentType, "fresh workspace default parent type exists");
    const parentTypeId = defaultParentType.id;
    const guardianTypeId = crypto.randomUUID();
    const foreignTypeId = crypto.randomUUID();
    await sql`
      insert into crm.relationship_types (id, workspace_id, forward_label, reverse_label, sort_order)
      values (${guardianTypeId}, ${own.workspaceId}, 'guardian', 'ward', 30),
        (${foreignTypeId}, ${foreign.workspaceId}, 'foreign', 'foreign inverse', 1)
    `;
    const typeOptions = await configured.app.request(
      `http://localhost/api/v1/relationship-types?search=par&selected=${guardianTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    const typeOptionsBody = await typeOptions.json() as {
      readonly options: readonly { readonly id: string }[];
      readonly selected: readonly { readonly id: string }[];
    };
    assert(
      typeOptions.status === 200 &&
        typeOptionsBody.options.some((option) => option.id === parentTypeId) &&
        typeOptionsBody.selected[0]?.id === guardianTypeId,
      "relationship type search remains tenant-scoped and hydrates the selected type",
    );
    const defaultTypeOptions = await configured.app.request(
      "http://localhost/api/v1/relationship-types",
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      defaultTypeOptions.status === 200 &&
        (await defaultTypeOptions.json() as {
            readonly options: readonly { readonly id: string }[];
          }).options.length === 20,
      "relationship type defaults remain bounded to the active workspace",
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${own.workspaceId}, 'relationships', false)
    `;
    const hiddenTypes = await configured.app.request(
      `http://localhost/api/v1/relationship-types?selected=${guardianTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    const hiddenTypesBody = await hiddenTypes.json() as {
      readonly options: readonly unknown[];
      readonly selected: readonly unknown[];
      readonly status: string;
    };
    const [retainedType] = await sql`
      select count(*)::int as count from crm.relationship_types
      where id = ${guardianTypeId}::uuid
        and workspace_id = ${own.workspaceId}::uuid
    `;
    const hiddenRelationships = await relationshipRequest(
      own,
      sourceId,
      "GET",
    );
    assert(
      hiddenTypes.status === 200 &&
        hiddenTypesBody.status === "hidden" &&
        hiddenTypesBody.options.length === 0 &&
        hiddenTypesBody.selected.length === 0 &&
        retainedType?.count === 1 &&
        hiddenRelationships.status === 200 &&
        (await hiddenRelationships.json() as { readonly status: string })
            .status === "hidden",
      "disabled relationships module conceals its type options and projection",
    );
    await sql`
      update crm.workspace_profile_modules set is_active = true
      where workspace_id = ${own.workspaceId}::uuid and key = 'relationships'
    `;
    const restoredTypes = await configured.app.request(
      `http://localhost/api/v1/relationship-types?selected=${guardianTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      restoredTypes.status === 200 &&
        (await restoredTypes.json() as {
            readonly selected: readonly { readonly id: string }[];
            readonly status: string;
          }).selected[0]?.id === guardianTypeId,
      "re-enabled relationships module did not restore its retained type",
    );
    const additionalTypeIds = Array.from(
      { length: 55 },
      () => crypto.randomUUID(),
    );
    const mutableTypeId = additionalTypeIds[19]!;
    const tailTypeId = additionalTypeIds[54]!;
    const unicodeTypeSearch = "Родство关系😀";
    await sql`
      insert into crm.relationship_types (
        id, workspace_id, forward_label, reverse_label, sort_order
      )
      select type_id, ${own.workspaceId}::uuid,
        ${unicodeTypeSearch} || ' ' || lpad(sequence::text, 2, '0'),
        'Обратно关系🧭 ' || lpad(sequence::text, 2, '0'), sequence + 9
      from unnest(${additionalTypeIds}::uuid[])
        with ordinality as generated(type_id, sequence)
    `;
    const typePages: {
      readonly nextCursor?: string;
      readonly options: readonly { readonly id: string }[];
    }[] = [];
    let typeCursor: string | undefined;
    do {
      const page = await configured.app.request(
        `http://localhost/api/v1/relationship-types?search=${
          encodeURIComponent(unicodeTypeSearch)
        }${typeCursor ? `&cursor=${encodeURIComponent(typeCursor)}` : ""}`,
        {
          headers: {
            cookie: own.cookie,
            "X-Workspace-Id": own.workspaceId,
          },
        },
      );
      assert(page.status === 200, `type continuation returned ${page.status}`);
      const body = await page.json() as {
        readonly nextCursor?: string;
        readonly options: readonly { readonly id: string }[];
      };
      typePages.push(body);
      typeCursor = body.nextCursor;
    } while (typeCursor && typePages.length < 10);
    assert(
      typePages.length === 3 &&
        typePages.every((page) => page.options.length <= 20) &&
        new Set(
            typePages.flatMap((page) => page.options.map((type) => type.id)),
          )
            .size === 55,
      "Unicode relationship type keysets are not complete and bounded",
    );
    const malformedTypePage = await configured.app.request(
      `http://localhost/api/v1/relationship-types?search=${
        encodeURIComponent(unicodeTypeSearch)
      }&cursor=not-base64url`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      malformedTypePage.status === 409,
      "malformed Unicode relationship type cursor was accepted",
    );
    const selectedTypes = await configured.app.request(
      `http://localhost/api/v1/relationship-types?selected=${tailTypeId},${foreignTypeId}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      selectedTypes.status === 200 &&
        (await selectedTypes.json() as {
            readonly selected: readonly { readonly id: string }[];
          }).selected.map((type) => type.id).join(",") ===
          tailTypeId,
      "selected relationship type hydration disclosed a foreign descriptor",
    );
    const mutableCursor = typePages[0]?.nextCursor;
    await sql`
      update crm.relationship_types set forward_label = 'Renamed anchor'
      where id = ${mutableTypeId}::uuid
    `;
    const staleTypePage = await configured.app.request(
      `http://localhost/api/v1/relationship-types?search=${
        encodeURIComponent(unicodeTypeSearch)
      }&cursor=${encodeURIComponent(mutableCursor ?? "")}`,
      {
        headers: {
          cookie: own.cookie,
          "X-Workspace-Id": own.workspaceId,
        },
      },
    );
    assert(
      mutableCursor && staleTypePage.status === 409,
      "mutable relationship type cursor was not rejected",
    );
    const created = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: parentTypeId,
      targetPersonId: targetId,
    });
    const createdBody = await created.json();
    assert(
      created.status === 201 && createdBody.inverse.label === "child",
      `directional create failed: ${JSON.stringify(createdBody)}`,
    );
    const relationshipId = createdBody.relationship.id as string;
    const firstUpdatedAt = createdBody.relationship.updatedAt as string;
    const inverse = await relationshipRequest(own, targetId, "GET");
    const inverseBody = await inverse.json();
    assert(
      inverseBody.relationships[0]?.display.label === "child" &&
        inverseBody.relationships[0]?.display.personId === sourceId,
      "inverse person workspace is inconsistent",
    );
    const malformedRelationshipId = crypto.randomUUID();
    await sql`
      insert into crm.relationships (
        id, workspace_id, from_person_id, to_person_id, relationship_type_id
      ) values (
        ${malformedRelationshipId}::uuid, ${own.workspaceId}::uuid,
        ${sourceId}::uuid, ${foreignId}::uuid, ${parentTypeId}::uuid
      )
    `;
    const concealedMalformed = await relationshipRequest(
      own,
      sourceId,
      "GET",
    );
    const concealedMalformedText = await concealedMalformed.text();
    assert(
      concealedMalformed.status === 200 &&
        !concealedMalformedText.includes(foreignId) &&
        !concealedMalformedText.includes(malformedRelationshipId) &&
        concealedMalformedText.includes(relationshipId),
      "malformed foreign endpoint edge was not completely concealed",
    );
    const historical = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: tailTypeId,
      targetPersonId: targetId,
    });
    const historicalBody = await historical.json() as {
      readonly relationship: {
        readonly id: string;
        readonly updatedAt: string;
      };
    };
    assert(
      historical.status === 201,
      "tail relationship type was not writable",
    );
    await sql`
      update crm.relationship_types set is_archived = true
      where id = ${tailTypeId}::uuid
    `;
    const historicalList = await relationshipRequest(own, sourceId, "GET");
    const historicalListBody = await historicalList.json() as {
      readonly relationships: readonly {
        readonly id: string;
        readonly relationshipTypeArchived: boolean;
      }[];
    };
    const historicalRow = historicalListBody.relationships.find((row) =>
      row.id === historicalBody.relationship.id
    );
    const archivedTypeUpdate = await relationshipRequest(
      own,
      sourceId,
      "PATCH",
      {
        expectedUpdatedAt: historicalBody.relationship.updatedAt,
        relationshipTypeId: tailTypeId,
      },
      historicalBody.relationship.id,
    );
    assert(
      historicalRow?.relationshipTypeArchived === true &&
        archivedTypeUpdate.status === 404,
      "archived historical type was not visible or remained selectable",
    );
    const duplicate = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: parentTypeId,
      targetPersonId: targetId,
    });
    assert(
      duplicate.status === 200 &&
        (await duplicate.json()).status === "existing",
      "duplicate retry was not idempotent",
    );
    const self = await relationshipRequest(own, sourceId, "POST", {
      relationshipTypeId: parentTypeId,
      targetPersonId: sourceId,
    });
    assert(self.status === 400, "self relationship persisted");
    for (
      const body of [
        { relationshipTypeId: parentTypeId, targetPersonId: foreignId },
        { relationshipTypeId: foreignTypeId, targetPersonId: targetId },
      ]
    ) {
      const concealed = await relationshipRequest(own, sourceId, "POST", body);
      assert(
        concealed.status === 404,
        `foreign relationship reference returned ${concealed.status}`,
      );
    }
    const updated = await relationshipRequest(own, sourceId, "PATCH", {
      expectedUpdatedAt: firstUpdatedAt,
      relationshipTypeId: guardianTypeId,
    }, relationshipId);
    const updatedBody = await updated.json();
    assert(
      updated.status === 200 && updatedBody.inverse.label === "ward",
      `directional update failed: ${JSON.stringify(updatedBody)}`,
    );
    await sql`update crm.people set archived_at = now() where id = ${targetId}`;
    const archivedUpdate = await relationshipRequest(own, sourceId, "PATCH", {
      expectedUpdatedAt: updatedBody.relationship.updatedAt,
      relationshipTypeId: parentTypeId,
    }, relationshipId);
    const archivedDelete = await relationshipRequest(own, sourceId, "DELETE", {
      expectedUpdatedAt: updatedBody.relationship.updatedAt,
    }, relationshipId);
    assert(
      archivedUpdate.status === 409 && archivedDelete.status === 409,
      "archived endpoint remained writable",
    );
    await sql`update crm.people set archived_at = null where id = ${targetId}`;
    const removed = await relationshipRequest(own, sourceId, "DELETE", {
      expectedUpdatedAt: updatedBody.relationship.updatedAt,
    }, relationshipId);
    assert(removed.status === 200, `unlink failed: ${await removed.text()}`);
    const counts = await sql<
      { readonly audits: number; readonly edges: number }[]
    >`
      select
        (select count(*)::int from crm.audit_events where subject_id = ${relationshipId} and action = 'relationships.relationship-changed') as audits,
        (select count(*)::int from crm.relationships where id = ${relationshipId}) as edges
    `;
    assert(
      counts[0]?.audits === 3 && counts[0]?.edges === 0,
      `relationship transaction postconditions failed: ${
        JSON.stringify(counts[0])
      }`,
    );

    const atomicUrl =
      `http://localhost/api/v1/people/${sourceId}/relationships/related-person`;
    const atomic = await configured.app.request(atomicUrl, {
      body: JSON.stringify({
        person: { givenName: "Grace", isPartial: false },
        relationshipTypeId: parentTypeId,
      }),
      headers: {
        cookie: own.cookie,
        "content-type": "application/json",
        origin: "http://localhost",
        "X-Workspace-Id": own.workspaceId,
      },
      method: "POST",
    });
    const atomicBody = await atomic.json() as {
      readonly person: { readonly id: string };
      readonly relationship: { readonly id: string };
    };
    assert(
      atomic.status === 201 && atomicBody.person.id &&
        atomicBody.relationship.id,
      "related person and relationship did not commit atomically",
    );
    const atomicProof = await sql<
      {
        readonly audits: number;
        readonly edges: number;
        readonly people: number;
      }[]
    >`
      select
        (select count(*)::int from crm.people where id = ${atomicBody.person.id}) people,
        (select count(*)::int from crm.relationships where id = ${atomicBody.relationship.id}) edges,
        (select count(*)::int from crm.audit_events
          where subject_id in (${atomicBody.person.id}::uuid, ${atomicBody.relationship.id}::uuid)
            and action in ('people.person-created', 'relationships.relationship-changed')) audits
    `;
    assert(
      atomicProof[0]?.people === 1 && atomicProof[0].edges === 1 &&
        atomicProof[0].audits === 2,
      "atomic owner postconditions or audits are incomplete",
    );
    const beforeRejected = await sql<
      {
        readonly audits: number;
        readonly edges: number;
        readonly people: number;
      }[]
    >`
      select
        (select count(*)::int from crm.people where workspace_id = ${own.workspaceId}) people,
        (select count(*)::int from crm.relationships where workspace_id = ${own.workspaceId}) edges,
        (select count(*)::int from crm.audit_events where workspace_id = ${own.workspaceId}) audits
    `;
    const invalidAtomic = await configured.app.request(atomicUrl, {
      body: JSON.stringify({
        person: { givenName: "Orphan", isPartial: false },
        relationshipTypeId: crypto.randomUUID(),
      }),
      headers: {
        cookie: own.cookie,
        "content-type": "application/json",
        origin: "http://localhost",
        "X-Workspace-Id": own.workspaceId,
      },
      method: "POST",
    });
    const replay = await configured.app.request(atomicUrl, {
      body: JSON.stringify({
        person: { givenName: "Grace", isPartial: false },
        relationshipTypeId: parentTypeId,
      }),
      headers: {
        cookie: own.cookie,
        "content-type": "application/json",
        origin: "http://localhost",
        "X-Workspace-Id": own.workspaceId,
      },
      method: "POST",
    });
    const afterRejected = await sql<
      {
        readonly audits: number;
        readonly edges: number;
        readonly people: number;
      }[]
    >`
      select
        (select count(*)::int from crm.people where workspace_id = ${own.workspaceId}) people,
        (select count(*)::int from crm.relationships where workspace_id = ${own.workspaceId}) edges,
        (select count(*)::int from crm.audit_events where workspace_id = ${own.workspaceId}) audits
    `;
    assert(
      invalidAtomic.status === 404 && replay.status === 409 &&
        JSON.stringify(beforeRejected[0]) === JSON.stringify(afterRejected[0]),
      "atomic rejection or duplicate replay retained partial owner effects",
    );

    await sql.begin(async (transaction) => {
      const generated = await transaction<{ readonly id: string }[]>`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name, family_name
        )
        select gen_random_uuid(), ${own.workspaceId}, ${own.memberId},
          'Page', lpad(sequence::text, 2, '0')
        from generate_series(1, 21) sequence
        returning id::text
      `;
      await transaction`
        insert into crm.relationships (
          id, workspace_id, from_person_id, to_person_id,
          relationship_type_id, status, created_at, updated_at
        )
        select gen_random_uuid(), ${own.workspaceId}, ${sourceId}, person_id,
          ${guardianTypeId}, 'active',
          '2026-08-16T12:00:00Z'::timestamptz + sequence * interval '1 second',
          now()
        from unnest(${generated.map((row) => row.id)}::uuid[])
          with ordinality as target(person_id, sequence)
      `;
    });
    const firstPage = await configured.app.request(
      `http://localhost/api/v1/people/${sourceId}/relationships?limit=20`,
      { headers: { cookie: own.cookie, "X-Workspace-Id": own.workspaceId } },
    );
    const firstPageBody = await firstPage.json() as {
      readonly nextCursor?: string;
      readonly relationships: readonly { readonly id: string }[];
    };
    assert(
      firstPage.status === 200 && firstPageBody.relationships.length === 20 &&
        firstPageBody.nextCursor,
      "first relationship page is bounded and continuable",
    );
    const nextPage = await configured.app.request(
      `http://localhost/api/v1/people/${sourceId}/relationships?limit=20&cursor=${
        encodeURIComponent(firstPageBody.nextCursor)
      }`,
      { headers: { cookie: own.cookie, "X-Workspace-Id": own.workspaceId } },
    );
    const nextPageBody = await nextPage.json() as {
      readonly nextCursor?: string;
      readonly relationships: readonly { readonly id: string }[];
    };
    assert(
      nextPage.status === 200 && nextPageBody.relationships.length === 3 &&
        !nextPageBody.nextCursor &&
        new Set([
            ...firstPageBody.relationships,
            ...nextPageBody.relationships,
          ].map((edge) => edge.id)).size === 23,
      "keyset continuation reaches each relationship exactly once",
    );
    const forgedPage = await configured.app.request(
      `http://localhost/api/v1/people/${sourceId}/relationships?cursor=${
        encodeURIComponent(btoa(JSON.stringify({
          createdAt: "2026-08-16T12:00:00.000000Z",
          id: crypto.randomUUID(),
          personId: sourceId,
          version: 1,
          workspaceId: own.workspaceId,
        })))
      }`,
      { headers: { cookie: own.cookie, "X-Workspace-Id": own.workspaceId } },
    );
    assert(
      forgedPage.status === 409,
      "forged relationship anchor was accepted",
    );
  },
});

Deno.test({
  name:
    "RELATIONSHIP-001 PostgreSQL lazily backfills versioned default relationship types for existing workspaces",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const empty = await register(
      `relationship-backfill-empty-${crypto.randomUUID()}@example.test`,
      "Existing empty relationship workspace",
    );
    const partial = await register(
      `relationship-backfill-partial-${crypto.randomUUID()}@example.test`,
      "Existing partial relationship workspace",
    );
    const hidden = await register(
      `relationship-backfill-hidden-${crypto.randomUUID()}@example.test`,
      "Existing hidden relationship workspace",
    );
    const failing = await register(
      `relationship-backfill-failing-${crypto.randomUUID()}@example.test`,
      "Existing invalid relationship workspace",
    );
    const history = await register(
      `relationship-backfill-history-${crypto.randomUUID()}@example.test`,
      "Existing relationship history workspace",
    );
    await sql`
      delete from crm.relationship_types
      where workspace_id in (
        ${empty.workspaceId}::uuid, ${partial.workspaceId}::uuid,
        ${hidden.workspaceId}::uuid, ${failing.workspaceId}::uuid
      )
    `;
    const partialDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[7]!;
    const archivedDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[19]!;
    await sql`
      insert into crm.relationship_types (
        workspace_id, forward_label, reverse_label, is_system, can_delete,
        is_archived, sort_order
      ) values
        (${partial.workspaceId}::uuid, 'custom kin', 'custom inverse', false,
          true, false, 900),
        (${partial.workspaceId}::uuid, ${partialDefault.forwardLabel},
          ${partialDefault.reverseLabel}, true, false, false,
          ${partialDefault.sortOrder}),
        (${partial.workspaceId}::uuid, ${archivedDefault.forwardLabel},
          ${archivedDefault.reverseLabel}, true, false, true,
          ${archivedDefault.sortOrder})
    `;
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${hidden.workspaceId}::uuid, 'relationships', false)
    `;
    const duplicate = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[0]!;
    await sql`
      insert into crm.relationship_types (
        workspace_id, forward_label, reverse_label, is_system, can_delete,
        is_archived, sort_order
      ) values
        (${failing.workspaceId}::uuid, ${duplicate.forwardLabel},
          ${duplicate.reverseLabel}, true, false, false, ${duplicate.sortOrder}),
        (${failing.workspaceId}::uuid, ${duplicate.forwardLabel},
          ${duplicate.reverseLabel}, true, false, false, ${duplicate.sortOrder})
    `;
    const typeAccess = (fixture: Fixture) =>
      configured.app.request("http://localhost/api/v1/relationship-types", {
        headers: {
          cookie: fixture.cookie,
          "X-Workspace-Id": fixture.workspaceId,
        },
      });
    const historicalDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[0]!;
    const missingDefault = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[1]!;
    const [historicalType] = await sql<{ readonly id: string }[]>`
      select id::text
      from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${historicalDefault.forwardLabel}
        and reverse_label = ${historicalDefault.reverseLabel}
        and sort_order = ${historicalDefault.sortOrder}
    `;
    assert(historicalType, "provisioned historical default is present");
    const historicalSource = await createPerson(history, {
      givenName: "Historical source",
      isPartial: false,
    });
    const historicalTarget = await createPerson(history, {
      givenName: "Historical target",
      isPartial: false,
    });
    const rejectedTarget = await createPerson(history, {
      givenName: "Rejected target",
      isPartial: false,
    });
    const historicalSourceId = (await historicalSource.json()).person
      .id as string;
    const historicalTargetId = (await historicalTarget.json()).person
      .id as string;
    const rejectedTargetId = (await rejectedTarget.json()).person.id as string;
    assert(
      (await relationshipRequest(history, historicalSourceId, "POST", {
        relationshipTypeId: historicalType.id,
        targetPersonId: historicalTargetId,
      })).status === 201,
      "historical relationship was not created before archiving its type",
    );
    await sql`
      update crm.relationship_types set is_archived = true
      where id = ${historicalType.id}::uuid
    `;
    await sql`
      delete from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${missingDefault.forwardLabel}
        and reverse_label = ${missingDefault.reverseLabel}
        and sort_order = ${missingDefault.sortOrder}
    `;
    const initialized = await Promise.all([
      typeAccess(history),
      typeAccess(history),
      relationshipRequest(history, historicalSourceId, "POST", {
        relationshipTypeId: historicalType.id,
        targetPersonId: rejectedTargetId,
      }),
    ]);
    assert(
      initialized[0].status === 200 && initialized[1].status === 200 &&
        initialized[2].status === 404 &&
        (await typeAccess(history)).status === 200,
      "concurrent list/mutation initialization did not preserve archived type semantics",
    );
    const archivedIdentity = await sql<{
      readonly id: string;
      readonly is_archived: boolean;
    }[]>`
      select id::text, is_archived
      from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${historicalDefault.forwardLabel}
        and reverse_label = ${historicalDefault.reverseLabel}
    `;
    const backfilledIdentity = await sql<{
      readonly id: string;
      readonly is_archived: boolean;
    }[]>`
      select id::text, is_archived
      from crm.relationship_types
      where workspace_id = ${history.workspaceId}::uuid
        and is_system = true
        and forward_label = ${missingDefault.forwardLabel}
        and reverse_label = ${missingDefault.reverseLabel}
    `;
    const historicalList = await relationshipRequest(
      history,
      historicalSourceId,
      "GET",
    );
    const historicalListBody = await historicalList.json() as {
      readonly relationships: readonly {
        readonly forwardLabel: string;
        readonly relationshipTypeArchived: boolean;
        readonly relationshipTypeId: string;
        readonly reverseLabel: string;
      }[];
    };
    const historicalRow = historicalListBody.relationships.find((row) =>
      row.relationshipTypeId === historicalType.id
    );
    const optionBody = await initialized[0].json() as {
      readonly options: readonly { readonly id: string }[];
    };
    assert(
      archivedIdentity.length === 1 &&
        archivedIdentity[0]?.id === historicalType.id &&
        archivedIdentity[0].is_archived === true &&
        backfilledIdentity.length === 1 &&
        backfilledIdentity[0]?.is_archived === false &&
        historicalList.status === 200 &&
        historicalRow?.relationshipTypeArchived === true &&
        historicalRow.forwardLabel === historicalDefault.forwardLabel &&
        historicalRow.reverseLabel === historicalDefault.reverseLabel &&
        !optionBody.options.some((type) => type.id === historicalType.id),
      "archived seeded identity was recreated/reactivated or lost historical display",
    );
    const concurrent = await Promise.all([
      typeAccess(empty),
      typeAccess(empty),
    ]);
    assert(
      concurrent.every((response) => response.status === 200),
      "concurrent first access did not make defaults available",
    );
    assert(
      (await typeAccess(empty)).status === 200 &&
        (await typeAccess(partial)).status === 200,
      "default relationship vocabulary replay or partial backfill failed",
    );
    const readyCounts = await sql<{
      readonly active_system: number;
      readonly archived_system: number;
      readonly custom_count: number;
      readonly workspace_id: string;
    }[]>`
      select workspace_id::text,
        count(*) filter (where is_system and not is_archived)::int active_system,
        count(*) filter (where is_system and is_archived)::int archived_system,
        count(*) filter (where not is_system)::int custom_count
      from crm.relationship_types
      where workspace_id in (${empty.workspaceId}::uuid, ${partial.workspaceId}::uuid)
      group by workspace_id order by workspace_id
    `;
    const byWorkspace = new Map(
      readyCounts.map((row) => [row.workspace_id, row]),
    );
    const emptyCounts = byWorkspace.get(empty.workspaceId);
    const partialCounts = byWorkspace.get(partial.workspaceId);
    assert(
      emptyCounts?.active_system ===
          DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length &&
        emptyCounts.archived_system === 0 && emptyCounts.custom_count === 0,
      "empty existing workspace did not receive exactly one active default vocabulary",
    );
    assert(
      partialCounts?.active_system ===
          DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length - 1 &&
        partialCounts.archived_system === 1 && partialCounts.custom_count === 1,
      "partial backfill changed custom/archive history or duplicated defaults",
    );
    const hiddenResponse = await typeAccess(hidden);
    const hiddenCount = await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.relationship_types
      where workspace_id = ${hidden.workspaceId}::uuid
    `;
    assert(
      hiddenResponse.status === 200 &&
        (await hiddenResponse.json() as { readonly status: string }).status ===
          "hidden" &&
        hiddenCount[0]?.count === 0,
      "hidden relationships module backfilled or disclosed defaults",
    );
    const failingResponse = await typeAccess(failing);
    const failureCounts = await sql<{
      readonly count: number;
      readonly distinct_labels: number;
    }[]>`
      select count(*)::int count,
        count(distinct (forward_label, reverse_label))::int distinct_labels
      from crm.relationship_types
      where workspace_id = ${failing.workspaceId}::uuid
    `;
    assert(
      failingResponse.status === 503 && failureCounts[0]?.count === 2 &&
        failureCounts[0]?.distinct_labels === 1,
      "failed default postcondition left partial backfill rows",
    );
  },
});

Deno.test({
  name:
    "RELATIONSHIP-001 PostgreSQL keeps atomic related-person and ordinary relationship mutations in one lock order",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = await register(
      `relationship-lock-order-${crypto.randomUUID()}@example.test`,
      "Relationship lock-order workspace",
    );
    const [identity] = await sql<{
      readonly role: PeopleActor["role"];
      readonly user_id: string;
    }[]>`
      select user_id::text, role
      from crm.workspace_members
      where id = ${fixture.memberId}::uuid
    `;
    assert(identity, "lock-order actor is available");
    const actor: PeopleActor = {
      memberId: fixture.memberId,
      role: identity.role,
      userId: identity.user_id,
      workspaceId: fixture.workspaceId,
    };
    const sourceResponse = await createPerson(fixture, {
      givenName: "Lock source",
      isPartial: false,
    });
    const targetResponse = await createPerson(fixture, {
      givenName: "Ordinary target",
      isPartial: false,
    });
    const sourceId = (await sourceResponse.json()).person.id as string;
    const ordinaryTargetId = (await targetResponse.json()).person.id as string;
    const [type] = await sql<{ readonly id: string }[]>`
      select id::text
      from crm.relationship_types
      where workspace_id = ${fixture.workspaceId}::uuid
        and is_system = true and is_archived = false
      order by sort_order, id
      limit 1
    `;
    assert(type, "lock-order relationship type is available");

    let releaseRowsLocked!: () => void;
    const rowsLocked = new Promise<void>((resolve) => {
      releaseRowsLocked = resolve;
    });
    let releaseOrdinaryInitialized!: () => void;
    const ordinaryInitialized = new Promise<void>((resolve) => {
      releaseOrdinaryInitialized = resolve;
    });
    let atomicInitialized = false;
    const dependencies = (
      operation: "atomic" | "ordinary",
    ): RelationshipDependencies => {
      const transaction = new PostgresPeopleTransaction(peopleConnection.db);
      const peopleManagement = createPeopleManagement({
        actors,
        audit: personCreatedAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { create: () => crypto.randomUUID() },
        repository: new PostgresPeopleRepository(),
        transaction,
      });
      const workspace = new PostgresRelationshipWorkspaceBoundary();
      return {
        actors,
        audit: relationshipAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { create: () => crypto.randomUUID() },
        people: new PostgresRelationshipPersonBoundary(),
        peopleCreation: {
          async createInTransaction(commandActor, input, session) {
            const result = await peopleManagement.createInTransaction(
              commandActor,
              input,
              session,
            );
            releaseRowsLocked();
            if (!atomicInitialized) await ordinaryInitialized;
            return result;
          },
        },
        repository: new PostgresRelationshipRepository(),
        transaction,
        workspace: {
          async ensureDefaultRelationshipTypes(command) {
            const result = await workspace.ensureDefaultRelationshipTypes(
              command,
            );
            if (operation === "atomic") atomicInitialized = true;
            else releaseOrdinaryInitialized();
            return result;
          },
          hydrateTypes: (command) => workspace.hydrateTypes(command),
          inspect: (command) => workspace.inspect(command),
          listTypes: (command) => workspace.listTypes(command),
        },
      };
    };
    const atomic = createRelationshipManagement(
      dependencies("atomic"),
    );
    const ordinary = createRelationshipManagement(
      dependencies("ordinary"),
    );
    const atomicOperation = atomic.createRelatedPerson(actor, sourceId, {
      person: {
        givenName: `Atomic ${crypto.randomUUID()}`,
        isPartial: false,
      },
      relationshipTypeId: type.id,
    });
    await Promise.race([
      rowsLocked,
      atomicOperation.then((result) => {
        throw new Error(
          `atomic operation completed before taking people locks: ${result.status}`,
        );
      }),
    ]);
    const ordinaryOperation = ordinary.create(actor, sourceId, {
      relationshipTypeId: type.id,
      targetPersonId: ordinaryTargetId,
    });
    const [atomicOutcome, ordinaryOutcome] = await Promise.race([
      Promise.allSettled([atomicOperation, ordinaryOperation]),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("relationship lock-order test timed out")),
          5_000,
        )
      ),
    ]);
    if (
      atomicOutcome.status === "rejected" ||
      ordinaryOutcome.status === "rejected"
    ) {
      const code = (
        outcome: PromiseRejectedResult | PromiseFulfilledResult<unknown>,
      ) =>
        outcome.status === "rejected" &&
          typeof outcome.reason === "object" && outcome.reason !== null &&
          "code" in outcome.reason
          ? String(outcome.reason.code)
          : outcome.status;
      throw new Error(
        `overlapping relationship mutations failed: atomic=${
          code(atomicOutcome)
        }, ordinary=${code(ordinaryOutcome)}`,
      );
    }
    const atomicResult = atomicOutcome.value;
    const ordinaryResult = ordinaryOutcome.value;
    assert(
      atomicResult.status === "created" &&
        ordinaryResult.status === "created",
      "overlapping relationship mutations did not both complete",
    );
    const proof = await sql<{
      readonly audits: number;
      readonly defaults: number;
      readonly edges: number;
      readonly people: number;
    }[]>`
        select
          (select count(*)::int from crm.people
            where id = ${atomicResult.person.id}::uuid) people,
          (select count(*)::int from crm.relationships
            where id in (${atomicResult.relationship.id}::uuid,
              ${ordinaryResult.relationship.id}::uuid)) edges,
          (select count(*)::int from crm.audit_events
            where subject_id in (${atomicResult.person.id}::uuid,
              ${atomicResult.relationship.id}::uuid,
              ${ordinaryResult.relationship.id}::uuid)
              and action in ('people.person-created',
                'relationships.relationship-changed')) audits,
          (select count(*)::int from crm.relationship_types
            where workspace_id = ${fixture.workspaceId}::uuid
              and is_system = true) defaults
      `;
    assert(
      proof[0]?.people === 1 && proof[0].edges === 2 &&
        proof[0].audits === 3 && proof[0].defaults ===
          DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length,
      `lock-order completion lost atomic effects: ${JSON.stringify(proof[0])}`,
    );
  },
});

Deno.test({
  name:
    "[AUD-K2] RELATIONSHIP-001 PostgreSQL reads take the vocabulary lock only when a default is missing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = await register(
      `relationship-unlocked-${crypto.randomUUID()}@example.test`,
      "Unlocked relationship workspace",
    );
    const personResponse = await createPerson(fixture, {
      givenName: "Unlocked reader",
      isPartial: false,
    });
    const personId = (await personResponse.json()).person.id as string;
    const listTypes = () =>
      configured.app.request("http://localhost/api/v1/relationship-types", {
        headers: {
          cookie: fixture.cookie,
          "X-Workspace-Id": fixture.workspaceId,
        },
      });
    const settle = async <T>(work: T | Promise<T>, milliseconds: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          Promise.resolve(work).then((value) => ({
            settled: true as const,
            value,
          })),
          new Promise<{ readonly settled: false }>((resolve) => {
            timer = setTimeout(() => resolve({ settled: false }), milliseconds);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    // Holds the vocabulary's advisory lock on another connection while `work`
    // runs, so a read that takes the lock cannot finish until it is released.
    const whileVocabularyLocked = async <T>(
      work: () => Promise<T>,
    ): Promise<T> =>
      await raceSql.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(
            ${fixture.workspaceId}::text,
            ${DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.version}::bigint
          ))
        `;
        return await work();
      }) as T;

    const unlocked = await whileVocabularyLocked(async () => ({
      types: await settle(listTypes(), 3_000),
      relationships: await settle(
        relationshipRequest(fixture, personId, "GET"),
        3_000,
      ),
    }));
    assert(
      unlocked.types.settled && unlocked.types.value.status === 200,
      "a relationship-type read took the vocabulary lock with every default present",
    );
    assert(
      unlocked.relationships.settled &&
        unlocked.relationships.value.status === 200,
      "a relationships read took the vocabulary lock with every default present",
    );

    const missing = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[3]!;
    await sql`
      delete from crm.relationship_types
      where workspace_id = ${fixture.workspaceId}::uuid and is_system = true
        and forward_label = ${missing.forwardLabel}
        and reverse_label = ${missing.reverseLabel}
    `;
    let pending: Promise<Response> | undefined;
    const whileMissing = await whileVocabularyLocked(async () => {
      pending = Promise.resolve(listTypes());
      return await settle(pending, 500);
    });
    assert(
      !whileMissing.settled,
      "a read backfilled a missing default without the vocabulary lock",
    );
    assert(pending, "the backfilling read was started");
    assert(
      (await pending).status === 200,
      "the backfilling read answers once the lock is free",
    );
    const [restored] = await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.relationship_types
      where workspace_id = ${fixture.workspaceId}::uuid and is_system = true
    `;
    assert(
      restored?.count === DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length,
      "the missing default was restored under the lock",
    );
  },
});

Deno.test({
  name: "PEOPLE-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await raceSql.end();
    await peopleConnection.destroy();
    await configured.close();
  },
});
