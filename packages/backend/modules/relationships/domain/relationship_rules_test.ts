import { assertEquals } from "../../../testing/assert.ts";
import {
  decorate,
  displays,
  type RelationshipRecord,
  success,
  validateEndpoints,
  validateRevision,
} from "./relationship_rules.ts";

const fromPersonId = "10000000-0000-4000-8000-000000000001";
const toPersonId = "10000000-0000-4000-8000-000000000002";
const relationshipId = "10000000-0000-4000-8000-000000000003";
const typeId = "10000000-0000-4000-8000-000000000004";

function edge(
  overrides: Partial<RelationshipRecord> = {},
): RelationshipRecord {
  return {
    createdAt: "2026-01-01T00:00:00.000000Z",
    forwardLabel: "Mother",
    fromPersonId,
    id: relationshipId,
    relationshipTypeId: typeId,
    relationshipTypeArchived: false,
    reverseLabel: "Son",
    status: "active",
    toPersonId,
    updatedAt: "2026-01-02T00:00:00.000000Z",
    ...overrides,
  };
}

Deno.test("[GAP-016] an edge reads forward from one end and inverted from the other", () => {
  assertEquals(displays(edge(), fromPersonId), {
    label: "Mother",
    personId: toPersonId,
    relationshipId,
  });
  assertEquals(displays(edge(), toPersonId), {
    label: "Son",
    personId: fromPersonId,
    relationshipId,
  });
  assertEquals(
    displays(edge(), "10000000-0000-4000-8000-00000000000f"),
    {
      label: "Son",
      personId: fromPersonId,
      relationshipId,
    },
    "a stranger reads the edge from the side it points at",
  );
});

Deno.test("[GAP-016] a display carries a name only when one was resolved", () => {
  assertEquals(displays(edge(), fromPersonId, "Ada Lovelace"), {
    label: "Mother",
    name: "Ada Lovelace",
    personId: toPersonId,
    relationshipId,
  });
  assertEquals(
    displays(edge(), fromPersonId, "").name,
    undefined,
    "an empty name is no name at all",
  );
});

Deno.test("[GAP-016] the vocabulary the caller just read relabels the stored edge", () => {
  assertEquals(
    decorate(edge(), {
      archived: true,
      forwardLabel: "Parent",
      id: typeId,
      reverseLabel: "Child",
    }),
    edge({
      forwardLabel: "Parent",
      relationshipTypeArchived: true,
      reverseLabel: "Child",
    }),
  );
});

Deno.test("[GAP-016] a finished write reports both sides and both people", () => {
  assertEquals(success(edge(), "created"), {
    affectedPersonIds: [fromPersonId, toPersonId],
    forward: { label: "Mother", personId: toPersonId, relationshipId },
    inverse: { label: "Son", personId: fromPersonId, relationshipId },
    relationship: edge(),
    status: "created",
  });
  assertEquals(success(edge(), "existing").status, "existing");
  assertEquals(success(edge(), "updated").status, "updated");
});

Deno.test("[GAP-016] nobody is related to themselves", () => {
  assertEquals(validateEndpoints(fromPersonId, toPersonId), {});
  assertEquals(validateEndpoints(fromPersonId, fromPersonId), {
    targetPersonId: "Choose another person.",
  });
});

Deno.test("[GAP-016] a revision is required, and the message names what is being done", () => {
  assertEquals(validateRevision("2026-01-02T00:00:00.000000Z", "save"), {});
  assertEquals(validateRevision("2026-01-02T00:00:00.000000Z", "unlink"), {});
  assertEquals(validateRevision("never", "save"), {
    expectedUpdatedAt: "Refresh relationships before saving.",
  });
  assertEquals(validateRevision("", "unlink"), {
    expectedUpdatedAt: "Refresh relationships before unlinking.",
  });
});
