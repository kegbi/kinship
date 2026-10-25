import { assert, assertEquals } from "../backend/testing/assert.ts";
import {
  foldName,
  NAME_FOLD_STEPS,
  nameMatches,
  nameMatchRanges,
  nameSearchForms,
} from "./schemas/name_search.ts";

Deno.test("[SEARCH-001] a name folds to one Latin skeleton from either script", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["Elena", "elena"],
    ["Елена", "elena"],
    ["ЕЛЕНА", "elena"],
    ["Yelena", "elena"],
    ["Юлия", "iulia"],
    ["Yulia", "iulia"],
    ["Yuliya", "iulia"],
    ["Julia", "iulia"],
    ["Iuliia", "iulia"],
    ["Александр", "aleksandr"],
    ["Aleksandr", "aleksandr"],
    ["Alexandr", "aleksandr"],
    ["Дмитрий", "dmitri"],
    ["Dmitriy", "dmitri"],
    ["Dmitry", "dmitri"],
    ["Михаил", "mikhail"],
    ["Mikhail", "mikhail"],
    ["Жанна", "zhanna"],
    ["Щукин", "shchukin"],
    ["Цветана", "tsvetana"],
    ["Наталья", "natalia"],
    ["Ёлка Игорь", "elka igor"],
    ["Олексій Їжак Єва Ґанна", "oleksi izhak eva ganna"],
  ];
  for (const [name, folded] of cases) {
    assertEquals(foldName(name), folded);
  }
});

Deno.test("[SEARCH-001] the fold steps are lowercase data a SQL replace chain can repeat", () => {
  assert(NAME_FOLD_STEPS.length > 0, "the steps are published");
  for (const [from, to] of NAME_FOLD_STEPS) {
    assert(from !== "" && from === from.toLowerCase(), `step ${from}`);
    assertEquals(to, to.toLowerCase());
  }
  // Applying the published steps in order, as `replace()` does, is the fold.
  const replayed = NAME_FOLD_STEPS.reduce(
    (text, [from, to]) => text.split(from).join(to),
    "александра ксения".toLowerCase(),
  );
  assertEquals(replayed, foldName("Александра Ксения"));
});

Deno.test("[SEARCH-001] a query's forms include it re-typed on the other keyboard layout", () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    // Elena typed on the Russian layout, and Елена typed on the English one.
    ["удутф", ["udutf", "elena"]],
    ["Tktyf", ["tktif", "elena"]],
    ["  елена ", ["elena", "tktif"]],
    ["elena", ["elena", "udutf"]],
    // Punctuation keys and shifted letters cross the layouts too.
    ["<jhbc", ["<ihbc", "boris"]],
    ["Ифкищк", ["ifkishchk", "barbor"]],
    // Two characters are too short to guess a layout from.
    ["ab", ["ab"]],
    ["", []],
    ["   ", []],
  ];
  for (const [query, forms] of cases) {
    assertEquals(nameSearchForms(query), forms);
  }
});

Deno.test("[SEARCH-001] a match maps back to the label's own characters", () => {
  const cases: readonly (readonly [
    string,
    string,
    readonly {
      readonly end: number;
      readonly start: number;
    }[],
  ])[] = [
    ["Elena Petrova", "ele", [{ start: 0, end: 3 }]],
    ["Elena Petrova", "елена", [{ start: 0, end: 5 }]],
    ["Elena Petrova", "удутф", [{ start: 0, end: 5 }]],
    ["Ada Елена", "Tktyf", [{ start: 4, end: 9 }]],
    ["Ada Елена", "ELENA", [{ start: 4, end: 9 }]],
    ["Petrova", "trov", [{ start: 2, end: 6 }]],
    // One Cyrillic letter folds to two Latin ones: a query for half of
    // them still marks the whole letter.
    ["Жанна", "zh", [{ start: 0, end: 1 }]],
    ["Жанна", "z", [{ start: 0, end: 1 }]],
    ["Zhanna", "ж", [{ start: 0, end: 2 }]],
    ["Мажор", "zho", [{ start: 2, end: 4 }]],
    // A collapsed pair marks both of the letters it came from.
    ["Yulia", "юл", [{ start: 0, end: 3 }]],
    ["Dmitriy", "дмитрий", [{ start: 0, end: 7 }]],
    // The prefix of a pair the fold collapses still matches literally.
    ["Yelena", "y", [{ start: 0, end: 1 }]],
    ["Elena Petrova", "zz", []],
    ["Elena", "", []],
  ];
  for (const [label, query, ranges] of cases) {
    assertEquals(nameMatchRanges(label, query), ranges);
  }
  assert(nameMatches("Settings · Profile", "Ыуеештпы"), "layout command");
  assert(nameMatches("Settings · Profile", "prof"), "plain command");
  assert(!nameMatches("Settings · Profile", "zebra"), "no command");
});
