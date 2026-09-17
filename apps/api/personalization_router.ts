/**
 * The one place that knows which module answers for which personalization
 * section.
 *
 * Personalization is a single settings page over seven owners: the workspace
 * holds most vocabularies, people hold tags, planning holds reminder rules,
 * and four modules each count and re-point the records that refer to an option
 * they own. Routing that is a composition concern rather than any one module's,
 * so it lives beside the composition root and behind the workspaces port, and
 * no module learns that another exists.
 *
 * Every read is authorized by the workspace before it is routed, which is what
 * the APP-004E boundary test pins: a member of another workspace must not
 * reach a module's own repository through this.
 *
 * Reference counts are only attached where they mean something. Tags and
 * reminder rules count their own, so their entries pass through untouched;
 * every other section has its references counted by whichever module stores
 * them, and `contact-method-types` is the one section two modules share.
 */

import type { InteractionPersonalizationReferences } from "../../packages/backend/modules/interactions/public.ts";
import type { JournalPersonalizationReferences } from "../../packages/backend/modules/journal/public.ts";
import type {
  PeoplePersonalizationReferences,
  TagPersonalizationFacade,
} from "../../packages/backend/modules/people/public.ts";
import type { ReminderRulePersonalizationFacade } from "../../packages/backend/modules/planning/public.ts";
import type { RelationshipPersonalizationReferences } from "../../packages/backend/modules/relationships/public.ts";
import type {
  PersonalizationEntry,
  PersonalizationMutationResult,
  PersonalizationRepository,
  PersonalizationResult,
  PersonalizationSection,
  WorkspacePersonalizationRepository,
} from "../../packages/backend/modules/workspaces/public.ts";

export class PersonalizationRouter implements PersonalizationRepository {
  constructor(
    private readonly workspace: WorkspacePersonalizationRepository,
    private readonly tags: TagPersonalizationFacade,
    private readonly reminders: ReminderRulePersonalizationFacade,
    private readonly peopleReferences: PeoplePersonalizationReferences,
    private readonly relationshipReferences:
      RelationshipPersonalizationReferences,
    private readonly interactionReferences:
      InteractionPersonalizationReferences,
    private readonly journalReferences: JournalPersonalizationReferences,
  ) {}

  private async count(
    command: Parameters<PersonalizationRepository["inspect"]>[0],
  ): Promise<number> {
    if (
      command.section === "gender-options" ||
      command.section === "contact-labels" ||
      command.section === "pet-categories"
    ) {
      return await this.peopleReferences.count({
        id: command.id,
        section: command.section,
        transaction: command.transaction,
        workspaceId: command.workspaceId,
      });
    }
    if (command.section === "contact-method-types") {
      const shared = {
        id: command.id,
        section: command.section,
        transaction: command.transaction,
        workspaceId: command.workspaceId,
      };
      return await this.peopleReferences.count(shared) +
        await this.interactionReferences.count(shared);
    }
    if (
      command.section === "activity-types" ||
      command.section === "emotion-options"
    ) {
      return await this.interactionReferences.count({
        id: command.id,
        section: command.section,
        transaction: command.transaction,
        workspaceId: command.workspaceId,
      });
    }
    if (command.section === "life-event-types") {
      return await this.journalReferences.count(command);
    }
    if (command.section === "relationship-types") {
      return await this.relationshipReferences.count(command);
    }
    return 0;
  }

  private async withCount(
    command: Parameters<PersonalizationRepository["inspect"]>[0],
    entry: PersonalizationEntry,
  ): Promise<PersonalizationEntry> {
    if (command.section === "tags" || command.section === "reminder-rules") {
      return entry;
    }
    return { ...entry, referenceCount: await this.count(command) };
  }

  private async replaceReferences(
    command: Parameters<PersonalizationRepository["mutate"]>[0] & {
      readonly action: "delete";
      readonly replacementId: string;
    },
  ): Promise<"conflict" | "replaced"> {
    if (
      command.section === "gender-options" ||
      command.section === "contact-labels" ||
      command.section === "pet-categories"
    ) {
      const replaced = await this.peopleReferences.replace({
        id: command.id,
        replacementId: command.replacementId,
        section: command.section,
        transaction: command.transaction,
        workspaceId: command.workspaceId,
      });
      return replaced;
    }
    if (command.section === "contact-method-types") {
      const shared = {
        id: command.id,
        replacementId: command.replacementId,
        section: command.section,
        transaction: command.transaction,
        workspaceId: command.workspaceId,
      };
      const replaced = await this.peopleReferences.replace(shared);
      if (replaced === "conflict") return "conflict";
      await this.interactionReferences.replace(shared);
      return "replaced";
    } else if (command.section === "activity-types") {
      await this.interactionReferences.replace({
        id: command.id,
        replacementId: command.replacementId,
        section: command.section,
        transaction: command.transaction,
        workspaceId: command.workspaceId,
      });
      return "replaced";
    } else if (command.section === "life-event-types") {
      await this.journalReferences.replace(command);
      return "replaced";
    } else if (command.section === "relationship-types") {
      return await this.relationshipReferences.replace(command);
    }
    return "replaced";
  }

  private routed(section: PersonalizationSection) {
    if (section === "tags") return this.tags;
    if (section === "reminder-rules") return this.reminders;
    return this.workspace;
  }

  async inspect(
    command: Parameters<PersonalizationRepository["inspect"]>[0],
  ): ReturnType<PersonalizationRepository["inspect"]> {
    if (!await this.workspace.authorize(command)) {
      return { status: "forbidden" };
    }
    const result = await this.routed(command.section).inspect(command) as
      | { readonly entry: PersonalizationEntry; readonly status: "ready" }
      | { readonly status: "forbidden" | "not-found" | "unavailable" };
    return result.status === "ready"
      ? { entry: await this.withCount(command, result.entry), status: "ready" }
      : result;
  }

  async list(
    command: Parameters<PersonalizationRepository["list"]>[0],
  ): ReturnType<PersonalizationRepository["list"]> {
    if (!await this.workspace.authorize(command)) {
      return { status: "forbidden" };
    }
    const result = await this.routed(command.section).list(
      command,
    ) as PersonalizationResult;
    if (result.status !== "ready") return result;
    return {
      ...result,
      entries: await Promise.all(
        result.entries.map((item) =>
          this.withCount({ ...command, id: item.id }, item)
        ),
      ),
    };
  }

  async mutate(
    command: Parameters<PersonalizationRepository["mutate"]>[0],
  ): ReturnType<PersonalizationRepository["mutate"]> {
    if (!await this.workspace.authorize(command)) {
      return { status: "forbidden" };
    }
    const repository = this.routed(command.section);
    if (repository === this.workspace && command.action === "delete") {
      const prepared = await this.workspace.prepareDelete(command);
      if (prepared.status !== "ready") return prepared;
      // A delete that arrives here either carries a replacement or was already
      // shown to have nothing pointing at it: the use case inspects first, in
      // this same transaction, and answers `replacement-required` itself. This
      // file counted the references a second time and repeated that answer
      // until GAP-020; the count was a duplicate query and the answer was
      // unreachable.
      if (command.replacementId) {
        const replaced = await this.replaceReferences({
          ...command,
          replacementId: command.replacementId,
        });
        if (replaced === "conflict") {
          return { status: "replacement-conflict" };
        }
      }
      return await this.workspace.deletePrepared(command);
    }
    const result = await repository.mutate(
      command,
    ) as PersonalizationMutationResult;
    if (result.status !== "saved") return result;
    return {
      ...result,
      entry: await this.withCount(
        { ...command, id: result.entry.id },
        result.entry,
      ),
    };
  }
}
