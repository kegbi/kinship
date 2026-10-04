import { sql } from "kysely";
import type { ContactMethodTypeCatalog } from "../../../workspaces/public.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  PeopleImportBoundary,
  PersonImportPresence,
} from "../../application/import_people_boundary.ts";
import {
  normalizeImportantDate,
  validateImportantDate,
} from "../../domain/important_dates/rules.ts";
import { normalizeProfileFact } from "../../domain/profile_facts/normalize.ts";
import { validateProfileFact } from "../../domain/profile_facts/validate.ts";
import type {
  ProfileFactSection,
  ProfileFactValue,
} from "../../domain/profile_facts/values.ts";
import type { ImportantDatePublisher } from "../../ports/important_date_repository.ts";
import { PostgresImportantDateRepository } from "./important_date_repository.ts";
import { PostgresProfileFactRepository } from "./profile_fact_repository.ts";

/**
 * The import use case revalidates the actor under lock and refuses anyone but
 * an owner or admin before it reaches this boundary (see the
 * `ActorRevalidation` port), so the statements below scope by workspace alone.
 *
 * `presence` (REL-065) tells a deleted person from an active one, so an
 * import leaves a person the member deleted deleted instead of reusing them.
 *
 * `addDetails` (GAP-050) writes a vCard or CSV contact's people-owned rows
 * through the same repositories and rules the profile editors use, and hands
 * each date to planning's publisher, so an imported birthday reminds exactly
 * as a typed one does.
 */
export class PostgresPeopleImportBoundary implements PeopleImportBoundary {
  readonly #dates = new PostgresImportantDateRepository();
  readonly #facts = new PostgresProfileFactRepository();

  constructor(
    private readonly publisher: ImportantDatePublisher,
    private readonly contactTypes: Pick<ContactMethodTypeCatalog, "forImport">,
  ) {}

