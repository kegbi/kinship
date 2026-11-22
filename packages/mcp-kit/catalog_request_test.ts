/**
 * Every area's tools as the requests their routes receive (MCP-C2).
 *
 * Each case is a call an agent could make with the real catalog: its
 * arguments pass the tool's own argument schema, and the request it becomes
 * is pinned — method, path, query, and body — and then parsed by the route's
 * own path, query, and body schemas, so a fixed discriminator, a shared or
 * aliased value, an omitted member, or a minted retry key that lands in the
 * wrong place fails here rather than at the route.
 */

import type { z } from "zod";
import { AGENT_TOOLS } from "../contracts/tools/mod.ts";
import type { AgentTool } from "../contracts/tools/define.ts";
import { assert, assertEquals } from "../backend/testing/assert.ts";
import { type ToolCaller, toolRequest } from "./tool_call.ts";

const caller: ToolCaller = {
  base: "http://api.internal",
  scopes: [],
  token: "kin_pat_00000000-0000-4000-8000-000000000001.c2VjcmV0",
};

const PERSON = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const RECORD = "00000000-0000-4000-8000-0000000000b1";
const TYPE = "00000000-0000-4000-8000-0000000000c1";
const RETRY = "00000000-0000-4000-8000-0000000000d1";
const AT = "2026-11-22T09:30:00.000Z";
const LATER = "2026-11-22T10:00:00.000Z";

interface Case {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** The JSON body; a minted `requestId` is checked, then left out here. */
  readonly body?: Readonly<Record<string, unknown>>;
  readonly mints?: boolean;
}

