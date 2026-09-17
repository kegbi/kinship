import {
  boundedText,
  currencyCode,
  instant,
  isInstant,
  isoDate,
  isoTime,
  moneyAmount,
  optionalText,
  uuid,
} from "./validation.ts";
import { assert } from "../testing/assert.ts";

Deno.test("[GAP-006] optional text trims and drops the empty value", () => {
  assert(optionalText("  Ada  ") === "Ada", "surrounding space is removed");
  assert(optionalText("") === undefined, "an empty string is absent");
  assert(optionalText("   ") === undefined, "whitespace only is absent");
  assert(optionalText(undefined) === undefined, "absent stays absent");
  assert(optionalText("0") === "0", "a falsy-looking value survives");
});

Deno.test("[GAP-006] bounded text enforces its maximum after trimming", () => {
  assert(boundedText(" hello ", 5) === "hello", "trimming happens first");
  assert(boundedText("hello!", 5) === undefined, "an overlong value is absent");
  assert(boundedText("  ", 5) === undefined, "an empty value is absent");
  assert(boundedText(undefined, 5) === undefined, "absent stays absent");
});

Deno.test("[GAP-006] an instant is recognised before it is canonicalised", () => {
  assert(isInstant("2026-09-16T10:00:00.000000Z"), "a stored revision parses");
  assert(
    isInstant("2026-09-16T10:00:00Z"),
    "a second-precision instant parses",
  );
  assert(!isInstant("invalid"), "a non-date is not an instant");
  assert(!isInstant(undefined), "an absent value is not an instant");
});

Deno.test("[GAP-006] canonical instants carry exactly six fractional digits", () => {
  assert(
    instant("2026-09-16T10:00:00Z") === "2026-09-16T10:00:00.000000Z",
    "a missing fraction is padded",
  );
  assert(
    instant("2026-09-16T10:00:00.5Z") === "2026-09-16T10:00:00.500000Z",
    "a short fraction is padded on the right",
  );
  assert(
    instant("2026-09-16T10:00:00.123456Z") === "2026-09-16T10:00:00.123456Z",
    "a full fraction is preserved",
  );
  assert(
    instant("2026-09-16T12:00:00.250000+02:00") ===
      "2026-09-16T10:00:00.250000Z",
    "an offset is normalised to UTC",
  );
  assert(
    instant("2026-09-16T10:00:00.1234567Z") === undefined,
    "more precision than the schema stores is rejected",
  );
  assert(instant("nonsense") === undefined, "a non-date is rejected");
  assert(instant(undefined) === undefined, "absent stays absent");
});

Deno.test("[GAP-006] uuids are canonicalised and derived versions are accepted", () => {
  assert(
    uuid("00000000-0000-4000-8000-000000000001") ===
      "00000000-0000-4000-8000-000000000001",
    "a random v4 identifier is accepted",
  );
  assert(
    uuid("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE") ===
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "case is folded to the canonical form",
  );
  assert(
    uuid("00000000-0000-8000-8000-000000000001") !== undefined,
    "a deterministically derived identifier is accepted",
  );
  assert(
    uuid("00000000-0000-6000-8000-000000000001") === undefined,
    "an unsupported version is rejected",
  );
  assert(
    uuid("00000000-0000-4000-c000-000000000001") === undefined,
    "an unsupported variant is rejected",
  );
  assert(uuid("not-a-uuid") === undefined, "a non-uuid is rejected");
  assert(uuid(undefined) === undefined, "absent stays absent");
});

Deno.test("[GAP-006] calendar dates and wall-clock times keep one shape", () => {
  assert(isoDate("2026-09-16") === "2026-09-16", "a calendar date is accepted");
  assert(isoDate("2026-9-16") === undefined, "an unpadded date is rejected");
  assert(
    isoDate("2026-09-16T00:00:00Z") === undefined,
    "an instant is not a date",
  );
  assert(isoDate(undefined) === undefined, "absent stays absent");

  assert(isoTime("09:30") === "09:30:00", "a minute-precision time is filled");
  assert(isoTime("09:30:15") === "09:30:15", "seconds are preserved");
  assert(isoTime("24:00") === undefined, "an impossible hour is rejected");
  assert(isoTime("09:60") === undefined, "an impossible minute is rejected");
  assert(isoTime(undefined) === undefined, "absent stays absent");
});

Deno.test("[GAP-006] money keeps a currency code and a bounded decimal amount", () => {
  assert(currencyCode(" eur ") === "EUR", "a code is trimmed and upper cased");
  assert(currencyCode("EURO") === undefined, "a four-letter code is rejected");
  assert(currencyCode("E1R") === undefined, "digits are rejected");
  assert(currencyCode(undefined) === undefined, "absent stays absent");

  assert(moneyAmount("12") === "12", "a whole amount is accepted");
  assert(moneyAmount("12.3456") === "12.3456", "four decimals are accepted");
  assert(moneyAmount("12.34567") === undefined, "five decimals are rejected");
  assert(moneyAmount("-1") === undefined, "a negative amount is rejected");
  assert(
    moneyAmount("9999999999999999") === undefined,
    "an amount past the stored range is rejected",
  );
  assert(moneyAmount(undefined) === undefined, "absent stays absent");
});
