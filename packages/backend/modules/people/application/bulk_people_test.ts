import {
  type BulkPeopleDependencies,
  createBulkPeopleActions,
  type PersonLifecycleRecord,
  type ProfileFactRecord,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();
const tagId = fixtures.uuid(900);
const otherTag = fixtures.uuid(901);
const revision = "2026-09-28T10:00:00.000000Z";

interface FakePerson {
  lifecycle: PersonLifecycleRecord["lifecycle"];
  tagIds: string[];
  updatedAt: string;
}

/** An in-memory workspace the fakes of both facades read and write. */
function workspace(people: Readonly<Record<string, Partial<FakePerson>>>) {
  const state = new Map<string, FakePerson>(
    Object.entries(people).map(([id, person]) => [id, {
      lifecycle: "active",
      tagIds: [],
      updatedAt: revision,
      ...person,
    }]),
  );
  const calls: string[] = [];
  let transactions = 0;
  let standing: "active" | "revoked" = "active";
  const record = (id: string): PersonLifecycleRecord => ({
    givenName: `Person ${id.slice(-3)}`,
    id,
    isDeceased: false,
    isPartial: false,
    lifecycle: state.get(id)!.lifecycle,
    updatedAt: state.get(id)!.updatedAt,
  });
  const bump = (person: FakePerson) => {
    person.updatedAt = `2026-09-28T11:00:0${calls.length % 10}.000000Z`;
  };
  const transition = (target: "active" | "archived") =>
  (
    _actor: unknown,
    id: string,
    input: { readonly expectedUpdatedAt: string },
  ) => {
    calls.push(`${target === "archived" ? "archive" : "restore"} ${id}`);
    if (standing === "revoked") {
      return Promise.resolve({ status: "forbidden" as const });
    }
    const person = state.get(id)!;
    if (person.updatedAt !== input.expectedUpdatedAt) {
      return Promise.resolve({ status: "stale" as const });
    }
    person.lifecycle = target;
    bump(person);
    return Promise.resolve({
      person: record(id),
      status: target === "archived" ? "archived" as const : "restored" as const,
    });
  };
  const dependencies: BulkPeopleDependencies = {
    actors: { revalidate: () => Promise.resolve(standing) },
    lifecycle: {
      archiveInTransaction: transition("archived"),
      inspectInTransaction: (_actor, id) => {
        calls.push(`inspect ${id}`);
        if (standing === "revoked") {
          return Promise.resolve({ status: "forbidden" });
        }
        return Promise.resolve(
          state.has(id)
            ? { person: record(id), status: "ready" }
            : { status: "not-found" },
        );
      },
      restoreInTransaction: transition("active"),
    },
    profileFacts: {
      create: () => Promise.reject(new Error("tags are always updated")),
      list: (_actor, id) => {
        calls.push(`list ${id}`);
        const person = state.get(id);
        if (!person) return Promise.resolve({ status: "not-found" });
        const tags: ProfileFactRecord = {
          id,
          section: "tags",
          updatedAt: person.updatedAt,
          value: { tagIds: [...person.tagIds] },
        };
        return Promise.resolve({
          options: [],
          personUpdatedAt: person.updatedAt,
          records: [tags],
          status: person.lifecycle === "archived" ? "archived" : "ready",
        });
      },
      update: (_actor, id, _section, input) => {
        calls.push(`update ${id}`);
        const person = state.get(id)!;
        if (input.expectedPersonUpdatedAt !== person.updatedAt) {
          return Promise.resolve({ status: "stale" });
        }
        person.tagIds = [
          ...(input as { readonly tagIds: readonly string[] }).tagIds,
        ];
        bump(person);
        return Promise.resolve({
          personUpdatedAt: person.updatedAt,
          record: {
            id,
            section: "tags",
            updatedAt: person.updatedAt,
            value: { tagIds: person.tagIds },
          },
          status: "saved",
        });
      },
    },
    tags: {
      exists: (command) => {
        calls.push(
          `tag ${command.tagId} ${command.workspaceId} in ${(command.transaction
            .opaque as number)} of ${transactions}`,
        );
        return Promise.resolve(
          command.tagId === tagId || command.tagId === otherTag,
        );
      },
    },
    transaction: {
      run: (work) => {
        transactions += 1;
        return work({ opaque: transactions });
      },
    },
  };
  return {
    bulk: createBulkPeopleActions(dependencies),
    calls,
    dependencies,
    revoke: () => {
      standing = "revoked";
    },
    state,
    transactions: () => transactions,
  };
}

const [ada, grace, alan, missing] = [101, 102, 103, 199].map(fixtures.uuid);

Deno.test("[PEOPLE-009] bulk archive runs each person through the lifecycle, one transaction each", async () => {
  const fake = workspace({
    [ada!]: {},
    [grace!]: { lifecycle: "archived" },
    [alan!]: { lifecycle: "deleted" },
  });
  const result = await fake.bulk.run(actor, {
    action: "archive",
    personIds: [ada!, grace!, missing!, alan!],
  });
  assert(result.status === "ready", "the request runs");
  assertEquals(result.results, [
    { outcome: "done", personId: ada! },
    { outcome: "unchanged", personId: grace! },
    { code: "not_found", outcome: "failed", personId: missing! },
    { code: "not_found", outcome: "failed", personId: alan! },
  ], "per-item results in request order");
  assertEquals(
    result.summary,
    { done: 1, failed: 2, skipped: 0, unchanged: 1 },
    "summary",
  );
  assertEquals(fake.state.get(ada!)?.lifecycle, "archived", "Ada archived");
  assertEquals(
    fake.calls.filter((call) => call.startsWith("archive")),
    [`archive ${ada}`],
    "only the person who changes is written",
  );
  // One standing check, then one transaction per person.
  assertEquals(fake.transactions(), 5, "transactions");

  const restored = await fake.bulk.run(actor, {
    action: "restore",
    personIds: [ada!, grace!],
  });
  assert(restored.status === "ready", "restore runs");
  assertEquals(
    restored.results.map((item) => item.outcome),
    ["done", "done"],
    "both restored",
  );
  const again = await fake.bulk.run(actor, {
    action: "restore",
    personIds: [ada!],
  });
  assert(again.status === "ready", "a repeat runs");
  assertEquals(again.results[0]?.outcome, "unchanged", "restore is idempotent");
});

Deno.test("[PEOPLE-009] bulk tagging adds or removes one tag through the tags profile fact", async () => {
  const fake = workspace({
    [ada!]: { tagIds: [otherTag] },
    [grace!]: { tagIds: [tagId] },
    [alan!]: { lifecycle: "archived" },
  });
  const tagged = await fake.bulk.run(actor, {
    action: "tag",
    personIds: [ada!, grace!, alan!, missing!],
    tagId,
  });
  assert(tagged.status === "ready", "tagging runs");
  assertEquals(tagged.results, [
    { outcome: "done", personId: ada! },
    { outcome: "unchanged", personId: grace! },
    { code: "archived_write_rejected", outcome: "failed", personId: alan! },
    { code: "not_found", outcome: "failed", personId: missing! },
  ], "per-item tagging");
  assertEquals(
    fake.calls[0],
    `tag ${tagId} ${actor.workspaceId} in 1 of 1`,
    "the tag is one workspace-scoped lookup, in the standing check's transaction",
  );
  assertEquals(fake.state.get(ada!)?.tagIds, [otherTag, tagId], "Ada kept");
  assertEquals(
    fake.calls.filter((call) => call.startsWith("update")),
    [`update ${ada}`],
    "only a change is written",
  );

  const untagged = await fake.bulk.run(actor, {
    action: "untag",
    personIds: [ada!, grace!],
    tagId: otherTag,
  });
  assert(untagged.status === "ready", "untagging runs");
  assertEquals(
    untagged.results.map((item) => item.outcome),
    ["done", "unchanged"],
    "untag",
  );
  assertEquals(fake.state.get(ada!)?.tagIds, [tagId], "only that tag left");
});

Deno.test("[PEOPLE-009] a whole-request problem is refused before any person is touched", async () => {
  const fake = workspace({ [ada!]: {} });
  assertEquals(
    await fake.bulk.run(actor, {
      action: "tag",
      personIds: [ada!],
      tagId: fixtures.uuid(999),
    }),
    { status: "tag-unavailable" },
    "a tag from another workspace",
  );
  const invalid = await fake.bulk.run(actor, {
    action: "tag",
    personIds: [ada!],
  });
  assertEquals(invalid.status, "validation-error", "no tag named");
  fake.revoke();
  assertEquals(
    await fake.bulk.run(actor, { action: "archive", personIds: [ada!] }),
    { status: "forbidden" },
    "a revoked member",
  );
  assertEquals(
    fake.calls.filter((call) => !call.startsWith("tag ")),
    [],
    "nobody was read or written",
  );
});

Deno.test("[PEOPLE-009] losing access mid-request skips everyone after it", async () => {
  const fake = workspace({ [ada!]: {}, [grace!]: {}, [alan!]: {} });
  const inspect = fake.dependencies.lifecycle.inspectInTransaction;
  let seen = 0;
  const bulk = createBulkPeopleActions({
    ...fake.dependencies,
    lifecycle: {
      ...fake.dependencies.lifecycle,
      inspectInTransaction: (...args) => {
        seen += 1;
        if (seen === 2) fake.revoke();
        return inspect(...args);
      },
    },
  });
  const result = await bulk.run(actor, {
    action: "archive",
    personIds: [ada!, grace!, alan!],
  });
  assert(result.status === "ready", "the request answers");
  assertEquals(result.results, [
    { outcome: "done", personId: ada! },
    { code: "forbidden", outcome: "failed", personId: grace! },
    { outcome: "skipped", personId: alan! },
  ], "the rest is skipped");
});

Deno.test("[PEOPLE-009] one item's outage or conflict fails only that item", async () => {
  const fake = workspace({ [ada!]: {}, [grace!]: {}, [alan!]: {} });
  const archive = fake.dependencies.lifecycle.archiveInTransaction;
  const list = fake.dependencies.profileFacts.list;
  const bulk = createBulkPeopleActions({
    ...fake.dependencies,
    lifecycle: {
      ...fake.dependencies.lifecycle,
      archiveInTransaction: (active, id, input, transaction) =>
        id === ada
          ? Promise.reject(new Error("connection reset"))
          : id === grace
          ? archive(active, id, { expectedUpdatedAt: "older" }, transaction)
          : archive(active, id, input, transaction),
    },
    profileFacts: {
      ...fake.dependencies.profileFacts,
      list: (active, id, section, input) =>
        id === grace
          ? Promise.resolve({ status: "forbidden" })
          : list(active, id, section, input),
    },
  });
  const archived = await bulk.run(actor, {
    action: "archive",
    personIds: [ada!, grace!, alan!],
  });
  assert(archived.status === "ready", "archive answers");
  assertEquals(archived.results, [
    { code: "unavailable", outcome: "failed", personId: ada! },
    { code: "stale", outcome: "failed", personId: grace! },
    { outcome: "done", personId: alan! },
  ], "outage and conflict stay on their items");

  const tagged = await bulk.run(actor, {
    action: "tag",
    personIds: [grace!, ada!],
    tagId,
  });
  assert(tagged.status === "ready", "tag answers");
  assertEquals(tagged.results, [
    { code: "forbidden", outcome: "failed", personId: grace! },
    { outcome: "skipped", personId: ada! },
  ], "a refused read stops the rest");
});

Deno.test("[PEOPLE-009] a person with no tags record is created one, and hidden tags are refused", async () => {
  const fake = workspace({ [ada!]: {}, [grace!]: {} });
  const created: string[] = [];
  const list = fake.dependencies.profileFacts.list;
  const bulk = createBulkPeopleActions({
    ...fake.dependencies,
    profileFacts: {
      ...fake.dependencies.profileFacts,
      create: (_actor, id, _section, input) => {
        created.push(
          `${id} ${(input as { readonly tagIds: readonly string[] }).tagIds}`,
        );
        return Promise.resolve({ status: "invalid-reference" });
      },
      list: async (active, id, section, input) => {
        const page = await list(active, id, section, input);
        if (id === grace) return { ...page, status: "hidden" } as typeof page;
        return page.status === "ready" ? { ...page, records: [] } : page;
      },
    },
  });
  const result = await bulk.run(actor, {
    action: "tag",
    personIds: [ada!, grace!],
    tagId,
  });
  assert(result.status === "ready", "answers");
  assertEquals(result.results, [
    { code: "tag_unavailable", outcome: "failed", personId: ada! },
    { code: "section_hidden", outcome: "failed", personId: grace! },
  ], "create is used without a record");
  assertEquals(created, [`${ada} ${tagId}`], "created with the one tag");
});
