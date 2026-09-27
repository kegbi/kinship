import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  CADENCE_ID_NAMESPACE,
  CADENCE_REQUEST_NAMESPACE,
  cadenceDueAt,
  cadenceFingerprint,
  cadenceIntervalText,
  type CreateCadenceInput,
  validateCreateCadence,
} from "./cadence.ts";

const personId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";

function proposal(
  overrides: Partial<CreateCadenceInput> = {},
): CreateCadenceInput {
  return {
    intervalCount: 3,
    intervalUnit: "week",
    personId,
    requestId,
    ...overrides,
  };
}

Deno.test("[GAP-016] a well-formed cadence proposal carries no errors", () => {
  assertEquals(validateCreateCadence(proposal()), {});
  assertEquals(
    validateCreateCadence(proposal({ intervalCount: 1 })),
    {},
    "the narrowest interval is allowed",
  );
  assertEquals(
    validateCreateCadence(proposal({ intervalCount: 100 })),
    {},
    "the widest interval is allowed",
  );
});

Deno.test("[GAP-016] a cadence proposal names every field it rejects", () => {
  assertEquals(
    validateCreateCadence(
      proposal({ intervalCount: 0, personId: "nobody", requestId: "nothing" }),
    ),
    {
      personId: "Choose a person from this workspace.",
      requestId: "Use a canonical request identifier.",
      intervalCount: "Choose an interval from 1 to 100.",
    },
  );
  assertEquals(
    validateCreateCadence(proposal({ intervalCount: 101 })),
    { intervalCount: "Choose an interval from 1 to 100." },
  );
  assertEquals(
    validateCreateCadence(proposal({ intervalCount: 2.5 })),
    { intervalCount: "Choose an interval from 1 to 100." },
    "a fractional interval is not an interval",
  );
});

Deno.test("[GAP-016] a cadence falls due one calendar interval after the contact", () => {
  const contacted = "2026-01-31T12:00:00Z";
  assertEquals(
    cadenceDueAt(contacted, 3, "day", "UTC"),
    "2026-02-03T12:00:00Z",
  );
  assertEquals(
    cadenceDueAt(contacted, 2, "week", "UTC"),
    "2026-02-14T12:00:00Z",
  );
  assertEquals(
    cadenceDueAt(contacted, 1, "month", "UTC"),
    "2026-02-28T12:00:00Z",
    "a month from the 31st lands on the last day of a shorter month",
  );
  assertEquals(
    cadenceDueAt(contacted, 1, "year", "UTC"),
    "2027-01-31T12:00:00Z",
  );
});

Deno.test("[GAP-016] the due instant follows the member's zone across a DST change", () => {
  assertEquals(
    cadenceDueAt("2026-03-28T10:00:00Z", 1, "day", "Europe/Belgrade"),
    "2026-03-29T09:00:00Z",
    "the same wall-clock time a day later is an hour earlier in UTC",
  );
  assertEquals(
    cadenceDueAt("2026-03-28T10:00:00Z", 1, "day", "UTC"),
    "2026-03-29T10:00:00Z",
    "UTC has no change to follow",
  );
});

Deno.test("[GAP-016] the request fingerprint is stable and names what was asked for", async () => {
  assertEquals(CADENCE_ID_NAMESPACE, "kinship.planning.cadence-id.v1");
  assertEquals(
    CADENCE_REQUEST_NAMESPACE,
    "kinship.planning.cadence-request.v1",
  );
  // Pinned against the digest the private copy in
  // `application/reminder_management.ts` produced before GAP-016 moved it
  // here. Stored request fingerprints are compared to this value forever, so
  // the namespace, the NUL separator, and the field order may never drift.
  const fingerprint = await cadenceFingerprint(proposal());
  assertEquals(
    fingerprint,
    "933f6691b965b98af3ff2f938b3da972e5f8ed68f3d5ac990552501052b3f88a",
    "the stored fingerprint spelling may not drift",
  );
  assertEquals(
    await cadenceFingerprint(proposal({ personId: personId.toUpperCase() })),
    fingerprint,
    "the person identifier is case-folded before it is hashed",
  );
  for (
    const different of [
      proposal({ intervalCount: 4 }),
      proposal({ intervalUnit: "month" }),
      proposal({ personId: "10000000-0000-4000-8000-000000000009" }),
    ]
  ) {
    assert(
      await cadenceFingerprint(different) !== fingerprint,
      "a different cadence must fingerprint differently",
    );
  }
});

Deno.test("[PEOPLE-008] a cadence interval reads as words", () => {
  assertEquals(cadenceIntervalText(1, "day"), "every day");
  assertEquals(cadenceIntervalText(7, "day"), "every 7 days");
  assertEquals(cadenceIntervalText(1, "week"), "every week");
  assertEquals(cadenceIntervalText(3, "month"), "every 3 months");
  assertEquals(cadenceIntervalText(2, "year"), "every 2 years");
});
