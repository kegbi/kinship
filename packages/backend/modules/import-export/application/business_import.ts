import type {
  RelationshipBusinessImportBoundary,
  RelationshipBusinessImportRecord,
} from "../../relationships/public.ts";
import type {
  InteractionBusinessImportBoundary,
  InteractionBusinessImportRecord,
} from "../../interactions/public.ts";
import type {
  PlanningBusinessImportBoundary,
  PlanningBusinessImportRecord,
} from "../../planning/public.ts";
import type {
  VocabularyBusinessImportBoundary,
  VocabularyBusinessImportRecord,
} from "../../workspaces/public.ts";
import type { BusinessEntity } from "../domain/business_entities.ts";
import type { ImportActor, ImportTransaction } from "../ports/context.ts";
export interface BusinessImportBoundary {
  importRecords(
    command: {
      readonly actor: ImportActor;
      readonly records: readonly {
        readonly id: string;
        readonly data: Readonly<Record<string, unknown>>;
        readonly references: Readonly<Record<string, string>>;
      }[];
      readonly transaction: ImportTransaction;
    },
  ): Promise<void | Readonly<Record<string, string>>>;
}
export type BusinessImportBoundaries =
  & Partial<
    Record<
      Exclude<
        BusinessEntity["owner"],
        "relationships" | "interactions" | "planning" | "vocabulary"
      >,
      BusinessImportBoundary
    >
  >
  & {
    readonly relationships?: RelationshipBusinessImportBoundary;
    readonly interactions?: InteractionBusinessImportBoundary;
    readonly planning?: PlanningBusinessImportBoundary;
    readonly vocabulary?: VocabularyBusinessImportBoundary;
  };
/** Resolve staged identities in dependency order, skipping deleted contacts and their descendants. */
export async function commitBusinessEntities(command: {
  readonly actor: ImportActor;
  readonly transaction: ImportTransaction;
  readonly entities: readonly BusinessEntity[];
  readonly contacts: ReadonlyMap<
    string,
    {
      readonly targetPersonId: string;
      readonly outcome: string;
      readonly repairBefore?: string;
      readonly legacyNotes?: readonly string[];
      readonly legacyStartedAt?: string;
      readonly legacyCompletedAt?: string;
    }
  >;
  readonly boundaries: BusinessImportBoundaries;
  readonly retarget: (entity: BusinessEntity, id: string) => Promise<void>;
}): Promise<void> {
  const identities = new Map<string, string>();
  const skipped = new Set<string>();
  const consumedLegacyNotes: string[] = [];
  const key = (table: string, id: string) => `${table}:${id}`;
  for (const [id, person] of command.contacts) {
    if (person.outcome === "deleted") skipped.add(key("contacts", id));
    else identities.set(key("contacts", id), person.targetPersonId);
  }
  // Reminder generation consumes the workspace rules without a row reference.
  // Stage IDs are random, so explicitly establish this scheduling prerequisite.
  const ruleFirst = (entity: BusinessEntity) =>
    entity.owner === "planning" && entity.data.kind === "rule" ? 0 : 1;
  let pending = [...command.entities].sort((a, b) =>
    ruleFirst(a) - ruleFirst(b)
  );
  while (pending.length) {
    const next: BusinessEntity[] = [];
    let progressed = false;
    for (const entity of pending) {
      const refs = Object.entries(entity.references ?? {});
      if (refs.some(([, r]) => skipped.has(key(r.table, r.key)))) {
        skipped.add(key(entity.sourceTable, entity.sourcePrimaryKey));
        progressed = true;
        continue;
      }
      if (refs.some(([, r]) => !identities.has(key(r.table, r.key)))) {
        next.push(entity);
        continue;
      }
      if (entity.alreadyImported) {
        identities.set(
          key(entity.sourceTable, entity.sourcePrimaryKey),
          entity.targetId,
        );
        await command.retarget(entity, entity.targetId);
        progressed = true;
        continue;
      }
      const boundary = command.boundaries[entity.owner];
      if (!boundary) {
        throw new Error(`Missing business import boundary: ${entity.owner}`);
      }
      const person = entity.references?.personId?.table === "contacts"
        ? command.contacts.get(entity.references.personId.key)
        : undefined;
      const data: Readonly<Record<string, unknown>> = {
        ...entity.data,
        ...(entity.owner === "people" && entity.data.kind === "profile" &&
            entity.data.reviewedChoice && person?.outcome === "reused" &&
            !entity.data.repairBefore
          ? {
            repairBefore: person.repairBefore ?? person.legacyCompletedAt ??
              "1970-01-01T00:00:00Z",
          }
          : {}),
        excludedLegacyIds: [...consumedLegacyNotes],
        preserveTimestamps: person?.outcome === "created",
        reconcileLegacy: person?.outcome === "reused",
        ...(person?.legacyNotes?.includes(String(entity.data.body))
          ? {
            legacyStartedAt: person.legacyStartedAt,
            legacyCompletedAt: person.legacyCompletedAt,
          }
          : {}),
      };
      const record = {
        id: entity.targetId,
        data,
        references: Object.fromEntries(
          [
            ...refs.map((
              [name, r],
            ) => [name, identities.get(key(r.table, r.key))!]),
            ...(typeof entity.data.selectedGenderId === "string"
              ? [["genderId", entity.data.selectedGenderId]]
              : []),
          ],
        ),
      };
      const context = {
        actor: command.actor,
        transaction: command.transaction,
      };
      const result = entity.owner === "relationships"
        ? await command.boundaries.relationships!.importRecords({
          ...context,
          records: [record as RelationshipBusinessImportRecord],
        })
        : entity.owner === "interactions"
        ? await command.boundaries.interactions!.importRecords({
          ...context,
          records: [record as InteractionBusinessImportRecord],
        })
        : entity.owner === "planning"
        ? await command.boundaries.planning!.importRecords({
          ...context,
          records: [record as PlanningBusinessImportRecord],
        })
        : entity.owner === "vocabulary"
        ? await command.boundaries.vocabulary!.importRecords({
          ...context,
          records: [record as VocabularyBusinessImportRecord],
        })
        : await (boundary as BusinessImportBoundary).importRecords({
          ...context,
          records: [record],
        });
      const id = result?.[entity.targetId] ?? entity.targetId;
      if (!id) {
        skipped.add(key(entity.sourceTable, entity.sourcePrimaryKey));
        progressed = true;
        continue;
      }
      if (entity.data.kind === "note" && id !== entity.targetId) {
        consumedLegacyNotes.push(id);
      }
      if (id !== entity.targetId || entity.data.reviewedChoice) {
        await command.retarget(entity, id);
      }
      identities.set(key(entity.sourceTable, entity.sourcePrimaryKey), id);
      progressed = true;
    }
    if (!progressed) {
      throw new Error(
        "Imported business records contain unresolved references.",
      );
    }
    pending = next;
  }
}
