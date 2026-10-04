import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { apiSupport } from "../support/api.ts";
Deno.test({
  name:
    "IMPORT-001 business records upgrade old imports and remain idempotent without replaying deliveries",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = requireDatabaseUrl(),
      sql = openSql(url),
      mail = new CapturedVerificationMail();
    const configured = createConfiguredApiApp(
      url,
      mail,
      browserSecurityPolicy("test", "http://localhost"),
    );
    const api = apiSupport(configured.app, mail, sql);
    const email = `business-${crypto.randomUUID()}@example.test`;
    const actor = await api.register(email, email, {
      firstName: "Import",
      lastName: "Owner",
    });
    const contact = {
      id: 1,
      account_id: 1,
      uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      first_name: "Example",
      birthday_special_date_id: 1,
      birthday_reminder_id: 1,
    };
    const date = {
      id: 1,
      account_id: 1,
      contact_id: 1,
      date: "1990-04-05",
      is_age_based: 0,
      is_year_unknown: 0,
    };
    const run = async (tables: Record<string, unknown>) => {
      const dry = await api.request(actor, "/api/v1/imports/dry-runs", "POST", {
        source: { format: "monica-json", version: 1, tables },
      });
      assertEquals(dry.status, 201);
      const staged = await dry.json() as { importId: string };
      const commit = await api.request(
        actor,
        `/api/v1/imports/${staged.importId}/commit`,
        "POST",
        {
          confirmed: true,
          monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
        },
      );
      const result = await commit.json();
      assertEquals(commit.status, 200, JSON.stringify(result));
      return { ...staged, ...result };
    };
    try {
      const baseline = await run({
        contacts: [contact],
        special_dates: [date],
      });
      const [person] =
        await sql`select id from crm.people where workspace_id=${actor.workspaceId}::uuid`;
      const [personDate] =
        await sql`select id from crm.person_dates where person_id=${
          person!.id
        }::uuid`;
      // Reproduce the previous importer: note bodies with import timestamps and a
      // generated birthday reminder, but no identities for either source record.
      await sql`insert into crm.notes(workspace_id,person_id,body,created_by_member_id) values(${actor.workspaceId}::uuid,${
        person!.id
      }::uuid,'Same body',${actor.memberId}::uuid),(${actor.workspaceId}::uuid,${
        person!.id
      }::uuid,'Same body',${actor.memberId}::uuid)`;
      const [legacyFile] =
        await sql`insert into crm.files(workspace_id,uploaded_by_member_id,original_filename,storage_provider,byte_size,status,visibility) values(${actor.workspaceId}::uuid,${actor.memberId}::uuid,'portrait.png','import-manifest',10,'missing','private') returning id`;
      await sql`insert into crm.person_avatars(person_id,source,file_id) values(${
        person!.id
      }::uuid,'file',${
        legacyFile!.id
      }::uuid) on conflict(person_id) do update set source='file',file_id=excluded.file_id`;
      await sql`insert into crm.data_import_entities(import_id,source_table,source_primary_key,target_table,target_key,status,warnings,raw_snapshot) values(${baseline.importId}::uuid,'photos','contact:1:avatar','files',${
        legacyFile!.id
      },'warning','[]'::jsonb,'{"personSourcePrimaryKey":"1","originalFilename":"portrait.png","byteSize":10}'::jsonb)`;
      const [legacyReminder] =
        await sql`insert into crm.reminders(workspace_id,person_id,person_date_id,target_kind,title,anchor_on,recurrence_unit,can_delete) values(${actor.workspaceId}::uuid,${
          person!.id
        }::uuid,${
          personDate!.id
        }::uuid,'person_date','Birthday','1990-04-05','year',false) returning id`;
      await sql`insert into crm.reminder_occurrences(reminder_id,member_id,occurs_on,deliver_at,status) values(${
        legacyReminder!.id
      }::uuid,${actor.memberId}::uuid,'2099-04-05','2099-04-05T12:00:00Z','pending')`;
      await sql`update crm.data_import_entities set raw_snapshot=jsonb_set(raw_snapshot,'{notes}','["Same body","Same body"]'::jsonb) where import_id=${baseline.importId}::uuid and source_table='contacts'`;
      await sql`update crm.data_imports set completed_at=now(),stats=jsonb_set(stats,'{fingerprint}','"old-importer-fingerprint"'::jsonb) where id=${baseline.importId}::uuid`;
      const tables = {
        contacts: [{ ...contact, avatar_source: "photo", avatar_photo_id: 1 }, {
          id: 2,
          account_id: 1,
          uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          first_name: "Friend",
        }],
        special_dates: [date],
        photos: [{
          id: 1,
          account_id: 1,
          original_filename: "portrait.png",
          filesize: 10,
          mime_type: "image/png",
        }],
        contact_photo: [{ contact_id: 1, photo_id: 1 }],
        relationship_type_groups: [{ id: 1, account_id: 1, name: "Family" }],
        relationship_types: [{
          id: 1,
          account_id: 1,
          name: "parent",
          name_reverse_relationship: "child",
          relationship_type_group_id: 1,
        }, {
          id: 2,
          account_id: 1,
          name: "child",
          name_reverse_relationship: "parent",
          relationship_type_group_id: 1,
        }],
        relationships: [{
          id: 1,
          account_id: 1,
          contact_is: 1,
          of_contact: 2,
          relationship_type_id: 1,
        }, {
          id: 2,
          account_id: 1,
          contact_is: 2,
          of_contact: 1,
          relationship_type_id: 2,
        }],
        activity_type_categories: [{ id: 1, account_id: 1, name: "Social" }],
        activity_types: [{
          id: 1,
          account_id: 1,
          name: "Walk",
          activity_type_category_id: 1,
        }],
        activities: [{
          id: 1,
          account_id: 1,
          activity_type_id: 1,
          summary: "Park walk",
          description: null,
          happened_at: "2020-04-05 10:30:00",
          created_at: "2020-04-05 11:00:00",
        }],
        activity_contact: [{ account_id: 1, activity_id: 1, contact_id: 1 }, {
          account_id: 1,
          activity_id: 1,
          contact_id: 2,
        }],
        calls: [{
          id: 1,
          account_id: 1,
          contact_id: 1,
          called_at: "2020-04-06 12:00:00",
          content: null,
          contact_called: 1,
        }],
        emotion_call: [{
          account_id: 1,
          call_id: 1,
          emotion_id: 1,
          contact_id: 1,
        }],
        notes: [{
          id: 1,
          account_id: 1,
          contact_id: 1,
          body: "Same body",
          created_at: "2020-01-01",
          updated_at: "2020-01-02",
          is_favorited: 1,
          favorited_at: "2020-01-02",
        }, { id: 2, account_id: 1, contact_id: 1, body: "Same body" }],
        reminder_rules: [{
          id: 1,
          account_id: 1,
          number_of_days_before: 0,
          active: 1,
        }],
        reminders: [{
          id: 1,
          account_id: 1,
          contact_id: 1,
          title: "Birthday reminder",
          initial_date: "1990-04-05",
          frequency_type: "year",
          frequency_number: 1,
          inactive: 1,
          delible: 0,
        }, {
          id: 2,
          account_id: 1,
          contact_id: 2,
          title: "Monthly call",
          initial_date: "2020-01-01",
          frequency_type: "month",
          frequency_number: 1,
          inactive: 0,
          delible: 1,
        }],
        reminder_outbox: [{ id: 1, reminder_id: 2, status: "sent" }],
      };
      for (let i = 0; i < 2; i++) {
        const result = await run(tables);
        assertEquals(result.peopleCreated, i === 0 ? 1 : 0);
        assertEquals(result.peopleReused, i === 0 ? 1 : 2);
        const [counts] =
          await sql`select (select count(*)::int from crm.people where workspace_id=${actor.workspaceId}::uuid) people,(select count(*)::int from crm.relationships where workspace_id=${actor.workspaceId}::uuid) relationships,(select count(*)::int from crm.activities where workspace_id=${actor.workspaceId}::uuid) activities,(select count(*)::int from crm.calls where workspace_id=${actor.workspaceId}::uuid) calls,(select count(*)::int from crm.notes where workspace_id=${actor.workspaceId}::uuid) notes,(select count(*)::int from crm.reminders where workspace_id=${actor.workspaceId}::uuid) reminders`;
        assertEquals(counts, {
          people: 2,
          relationships: 1,
          activities: 1,
          calls: 1,
          notes: 2,
          reminders: 2,
        });
      }
      const [fileCount] =
        await sql`select count(*)::int n from crm.files where workspace_id=${actor.workspaceId}::uuid`;
      assertEquals(fileCount?.n, 1);
      const [gallery] =
        await sql`select file_id from crm.person_file_links where person_id=${
          person!.id
        }::uuid`;
      assertEquals(gallery?.file_id, legacyFile!.id);
      const [note] =
        await sql`select created_at,favorited_at from crm.notes where person_id=${
          person!.id
        }::uuid and is_favorited`;
      assertEquals(note?.created_at.toISOString(), "2020-01-01T00:00:00.000Z");
      assertEquals(
        note?.favorited_at.toISOString(),
        "2020-01-02T00:00:00.000Z",
      );
      const [reminder] =
        await sql`select is_active,can_delete from crm.reminders where id=${
          legacyReminder!.id
        }::uuid`;
      assertEquals(reminder, { is_active: false, can_delete: false });
      const pending =
        await sql`select o.deliver_at from crm.reminder_occurrences o join crm.reminders r on r.id=o.reminder_id where r.workspace_id=${actor.workspaceId}::uuid and o.status='pending'`;
      assert(pending.length > 0, "future occurrences generated");
      assert(
        pending.every((o) => o.deliver_at.valueOf() >= Date.now()),
        "no historical notifications replayed",
      );
    } finally {
      await configured.close();
      await sql.end();
    }
  },
});

