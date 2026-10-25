/**
 * Profile facts (split from `people_postgres_test.ts`, GAP-035): tenant
 * vocabularies and hidden retention.
 *
 * Its final test closes the app and pools it loaded from
 * `people.test-helper.ts`.
 */

import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  configured,
  createPerson,
  profileFacts,
  register,
  sql,
} from "./people.test-helper.ts";
import { closeResources } from "./people.test-helper.ts";

Deno.test({
  name:
    "[PEOPLE-006] real PostgreSQL profile facts enforce tenant vocabularies and hidden retention",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await register(
      `facts-${crypto.randomUUID()}@example.test`,
      "Facts circle",
    );
    const foreign = await register(
      `facts-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign facts circle",
    );
    const created = await createPerson(owner, {
      givenName: "Ada",
      isPartial: false,
    });
    const personId =
      (await created.json() as { readonly person: { readonly id: string } })
        .person.id;
    const introducerCreated = await createPerson(owner, {
      givenName: "Charles",
      isPartial: false,
    });
    const introducerId = (await introducerCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const colleagueCreated = await createPerson(owner, {
      givenName: "Barbara",
      isPartial: false,
    });
    const colleagueId = (await colleagueCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const foreignPersonCreated = await createPerson(foreign, {
      givenName: "Private",
      isPartial: false,
    });
    const foreignPersonId = (await foreignPersonCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const introducerPage = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&search=Ada&selectedPersonId=${introducerId}&excludePersonId=${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const introducerPageBody = await introducerPage.json() as {
      readonly people?: readonly { readonly id: string }[];
      readonly selected?: { readonly id: string; readonly givenName: string };
    };
    assert(
      introducerPage.status === 200 &&
        introducerPageBody.people?.every((person) =>
          person.id !== introducerId
        ) &&
        introducerPageBody.selected?.id === introducerId &&
        introducerPageBody.selected.givenName === "Charles",
      "an existing introducer is hydrated outside the bounded search page",
    );
    const concealedSelected = async (selectedPersonId: string) => {
      const response = await configured.app.request(
        `http://localhost/api/v1/people?limit=1&selectedPersonId=${selectedPersonId}&excludePersonId=${personId}`,
        {
          headers: {
            cookie: owner.cookie,
            "X-Workspace-Id": owner.workspaceId,
          },
        },
      );
      return await response.json() as { readonly selected?: unknown };
    };
    assert(
      (await concealedSelected(personId)).selected === undefined &&
        (await concealedSelected(foreignPersonId)).selected === undefined,
      "self and foreign introducer hydration are concealed",
    );
    const excludedPage = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&excludePersonId=${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const excludedPageBody = await excludedPage.json() as {
      readonly nextCursor?: string;
      readonly people: readonly { readonly id: string }[];
    };
    const excludedTail = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&excludePersonId=${personId}&cursor=${
        encodeURIComponent(excludedPageBody.nextCursor ?? "")
      }`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const excludedTailBody = await excludedTail.json() as {
      readonly people: readonly { readonly id: string }[];
    };
    const mismatchedExclude = await configured.app.request(
      `http://localhost/api/v1/people?limit=1&excludePersonId=${colleagueId}&cursor=${
        encodeURIComponent(excludedPageBody.nextCursor ?? "")
      }`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    assert(
      excludedPage.status === 200 && excludedPageBody.people.length === 1 &&
        excludedPageBody.nextCursor && excludedTail.status === 200 &&
        excludedTailBody.people.length === 1 &&
        [...excludedPageBody.people, ...excludedTailBody.people].every((
          person,
        ) => person.id !== personId) && mismatchedExclude.status === 409,
      "excluded subject never consumes a page slot and remains cursor-bound",
    );
    const typeId = crypto.randomUUID();
    const foreignTypeId = crypto.randomUUID();
    const inactiveTypeId = crypto.randomUUID();
    const labelId = crypto.randomUUID();
    const foreignLabelId = crypto.randomUUID();
    const petCategoryId = crypto.randomUUID();
    const tagId = crypto.randomUUID();
    const foreignTagId = crypto.randomUUID();
    const foreignOrganizationId = crypto.randomUUID();
    await sql`
      insert into crm.contact_method_types (id, workspace_id, name, is_archived)
      values (${typeId}, ${owner.workspaceId}, 'Email', false),
        (${inactiveTypeId}, ${owner.workspaceId}, 'Disabled custom', true)
    `;
    await sql`
      insert into crm.contact_method_types (id, workspace_id, name, is_archived)
      values (${foreignTypeId}, ${foreign.workspaceId}, 'Foreign', false)
    `;
    await sql`
      insert into crm.contact_labels (id, workspace_id, label, applies_to)
      values (${labelId}, ${owner.workspaceId}, 'Home', 'any')
    `;
    await sql`
      insert into crm.contact_labels (id, workspace_id, label, applies_to)
      values (${foreignLabelId}, ${foreign.workspaceId}, 'Foreign', 'any')
    `;
    await sql`
      insert into crm.pet_categories (id, name, is_common, is_active)
      values (${petCategoryId}, ${`Cat ${petCategoryId}`}, true, true)
    `;
    await sql`
      insert into crm.tags (id, workspace_id, name, slug)
      values (${tagId}, ${owner.workspaceId}, 'Friend', ${`friend-${tagId}`}),
        (${foreignTagId}, ${foreign.workspaceId}, 'Private', ${`private-${foreignTagId}`})
    `;
    await sql`
      insert into crm.organizations (id, workspace_id, name)
      values (${foreignOrganizationId}, ${foreign.workspaceId}, 'Private Engines')
    `;
    const boundedOrganizations = await sql<{
      readonly id: string;
      readonly name: string;
    }[]>`
      insert into crm.organizations (workspace_id, name)
      select ${owner.workspaceId}::uuid,
        'Bounded organization ' || lpad(series::text, 3, '0')
      from generate_series(1, 74) series
      returning id::text, name
    `;
    const assignedTagRows = await sql<{ readonly id: string }[]>`
      insert into crm.tags (workspace_id, name, slug)
      select ${owner.workspaceId}::uuid, 'Assigned tag ' || series,
        ${`assigned-${personId}-`} || series
      from generate_series(1, 74) series
      returning id::text
    `;
    const assignedTagIds = [tagId, ...assignedTagRows.map((row) => row.id)];
    const request = (
      section: string,
      method: string,
      body?: Readonly<Record<string, unknown>>,
      factId?: string,
    ) => {
      const updateId = method === "PUT" && typeof body?.id === "string"
        ? body.id
        : undefined;
      const actualMethod = method === "PUT" && !updateId ? "POST" : method;
      const targetId = factId ?? updateId;
      return configured.app.request(
        `http://localhost/api/v1/people/${personId}/facts/${section}${
          targetId ? `/${targetId}` : ""
        }`,
        {
          ...(body
            ? {
              body: JSON.stringify(
                ["POST", "PUT", "DELETE"].includes(actualMethod)
                  ? { section, ...body }
                  : body,
              ),
            }
            : {}),
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
            origin: "http://localhost",
            "X-Workspace-Id": owner.workspaceId,
          },
          method: actualMethod,
        },
      );
    };
    const [ownerIdentity] = await sql<{ readonly user_id: string }[]>`
      select user_id::text from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(ownerIdentity, "owner actor identity resolves");
    const factActor = {
      memberId: owner.memberId,
      role: "owner" as const,
      userId: ownerIdentity.user_id,
      workspaceId: owner.workspaceId,
    };
    const initialFacts = await request("contact-methods", "GET");
    let personRevision = (await initialFacts.json() as {
      readonly personUpdatedAt: string;
    }).personUpdatedAt;
    const savedContact = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isPrimary: true,
      labelIds: [labelId],
      typeId,
      value: "ada@example.test",
    });
    const savedContactDiagnostic = await savedContact.clone().text();
    if (savedContact.status !== 200) {
      try {
        const direct = await profileFacts.create(
          factActor,
          personId,
          "contact-methods",
          {
            expectedPersonUpdatedAt: personRevision,
            isPrimary: true,
            labelIds: [labelId],
            typeId,
            value: "ada@example.test",
          },
        );
        throw new Error(
          `HTTP concealed a save while direct facade returned ${
            JSON.stringify(direct)
          }`,
        );
      } catch (error) {
        const details = error instanceof Error
          ? `${error.name}: ${error.message}; cause=${String(error.cause)}`
          : String(error);
        throw new Error(
          `workspace contact save raw diagnostic (${savedContact.status}: ${savedContactDiagnostic}): ${details}`,
        );
      }
    }
    assert(
      savedContact.status === 200,
      `workspace contact type and label save (${savedContact.status}: ${savedContactDiagnostic})`,
    );
    const contact = await savedContact.json() as {
      readonly personUpdatedAt: string;
      readonly record: { readonly id: string; readonly updatedAt: string };
    };
    personRevision = contact.personUpdatedAt;
    const factIds = new Map<string, string>([[
      "contact-methods",
      contact.record.id,
    ]]);
    const factRevisions = new Map<string, string>([[
      "contact-methods",
      contact.record.updatedAt,
    ]]);
    for (
      const [section, body] of [
        ["addresses", {
          city: "London",
          displayName: "Home",
          isPrimary: true,
          labelIds: [labelId],
          street: "1 Analytical Engine Way",
        }],
        ["first-meeting", {
          introducedByPersonId: introducerId,
          notes: "Introduced at a mathematics salon",
          placeText: "London",
        }],
        ["work", {
          isCurrent: true,
          organizationName: "Analytical Engines",
          title: "Mathematician",
        }],
        ["tags", { tagIds: assignedTagIds }],
        ["pets", { categoryId: petCategoryId, name: "Byron" }],
        ["food-preferences", { foodPreferences: "Tea; no shellfish" }],
      ] as const
    ) {
      const response = await request(section, "PUT", {
        ...body,
        expectedPersonUpdatedAt: personRevision,
        ...(section === "tags"
          ? { expectedUpdatedAt: personRevision, id: personId }
          : {}),
      });
      assert(
        response.status === 200,
        `${section} saves through its local fact action`,
      );
      const changed = await response.clone().json() as {
        readonly personUpdatedAt: string;
        readonly record: { readonly id: string; readonly updatedAt: string };
      };
      personRevision = changed.personUpdatedAt;
      factIds.set(section, changed.record.id);
      factRevisions.set(section, changed.record.updatedAt);
      const listed = await request(section, "GET");
      assert(listed.status === 200, `${section} refreshes independently`);
    }
    const organizationOptions = await request(
      "work?includeOptions=true&optionSearch=analytical",
      "GET",
    );
    const organizationOptionsBody = await organizationOptions.json() as {
      readonly options: readonly {
        readonly id: string;
        readonly kind?: string;
        readonly name: string;
      }[];
    };
    const foreignOrganizationOptions = await request(
      "work?includeOptions=true&optionSearch=private",
      "GET",
    );
    assert(
      organizationOptions.status === 200 &&
        organizationOptionsBody.options.length === 1 &&
        organizationOptionsBody.options[0]?.kind === "organization" &&
        organizationOptionsBody.options[0]?.name === "Analytical Engines" &&
        foreignOrganizationOptions.status === 200 &&
        (await foreignOrganizationOptions.json() as {
            readonly options: readonly unknown[];
          }).options.length === 0,
      "work options expose only searchable organizations from the active workspace",
    );
    const workOptionPage = async (search: string, cursor?: string) => {
      const response = await request(
        `work?includeOptions=true&optionSearch=${encodeURIComponent(search)}${
          cursor ? `&optionCursor=${encodeURIComponent(cursor)}` : ""
        }`,
        "GET",
      );
      return {
        body: await response.json() as {
          readonly nextOptionsCursor?: string;
          readonly options?: readonly {
            readonly id: string;
            readonly kind?: string;
            readonly name: string;
          }[];
        },
        status: response.status,
      };
    };
    const boundedFirst = await workOptionPage(
      "  BoUnDeD OrGaNiZaTiOn  ",
    );
    const boundedContinuation = await workOptionPage(
      "bounded organization",
      boundedFirst.body.nextOptionsCursor,
    );
    const boundedIds = [
      ...(boundedFirst.body.options ?? []),
      ...(boundedContinuation.body.options ?? []),
    ].map((option) => option.id);
    const mismatchedOrganizationSearch = await workOptionPage(
      "other organization",
      boundedFirst.body.nextOptionsCursor,
    );
    const anchor = boundedFirst.body.options?.at(-1);
    assert(anchor, "the first organization page exposes its keyset anchor");
    await sql`
      update crm.organizations set name = 'Changed organization anchor'
      where id = ${anchor.id}::uuid and workspace_id = ${owner.workspaceId}
    `;
    const staleOrganizationCursor = await workOptionPage(
      "bounded organization",
      boundedFirst.body.nextOptionsCursor,
    );
    const hydratedWork = await request("work", "GET");
    const hydratedWorkBody = await hydratedWork.json() as {
      readonly records: readonly {
        readonly referencesResolved?: boolean;
        readonly selectedOptions?: readonly {
          readonly id: string;
          readonly kind?: string;
          readonly name: string;
        }[];
        readonly value: { readonly organizationId?: string };
      }[];
    };
    const savedWork = hydratedWorkBody.records[0];
    assert(
      boundedOrganizations.length === 74 && boundedFirst.status === 200 &&
        boundedFirst.body.options?.length === 50 &&
        boundedFirst.body.nextOptionsCursor &&
        boundedContinuation.status === 200 &&
        boundedContinuation.body.options?.length === 24 &&
        !boundedContinuation.body.nextOptionsCursor &&
        boundedIds.length === 74 && new Set(boundedIds).size === 74 &&
        mismatchedOrganizationSearch.status === 409 &&
        staleOrganizationCursor.status === 409 && hydratedWork.status === 200 &&
        savedWork?.referencesResolved === true &&
        savedWork.selectedOptions?.length === 1 &&
        savedWork.selectedOptions[0]?.kind === "organization" &&
        savedWork.selectedOptions[0]?.id === savedWork.value.organizationId &&
        savedWork.selectedOptions[0]?.name === "Analytical Engines",
      `People-owned organization options are bounded, search-bound, tenant-safe, and hydrated: ${
        JSON.stringify({
          continuation: boundedContinuation.status,
          first: boundedFirst.body.options?.length,
          hydrated: savedWork,
          stale: staleOrganizationCursor.status,
          total: boundedIds.length,
        })
      }`,
    );
    const foodProof = () =>
      sql<{
        readonly audit_count: number;
        readonly food_preferences: string | null;
        readonly updated_at: string;
      }[]>`
        select person.food_preferences,
          to_char(person.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') updated_at,
          (select count(*)::int from crm.audit_events audit
            where audit.person_id = person.id
              and audit.action = 'people.person-profile-fact-updated'
              and audit.subject_type = 'person_profile_fact') audit_count
        from crm.people person where person.id = ${personId}
      `;
    const [beforeBlankFood] = await foodProof();
    const blankFood = await profileFacts.update(
      factActor,
      personId,
      "food-preferences",
      {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        foodPreferences: "   ",
        id: personId,
      },
    );
    const [afterBlankFood] = await foodProof();
    assert(
      blankFood.status === "validation-error" && beforeBlankFood &&
        afterBlankFood &&
        beforeBlankFood.food_preferences === afterBlankFood.food_preferences &&
        beforeBlankFood.updated_at === afterBlankFood.updated_at &&
        beforeBlankFood.audit_count === afterBlankFood.audit_count,
      "public facade rejects blank food without row, revision, or audit change",
    );
    const malformedContactId = crypto.randomUUID();
    await sql`
      insert into crm.person_contact_methods (id, person_id, type_id, value)
      values (${malformedContactId}, ${personId}, ${foreignTypeId}, 'concealed')
    `;
    await sql`
      insert into crm.person_contact_method_labels (contact_method_id, label_id)
      values (${factIds.get("contact-methods")!}, ${foreignLabelId})
    `;
    await sql`
      insert into crm.person_address_labels (address_id, label_id)
      values (${factIds.get("addresses")!}, ${foreignLabelId})
    `;
    await sql`
      update crm.person_first_meetings
      set introduced_by_person_id = ${foreignPersonId}
      where person_id = ${personId}
    `;
    const scopedContact = await request("contact-methods", "GET");
    const scopedAddress = await request("addresses", "GET");
    const scopedMeeting = await request("first-meeting", "GET");
    const scopedContactBody = await scopedContact.json() as {
      readonly records: readonly {
        readonly id: string;
        readonly value: { readonly labelIds: readonly string[] };
      }[];
    };
    const scopedAddressBody = await scopedAddress.json() as {
      readonly records: readonly {
        readonly value: { readonly labelIds: readonly string[] };
      }[];
    };
    const scopedMeetingBody = await scopedMeeting.json() as {
      readonly records: readonly {
        readonly value: { readonly introducedByPersonId?: string };
      }[];
    };
    assert(
      scopedContact.status === 200 && scopedAddress.status === 200 &&
        scopedMeeting.status === 200 &&
        scopedContactBody.records.every((record) =>
          record.id !== malformedContactId &&
          !record.value.labelIds.includes(foreignLabelId)
        ) &&
        scopedAddressBody.records.every((record) =>
          !record.value.labelIds.includes(foreignLabelId)
        ) &&
        scopedMeetingBody.records[0]?.value.introducedByPersonId === undefined,
      "foreign type, labels, and introducer references are concealed on reads",
    );

    const foreignContactId = crypto.randomUUID();
    const foreignLocationId = crypto.randomUUID();
    const foreignAddressId = crypto.randomUUID();
    const foreignWorkId = crypto.randomUUID();
    const foreignPetId = crypto.randomUUID();
    await sql`
      insert into crm.person_contact_methods (id, person_id, type_id, value)
      values (${foreignContactId}, ${foreignPersonId}, ${foreignTypeId}, 'private')
    `;
    await sql`
      insert into crm.locations (id, workspace_id, city)
      values (${foreignLocationId}, ${foreign.workspaceId}, 'Private')
    `;
    await sql`
      insert into crm.person_addresses (id, person_id, location_id)
      values (${foreignAddressId}, ${foreignPersonId}, ${foreignLocationId})
    `;
    await sql`
      insert into crm.person_occupations (id, person_id, title)
      values (${foreignWorkId}, ${foreignPersonId}, 'Private')
    `;
    await sql`
      insert into crm.pets (id, person_id, name)
      values (${foreignPetId}, ${foreignPersonId}, 'Private')
    `;
    const missingFactId = crypto.randomUUID();
    const concealedUpdates = await Promise.all([
      request("contact-methods", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignContactId,
        isPrimary: false,
        labelIds: [],
        typeId,
        value: "oracle@example.test",
      }),
      request("addresses", "PUT", {
        city: "Oracle",
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignAddressId,
        isPrimary: false,
        labelIds: [],
      }),
      request("work", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignWorkId,
        isCurrent: false,
        title: "Oracle",
      }),
      request("pets", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignPetId,
        name: "Oracle",
      }),
      request("pets", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: missingFactId,
        name: "Unused",
      }),
      request("first-meeting", "PUT", {
        expectedPersonUpdatedAt: personRevision,
        expectedUpdatedAt: personRevision,
        id: foreignPersonId,
        notes: "Oracle",
      }),
    ]);
    assert(
      concealedUpdates.every((response) => response.status === 404),
      "foreign and missing update IDs are indistinguishable and never upsert",
    );
    const assignedTags = await request("tags", "GET");
    const assignedTagsBody = await assignedTags.json() as {
      readonly options: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly records: readonly {
        readonly value: { readonly tagIds: readonly string[] };
      }[];
    };
    assert(
      assignedTags.status === 200 && assignedTagsBody.options.length === 75 &&
        assignedTagsBody.records[0]?.value.tagIds.length === 75 &&
        assignedTagsBody.options.every((option) => option.name.length > 0),
      "all assigned tag descriptors are hydrated in one bounded fact read",
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${owner.workspaceId}, 'tags', false)
      on conflict (workspace_id, key) do update set is_active = false,
        updated_at = now()
    `;
    const hiddenTags = await request("tags", "GET");
    const hiddenProfile = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const hiddenProfileBody = await hiddenProfile.json() as {
      readonly person: {
        readonly tagCount: number;
        readonly tags: readonly unknown[];
      };
    };
    const retainedTags = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.person_tags
      where person_id = ${personId}
    `;
    await sql`
      update crm.workspace_profile_modules set is_active = true,
        updated_at = now()
      where workspace_id = ${owner.workspaceId} and key = 'tags'
    `;
    const restoredTags = await request("tags", "GET");
    const restoredProfile = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const restoredProfileBody = await restoredProfile.json() as {
      readonly person: { readonly tagCount: number };
    };
    assert(
      hiddenTags.status === 200 &&
        (await hiddenTags.json() as { readonly status: string }).status ===
          "hidden" &&
        hiddenProfile.status === 200 &&
        hiddenProfileBody.person.tagCount === 0 &&
        hiddenProfileBody.person.tags.length === 0 &&
        retainedTags[0]?.count === 75 && restoredTags.status === 200 &&
        (await restoredTags.json() as { readonly options: readonly unknown[] })
            .options.length === 75 &&
        restoredProfile.status === 200 &&
        restoredProfileBody.person.tagCount === 75,
      "disabled tags hide every projection while re-enable restores retained links",
    );
    const stale = await request("contact-methods", "PUT", {
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      expectedPersonUpdatedAt: personRevision,
      id: contact.record.id,
      isPrimary: true,
      labelIds: [labelId],
      typeId,
      value: "changed@example.test",
    });
    assert(stale.status === 409, "stale fact version is rejected");
    const disabledType = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isPrimary: false,
      labelIds: [],
      typeId: inactiveTypeId,
      value: "private",
    });
    const foreignTag = await request("tags", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
      id: personId,
      tagIds: [foreignTagId],
    });
    const foreignOrganization = await request("work", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isCurrent: false,
      organizationId: foreignOrganizationId,
      title: "Private analyst",
    });
    assert(
      disabledType.status === 400 && foreignTag.status === 409 &&
        foreignOrganization.status === 400,
      "disabled and cross-workspace vocabulary or organization links persist nothing",
    );
    const selfIntroducer = await request("first-meeting", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: factRevisions.get("first-meeting")!,
      id: personId,
      introducedByPersonId: personId,
    });
    const foreignIntroducer = await request("first-meeting", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: factRevisions.get("first-meeting")!,
      id: personId,
      introducedByPersonId: foreignPersonId,
    });
    const invalidRange = await request("work", "PUT", {
      endOn: "2025-12-31",
      expectedPersonUpdatedAt: personRevision,
      isCurrent: false,
      startOn: "2026-01-01",
      title: "Analyst",
    });
    const rangeProblem = await invalidRange.json() as {
      readonly errors?: Readonly<Record<string, string>>;
    };
    assert(
      selfIntroducer.status === 400 && foreignIntroducer.status === 400 &&
        invalidRange.status === 400 && rangeProblem.errors?.endOn,
      "self/foreign introducers and reversed work dates fail safely",
    );
    const tagAgain = await request("tags", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
      id: personId,
      tagIds: [tagId],
    });
    const tagRevision = (await tagAgain.json() as {
      readonly personUpdatedAt: string;
    }).personUpdatedAt;
    const staleFood = await request("food-preferences", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
      foodPreferences: "Stale",
      id: personId,
    });
    const foodAgain = await request("food-preferences", "PUT", {
      expectedPersonUpdatedAt: tagRevision,
      expectedUpdatedAt: tagRevision,
      foodPreferences: "Tea",
      id: personId,
    });
    const foodRevision = (await foodAgain.json() as {
      readonly personUpdatedAt: string;
    }).personUpdatedAt;
    const lifecycle = (
      action: "archive" | "restore",
      expectedUpdatedAt: string,
    ) =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}/${action}`,
        {
          body: JSON.stringify({ expectedUpdatedAt }),
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
            origin: "http://localhost",
            "X-Workspace-Id": owner.workspaceId,
          },
          method: "POST",
        },
      );
    const archived = await lifecycle("archive", foodRevision);
    const archivedRevision = (await archived.json() as {
      readonly person: { readonly updatedAt: string };
    }).person.updatedAt;
    const restored = await lifecycle("restore", archivedRevision);
    personRevision = (await restored.json() as {
      readonly person: { readonly updatedAt: string };
    }).person.updatedAt;
    assert(
      tagAgain.status === 200 && staleFood.status === 409 &&
        foodAgain.status === 200 && archived.status === 200 &&
        restored.status === 200,
      "tag to food to lifecycle uses one propagated person revision",
    );
    const clearedFood = await profileFacts.delete(
      factActor,
      personId,
      "food-preferences",
      personId,
      personRevision,
      personRevision,
    );
    const replayClear = await request("food-preferences", "DELETE", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: personRevision,
    }, personId);
    const emptyFood = await request("food-preferences", "GET");
    const emptyFoodBody = await emptyFood.json() as {
      readonly records: readonly unknown[];
    };
    assert(
      clearedFood.status === "deleted" && replayClear.status === 409 &&
        emptyFood.status === 200 && emptyFoodBody.records.length === 0,
      "public facade clears food once with audit and no synthetic null record",
    );
    personRevision = clearedFood.status === "deleted"
      ? clearedFood.personUpdatedAt
      : personRevision;
    await sql`
      insert into crm.pets (person_id, name, created_at, updated_at)
      select ${personId}::uuid, 'Bounded pet ' || series,
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second',
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second'
      from generate_series(1, 120) series
    `;
    await sql`
      insert into crm.contact_method_types (
        id, workspace_id, name, is_archived
      )
      select gen_random_uuid(), ${owner.workspaceId}::uuid,
        'Bounded type ' || series, false
      from generate_series(1, 120) series
    `;
    await sql`
      insert into crm.contact_labels (id, workspace_id, label, applies_to)
      select gen_random_uuid(), ${owner.workspaceId}::uuid,
        'Bounded label ' || series, 'any'
      from generate_series(1, 120) series
    `;
    await sql`
      insert into crm.person_contact_methods (
        person_id, type_id, value, is_primary, sort_order, created_at,
        updated_at
      )
      select ${personId}::uuid, method_type.id,
        'bounded-' || series || '@example.test', false, series,
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second',
        '2026-01-01T00:00:00Z'::timestamptz + series * interval '1 second'
      from generate_series(1, 120) series
      join crm.contact_method_types method_type
        on method_type.workspace_id = ${owner.workspaceId}::uuid
        and method_type.name = 'Bounded type ' || series
    `;
    await sql`
      insert into crm.person_contact_method_labels (contact_method_id, label_id)
      select method.id, label.id
      from crm.person_contact_methods method
      join crm.contact_labels label
        on label.workspace_id = ${owner.workspaceId}::uuid
        and label.label = 'Bounded label ' ||
          substring(method.value from 'bounded-([0-9]+)@')
      where method.person_id = ${personId}::uuid
        and method.value like 'bounded-%@example.test'
    `;
    await sql`
      insert into crm.pet_categories (id, name, is_common, is_active)
      select gen_random_uuid(),
        ${`Bounded category ${personId} `} || series, false, true
      from generate_series(1, 120) series
    `;
    await sql`
      update crm.pets pet set category_id = category.id
      from crm.pet_categories category
      where pet.person_id = ${personId}::uuid
        and pet.name like 'Bounded pet %'
        and category.name = ${`Bounded category ${personId} `} ||
          substring(pet.name from 'Bounded pet ([0-9]+)')
    `;
    const replaceCursorId = (cursor: string) => {
      const padded = cursor.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - cursor.length % 4) % 4);
      const decoded = JSON.parse(atob(padded)) as Record<string, unknown>;
      decoded.id = "00000000-0000-4000-8000-000000000999";
      return btoa(JSON.stringify(decoded)).replaceAll("+", "-")
        .replaceAll("/", "_").replaceAll("=", "");
    };
    const petPage = await request("pets", "GET");
    const petPageBody = await petPage.json() as {
      readonly nextCursor?: string;
      readonly records: readonly unknown[];
    };
    const petPages = [petPageBody];
    let petCursor = petPageBody.nextCursor;
    while (petCursor && petPages.length < 10) {
      const page = await request(
        `pets?cursor=${encodeURIComponent(petCursor)}`,
        "GET",
      );
      assert(
        page.status === 200,
        `pet continuation is available: ${page.status}`,
      );
      const pageBody = await page.json() as typeof petPageBody;
      petPages.push(pageBody);
      petCursor = pageBody.nextCursor;
    }
    assert(
      petPage.status === 200 && petPageBody.records.length === 50 &&
        petPages.length === 3 &&
        petPages.every((page) => page.records.length <= 50) &&
        petPages.flatMap((page) => page.records).length === 121 && !petCursor,
      `fact rows are bounded across every continuation: ${
        JSON.stringify(petPages.map((page) => page.records.length))
      }`,
    );
    const forgedFactPage = await request(
      `pets?cursor=${
        encodeURIComponent(replaceCursorId(petPageBody.nextCursor ?? ""))
      }`,
      "GET",
    );
    assert(
      forgedFactPage.status === 409,
      `forged fact anchor is rejected: ${forgedFactPage.status}`,
    );
    const contactFactPage = await request("contact-methods", "GET");
    const contactFactPageBody = await contactFactPage.json() as {
      readonly nextCursor?: string;
      readonly records: readonly {
        readonly id: string;
        readonly referencesResolved?: boolean;
        readonly selectedOptions?: readonly { readonly id: string }[];
        readonly updatedAt: string;
        readonly value: {
          readonly isPrimary: boolean;
          readonly labelIds: readonly string[];
          readonly typeId: string;
          readonly value: string;
        };
      }[];
    };
    const contactFactPages = [contactFactPageBody];
    let contactFactCursor = contactFactPageBody.nextCursor;
    while (contactFactCursor && contactFactPages.length < 10) {
      const page = await request(
        `contact-methods?cursor=${encodeURIComponent(contactFactCursor)}`,
        "GET",
      );
      assert(
        page.status === 200,
        `contact continuation is available: ${page.status}`,
      );
      const pageBody = await page.json() as typeof contactFactPageBody;
      contactFactPages.push(pageBody);
      contactFactCursor = pageBody.nextCursor;
    }
    const allContactRecords = contactFactPages.flatMap((page) => page.records);
    const tailContact = allContactRecords.find((record) =>
      record.value.value === "bounded-120@example.test"
    );
    const archivedContact = allContactRecords.find((record) =>
      record.value.value === "bounded-2@example.test"
    );
    const tailPet = petPages.flatMap((page) => page.records).find((record) =>
      (record as { readonly value?: { readonly name?: string } }).value
        ?.name ===
        "Bounded pet 120"
    ) as {
      readonly id: string;
      readonly referencesResolved?: boolean;
      readonly selectedOptions?: readonly { readonly id: string }[];
      readonly updatedAt: string;
      readonly value: {
        readonly categoryId: string;
        readonly name: string;
      };
    } | undefined;
    assert(
      contactFactPage.status === 200 &&
        contactFactPageBody.records.length === 50 &&
        contactFactPageBody.records.every((record) =>
          record.referencesResolved === true &&
          record.selectedOptions?.length === 2
        ) && contactFactPages.length === 3 && !contactFactCursor &&
        tailContact &&
        tailContact.referencesResolved === true &&
        tailContact.selectedOptions?.length === 2 && tailPet &&
        tailPet.referencesResolved === true &&
        tailPet.selectedOptions?.some((option) =>
          option.id === tailPet.value.categoryId
        ),
      "fact pages hydrate every record's selected labels, types, and categories",
    );
    const optionSearch = `Bounded type`;
    const optionPage = (cursor?: string) =>
      request(
        `contact-methods?includeOptions=true&optionSearch=${
          encodeURIComponent(optionSearch)
        }${cursor ? `&optionCursor=${encodeURIComponent(cursor)}` : ""}`,
        "GET",
      );
    const readOptionBody = (response: Response) =>
      response.json() as Promise<{
        readonly nextOptionsCursor?: string;
        readonly options: readonly {
          readonly id: string;
          readonly name: string;
        }[];
      }>;
    const contactOptionPage = await optionPage();
    const contactOptionBody = await readOptionBody(contactOptionPage);
    const optionCursorVariants = [
      contactOptionBody.nextOptionsCursor ?? "",
      replaceCursorId(contactOptionBody.nextOptionsCursor ?? ""),
      "forged-option-cursor",
    ];
    for (const optionCursor of optionCursorVariants) {
      const missingInclude = await request(
        `contact-methods?optionCursor=${encodeURIComponent(optionCursor)}`,
        "GET",
      );
      assert(
        missingInclude.status === 400,
        `HTTP option continuation requires includeOptions=true: ${missingInclude.status}`,
      );
      const directMissingInclude = await profileFacts.list(
        factActor,
        personId,
        "contact-methods",
        { optionCursor, optionSearch: optionSearch } as never,
      );
      assert(
        directMissingInclude.status === "stale-cursor",
        `public facade rejects option continuation without options mode: ${directMissingInclude.status}`,
      );
    }
    const insertedOptionName = `${
      contactOptionBody.options.at(-1)?.name
    } inserted`;
    await sql`
      insert into crm.contact_method_types (
        workspace_id, name, is_archived
      ) values (${owner.workspaceId}, ${insertedOptionName}, false)
    `;
    const continuationAfterInsert = await optionPage(
      contactOptionBody.nextOptionsCursor,
    );
    const continuationAfterInsertBody = await readOptionBody(
      continuationAfterInsert,
    );
    const afterInsertPage = await optionPage();
    const afterInsertBody = await readOptionBody(afterInsertPage);
    const renameAnchor = afterInsertBody.options.at(-1);
    assert(
      renameAnchor && afterInsertBody.nextOptionsCursor,
      "rename anchor exists",
    );
    await sql`
      update crm.contact_method_types
      set name = 'Bounded type renamed', updated_at = now()
      where workspace_id = ${owner.workspaceId}
        and id = ${renameAnchor.id}::uuid
    `;
    const staleAfterRename = await optionPage(
      afterInsertBody.nextOptionsCursor,
    );
    const afterRenamePage = await optionPage();
    const afterRenameBody = await readOptionBody(afterRenamePage);
    const archiveAnchor = afterRenameBody.options.at(-1);
    assert(
      archiveAnchor && afterRenameBody.nextOptionsCursor,
      "archive anchor exists",
    );
    await sql`
      update crm.contact_method_types
      set is_archived = true, updated_at = now()
      where workspace_id = ${owner.workspaceId}
        and id = ${archiveAnchor.id}::uuid
    `;
    const staleAfterArchive = await optionPage(
      afterRenameBody.nextOptionsCursor,
    );
    await sql`
      update crm.contact_method_types
      set is_archived = true, updated_at = now()
      where workspace_id = ${owner.workspaceId}
        and name = 'Bounded type 2'
    `;
    assert(
      archivedContact !== undefined,
      `archived-reference fixture is present: ${
        JSON.stringify({
          firstPage: contactFactPageBody.records.length,
          pages: contactFactPages.map((page) => page.records.length),
        })
      }`,
    );
    const archivedBefore = await sql<{
      readonly audit_count: number;
      readonly person_revision: string;
      readonly value: string;
    }[]>`
      select method.value,
        to_char(person.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as person_revision,
        (select count(*)::int from crm.audit_events audit
          where audit.person_id = ${personId}
            and audit.action = 'people.person-profile-fact-updated'
            and audit.subject_type = 'person_profile_fact') as audit_count
      from crm.person_contact_methods method
      join crm.people person on person.id = method.person_id
      where method.id = ${archivedContact.id}::uuid
    `;
    const archivedUpdate = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: archivedContact.updatedAt,
      id: archivedContact.id,
      isPrimary: archivedContact.value.isPrimary,
      labelIds: archivedContact.value.labelIds,
      typeId: archivedContact.value.typeId,
      value: "must-not-update-archived-reference@example.test",
    });
    const archivedProblem = await archivedUpdate.clone().json() as {
      readonly code?: string;
    };
    const archivedAfter = await sql<{
      readonly audit_count: number;
      readonly person_revision: string;
      readonly value: string;
    }[]>`
      select method.value,
        to_char(person.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as person_revision,
        (select count(*)::int from crm.audit_events audit
          where audit.person_id = ${personId}
            and audit.action = 'people.person-profile-fact-updated'
            and audit.subject_type = 'person_profile_fact') as audit_count
      from crm.person_contact_methods method
      join crm.people person on person.id = method.person_id
      where method.id = ${archivedContact.id}::uuid
    `;
    assert(
      archivedUpdate.status === 400 &&
        archivedProblem.code === "profile_fact_reference_invalid",
      `archived contact type is rejected: ${
        JSON.stringify({
          code: archivedProblem.code,
          status: archivedUpdate.status,
        })
      }`,
    );
    assert(
      archivedAfter[0]?.value === archivedBefore[0]?.value &&
        archivedAfter[0]?.person_revision ===
          archivedBefore[0]?.person_revision &&
        archivedAfter[0]?.audit_count === archivedBefore[0]?.audit_count,
      `archived contact rejection has no mutation: ${
        JSON.stringify({
          after: archivedAfter[0],
          before: archivedBefore[0],
        })
      }`,
    );
    const stableOptionPage = await optionPage();
    const stableOptionBody = await readOptionBody(stableOptionPage);
    const stableOptionPages = [stableOptionBody];
    let stableOptionCursor = stableOptionBody.nextOptionsCursor;
    while (stableOptionCursor && stableOptionPages.length < 10) {
      const page = await optionPage(stableOptionCursor);
      assert(
        page.status === 200,
        `option continuation is available: ${page.status}`,
      );
      const body = await readOptionBody(page);
      stableOptionPages.push(body);
      stableOptionCursor = body.nextOptionsCursor;
    }
    const contactOptionIds = stableOptionPages.flatMap((page) => page.options)
      .map((option) => option.id);
    const forgedOptionPage = await optionPage(
      replaceCursorId(stableOptionBody.nextOptionsCursor ?? ""),
    );
    const mismatchedSearch = await request(
      `contact-methods?includeOptions=true&optionSearch=other&optionCursor=${
        encodeURIComponent(stableOptionBody.nextOptionsCursor ?? "")
      }`,
      "GET",
    );
    assert(
      contactOptionPage.status === 200 &&
        contactOptionBody.options.length === 50 &&
        contactOptionBody.nextOptionsCursor &&
        continuationAfterInsert.status === 200 &&
        continuationAfterInsertBody.options.some((option) =>
          option.name === insertedOptionName
        ) && staleAfterRename.status === 409 &&
        staleAfterArchive.status === 409 && stableOptionPage.status === 200 &&
        stableOptionBody.options.length === 50 &&
        stableOptionBody.nextOptionsCursor &&
        stableOptionPages.length === 3 &&
        stableOptionPages.every((page) => page.options.length <= 50) &&
        !stableOptionCursor &&
        new Set(contactOptionIds).size === contactOptionIds.length &&
        forgedOptionPage.status === 409 && mismatchedSearch.status === 409,
      `workspace option keysets handle insert/rename/archive and remain bounded: ${
        JSON.stringify({
          forged: forgedOptionPage.status,
          mismatch: mismatchedSearch.status,
          pages: stableOptionPages.map((page) => page.options.length),
        })
      }`,
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${owner.workspaceId}, 'contact-methods', false)
    `;
    const hidden = await request("contact-methods", "GET");
    const [beforeHiddenWrite] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.person_contact_methods
      where person_id = ${personId}
    `;
    const hiddenWrite = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      isPrimary: false,
      labelIds: [],
      typeId,
      value: "must-not-save@example.test",
    });
    const retained = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.person_contact_methods
      where person_id = ${personId}
    `;
    assert(
      hidden.status === 200 &&
        (await hidden.json() as { readonly status: string }).status ===
          "hidden" &&
        hiddenWrite.status === 409 && beforeHiddenWrite &&
        retained[0]?.count === beforeHiddenWrite.count,
      "disabled section hides but retains existing rows and rejects new writes",
    );
    const audits = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-profile-fact-updated'
        and subject_type = 'person_profile_fact'
    `;
    assert(
      audits[0]?.count === 10,
      "each successful fact transaction has one exact governance audit",
    );
    await sql`
      update crm.workspace_profile_modules set is_active = true
      where workspace_id = ${owner.workspaceId}::uuid
        and key = 'contact-methods'
    `;
    assert(tailContact && tailPet, "continuation records remain available");
    const updatedTailContact = await request("contact-methods", "PUT", {
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: tailContact.updatedAt,
      id: tailContact.id,
      isPrimary: tailContact.value.isPrimary,
      labelIds: tailContact.value.labelIds,
      typeId: tailContact.value.typeId,
      value: "updated-continuation@example.test",
    });
    const updatedTailContactBody = await updatedTailContact.json() as {
      readonly personUpdatedAt?: string;
    };
    personRevision = updatedTailContactBody.personUpdatedAt ?? personRevision;
    const updatedTailPet = await request("pets", "PUT", {
      categoryId: tailPet.value.categoryId,
      expectedPersonUpdatedAt: personRevision,
      expectedUpdatedAt: tailPet.updatedAt,
      id: tailPet.id,
      name: "Updated continuation pet",
    });
    const retainedReferences = await sql<{
      readonly contact_labels: number;
      readonly pet_category_id: string | null;
    }[]>`
      select
        (select count(*)::int from crm.person_contact_method_labels
          where contact_method_id = ${tailContact.id}::uuid) as contact_labels,
        (select category_id::text from crm.pets
          where id = ${tailPet.id}::uuid) as pet_category_id
    `;
    const finalAudits = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-profile-fact-updated'
        and subject_type = 'person_profile_fact'
    `;
    assert(
      updatedTailContact.status === 200,
      `unrelated continuation contact edit succeeds: ${
        JSON.stringify({
          body: updatedTailContactBody,
          status: updatedTailContact.status,
        })
      }`,
    );
    assert(
      updatedTailPet.status === 200,
      `unrelated continuation pet edit succeeds: ${
        JSON.stringify({
          body: await updatedTailPet.clone().text(),
          status: updatedTailPet.status,
        })
      }`,
    );
    assert(
      retainedReferences[0]?.contact_labels === 1,
      `continuation contact edit retains its selected label: ${
        JSON.stringify(
          retainedReferences[0],
        )
      }`,
    );
    assert(
      retainedReferences[0]?.pet_category_id === tailPet.value.categoryId,
      `continuation pet edit retains its selected category: ${
        JSON.stringify({
          actual: retainedReferences[0]?.pet_category_id,
          expected: tailPet.value.categoryId,
        })
      }`,
    );
    assert(
      finalAudits[0]?.count === 12,
      `continuation edits add two scoped governance audits: ${
        JSON.stringify({
          actual: finalAudits[0]?.count,
          expected: 12,
        })
      }`,
    );
  },
});

