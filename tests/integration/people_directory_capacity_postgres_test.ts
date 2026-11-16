/**
 * The people directory's orders at the large capacity boundary (GAP-053,
 * PERF-001): 10,000 people and 250,000 history records, split across calls,
 * conversations, and their messages.
 *
 * `docs/planning/mvp-capacity-profile.json` sets an ordinary API read at 500
 * ms and a representative query at 250 ms. Every order's pages are read
 * through the directory repository, after one warming read, and each page is
 * held under the read ceiling with the median under the query ceiling. The
 * `last-contacted` order, which reads the history, is the one that once did
 * per-person work across the whole workspace before its limit.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { apiSupport, ORIGIN } from "../support/api.ts";
import { PostgresPeopleDirectoryRepository } from "../../packages/backend/read-models/people-directory/adapters/postgres/people_directory_repository.ts";
import type { PeopleDirectoryCursor } from "../../packages/backend/read-models/people-directory/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";

/** `functionalCeilingsMs` in `docs/planning/mvp-capacity-profile.json`. */
const ORDINARY_API_READ_MS = 500;
const REPRESENTATIVE_QUERY_MS = 250;
const LARGE_PEOPLE = 10_000;
const LARGE_CALLS = 125_000;
const LARGE_THREADS = 25_000;
const LARGE_MESSAGES = 100_000;
const PAGES = 6;

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
);
const api = apiSupport(configured.app, mail, sql);

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(share * sorted.length))
  ]!;
}

Deno.test({
  name:
    "[PERF-001] every directory order reads its pages within the large-boundary read budget",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await api.register(
      `capacity-${crypto.randomUUID()}@example.test`,
      "Capacity circle",
    );
    const workspace = owner.workspaceId;
    await sql`
      insert into crm.people (workspace_id, created_by_member_id, given_name,
        family_name, created_at, updated_at, is_starred)
      select ${workspace}::uuid, ${owner.memberId}::uuid, 'Person ' || i,
        'Family ' || (i % 97), now() - (i || ' minutes')::interval,
        now() - ((i * 7) % 10000 || ' minutes')::interval, i % 50 = 0
      from generate_series(1, ${LARGE_PEOPLE}) i
    `;
    await sql`
      create temporary table capacity_people as
      select id, row_number() over (order by id) as n
      from crm.people where workspace_id = ${workspace}::uuid
    `;
    await sql`
      insert into crm.calls (workspace_id, person_id, called_at)
      select ${workspace}::uuid, person.id,
        now() - ((i * 13) % 500000 || ' minutes')::interval
      from generate_series(1, ${LARGE_CALLS}) i
      join capacity_people person on person.n = 1 + (i::bigint * 7919) % ${LARGE_PEOPLE}
    `;
    await sql`
      insert into crm.conversation_threads (workspace_id, person_id, happened_at)
      select ${workspace}::uuid, person.id,
        now() - ((i * 17) % 500000 || ' minutes')::interval
      from generate_series(1, ${LARGE_THREADS}) i
      join capacity_people person on person.n = 1 + (i::bigint * 104729) % ${LARGE_PEOPLE}
    `;
    await sql`
      insert into crm.messages (conversation_id, content, written_at, direction, workspace_id)
      select thread.id, 'Hello', thread.happened_at + (i || ' minutes')::interval,
        'inbound',
        (select scope.workspace_id from crm.conversation_threads scope where scope.id = thread.id)
      from crm.conversation_threads thread
      cross join generate_series(1, ${LARGE_MESSAGES / LARGE_THREADS}) i
      where thread.workspace_id = ${workspace}::uuid
    `;
    await sql`drop table capacity_people`;
    await sql`analyze crm.people, crm.calls, crm.conversation_threads, crm.messages`;

    const connection = connectDatabase(databaseUrl);
    const repository = new PostgresPeopleDirectoryRepository(connection.db);
    const report: string[] = [];
    try {
      for (
        const sort of [
          "given-name",
          "family-name",
          "recently-added",
          "last-contacted",
          "recently-updated",
        ] as const
      ) {
        for (const starredFirst of [false, true]) {
          const read = (after?: PeopleDirectoryCursor) =>
            repository.list({
              ...owner,
              ...(after ? { after } : {}),
              lifecycle: "active",
              limit: 20,
              nameFold: [],
              nameForms: [],
              search: "",
              sort,
              starred: false,
              starredFirst,
            });
          await read();
          const timings: number[] = [];
          let after: PeopleDirectoryCursor | undefined;
          for (let page = 0; page < PAGES; page++) {
            const started = performance.now();
            const answer = await read(after);
            timings.push(performance.now() - started);
            assert(answer.status === "ready", `${sort} page ${page} reads`);
            if (answer.status !== "ready") return;
            after = answer.people[19]?.cursor;
            assert(after !== undefined, `${sort} page ${page} continues`);
          }
          const median = percentile(timings, 0.5);
          const worst = Math.max(...timings);
          report.push(
            `${sort}${starredFirst ? " starred-first" : ""}: p50 ${
              median.toFixed(0)
            } ms, max ${worst.toFixed(0)} ms`,
          );
          assert(
            worst <= ORDINARY_API_READ_MS,
            `${sort} pages stay under ${ORDINARY_API_READ_MS} ms: ${
              timings.map((value) => value.toFixed(0)).join(", ")
            }`,
          );
          assert(
            median <= REPRESENTATIVE_QUERY_MS,
            `${sort} pages' median stays under ${REPRESENTATIVE_QUERY_MS} ms: ${
              timings.map((value) => value.toFixed(0)).join(", ")
            }`,
          );
        }
      }
    } finally {
      console.log(report.join("\n"));
      await connection.destroy();
    }
  },
});