import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { revocableActor } from "../support/database.ts";
import { PostgresVocabularyBusinessImportBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/business_vocabulary_import.ts";
import { PostgresWorkspaceBusinessImportBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/import_business_boundary.ts";
Deno.test({
  name:
    "Business vocabularies reject foreign references and private global taxonomy values atomically",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = requireDatabaseUrl(),
      sql = openSql(url),
      connection = connectDatabase(url),
      boundary = new PostgresVocabularyBusinessImportBoundary();
    const actor = await revocableActor(
        sql,
        `vocabulary-${crypto.randomUUID()}`,
      ),
      foreign = await revocableActor(sql, `foreign-${crypto.randomUUID()}`);
    try {
      const [group] =
        await sql`insert into crm.relationship_type_groups(workspace_id,name) values(${foreign.workspaceId}::uuid,'Foreign') returning id`;
      const [category] =
        await sql`insert into crm.activity_type_categories(workspace_id,name) values(${foreign.workspaceId}::uuid,'Foreign') returning id`;
      for (const kind of ["relationship_type", "activity_type"] as const) {
        const id = crypto.randomUUID();
        let rejected = false;
        try {
          await connection.db.transaction().execute(async (tx) => {
            await boundary.importRecords({
              actor,
              transaction: { opaque: tx },
              records: [{
                id,
                data: {
                  kind: "relationship_group",
                  name: "Rolled back",
                  canDelete: true,
                  createdAt: null,
                  updatedAt: null,
                },
                references: {},
              }, {
                id: crypto.randomUUID(),
                data: { kind },
                references: kind === "relationship_type"
                  ? { groupId: group!.id }
                  : { categoryId: category!.id },
              }],
            });
          });
        } catch {
          rejected = true;
        }
        assert(rejected, "foreign category rejected");
        assertEquals(
          (await sql`select id from crm.relationship_type_groups where id=${id}::uuid`)
            .length,
          0,
        );
      }
      let rejected = false;
      try {
        await new PostgresWorkspaceBusinessImportBoundary().importRecords({
          actor,
          transaction: { opaque: connection.db },
          records: [{
            id: crypto.randomUUID(),
            data: { kind: "pet_category", name: "Private category" },
            references: {},
          }],
        });
      } catch {
        rejected = true;
      }
      assert(rejected, "private global category rejected");
    } finally {
      await connection.destroy();
      await sql.end();
    }
  },
});

import { personBoundary } from "../../packages/backend/modules/people/composition.ts";
import { PostgresFileBusinessImportBoundary } from "../../packages/backend/modules/files/adapters/postgres/import_business_boundary.ts";
import { PostgresPeopleBusinessImportBoundary } from "../../packages/backend/modules/people/adapters/postgres/import_business_boundary.ts";
import { PostgresInteractionBusinessImportBoundary } from "../../packages/backend/modules/interactions/adapters/postgres/business_import_boundary.ts";
import { PostgresRelationshipBusinessImportBoundary } from "../../packages/backend/modules/relationships/adapters/postgres/business_import_boundary.ts";
import { PostgresPlanningBusinessImportBoundary } from "../../packages/backend/modules/planning/adapters/postgres/business_import_boundary.ts";
Deno.test({
  name:
    "Business owners reject foreign people, vocabularies and interaction parents with rollback",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = requireDatabaseUrl(),
      sql = openSql(url),
      connection = connectDatabase(url);
    const actor = await revocableActor(
        sql,
        `references-${crypto.randomUUID()}`,
      ),
      foreign = await revocableActor(sql, `foreign-${crypto.randomUUID()}`);
    const persons = personBoundary(),
      vocabulary = new PostgresWorkspaceBusinessImportBoundary(),
      files = new PostgresFileBusinessImportBoundary(persons);
    const people = new PostgresPeopleBusinessImportBoundary({
      file: (c) => files.fileExists(c),
      vocabulary: (c) => vocabulary.referenceExists(c),
    });
    const interactions = new PostgresInteractionBusinessImportBoundary(
      persons,
      (c) => vocabulary.referenceExists(c),
    );
    const relationships = new PostgresRelationshipBusinessImportBoundary(
      persons,
      (c) => vocabulary.referenceExists(c),
    );
    const planning = new PostgresPlanningBusinessImportBoundary(
      {
        listEligible: () => Promise.resolve([]),
        filterEligible: () => Promise.resolve([]),
      },
      { listDeliveryPreferences: () => Promise.resolve([]) },
      persons,
      (c) => people.dateBelongsToPerson(c),
    );
    try {
      const [activity] =
        await sql`insert into crm.activities(workspace_id,summary,happened_at) values(${foreign.workspaceId}::uuid,'Foreign',now()) returning id`;
      const [call] =
        await sql`insert into crm.calls(workspace_id,person_id,called_at) values(${foreign.workspaceId}::uuid,${foreign.personId}::uuid,now()) returning id`;
      const [type] =
        await sql`insert into crm.relationship_types(workspace_id,forward_label,reverse_label) values(${foreign.workspaceId}::uuid,'Foreign','Foreign') returning id`;
      const [date] =
        await sql`insert into crm.person_dates(person_id,kind,precision,year,month,day) values(${foreign.personId}::uuid,'birthday','full',1990,1,1) returning id`;
      const commands = [
        (transaction: { opaque: unknown }) =>
          planning.importRecords({
            actor,
            transaction,
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "cadence" },
              references: { personId: foreign.personId },
            }],
          }),
        (transaction: { opaque: unknown }) =>
          planning.importRecords({
            actor,
            transaction,
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "reminder" },
              references: { personId: actor.personId, dateId: date!.id },
            }],
          }),
        (transaction: { opaque: unknown }) =>
          relationships.importRecords({
            actor,
            transaction,
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "relationship" },
              references: {
                fromPersonId: actor.personId,
                toPersonId: foreign.personId,
                typeId: type!.id,
              },
            }],
          }),
        (transaction: { opaque: unknown }) =>
          relationships.importRecords({
            actor,
            transaction,
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "relationship" },
              references: {
                fromPersonId: actor.personId,
                toPersonId: actor.personId,
                typeId: type!.id,
              },
            }],
          }),
        (transaction: { opaque: unknown }) =>
          interactions.importRecords({
            actor,
            transaction,
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "participant" },
              references: {
                personId: actor.personId,
                activityId: activity!.id,
              },
            }],
          }),
        (transaction: { opaque: unknown }) =>
          interactions.importRecords({
            actor,
            transaction,
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "activity_emotion" },
              references: { parentId: activity!.id },
            }],
          }),
        (transaction: { opaque: unknown }) =>
          interactions.importRecords({
            actor,
            transaction,
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "call_emotion" },
              references: { parentId: call!.id },
            }],
          }),
      ];
      for (const command of commands) {
        const marker = crypto.randomUUID();
        let reason = "";
        try {
          await connection.db.transaction().execute(async (tx) => {
            await interactions.importRecords({
              actor,
              transaction: { opaque: tx },
              records: [{
                id: marker,
                data: {
                  kind: "note",
                  body: "Rollback marker",
                  isFavorited: false,
                  favoritedAt: null,
                  createdAt: null,
                  updatedAt: null,
                },
                references: { personId: actor.personId },
              }],
            });
            await command({ opaque: tx });
          });
        } catch (error) {
          reason = String(error);
        }
        assert(
          reason.includes("outside the workspace"),
          `owner guard rejected reference: ${reason}`,
        );
        assertEquals(
          (await sql`select id from crm.notes where id=${marker}::uuid`).length,
          0,
        );
      }
      await sql`update crm.people set deleted_at=now() where id=${actor.personId}::uuid`;
      const historicalNote = crypto.randomUUID(),
        historicalCall = crypto.randomUUID();
      await connection.db.transaction().execute((tx) =>
        interactions.importRecords({
          actor,
          transaction: { opaque: tx },
          records: [
            {
              id: historicalNote,
              data: {
                kind: "note",
                body: "Source-deleted history",
                isFavorited: false,
                favoritedAt: null,
                createdAt: null,
                updatedAt: null,
              },
              references: { personId: actor.personId },
            },
            {
              id: historicalCall,
              data: {
                kind: "call",
                calledAt: "2020-01-01T00:00:00Z",
                content: null,
                contactWasCaller: false,
                createdAt: null,
                updatedAt: null,
              },
              references: { personId: actor.personId },
            },
          ],
        })
      );
      assertEquals(
        (await sql`select id from crm.notes where id=${historicalNote}::uuid`)
          .length,
        1,
      );
      assertEquals(
        (await sql`select id from crm.calls where id=${historicalCall}::uuid`)
          .length,
        1,
      );
    } finally {
      await connection.destroy();
      await sql.end();
    }
  },
});
Deno.test({
  name:
    "Active imported date reminders regenerate future deliveries and preserve sent history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = requireDatabaseUrl(),
      sql = openSql(url),
      connection = connectDatabase(url),
      actor = await revocableActor(sql, `schedule-${crypto.randomUUID()}`);
    const persons = personBoundary(),
      vocabulary = new PostgresWorkspaceBusinessImportBoundary(),
      files = new PostgresFileBusinessImportBoundary(persons);
    const people = new PostgresPeopleBusinessImportBoundary({
      file: (c) => files.fileExists(c),
      vocabulary: (c) => vocabulary.referenceExists(c),
    });
    const second = await revocableActor(
      sql,
      `recipient-${crypto.randomUUID()}`,
    );
    const secondMemberId = crypto.randomUUID();
    await sql`insert into crm.workspace_members(id,workspace_id,user_id,role,status) values(${secondMemberId}::uuid,${actor.workspaceId}::uuid,${second.userId}::uuid,'member','active')`;
    await sql`insert into crm.member_preferences(member_id,timezone) values(${secondMemberId}::uuid,'Asia/Tokyo')`;
    const recipients = [{
      memberId: actor.memberId,
      workspaceId: actor.workspaceId,
    }, { memberId: secondMemberId, workspaceId: actor.workspaceId }];
    const planning = new PostgresPlanningBusinessImportBoundary(
      {
        listEligible: () => Promise.resolve(recipients),
        filterEligible: (c) =>
          Promise.resolve(
            recipients.filter((r) => c.memberIds.includes(r.memberId)),
          ),
      },
      { listDeliveryPreferences: () => Promise.resolve([]) },
      persons,
      (c) => people.dateBelongsToPerson(c),
    );
    try {
      const [date] =
        await sql`insert into crm.person_dates(person_id,kind,precision,year,month,day) values(${actor.personId}::uuid,'birthday','full',1990,1,1) returning id`;
      const [reminder] =
        await sql`insert into crm.reminders(workspace_id,person_id,person_date_id,target_kind,title,anchor_on,recurrence_unit,send_time) values(${actor.workspaceId}::uuid,${actor.personId}::uuid,${
          date!.id
        }::uuid,'person_date','Old title','1990-01-01','year','12:00') returning id`;
      await sql`insert into crm.reminder_occurrences(reminder_id,member_id,occurs_on,deliver_at,status,title_snapshot) values(${
        reminder!.id
      }::uuid,${actor.memberId}::uuid,'2099-01-01','2099-01-01T12:00:00Z','pending','Old title')`;
      await sql`insert into crm.reminder_occurrences(reminder_id,member_id,occurs_on,deliver_at,status,title_snapshot) values(${
        reminder!.id
      }::uuid,${secondMemberId}::uuid,'2099-01-01','2099-01-01T03:00:00Z','pending','Old title')`;
      const [sent] =
        await sql`insert into crm.reminder_occurrences(reminder_id,member_id,occurs_on,deliver_at,status,sent_at,provider_result_state,provider_receipt,provider_effect_at,visible_at) values(${
          reminder!.id
        }::uuid,${actor.memberId}::uuid,'2020-01-01','2020-01-01T12:00:00Z','sent','2020-01-01T12:00:00Z','confirmed','historical','2020-01-01T12:00:00Z','2020-01-01T12:00:00Z') returning id`;
      for (let round = 0; round < 2; round++) {
        if (round) {
          await sql`insert into crm.reminder_rules(workspace_id,days_before,is_active) values(${actor.workspaceId}::uuid,7,true),(${actor.workspaceId}::uuid,3650,true),(${actor.workspaceId}::uuid,21,false)`;
          await sql`delete from crm.reminder_occurrences where reminder_id=${
            reminder!.id
          }::uuid and status='pending'`;
        }
        await connection.db.transaction().execute((tx) =>
          planning.importRecords({
            actor,
            transaction: { opaque: tx },
            records: [{
              id: crypto.randomUUID(),
              data: {
                kind: "reminder",
                title: "Imported title",
                description: null,
                anchorOn: "2020-01-01",
                recurrenceUnit: "month",
                recurrenceInterval: 2,
                sendTime: "09:00",
                isActive: true,
                canDelete: false,
                deletedAt: null,
                createdAt: null,
                updatedAt: null,
              },
              references: { personId: actor.personId, dateId: date!.id },
            }],
          })
        );
        const pending =
          await sql`select member_id,occurs_on::text,lead_time_days,deliver_at,title_snapshot from crm.reminder_occurrences where reminder_id=${
            reminder!.id
          }::uuid and status='pending'`;
        if (!round) {
          assertEquals(pending.length, 16);
          assertEquals(
            pending.filter((r) => r.member_id === secondMemberId).length,
            8,
          );
        } else {
          // A near-term date may already be inside its seven-day lead window.
          assert(
            pending.length >= 14 && pending.length <= 16,
            "both members retain future lead-time deliveries",
          );
          assert(
            pending.filter((r) => r.member_id === secondMemberId).length >= 7,
            "second member keeps future lead-time deliveries",
          );
        }
        assert(
          pending.every((r) => r.lead_time_days === (round ? 7 : 0)),
          "active date rules and zero-day fallback are represented",
        );
        assert(
          pending.every((r) =>
            r.deliver_at.toISOString().slice(0, 10) ===
              new Date(
                Date.parse(r.occurs_on + "T00:00:00Z") -
                  (round ? 7 : 0) * 86400000,
              ).toISOString().slice(0, 10)
          ),
          "lead times change delivery dates",
        );
        assert(
          pending.every((r) =>
            r.deliver_at.toISOString().includes(
              r.member_id === secondMemberId ? "T00:00:00" : "T09:00:00",
            ) &&
            r.deliver_at > new Date() && r.title_snapshot === "Imported title"
          ),
          "future schedule and title regenerated",
        );
        assertEquals(
          (await sql`select status from crm.reminder_occurrences where id=${
            sent!.id
          }::uuid`)[0]!.status,
          "sent",
        );
      }
    } finally {
      await connection.destroy();
      await sql.end();
    }
  },
});
