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

export class PersonalizationRepositoryRouter
  implements PersonalizationRepository {
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
      const referenceCount = await this.count(command);
      if (referenceCount > 0 && !command.replacementId) {
        return {
          referenceCount,
          status: "replacement-required",
        };
      }
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
