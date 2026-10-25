/**
 * Name search across scripts and keyboard layouts (`SEARCH-001`).
 *
 * A person is found by a query typed in either script or on the wrong
 * keyboard layout: "елена" and "elena" find both Elena and Елена, and so do
 * "удутф" (Elena typed on the Russian ЙЦУКЕН layout) and "Tktyf" (Елена typed
 * on the English QWERTY one). The rules live here, once, as data:
 *
 * - The API folds each stored name in SQL with `lower()` and then one
 *   `replace()` per `NAME_FOLD_STEPS` pair, in order, and matches the
 *   `nameSearchForms` of the query against it.
 * - The palette folds the same way to filter its commands and to mark the
 *   part of each name the query matched.
 *
 * The fold is a lossy skeleton, not a transliteration standard: Russian and
 * Ukrainian letters become Latin ones (ж → zh, х → kh, ц → ts, щ → shch, the
 * signs vanish), then a few Latin spellings that common names alternate
 * between collapse on both sides: x → ks (Alexandr, Александр), ye → e
 * (Yelena, Елена), j → i and y → i (Julia, Yulia, Юлия), and ii → i
 * (Dmitriy, Дмитрий).
 * Each Cyrillic letter becomes a Latin string that starts with what one
 * would type first, so a Latin query that is a prefix ("z" of "Жанна") still
 * matches. Callers also keep the plain case-insensitive match, so nothing the
 * fold collapses ("y" of "Yelena") stops matching as it is typed.
 */

/** A `replace(text, from, to)` the fold applies, in order, to lowercase text. */
export type NameFoldStep = readonly [from: string, to: string];

const CYRILLIC_TO_LATIN: readonly NameFoldStep[] = [
  ["а", "a"],
  ["б", "b"],
  ["в", "v"],
  ["г", "g"],
  ["ґ", "g"],
  ["д", "d"],
  ["е", "e"],
  ["ё", "e"],
  ["є", "ye"],
  ["ж", "zh"],
  ["з", "z"],
  ["и", "i"],
  ["і", "i"],
  ["ї", "yi"],
  ["й", "y"],
  ["к", "k"],
  ["л", "l"],
  ["м", "m"],
  ["н", "n"],
  ["о", "o"],
  ["п", "p"],
  ["р", "r"],
  ["с", "s"],
  ["т", "t"],
  ["у", "u"],
  ["ф", "f"],
  ["х", "kh"],
  ["ц", "ts"],
  ["ч", "ch"],
  ["ш", "sh"],
  ["щ", "shch"],
  ["ъ", ""],
  ["ы", "y"],
  ["ь", ""],
  ["э", "e"],
  ["ю", "yu"],
  ["я", "ya"],
];

/** Spellings both sides collapse after the letters are Latin. Order matters. */
const LATIN_COLLAPSE: readonly NameFoldStep[] = [
  ["x", "ks"],
  ["ye", "e"],
  ["j", "i"],
  ["y", "i"],
  ["ii", "i"],
];

/** Every step of the fold, applied in order after lowercasing. */
export const NAME_FOLD_STEPS: readonly NameFoldStep[] = [
  ...CYRILLIC_TO_LATIN,
  ...LATIN_COLLAPSE,
];

/**
 * The keys of the English QWERTY and Russian ЙЦУКЕН layouts, position for
 * position: letters, the punctuation keys that carry Russian letters, and
 * their shifted forms.
 */
