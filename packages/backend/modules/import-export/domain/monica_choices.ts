import type {
  BusinessEntity,
  UnstagedBusinessEntity,
} from "./business_entities.ts";
import { monicaCurrencyScale, monicaMoney } from "./formats/monica_extra.ts";

export interface MonicaChoices {
  readonly timezone: string;
  readonly currencies: readonly {
    readonly sourceKey: string;
    readonly currencyCode: string;
  }[];
  readonly genders: readonly {
    readonly sourceKey: string;
    readonly action: "map" | "source" | "create" | "unspecified";
    readonly genderId?: string | undefined;
    readonly name?: string | undefined;
  }[];
}
export interface MonicaChoiceOptions {
  readonly currencies: readonly string[];
  readonly genders: readonly {
    readonly id: string;
    readonly name: string;
    readonly archived: boolean;
  }[];
}
export interface MonicaChoiceReport {
  readonly currencyMinorUnits: Readonly<Record<string, number>>;
  readonly debts: readonly {
    readonly sourceKey: string;
    readonly contactName: string;
    readonly rawAmount: string;
    readonly minorUnits: boolean;
    readonly reason?: string;
    readonly direction?: string;
  }[];
  readonly contacts: readonly {
    readonly sourceKey: string;
    readonly contactName: string;
    readonly sourceGender: string;
  }[];
  readonly currencies: readonly string[];
  readonly genders: readonly {
    readonly id: string;
    readonly name: string;
    readonly source: boolean;
  }[];
}
export function monicaChoiceReport(
  entities: readonly UnstagedBusinessEntity[],
  contacts: readonly {
    readonly sourcePrimaryKey: string;
    readonly givenName: string;
    readonly familyName?: string;
  }[],
  options: MonicaChoiceOptions,
): MonicaChoiceReport {
  const name = (entity: UnstagedBusinessEntity) => {
    const person = contacts.find((c) =>
      c.sourcePrimaryKey === entity.references?.personId?.key
    );
    return person
      ? [person.givenName, person.familyName].filter(Boolean).join(" ")
      : "Unknown contact";
  };
  return {
    debts: entities.filter((e) => e.data.unresolvedCurrency).map((e) => ({
      sourceKey: e.sourcePrimaryKey,
      contactName: name(e),
      rawAmount: String(e.data.rawAmount),
      minorUnits: e.data.minorUnits === true,
      ...(typeof e.data.reason === "string" ? { reason: e.data.reason } : {}),
      ...(typeof e.data.direction === "string"
        ? { direction: e.data.direction }
        : {}),
    })),
    contacts: entities.filter((e) => e.data.unresolvedGender).map((e) => ({
      sourceKey: e.sourcePrimaryKey,
      contactName: name(e),
      sourceGender: String(e.data.unresolvedGender),
    })),
    currencies: options.currencies,
    currencyMinorUnits: Object.fromEntries(
      options.currencies.map((code) => [code, monicaCurrencyScale(code)]),
    ),
    genders: [
      ...options.genders.filter((g) => !g.archived).map((g) => ({
        id: g.id,
        name: g.name,
        source: false,
      })),
      ...entities.filter((e) =>
        e.data.kind === "gender" &&
        !options.genders.some((g) =>
          g.name.trim().toLowerCase() ===
            String(e.data.name).trim().toLowerCase()
        )
      ).map((e) => ({
        id: e.sourcePrimaryKey,
        name: String(e.data.name),
        source: true,
      })),
    ],
  };
}
/** Reject missing, duplicate and foreign choices before any owner writes. */
export function validMonicaChoices(
  entities: readonly BusinessEntity[],
  options: MonicaChoiceOptions,
  choices: MonicaChoices | undefined,
): choices is MonicaChoices {
  if (!choices) return false;
  try {
    Temporal.ZonedDateTime.from({
      timeZone: choices.timezone,
      year: 2026,
      month: 1,
      day: 1,
    });
  } catch {
    return false;
  }
  const exact = (
    keys: readonly string[],
    selected: readonly { readonly sourceKey: string }[],
  ) =>
    keys.length === selected.length && new Set(selected.map((c) =>
        c.sourceKey
      )).size === keys.length &&
    selected.every((c) => keys.includes(c.sourceKey));
  const debts = entities.filter((e) => e.data.unresolvedCurrency);
  const contacts = entities.filter((e) => e.data.unresolvedGender);
  if (
    !exact(debts.map((e) => e.sourcePrimaryKey), choices.currencies) ||
    !exact(contacts.map((e) => e.sourcePrimaryKey), choices.genders)
  ) return false;
  for (const choice of choices.currencies) {
    const entity = debts.find((e) => e.sourcePrimaryKey === choice.sourceKey)!;
    if (
      !options.currencies.includes(choice.currencyCode) ||
      monicaMoney(
          entity.data.rawAmount,
          choice.currencyCode,
          entity.data.minorUnits === true,
        ) === undefined
    ) return false;
  }
  const report = monicaChoiceReport(entities, [], options);
  return choices.genders.every((c) => {
    if (c.action === "unspecified") {
      return c.genderId === undefined && c.name === undefined;
    }
    if (c.action === "create") {
      return c.genderId === undefined && typeof c.name === "string" &&
        c.name.trim().length > 0 && c.name.trim().length <= 100 &&
        !options.genders.some((g) =>
          g.archived &&
          g.name.trim().toLowerCase() === c.name!.trim().toLowerCase()
        );
    }
    return c.name === undefined &&
      report.genders.some((g) =>
        g.id === c.genderId && g.source === (c.action === "source")
      );
  });
}
export function applyMonicaChoices(
  entities: readonly BusinessEntity[],
  choices: MonicaChoices,
  created: Readonly<Record<string, string>>,
): BusinessEntity[] {
  return entities.map((entity) => {
    if (entity.data.unresolvedCurrency) {
      const choice = choices.currencies.find((c) =>
        c.sourceKey === entity.sourcePrimaryKey
      )!;
      return {
        ...entity,
        data: {
          ...entity.data,
          currencyCode: choice.currencyCode,
          amount: monicaMoney(
            entity.data.rawAmount,
            choice.currencyCode,
            entity.data.minorUnits === true,
          ),
          reviewedChoice: true,
        },
      };
    }
    if (entity.data.unresolvedGender) {
      const choice = choices.genders.find((c) =>
        c.sourceKey === entity.sourcePrimaryKey
      )!;
      return {
        ...entity,
        data: {
          ...entity.data,
          reviewedChoice: true,
          selectedGenderId: choice.action === "map"
            ? choice.genderId
            : choice.action === "create"
            ? created[choice.sourceKey]
            : null,
        },
        references: {
          ...entity.references,
          ...(choice.action === "source"
            ? { genderId: { table: "genders", key: choice.genderId! } }
            : {}),
        },
      };
    }
    return entity;
  });
}
