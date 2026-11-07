import { Hono } from "hono";
import type { CalendarFeedPublication } from "../../public.ts";
import { createCalendarFeedRoutes } from "./routes.ts";
import { assert, assertEquals } from "../../../../testing/assert.ts";
import { requestLogging } from "../../../../../http-kit/logging.ts";
import { requestId } from "../../../../../http-kit/request_id.ts";
import { jsonLogger } from "../../../../platform/telemetry/json_logger.ts";

const SECRET =
  "kin_cal_40000000-0000-4000-8000-000000000001.Zm9yLXRoZS1jYWxlbmRhci1vbmx5";
const PATH = `/api/v1/calendar-feeds/${SECRET}.ics`;
const BODY = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
const TAG = '"Q2FsZW5kYXItZmVlZC1yZXZpc2lvbi10YWctdmFsdWUx"';

function app(publish: CalendarFeedPublication["publish"]) {
  const presented: string[] = [];
  const lines: string[] = [];
  const api = new Hono();
  api.use(requestId());
  api.use(requestLogging(jsonLogger((line) => void lines.push(line))));
  api.route(
    "/",
    createCalendarFeedRoutes({
      calendarFeed: {
        publish: (secret, held) => {
          presented.push(secret);
          return publish(secret, held);
        },
      },
    }),
  );
  return { api, lines, presented };
}

/** The publication: a 304 when the caller holds `TAG`, else the body. */
const ready: CalendarFeedPublication["publish"] = (_secret, held) =>
  Promise.resolve(
    held?.(TAG)
      ? { status: "not-modified" as const, tag: TAG }
      : { body: BODY, status: "ready" as const, tag: TAG },
  );

Deno.test("[INTEGRATION-002] the feed answers text/calendar with a strong tag and no session", async () => {
  const { api, presented } = app(ready);
  const response = await api.request(`http://localhost${PATH}`);
  assertEquals(response.status, 200);
  assertEquals(await response.text(), BODY);
  assertEquals(presented, [SECRET], "the secret, without its extension");
  assertEquals(
    response.headers.get("content-type"),
    "text/calendar; charset=utf-8",
  );
  assertEquals(response.headers.get("cache-control"), "private, max-age=300");
  assertEquals(response.headers.get("etag"), TAG, "the publication's tag");
  assertEquals(response.headers.get("set-cookie"), null);
});

Deno.test("[INTEGRATION-002] a matching If-None-Match answers 304 with no body", async () => {
  const { api } = app(ready);
  const tag = TAG;
  for (const presented of [tag, `W/${tag}`, `"other", ${tag}`, "*"]) {
    const response = await api.request(`http://localhost${PATH}`, {
      headers: { "If-None-Match": presented },
    });
    assertEquals(response.status, 304, presented);
    assertEquals(await response.text(), "");
    assertEquals(response.headers.get("etag"), tag);
    assertEquals(
      response.headers.get("cache-control"),
      "private, max-age=300",
    );
  }
  const changed = await api.request(`http://localhost${PATH}`, {
    headers: { "If-None-Match": '"stale"' },
  });
  assertEquals(changed.status, 200, "a stale tag gets the new body");
  assertEquals(await changed.text(), BODY);
  const plain = await api.request(`http://localhost${PATH}`);
  assertEquals(plain.status, 200, "no If-None-Match holds nothing");
});

Deno.test("[INTEGRATION-002] a refused, malformed, or unavailable feed never confirms a secret", async () => {
  const refused = app(() => Promise.resolve({ status: "not-found" as const }));
  const missing = await refused.api.request(`http://localhost${PATH}`);
  assertEquals(missing.status, 404);
  assertEquals((await missing.json()).code, "calendar_feed_not_found");

  for (
    const path of [
      `/api/v1/calendar-feeds/${SECRET}`,
      `/api/v1/calendar-feeds/${SECRET}.ical`,
      `/api/v1/calendar-feeds/kin_pat_${SECRET.slice(8)}.ics`,
      "/api/v1/calendar-feeds/.ics",
    ]
  ) {
    const response = await refused.api.request(`http://localhost${path}`);
    assertEquals(response.status, 404, path);
    assertEquals((await response.json()).code, "calendar_feed_not_found");
  }
  assertEquals(
    refused.presented,
    [SECRET],
    "a malformed name never reaches the token check",
  );

  const down = app(() => Promise.resolve({ status: "unavailable" as const }));
  const unavailable = await down.api.request(`http://localhost${PATH}`);
  assertEquals(unavailable.status, 503);
  assertEquals((await unavailable.json()).code, "calendar_feed_unavailable");

  const thrown = app(() => Promise.reject(new Error("pool exhausted")));
  assertEquals(
    (await thrown.api.request(`http://localhost${PATH}`)).status,
    503,
  );
});

Deno.test("[INTEGRATION-002] the API request log never carries the feed secret", async () => {
  const served = app(ready);
  await served.api.request(`http://localhost${PATH}`);
  await served.api.request(`http://localhost${PATH}`, {
    headers: { "If-None-Match": TAG },
  });
  const refused = app(() => Promise.resolve({ status: "not-found" as const }));
  await refused.api.request(`http://localhost${PATH}`);
  await refused.api.request(`http://localhost/api/v1/calendar-feeds/${SECRET}`);
  const lines = [...served.lines, ...refused.lines];
  assertEquals(lines.length, 4, "one line per request");
  const secretPart = SECRET.split(".")[1]!;
  for (const line of lines) {
    assert(!line.includes(secretPart), `the secret leaked: ${line}`);
    assert(!line.includes("kin_cal_"), `the token leaked: ${line}`);
    assert(
      line.includes('"route":"/api/v1/calendar-feeds/:feedFile"'),
      `the route is the registered pattern: ${line}`,
    );
  }
  assertEquals(
    lines.map((line) => JSON.parse(line).status),
    [200, 304, 404, 404],
  );
});
