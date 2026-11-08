import { writeWithinWorkspace } from "../../packages/backend/platform/postgres/transactions.ts";
import { personBoundary } from "../../packages/backend/modules/people/composition.ts";
import { journalActivityBoundary } from "../../packages/backend/modules/interactions/composition.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { PostgresPeopleBusinessImportBoundary } from "../../packages/backend/modules/people/adapters/postgres/import_business_boundary.ts";
import { PostgresGiftBusinessImportBoundary } from "../../packages/backend/modules/gifts/adapters/postgres/import_business_boundary.ts";
import { PostgresJournalBusinessImportBoundary } from "../../packages/backend/modules/journal/adapters/postgres/import_business_boundary.ts";
import { PostgresFileBusinessImportBoundary } from "../../packages/backend/modules/files/adapters/postgres/import_business_boundary.ts";
import { PostgresWorkspaceBusinessImportBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/import_business_boundary.ts";
import { monicaExtra } from "../../packages/backend/modules/import-export/domain/formats/monica_extra.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
} from "../support/database.ts";

Deno.test({
  name:
    "Monica extra owning boundaries preserve source facts, reuse catalogs and reject foreign references",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = requireDatabaseUrl(),
      sql = openSql(url),
      connection = connectDatabase(url);
    const owner = await revocableActor(sql, `extra-${crypto.randomUUID()}`),
      foreign = await revocableActor(sql, `foreign-${crypto.randomUUID()}`);
    const workspace = new PostgresWorkspaceBusinessImportBoundary(),
      files = new PostgresFileBusinessImportBoundary(personBoundary()),
      people = new PostgresPeopleBusinessImportBoundary({
        vocabulary: (c) => workspace.referenceExists(c),
        file: (c) => files.fileExists(c),
      }),
      gifts = new PostgresGiftBusinessImportBoundary(personBoundary()),
      journal = new PostgresJournalBusinessImportBoundary(
        journalActivityBoundary(),
      );
    const identities = new Map<string, string>([[
      "contacts:1",
      owner.personId,
    ]]);
    const get = (table: string, key: string) =>
      identities.get(`${table}:${key}`)!;
    const instant = "2020-01-02 03:04:05";
    await sql`insert into crm.person_avatars (person_id,source, workspace_id) values (${owner.personId}::uuid,'default', (select scope.workspace_id from crm.people scope where scope.id = ${owner.personId}::uuid))`;

    const parsed = monicaExtra({
      contacts: [{
        id: 1,
        account_id: 9,
        gender_id: 2,
        created_at: instant,
        updated_at: instant,
        first_met_where: "School",
        first_met_additional_info: "Math club",
        avatar_source: "photo",
        avatar_photo_id: 2,
      }],
      genders: [{
        id: 2,
        account_id: 9,
        name: `Custom-${crypto.randomUUID()}`,
        type: "O",
      }],
      tags: [{ id: 3, account_id: 9, name: "Friends", name_slug: "friends" }],
      contact_tag: [{ contact_id: 1, tag_id: 3, account_id: 9 }],
      pets: [{
        id: 4,
        account_id: 9,
        contact_id: 1,
        pet_category_id: 3,
        name: "Mittens",
      }],
      places: [{
        id: 5,
        account_id: 9,
        street: "Example road",
        latitude: 10,
        longitude: 20,
      }],
      addresses: [{
        id: 6,
        account_id: 9,
        contact_id: 1,
        place_id: 5,
        name: "Home",
      }],
      debts: [{
        id: 7,
        account_id: 9,
        contact_id: 1,
        in_debt: "yes",
        status: "complete",
        currency_id: 5,
        amount: 12345,
        created_at: instant,
        updated_at: instant,
      }],
      gifts: [{
        id: 8,
        account_id: 9,
        contact_id: 1,
        name: "Book",
        amount: 1234,
        currency_id: 2,
        status: "given",
        date: "2021-01-01",
      }],
      entries: [{
        id: 1,
        account_id: 9,
        post: "A good day",
        created_at: instant,
      }],
      days: [{ id: 2, account_id: 9, date: "2021-01-03", rate: 3 }],
      journal_entries: [{
        id: 1,
        account_id: 9,
        journalable_type: "Entry",
        journalable_id: 1,
        date: "2021-01-02",
      }, {
        id: 2,
        account_id: 9,
        journalable_type: "Day",
        journalable_id: 2,
        date: "2021-01-03",
      }],
      photos: [{
        id: 2,
        account_id: 9,
        original_filename: "portrait.png",
        filesize: 12,
        mime_type: "image/png",
        created_at: instant,
      }],
      contact_photo: [{ contact_id: 1, photo_id: 2 }],
      modules: [{ id: 1, account_id: 9, key: "pets", active: 0 }],
      life_event_categories: [{
        id: 1,
        account_id: 9,
        default_life_event_category_key: "work",
        core_monica_data: 1,
      }],
      life_event_types: [{
        id: 1,
        account_id: 9,
        life_event_category_id: 1,
        default_life_event_type_key: "newjob",
        specific_information_structure: '{"fields":[]}',
        core_monica_data: 1,
      }],
    }, { sourceProfile: "sql_export" });
    assert(typeof parsed !== "string", "fixture parses");
    try {
      await writeWithinWorkspace(
        connection.db,
        owner.workspaceId,
        async (tx) => {
          const pending = [...parsed.entities];
          while (pending.length) {
            const index = pending.findIndex((entity) =>
              Object.values(entity.references ?? {}).every((r) =>
                identities.has(`${r.table}:${r.key}`)
              )
            );
            assert(index >= 0, "unresolved fixture references");
            const entity = pending.splice(index, 1)[0]!;
            const id = crypto.randomUUID();
            const refs = Object.fromEntries(
              Object.entries(entity.references ?? {}).map((
                [key, r],
              ) => [key, get(r.table, r.key)]),
            );
            const boundary = {
              people,
              gifts,
              journal,
              files,
              workspaces: workspace,
            }[entity.owner];
            const result = await boundary.importRecords({
              actor: owner,
              transaction: { opaque: tx },
              records: [{
                id,
                data: { ...entity.data, preserveTimestamps: true },
                references: refs,
              }],
            });
            identities.set(
              `${entity.sourceTable}:${entity.sourcePrimaryKey}`,
              result?.[id] ?? id,
            );
          }
        },
      );
      const [debt] =
        await sql`select amount::text,currency_code,direction,status,settled_at,created_at from crm.debts where id=${
          get("debts", "7")
        }::uuid`;
      assertEquals(debt?.amount, "123.4500");
      assertEquals(debt?.currency_code, "RUB");
      assertEquals(debt?.direction, "i_owe");
      assertEquals(debt?.status, "settled");
      assertEquals(debt?.settled_at.toISOString(), "2020-01-02T03:04:05.000Z");
      const [photo] =
        await sql`select f.status,a.file_id,(select count(*)::int from crm.person_file_links where person_id=${owner.personId}::uuid) as links from crm.files f join crm.person_avatars a on a.file_id=f.id where f.id=${
          get("photos", "2")
        }::uuid`;
      assertEquals(photo?.status, "missing");
      assertEquals(photo?.links, 1);
      const [profile] =
        await sql`select p.created_at,p.gender_option_id,m.place_text,a.display_name from crm.people p join crm.person_first_meetings m on m.person_id=p.id join crm.person_addresses a on a.person_id=p.id where p.id=${owner.personId}::uuid`;
      assertEquals(
        profile?.created_at.toISOString(),
        "2020-01-02T03:04:05.000Z",
      );
      assertEquals(profile?.gender_option_id, get("genders", "2"));
      assertEquals(profile?.place_text, "School");
      assertEquals(profile?.display_name, "Home");
      const [post] =
        await sql`select occurred_at from crm.journal_posts where id=${
          get("entries", "1")
        }::uuid`;
      assertEquals(post?.occurred_at.toISOString(), "2021-01-02T00:00:00.000Z");
      const [toggle] =
        await sql`select is_active from crm.workspace_profile_modules where id=${
          get("modules", "1")
        }::uuid`;
      assertEquals(toggle?.is_active, false);
      // Natural catalog conflicts return the existing ID, without renaming it.
      const reused = await writeWithinWorkspace(
        connection.db,
        owner.workspaceId,
        (db) =>
          workspace.importRecords({
            actor: owner,
            transaction: { opaque: db },
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "pet_category", name: "cat" },
              references: {},
            }],
          }),
      );
      assert(
        Object.values(reused).includes(get("pet_categories", "3")),
        "global category reused",
      );
      // A rollback must undo earlier writes when the next source link is foreign.
      const rollbackId = crypto.randomUUID();
      let rejected = false;
      try {
        await writeWithinWorkspace(
          connection.db,
          owner.workspaceId,
          async (tx) => {
            await gifts.importRecords({
              actor: owner,
              transaction: { opaque: tx },
              records: [{
                id: rollbackId,
                data: {
                  kind: "debt",
                  amount: "1.00",
                  currencyCode: "USD",
                  direction: "they_owe",
                  status: "open",
                },
                references: { personId: owner.personId },
              }, {
                id: crypto.randomUUID(),
                data: {
                  kind: "debt",
                  amount: "2.00",
                  currencyCode: "USD",
                  direction: "they_owe",
                  status: "open",
                },
                references: { personId: foreign.personId },
              }],
            });
          },
        );
      } catch {
        rejected = true;
      }
      assert(rejected, "foreign reference rejected");
      assertEquals(
        (await sql`select id from crm.debts where id=${rollbackId}::uuid`)
          .length,
        0,
      );
      const retained = await writeWithinWorkspace(
        connection.db,
        owner.workspaceId,
        (db) =>
          people.importRecords({
            actor: owner,
            transaction: { opaque: db },
            records: [{
              id: crypto.randomUUID(),
              data: { kind: "profile", createdAt: "1999-01-01T00:00:00Z" },
              references: { personId: owner.personId },
            }],
          }),
      );
      assertEquals(Object.values(retained), [owner.personId]);
      const [unchanged] =
        await sql`select created_at from crm.people where id=${owner.personId}::uuid`;
      assertEquals(
        unchanged?.created_at.toISOString(),
        "2020-01-02T03:04:05.000Z",
      );
    } finally {
      await connection.destroy();
      await sql.end();
    }
  },
});