const CASES: readonly Case[] = [
  // context and overview
  { tool: "get_context", args: {}, method: "GET", path: "/api/v1/me" },
  {
    tool: "search_workspace",
    args: { q: "Ada", limit: 3 },
    method: "GET",
    path: "/api/v1/search",
    query: { q: "Ada", limit: "3" },
  },
  {
    tool: "get_today_attention",
    args: {},
    method: "GET",
    path: "/api/v1/today/attention",
  },
  // people
  {
    tool: "list_people",
    args: { search: "Ada", starred: "true", limit: 5 },
    method: "GET",
    path: "/api/v1/people",
    query: { search: "Ada", starred: "true", limit: "5" },
  },
  {
    tool: "create_person",
    args: { givenName: "Ada", familyName: "Lovelace", isPartial: false },
    method: "POST",
    path: "/api/v1/people",
    body: { givenName: "Ada", familyName: "Lovelace", isPartial: false },
  },
  {
    tool: "update_person",
    args: {
      personId: PERSON,
      expectedUpdatedAt: AT,
      givenName: "Ada",
      isPartial: false,
    },
    method: "PATCH",
    path: `/api/v1/people/${PERSON}`,
    body: { expectedUpdatedAt: AT, givenName: "Ada", isPartial: false },
  },
  {
    tool: "remove_person_star",
    args: { personId: PERSON },
    method: "DELETE",
    path: `/api/v1/people/${PERSON}/star`,
  },
  {
    tool: "archive_people",
    args: { personIds: [PERSON, OTHER] },
    method: "POST",
    path: "/api/v1/people/bulk",
    body: { action: "archive", personIds: [PERSON, OTHER] },
  },
  {
    tool: "add_tag_to_people",
    args: { personIds: [PERSON], tagId: TYPE },
    method: "POST",
    path: "/api/v1/people/bulk",
    body: { action: "tag", personIds: [PERSON], tagId: TYPE },
  },
  {
    tool: "delete_person",
    args: {
      personId: PERSON,
      confirmation: "Delete Ada",
      expectedUpdatedAt: AT,
    },
    method: "DELETE",
    path: `/api/v1/people/${PERSON}`,
    body: { confirmation: "Delete Ada", expectedUpdatedAt: AT },
  },
  {
    tool: "get_merge_preview",
    args: { primaryId: PERSON, duplicateId: OTHER },
    method: "GET",
    path: `/api/v1/people/${PERSON}/merge-preview`,
    query: { duplicateId: OTHER },
  },
  // profile
  {
    tool: "list_profile_facts",
    args: {
      personId: PERSON,
      section: "contact-methods",
      includeOptions: "true",
    },
    method: "GET",
    path: `/api/v1/people/${PERSON}/facts/contact-methods`,
    query: { includeOptions: "true" },
  },
  {
    tool: "add_contact_method",
    args: {
      personId: PERSON,
      expectedPersonUpdatedAt: AT,
      isPrimary: true,
      labelIds: [],
      typeId: TYPE,
      value: "ada@example.test",
    },
    method: "POST",
    path: `/api/v1/people/${PERSON}/facts/contact-methods`,
    body: {
      expectedPersonUpdatedAt: AT,
      isPrimary: true,
      labelIds: [],
      section: "contact-methods",
      typeId: TYPE,
      value: "ada@example.test",
    },
  },
  {
    tool: "update_address",
    args: {
      personId: PERSON,
      factId: RECORD,
      city: "London",
      expectedPersonUpdatedAt: AT,
      expectedUpdatedAt: LATER,
      isPrimary: false,
      labelIds: [],
    },
    method: "PUT",
    path: `/api/v1/people/${PERSON}/facts/addresses/${RECORD}`,
    body: {
      city: "London",
      expectedPersonUpdatedAt: AT,
      expectedUpdatedAt: LATER,
      id: RECORD,
      isPrimary: false,
      labelIds: [],
      section: "addresses",
    },
  },
  {
    tool: "update_person_tags",
    args: {
      personId: PERSON,
      tagIds: [TYPE],
      expectedPersonUpdatedAt: AT,
      expectedUpdatedAt: AT,
    },
    method: "PUT",
    path: `/api/v1/people/${PERSON}/facts/tags/${PERSON}`,
    body: {
      expectedPersonUpdatedAt: AT,
      expectedUpdatedAt: AT,
      id: PERSON,
      section: "tags",
      tagIds: [TYPE],
    },
  },
  {
    tool: "delete_profile_fact",
    args: {
      personId: PERSON,
      section: "pets",
      factId: RECORD,
      expectedPersonUpdatedAt: AT,
      expectedUpdatedAt: LATER,
    },
    method: "DELETE",
    path: `/api/v1/people/${PERSON}/facts/pets/${RECORD}`,
    body: {
      expectedPersonUpdatedAt: AT,
      expectedUpdatedAt: LATER,
      section: "pets",
    },
  },
  {
    tool: "add_important_date",
    args: {
      personId: PERSON,
      kind: "birthday",
      precision: "month_day",
      month: 12,
      day: 10,
      isAgeBased: false,
      isYearApproximate: false,
    },
    method: "POST",
    path: `/api/v1/people/${PERSON}/dates`,
    body: {
      day: 10,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 12,
      precision: "month_day",
    },
  },
  {
    tool: "delete_life_event",
    args: { personId: PERSON, lifeEventId: RECORD, expectedUpdatedAt: AT },
    method: "DELETE",
    path: `/api/v1/people/${PERSON}/life-events/${RECORD}`,
    body: { expectedUpdatedAt: AT },
  },
  // relationships
  {
    tool: "create_relationship",
    args: { personId: PERSON, relationshipTypeId: TYPE, targetPersonId: OTHER },
    method: "POST",
    path: `/api/v1/people/${PERSON}/relationships`,
    body: { relationshipTypeId: TYPE, targetPersonId: OTHER },
  },
  {
    tool: "list_relationship_types",
    args: { selected: [TYPE, RECORD] },
    method: "GET",
    path: "/api/v1/relationship-types",
    query: { selected: `${TYPE},${RECORD}` },
  },
  // interactions
  {
    tool: "record_note",
    args: { personId: PERSON, body: "Likes tea" },
    method: "POST",
    path: "/api/v1/interactions",
    body: { body: "Likes tea", kind: "note", personId: PERSON },
    mints: true,
  },
  {
    tool: "record_call",
    args: {
      personId: PERSON,
      calledAt: AT,
      contactWasCaller: true,
      requestId: RETRY,
    },
    method: "POST",
    path: "/api/v1/interactions",
    body: {
      calledAt: AT,
      contactWasCaller: true,
      kind: "call",
      personId: PERSON,
      requestId: RETRY,
    },
  },
  {
    tool: "list_notes_and_activities",
    args: { personId: PERSON, kind: "note", year: 2026 },
    method: "GET",
    path: `/api/v1/people/${PERSON}/activity-report`,
    query: { kind: "note", year: "2026" },
  },
  // planning
  {
    tool: "create_task",
    args: { title: "Call Ada back", personId: PERSON },
    method: "POST",
    path: "/api/v1/tasks",
    body: { personId: PERSON, title: "Call Ada back" },
    mints: true,
  },
  {
    tool: "update_task",
    args: { taskId: RECORD, expectedUpdatedAt: AT, dueAt: null },
    method: "PATCH",
    path: `/api/v1/tasks/${RECORD}`,
    body: { dueAt: null, expectedUpdatedAt: AT },
  },
  {
    tool: "create_reminder",
    args: {
      personId: PERSON,
      title: "Birthday card",
      anchorOn: "2026-12-10",
      sendTime: "09:00",
      recurrenceUnit: "year",
      recurrenceInterval: 1,
    },
    method: "POST",
    path: "/api/v1/reminders",
    body: {
      anchorOn: "2026-12-10",
      personId: PERSON,
      recurrenceInterval: 1,
      recurrenceUnit: "year",
      sendTime: "09:00",
      title: "Birthday card",
    },
    mints: true,
  },
  {
    tool: "set_reminder_active",
    args: { reminderId: RECORD, active: false },
    method: "PUT",
    path: `/api/v1/reminders/${RECORD}/active`,
    body: { active: false },
  },
  {
    tool: "set_stay_in_touch_cadence",
    args: { personId: PERSON, intervalCount: 2, intervalUnit: "week" },
    method: "POST",
    path: "/api/v1/stay-in-touch-cadences",
    body: { intervalCount: 2, intervalUnit: "week", personId: PERSON },
    mints: true,
  },
  // journal
  {
    tool: "create_journal_post",
    args: { body: "A quiet day.", occurredAt: AT },
    method: "POST",
    path: "/api/v1/journal/posts",
    body: { body: "A quiet day.", occurredAt: AT },
  },
  {
    tool: "set_day_rating",
    args: { ratedOn: "2026-11-22", rating: 4 },
    method: "PUT",
    path: "/api/v1/journal/day-ratings",
    body: { ratedOn: "2026-11-22", rating: 4 },
  },
  {
    tool: "delete_journal_item",
    args: { itemId: RECORD },
    method: "DELETE",
    path: `/api/v1/journal/items/${RECORD}`,
  },
  // gifts and debts
  {
    tool: "create_gift",
    args: { personId: PERSON, name: "A teapot", status: "idea" },
    method: "POST",
    path: `/api/v1/people/${PERSON}/gifts`,
    body: { name: "A teapot", status: "idea" },
  },
  {
    tool: "set_debt_status",
    args: { personId: PERSON, debtId: RECORD, status: "settled" },
    method: "PATCH",
    path: `/api/v1/people/${PERSON}/debts/${RECORD}/status`,
    body: { status: "settled" },
  },
  {
    tool: "list_gifts_and_debts",
    args: { personId: PERSON, giftCursor: "next-gifts" },
    method: "GET",
    path: `/api/v1/people/${PERSON}/gifts`,
    query: { giftCursor: "next-gifts" },
  },
  // vocabularies
  {
    tool: "create_tag",
    args: { name: "Family" },
    method: "POST",
    path: "/api/v1/settings/personalization/tags",
    body: { name: "Family" },
  },
  {
    tool: "update_relationship_type",
    args: {
      id: TYPE,
      expectedUpdatedAt: AT,
      forwardLabel: "mentor of",
      reverseLabel: "mentee of",
    },
    method: "PATCH",
    path: `/api/v1/settings/personalization/relationship-types/${TYPE}`,
    body: {
      expectedUpdatedAt: AT,
      forwardLabel: "mentor of",
      reverseLabel: "mentee of",
    },
  },
  {
    tool: "delete_vocabulary_entry",
    args: {
      section: "activity-types",
      id: TYPE,
      expectedUpdatedAt: AT,
      replacementId: RECORD,
    },
    method: "DELETE",
    path: `/api/v1/settings/personalization/activity-types/${TYPE}`,
    query: { expectedUpdatedAt: AT, replacementId: RECORD },
  },
];

