import type { Failure } from "../../../shared-kernel/result.ts";
import type { ActorRevalidation } from "./actor_revalidation.ts";

export interface RecentPeopleActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface RecentPeopleTransaction {
  readonly opaque: unknown;
}

export interface RecentPeopleRepository {
  lock(
    command: RecentPeopleActor & {
      readonly transaction: RecentPeopleTransaction;
    },
  ): Promise<
    | Failure<"forbidden">
    | { readonly status: "ready"; readonly uiState: unknown }
  >;
  save(
    command: RecentPeopleActor & {
      readonly transaction: RecentPeopleTransaction;
      readonly uiState: Readonly<Record<string, unknown>>;
    },
  ): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function recentIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < value.length && ids.length < 8; index++) {
    const candidate = value[index];
    if (typeof candidate !== "string" || !UUID.test(candidate)) continue;
    const id = candidate.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function createRecentPeopleManagement(dependencies: {
  readonly actors: ActorRevalidation;
  readonly repository: RecentPeopleRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: RecentPeopleTransaction) => Promise<T>,
    ): Promise<T>;
  };
}) {
  return {
    async record(
      actor: RecentPeopleActor,
      personId: string,
    ) {
      return await dependencies.transaction.run(async (transaction) => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" as const };
        const locked = await dependencies.repository.lock({
          ...actor,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        const stored = decoded(locked.uiState);
        const base = isRecord(stored) ? stored : {};
        const canonicalPersonId = UUID.test(personId)
          ? personId.toLowerCase()
          : undefined;
        if (!canonicalPersonId) return { status: "forbidden" as const };
        const uiState = {
          ...base,
          recentPersonIds: [
            canonicalPersonId,
            ...recentIds(base.recentPersonIds).filter((id) =>
              id !== canonicalPersonId
            ),
          ].slice(0, 8),
        };
        return await dependencies.repository.save({
            ...actor,
            transaction,
            uiState,
          })
          ? { status: "recorded" as const }
          : { status: "forbidden" as const };
      });
    },
  };
}

export type RecentPeopleManagement = ReturnType<
  typeof createRecentPeopleManagement
>;