const ENGLISH_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`" +
  'QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>~';
const RUSSIAN_KEYS = "йцукенгшщзхъфывапролджэячсмитьбюё" +
  "ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮЁ";

function layoutMap(from: string, to: string): ReadonlyMap<string, string> {
  const source = Array.from(from);
  const target = Array.from(to);
  return new Map(source.map((key, index) => [key, target[index]!]));
}

const TO_RUSSIAN = layoutMap(ENGLISH_KEYS, RUSSIAN_KEYS);
const TO_ENGLISH = layoutMap(RUSSIAN_KEYS, ENGLISH_KEYS);

function retyped(text: string, keys: ReadonlyMap<string, string>): string {
  return Array.from(text, (key) => keys.get(key) ?? key).join("");
}

/**
 * The shortest query re-typed on the other layout. Shorter ones re-type into
 * two or three common letters ("Sam" -> "if") found inside unrelated names.
 */
export const NAME_LAYOUT_MINIMUM = 4;

/** The shortest query folded at all: one folded letter matches nearly anyone. */
export const NAME_FOLD_MINIMUM = 2;

/** Whether a re-typing reads as a word: letters, spaces, hyphens, apostrophes. */
const WORDLIKE = /^[\p{L}\s'’-]+$/u;

interface Folded {
  /** Where each unit of `text` came from: a span of the original's units. */
  readonly spans: readonly (readonly [start: number, end: number])[];
  readonly text: string;
}

/**
 * `text` lowercased and folded, remembering for each folded unit the span of
 * `text` it came from. A replaced run's units all take the span of the whole
 * run, so a match that covers part of it still covers the original letters.
 */
function foldTracked(text: string): Folded {
  let units: string[] = [];
  let spans: (readonly [number, number])[] = [];
  let offset = 0;
  for (const character of text) {
    const lower = character.toLowerCase();
    for (let unit = 0; unit < lower.length; unit++) {
      units.push(lower[unit]!);
      spans.push([offset, offset + character.length]);
    }
    offset += character.length;
  }
  for (const [from, to] of NAME_FOLD_STEPS) {
    const current = units.join("");
    if (!current.includes(from)) continue;
    const nextUnits: string[] = [];
    const nextSpans: (readonly [number, number])[] = [];
    let index = 0;
    while (index < units.length) {
      if (current.startsWith(from, index)) {
        const span = [
          spans[index]![0],
          spans[index + from.length - 1]![1],
        ] as const;
        for (let unit = 0; unit < to.length; unit++) {
          nextUnits.push(to[unit]!);
          nextSpans.push(span);
        }
        index += from.length;
      } else {
        nextUnits.push(units[index]!);
        nextSpans.push(spans[index]!);
        index += 1;
      }
    }
    units = nextUnits;
    spans = nextSpans;
  }
  return { spans, text: units.join("") };
}

/** `text` lowercased and folded to its Latin skeleton. */
export function foldName(text: string): string {
  return foldTracked(text).text;
}

/**
 * The folded strings a name may contain to match `query`: the query itself
 * from two characters, and, from four, the query re-typed as if on the other
 * layout when that re-typing reads as a word. Unique, in that order, without
 * empty ones. A shorter query matches only as typed.
 */
export function nameSearchForms(query: string): string[] {
  const trimmed = query.trim();
  const length = Array.from(trimmed).length;
  if (length < NAME_FOLD_MINIMUM) return [];
  const retypings = length >= NAME_LAYOUT_MINIMUM
    ? [retyped(trimmed, TO_ENGLISH), retyped(trimmed, TO_RUSSIAN)].filter((
      text,
    ) => text !== trimmed && WORDLIKE.test(text))
    : [];
  return [...new Set([trimmed, ...retypings].map(foldName))].filter(Boolean);
}

export interface NameMatchRange {
  /** The label's code-unit offset where the match starts. */
  readonly start: number;
  /** The label's code-unit offset just past the match. */
  readonly end: number;
}

/**
 * Where `query` matches `label`, in the label's own code units: the earliest
 * case-insensitive occurrence of the query as typed, or of any of its folded
 * forms in the folded label, the longest when two start together. Empty when
 * nothing matches.
 */
export function nameMatchRanges(
  label: string,
  query: string,
): NameMatchRange[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const candidates: NameMatchRange[] = [];
  // The query as typed, where lowercasing kept the label's offsets.
  const plain = label.toLowerCase();
  const lowered = trimmed.toLowerCase();
  const typed = plain.length === label.length ? plain.indexOf(lowered) : -1;
  if (typed >= 0) {
    candidates.push({ start: typed, end: typed + lowered.length });
  }
  const folded = foldTracked(label);
  for (const form of nameSearchForms(trimmed)) {
    const at = folded.text.indexOf(form);
    if (at < 0) continue;
    candidates.push({
      start: folded.spans[at]![0],
      end: folded.spans[at + form.length - 1]![1],
    });
  }
  const earliest =
    candidates.sort((left, right) =>
      left.start - right.start || right.end - left.end
    )[0];
  return earliest ? [earliest] : [];
}

/** Whether `query` matches `label` by the name-search rules. */
export function nameMatches(label: string, query: string): boolean {
  return nameMatchRanges(label, query).length > 0;
}