function tool(name: string): AgentTool {
  const found = AGENT_TOOLS.find((each) => each.name === name);
  assert(found !== undefined, `${name} is in the catalog`);
  return found;
}

/** An object with its keys sorted, so a comparison ignores their order. */
function sorted(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function routeBody(target: AgentTool): z.ZodType | undefined {
  return target.route.request?.body?.content["application/json"] as
    | z.ZodType
    | undefined;
}

for (const each of CASES) {
  Deno.test(`[MCP-C2] ${each.tool} becomes the request its route parses`, async () => {
    const target = tool(each.tool);
    const checked = target.input.safeParse(each.args);
    assert(
      checked.success,
      `the arguments fit ${each.tool}: ${JSON.stringify(checked.error)}`,
    );
    const request = toolRequest(target, each.args, caller);
    const url = new URL(request.url);
    assertEquals(request.method, each.method);
    assertEquals(url.pathname, each.path);
    const query = Object.fromEntries(url.searchParams);
    assertEquals(sorted(query), sorted(each.query ?? {}));

    const text = await request.text();
    const takesBody = routeBody(target) !== undefined;
    assertEquals(
      text === "",
      !takesBody,
      "a body exactly when the route takes one",
    );
    const body = takesBody ? JSON.parse(text) as Record<string, unknown> : {};
    if (each.mints) {
      assert(
        typeof body.requestId === "string" &&
          /^[0-9a-f-]{36}$/.test(body.requestId),
        "a retry key is minted when the agent leaves it out",
      );
    }
    const { requestId: _minted, ...rest } = body;
    assertEquals(sorted(each.mints ? rest : body), sorted(each.body ?? {}));

    const actual = url.pathname.split("/");
    const params = Object.fromEntries(
      target.route.path.split("/").flatMap((segment, index) =>
        segment.startsWith("{")
          ? [[segment.slice(1, -1), decodeURIComponent(actual[index] ?? "")]]
          : []
      ),
    );
    const routeParams = target.route.request?.params;
    if (routeParams) {
      assert(routeParams.safeParse(params).success, "the route's path parses");
    }
    const routeQuery = target.route.request?.query;
    if (routeQuery) {
      const values: Record<string, unknown> = { ...query };
      for (const [field, member] of Object.entries(routeQuery.shape)) {
        const value = values[field];
        if (typeof value !== "string") continue;
        // The route's query reader splits a comma-joined list back apart.
        const list = value.split(",");
        if ((member as z.ZodType).safeParse(list).success) values[field] = list;
      }
      const parsed = routeQuery.safeParse(values);
      assert(parsed.success, `the route's query parses: ${parsed.error}`);
    }
    const schema = routeBody(target);
    if (schema) {
      const parsed = schema.safeParse(body);
      assert(parsed.success, `the route's body parses: ${parsed.error}`);
    }
  });
}

Deno.test("[MCP-C2] every area has a pinned request", () => {
  const areas = new Set(
    CASES.map((each) => tool(each.tool).route.path.split("/")[3]),
  );
  for (
    const area of [
      "me",
      "search",
      "today",
      "people",
      "relationship-types",
      "interactions",
      "tasks",
      "reminders",
      "stay-in-touch-cadences",
      "journal",
      "settings",
    ]
  ) {
    assert(areas.has(area), `${area} has a case`);
  }
});