Deno.test({
  name: "[REL-093] PostgreSQL fact cursors preserve microsecond anchors",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const owner = await register(
      `fact-microseconds-${crypto.randomUUID()}@example.test`,
      "Microsecond facts",
    );
    const foreign = await register(
      `fact-microseconds-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign microsecond facts",
    );
    const person = async (fixture: typeof owner, givenName: string) => {
      const response = await createPerson(fixture, {
        givenName,
        isPartial: false,
      });
      assertEquals(response.status, 201);
      return (await response.json() as {
        readonly person: { readonly id: string };
      }).person.id;
    };
    const personId = await person(owner, "Ada");
    const otherPersonId = await person(owner, "Grace");
    const foreignPersonId = await person(foreign, "Private");
    const ids = Array.from({ length: 53 }, () => crypto.randomUUID()).sort();
    // Equal timestamps straddle the page boundary; neighbours differ by only
    // one microsecond. Keep these values in PostgreSQL, never in a JS Date.
    await sql`
      insert into crm.pets (id, person_id, name, updated_at)
      select id, ${personId}::uuid, 'Microsecond pet ' || position,
        '2026-01-01T00:00:00.123456Z'::timestamptz +
          case when position <= 49 then 0 when position <= 51 then 1 else 2 end *
            interval '1 microsecond'
      from unnest(${ids}::uuid[]) with ordinality fixture(id, position)
    `;
    const typeId = crypto.randomUUID();
    await sql`
      insert into crm.contact_method_types (id, workspace_id, name)
      values (${typeId}::uuid, ${owner.workspaceId}::uuid, 'Microsecond contact')
    `;
    await sql`
      insert into crm.person_contact_methods (
        id, person_id, type_id, value, updated_at
      )
      select id, person_id, ${typeId}::uuid, name, updated_at
      from crm.pets where person_id = ${personId}::uuid
    `;
    await sql`
      insert into crm.person_addresses (id, person_id, display_name, updated_at)
      select id, person_id, name, updated_at
      from crm.pets where person_id = ${personId}::uuid
    `;
    await sql`
      insert into crm.person_occupations (id, person_id, title, updated_at)
      select id, person_id, name, updated_at
      from crm.pets where person_id = ${personId}::uuid
    `;
    const expected = ids.map((id, index) => ({
      id,
      updatedAt: `2026-01-01T00:00:00.${
        index < 49 ? "123456" : index < 51 ? "123457" : "123458"
      }Z`,
    }));
    interface Page {
      readonly nextCursor?: string;
      readonly records: readonly {
        readonly id: string;
        readonly updatedAt: string;
      }[];
    }
    const projection = (page: Page) =>
      page.records.map(({ id, updatedAt }) => ({ id, updatedAt }));
    const request = (
      section: string,
      cursor?: string,
      targetPersonId = personId,
      fixture = owner,
    ) =>
      configured.app.request(
        `http://localhost/api/v1/people/${targetPersonId}/facts/${section}${
          cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
        }`,
        {
          headers: {
            cookie: fixture.cookie,
            "X-Workspace-Id": fixture.workspaceId,
          },
        },
      );
    for (const section of ["pets", "contact-methods", "addresses", "work"]) {
      await t.step(section, async () => {
        const firstResponse = await request(section);
        assertEquals(firstResponse.status, 200);
        const first = await firstResponse.json() as Page;
        assertEquals(projection(first), expected.slice(0, 50), "first page");
        assert(first.nextCursor, "first page has a continuation");
        const secondResponse = await request(section, first.nextCursor);
        assertEquals(secondResponse.status, 200, "microsecond continuation");
        const second = await secondResponse.json() as Page;
        assertEquals(second.records.length, 3, "exact remaining fact count");
        assertEquals(projection(second), expected.slice(50), "second page");
        assertEquals(
          [...projection(first), ...projection(second)],
          expected,
          "all facts retain their exact order and timestamps",
        );
        assertEquals(
          new Set([...first.records, ...second.records].map(({ id }) => id))
            .size,
          ids.length,
          "no duplicate facts",
        );
        assert(!("nextCursor" in second), "last page omits its continuation");
        for (
          const [targetId, fixture] of [
            [otherPersonId, owner],
            [foreignPersonId, foreign],
          ] as const
        ) {
          const refused = await request(
            section,
            first.nextCursor,
            targetId,
            fixture,
          );
          assertEquals(refused.status, 409, "foreign cursor is refused");
          assertEquals(
            (await refused.json() as { readonly code: string }).code,
            "profile_fact_cursor_stale",
          );
        }
        // Changing only the anchor, without changing the person's revision,
        // must still invalidate the cursor at full microsecond precision.
        const table = {
          pets: "crm.pets",
          "contact-methods": "crm.person_contact_methods",
          addresses: "crm.person_addresses",
          work: "crm.person_occupations",
        }[section]!;
        await sql`
          update ${
          sql(table)
        } set updated_at = updated_at + interval '1 microsecond'
          where id = ${ids[49]!}::uuid and person_id = ${personId}::uuid
        `;
        const stale = await request(section, first.nextCursor);
        assertEquals(stale.status, 409, "changed microsecond anchor is stale");
        assertEquals(
          (await stale.json() as { readonly code: string }).code,
          "profile_fact_cursor_stale",
        );
      });
    }
  },
});

Deno.test({
  name: "PEOPLE-001 PostgreSQL facts resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
