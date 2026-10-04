import { assertEquals } from "../../../testing/assert.ts";
import {
  applyMonicaChoices,
  monicaChoiceReport,
  type MonicaChoices,
  validMonicaChoices,
} from "./monica_choices.ts";
import type { BusinessEntity } from "./business_entities.ts";
const debt: BusinessEntity = {
  owner: "gifts",
  sourceTable: "debts",
  sourcePrimaryKey: "1",
  targetTable: "debts",
  targetId: "debt",
  data: {
    kind: "debt",
    unresolvedCurrency: true,
    rawAmount: "12345",
    minorUnits: true,
  },
  references: { personId: { table: "contacts", key: "2" } },
};
const profile: BusinessEntity = {
  ...debt,
  owner: "people",
  sourceTable: "contacts_extra",
  sourcePrimaryKey: "2",
  targetTable: "people",
  data: { kind: "profile", unresolvedGender: "999" },
};
const catalog: BusinessEntity = {
  ...profile,
  owner: "workspaces",
  sourceTable: "genders",
  sourcePrimaryKey: "3",
  targetTable: "gender_options",
  data: { kind: "gender", name: "Source option" },
};
const options = {
  currencies: ["EUR", "JPY", "KWD"],
  genders: [{ id: "active", name: "Custom", archived: false }, {
    id: "retired",
    name: "Retired",
    archived: true,
  }],
};
const choices: MonicaChoices = {
  timezone: "UTC",
  currencies: [{ sourceKey: "1", currencyCode: "JPY" }],
  genders: [{ sourceKey: "2", action: "unspecified" }],
};
Deno.test("Monica choices require exact coverage, active catalogs and a real timezone before writes", () => {
  const entities = [debt, profile, catalog];
  assertEquals(validMonicaChoices(entities, options, choices), true);
  for (
    const invalid of [
      undefined,
      { ...choices, timezone: "" },
      { ...choices, timezone: "Not/AZone" },
      { ...choices, currencies: [] },
      {
        ...choices,
        currencies: [...choices.currencies, ...choices.currencies],
      },
      {
        ...choices,
        currencies: [{ sourceKey: "foreign", currencyCode: "EUR" }],
      },
      { ...choices, currencies: [{ sourceKey: "1", currencyCode: "ZZZ" }] },
      { ...choices, genders: [] },
      { ...choices, genders: [...choices.genders, ...choices.genders] },
      {
        ...choices,
        genders: [{
          sourceKey: "2",
          action: "map" as const,
          genderId: "retired",
        }],
      },
      {
        ...choices,
        genders: [{
          sourceKey: "2",
          action: "map" as const,
          genderId: "foreign",
        }],
      },
      {
        ...choices,
        genders: [{
          sourceKey: "2",
          action: "source" as const,
          genderId: "foreign",
        }],
      },
      {
        ...choices,
        genders: [{
          sourceKey: "2",
          action: "create" as const,
          name: "Retired",
        }],
      },
      {
        ...choices,
        genders: [{ sourceKey: "2", action: "create" as const, name: " " }],
      },
      {
        ...choices,
        genders: [{
          sourceKey: "2",
          action: "unspecified" as const,
          genderId: "active",
        }],
      },
    ]
  ) assertEquals(validMonicaChoices(entities, options, invalid), false);
  for (
    const gender of [
      { sourceKey: "2", action: "map" as const, genderId: "active" },
      { sourceKey: "2", action: "source" as const, genderId: "3" },
      { sourceKey: "2", action: "create" as const, name: "New" },
    ]
  ) {
    assertEquals(
      validMonicaChoices(entities, options, { ...choices, genders: [gender] }),
      true,
    );
  }
  assertEquals(
    validMonicaChoices(
      [
        { ...debt, data: { ...debt.data, rawAmount: "9999999999999999999" } },
        profile,
      ],
      options,
      choices,
    ),
    false,
  );
});
Deno.test("choice reports include contact context, exact amounts and source options without retired options", () => {
  const report = monicaChoiceReport([debt, profile, catalog], [{
    sourcePrimaryKey: "2",
    givenName: "Ada",
    familyName: "Lovelace",
  }], options);
  assertEquals(report.debts[0]?.contactName, "Ada Lovelace");
  assertEquals(report.debts[0]?.rawAmount, "12345");
  assertEquals(
    monicaChoiceReport([], [], {
      currencies: ["ISK", "UYI", "MGA", "KWD"],
      genders: [],
    }).currencyMinorUnits,
    { ISK: 0, UYI: 0, MGA: 2, KWD: 3 },
  );
  assertEquals(report.genders.map((g) => g.id), ["active", "3"]);
  assertEquals(
    monicaChoiceReport([debt], [], options).debts[0]?.contactName,
    "Unknown contact",
  );
});
Deno.test("choices scale exact minor units only after currency selection and keep JSON major units", () => {
  for (
    const [currencyCode, amount] of [["JPY", "12345"], ["KWD", "12.345"], [
      "EUR",
      "123.45",
    ]]
  ) {
    const result = applyMonicaChoices([debt, profile, catalog], {
      ...choices,
      currencies: [{ sourceKey: "1", currencyCode: currencyCode! }],
    }, {});
    assertEquals(result[0]?.data.amount, amount);
    assertEquals(result[1]?.data.selectedGenderId, null);
    assertEquals(result[2], catalog);
  }
  assertEquals(
    applyMonicaChoices(
      [{
        ...debt,
        data: { ...debt.data, rawAmount: "12.3456", minorUnits: false },
      }],
      choices,
      {},
    )[0]?.data.amount,
    "12.3456",
  );
  for (
    const [action, genderId] of [["map", "active"], ["create", undefined], [
      "source",
      "3",
    ]] as const
  ) {
    const result = applyMonicaChoices([profile], {
      ...choices,
      genders: [{
        sourceKey: "2",
        action,
        ...(genderId ? { genderId } : { name: "New" }),
      }],
    }, { "2": "new" })[0]!;
    assertEquals(
      action === "source"
        ? result.references?.genderId?.key
        : result.data.selectedGenderId,
      action === "source" ? "3" : action === "create" ? "new" : "active",
    );
  }
});