  async addDetails(
    command: Parameters<PeopleImportBoundary["addDetails"]>[0],
  ): Promise<void> {
    const actor = { ...command.actor, transaction: command.transaction };
    const save = async (
      section: ProfileFactSection,
      input: ProfileFactValue,
    ) => {
      const value = normalizeProfileFact(section, input);
      if (
        Object.keys(validateProfileFact(section, value, command.personId))
          .length > 0
      ) throw new Error(`Imported ${section} value is invalid.`);
      const saved = await this.#facts.save({
        ...actor,
        id: crypto.randomUUID(),
        occurredAt: command.occurredAt,
        personId: command.personId,
        section,
        value,
      });
      if (!saved) throw new Error(`Imported ${section} value was not saved.`);
    };
    await this.addContactMethods({
      ...command,
      methods: command.details.contactMethods,
    });
    for (const [index, address] of command.details.addresses.entries()) {
      await save("addresses", {
        ...address,
        isPrimary: index === 0,
        labelIds: [],
      });
    }
    if (command.details.occupation) {
      await save("work", { ...command.details.occupation, isCurrent: true });
    }
    for (const date of command.details.dates) {
      const value = normalizeImportantDate({
        ...date,
        isAgeBased: date.isAgeBased ??
          (date.kind === "birthday" && date.year !== undefined),
        isYearApproximate: date.isYearApproximate ?? false,
      });
      if (Object.keys(validateImportantDate(value)).length > 0) {
        throw new Error("Imported date is invalid.");
      }
      const after = await this.#dates.create({
        ...actor,
        id: crypto.randomUUID(),
        occurredAt: command.occurredAt,
        personId: command.personId,
        value,
      });
      if (!after) throw new Error("Imported date was not saved.");
      await this.publisher.regenerate({
        ...actor,
        after,
        occurredAt: command.occurredAt,
      });
    }
  }

  async addContactMethods(
    command: Parameters<PeopleImportBoundary["addContactMethods"]>[0],
  ): Promise<void> {
    if (!command.methods.length) return;
    const database = databaseFromSession(command.transaction);
    const person = await sql<
      { deleted: boolean }
    >`select deleted_at is not null as deleted from crm.people where id=${command.personId}::uuid and workspace_id=${command.actor.workspaceId}::uuid for update`
      .execute(database);
    if (!person.rows[0]) {
      throw new Error("Imported contact method person is unavailable.");
    }
    if (person.rows[0].deleted) return;
    const types = await this.contactTypes.forImport({
      workspaceId: command.actor.workspaceId,
      transaction: command.transaction,
      lock: false,
    });
    for (const method of command.methods) {
      const type = types.find((type) =>
        type.id === method.typeId && !type.archived
      );
      if (!type) {
        throw new Error("Imported contact method type is unavailable.");
      }
      const normalize = (value: string) =>
        type.kind === "email"
          ? value.trim().toLowerCase()
          : type.kind === "phone"
          ? value.replace(/[^0-9+a-z]/gi, "").toLowerCase()
          : value.trim();
      const existing = await sql<
        { value: string }
      >`select value from crm.person_contact_methods where person_id=${command.personId}::uuid and type_id=${method.typeId}::uuid`
        .execute(database);
      if (
        existing.rows.some((row) =>
          normalize(row.value) === normalize(method.value)
        )
      ) continue;
      const value = normalizeProfileFact("contact-methods", {
        typeId: method.typeId,
        value: method.value,
        isPrimary: existing.rows.length === 0,
        labelIds: [],
      });
      if (
        Object.keys(
          validateProfileFact("contact-methods", value, command.personId),
        ).length
      ) throw new Error("Imported contact method value is invalid.");
      const saved = await this.#facts.save({
        ...command.actor,
        transaction: command.transaction,
        personId: command.personId,
        occurredAt: command.occurredAt,
        id: crypto.randomUUID(),
        section: "contact-methods",
        value,
      });
      if (!saved) throw new Error("Imported contact method was not saved.");
    }
  }

  async create(
    command: Parameters<PeopleImportBoundary["create"]>[0],
  ): Promise<void> {
    if (!command.person.givenName.trim()) {
      throw new Error("Imported person needs a given name.");
    }
    const result = await sql<{ readonly id: string }>`
      insert into crm.people (
        id, workspace_id, created_by_member_id, given_name, middle_name,
        family_name, nickname, description, food_preferences, is_partial,
        is_starred, is_deceased, archived_at, created_at, updated_at,
        deleted_at
      )
      values (
        ${command.person.id}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid, ${command.person.givenName},
        ${command.person.middleName ?? null},
        ${command.person.familyName ?? null},
        ${command.person.nickname ?? null},
        ${command.person.description ?? null},
        ${command.person.foodPreferences ?? null},
        ${command.person.isPartial}, ${command.person.isStarred},
        ${command.person.isDeceased},
        ${command.person.archived ? command.occurredAt : null},
        ${command.occurredAt}, ${command.occurredAt},
        ${command.person.deletedAt ?? null}
      )
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported person context is invalid.");
    const avatar = command.person.avatar;
    if (avatar) {
      await sql`
        insert into crm.person_avatars (
          person_id, source, external_url, background_color, updated_at
        ) values (
          ${command.person.id}::uuid, ${avatar.source ?? "default"},
          ${avatar.externalUrl ?? null}, ${avatar.backgroundColor ?? null},
          ${command.occurredAt}
        )
      `.execute(databaseFromSession(command.transaction));
    }
  }

  async presence(
    command: Parameters<PeopleImportBoundary["presence"]>[0],
  ): Promise<PersonImportPresence> {
    const result = await sql<{ readonly deleted: boolean }>`
      select person.deleted_at is not null as deleted
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.actor.workspaceId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    if (!row) return "absent";
    return row.deleted ? "deleted" : "active";
  }

  async linkAvatar(
    command: Parameters<PeopleImportBoundary["linkAvatar"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly person_id: string }>`
      insert into crm.person_avatars (person_id, source, file_id)
      select person.id, 'file', ${command.fileId}::uuid
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.actor.workspaceId}::uuid
      on conflict (person_id) do update set
        source = 'file', file_id = excluded.file_id, updated_at = now()
      returning person_id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported avatar context is invalid.");
  }
}
