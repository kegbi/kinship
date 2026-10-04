/** Source vocabulary choices are validated before the first configuration write. */
import type {
  ImportedContact,
  ImportedContactMethodType,
} from "./contact_import.ts";
export interface SourceContactType extends ImportedContactMethodType {
  readonly count: number;
}
export interface WorkspaceContactType {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly archived: boolean;
}
export interface ContactTypeDecision {
  readonly sourceKey: string;
  readonly action: "create" | "map" | "skip";
  readonly typeId?: string | undefined;
}
const normalized = (name: string) => name.trim().toLowerCase();
export function sourceContactTypes(
  contacts: readonly { readonly contact?: ImportedContact }[],
  catalog: readonly ImportedContactMethodType[] = [],
): SourceContactType[] {
  const types = new Map<string, SourceContactType>(
    catalog.map((type) => [type.key, { ...type, count: 0 }]),
  );
  for (const row of contacts) {
    for (const method of row.contact?.contactMethods ?? []) {
      const type = method.sourceType;
      types.set(type.key, {
        ...type,
        count: (types.get(type.key)?.count ?? 0) + 1,
      });
    }
  }
  return [...types.values()];
}
export function matchingContactType(
  source: SourceContactType,
  types: readonly WorkspaceContactType[],
): WorkspaceContactType | undefined {
  const active = types.filter((type) => !type.archived);
  return active.find((type) =>
    normalized(type.name) === normalized(source.name) &&
    type.kind === source.kind
  ) ??
    ((source.kind === "url" ? ["website", "url"] : [source.kind]).includes(
        normalized(source.name),
      ) && ["email", "phone", "url"].includes(source.kind)
      ? active.find((type) => type.kind === source.kind) ??
        active.find((type) =>
          type.kind === "custom" &&
          (source.kind === "url" ? ["website", "url"] : [source.kind]).includes(
            normalized(type.name),
          )
        )
      : undefined);
}
export function contactTypePlan(
  sources: readonly SourceContactType[],
  types: readonly WorkspaceContactType[],
  decisions: readonly ContactTypeDecision[],
) {
  const mapping: Record<string, string> = {};
  const create: SourceContactType[] = [];
  const invalid = () => ({
    status: "decision-required" as const,
    mapping,
    create,
  });
  if (
    new Set(decisions.map((choice) => choice.sourceKey)).size !==
      decisions.length ||
    decisions.some((choice) =>
      !sources.some((source) => source.key === choice.sourceKey)
    )
  ) return invalid();
  for (const source of sources) {
    const decision = decisions.find((choice) =>
      choice.sourceKey === source.key
    );
    if (decision?.action === "skip") continue;
    if (decision?.action === "map") {
      const target = types.find((type) =>
        type.id === decision.typeId && !type.archived
      );
      if (!target) return invalid();
      mapping[source.key] = target.id;
      continue;
    }
    const match = matchingContactType(source, types);
    if (match) {
      mapping[source.key] = match.id;
      continue;
    }
    if (
      decision?.action !== "create" || types.some((type) =>
        normalized(type.name) === normalized(source.name)
      ) || create.some((type) =>
        normalized(type.name) === normalized(source.name) &&
        type.kind !== source.kind
      )
    ) return invalid();
    create.push(source);
  }
  return { status: "ready" as const, mapping, create };
}
