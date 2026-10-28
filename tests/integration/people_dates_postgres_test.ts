/**
 * Important dates (split from `people_postgres_test.ts`, GAP-035): precision,
 * tenancy, audit, concurrency, and reminder history.
 *
 * Its final test closes the app and pools it loaded from
 * `people.test-helper.ts`.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import {
  configured,
  createPerson,
  getPerson,
  importantDateRequest,
  register,
  sql,
} from "./people.test-helper.ts";
import { closeResources } from "./people.test-helper.ts";
import { truncate } from "../support/database.ts";

Deno.test({
  name:
    "PEOPLE-005 important dates preserve precision, tenancy, audit, concurrency, and reminder history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    const owner = await register(
      `important-dates-${crypto.randomUUID()}@example.test`,
      "Important dates circle",
    );
    const foreignOwner = await register(
      `important-dates-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign important dates circle",
    );
    await sql`
      update crm.workspace_settings
      set default_timezone = 'America/New_York',
        default_reminder_time = '09:30'::time
      where workspace_id = ${owner.workspaceId}
    `;
    await sql`
      update crm.member_preferences
      set timezone = 'America/New_York'
      where member_id = ${owner.memberId}
    `;
    await sql`
      insert into crm.reminder_rules (
        workspace_id, days_before, is_active, created_at, updated_at
      ) values (${owner.workspaceId}, 2, true, now(), now())
    `;
    const createdPerson = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const personId = (await createdPerson.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const foreignPerson = await createPerson(foreignOwner, {
      familyName: "Hidden",
      givenName: "Person",
      isPartial: false,
    });
    const foreignPersonId = (await foreignPerson.json() as {
      readonly person: { readonly id: string };
    }).person.id;

    const invalidLeap = await importantDateRequest(owner, personId, "POST", {
      day: 29,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Impossible leap day",
      month: 2,
      precision: "full",
      year: 1900,
    });
    assert(invalidLeap.status === 400, "non-leap February 29 is rejected");
    const contradictory = await importantDateRequest(
      owner,
      personId,
      "POST",
      {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "custom",
        label: "Contradictory",
        month: 4,
        precision: "year",
        year: 2012,
      },
    );
    assert(
      contradictory.status === 400,
      "components contradicting precision are rejected",
    );

    const [firstMetLeft, firstMetRight] = await Promise.all([
      importantDateRequest(owner, personId, "POST", {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "first_met",
        month: 4,
        precision: "year_month",
        year: 2012,
      }),
      importantDateRequest(owner, personId, "POST", {
        day: 5,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "first_met",
        month: 4,
        precision: "full",
        year: 2012,
      }),
    ]);
    assert(
      [firstMetLeft.status, firstMetRight.status].sort().join(",") ===
        "201,409",
      "the singleton lock permits exactly one concurrent first-meeting date",
    );

    interface DateRecord {
      readonly id: string;
      readonly isYearApproximate: boolean;
      readonly kind: string;
      readonly precision: string;
      readonly scheduling: string;
      readonly updatedAt: string;
      readonly year?: number;
    }
    const createDate = async (
      body: Readonly<Record<string, unknown>>,
    ): Promise<DateRecord> => {
      const response = await importantDateRequest(
        owner,
        personId,
        "POST",
        body,
      );
      const payload = await response.json() as { readonly date: DateRecord };
      assert(
        response.status === 201,
        `date fixture creates: ${response.status}`,
      );
      return payload.date;
    };
    const birthday = await createDate({
      day: 29,
      isAgeBased: true,
      isYearApproximate: true,
      kind: "birthday",
      month: 2,
      precision: "full",
      year: 1984,
    });
    const duplicateBirthday = await importantDateRequest(
      owner,
      personId,
      "POST",
      {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "birthday",
        precision: "unknown",
      },
    );
    assert(duplicateBirthday.status === 409, "birthday is a singleton");
    const deceased = await createDate({
      isAgeBased: false,
      isYearApproximate: true,
      kind: "deceased",
      precision: "year",
      year: 2020,
    });
    const annualCustom = await createDate({
      day: 29,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Leap-day tradition",
      month: 2,
      precision: "month_day",
    });
    await createDate({
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Conference month",
      month: 9,
      precision: "month",
    });
    await createDate({
      day: 12,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Remembered day",
      precision: "day",
    });
    await createDate({
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Unknown anniversary",
      precision: "unknown",
    });

    const listed = await importantDateRequest(owner, personId, "GET");
    const listedBody = await listed.json() as {
      readonly dates: readonly DateRecord[];
      readonly status: string;
    };
    assert(
      listed.status === 200 && listedBody.status === "ready" &&
        listedBody.dates.length === 7,
      "all core and custom date kinds list in the active workspace",
    );
    const listedBirthday = listedBody.dates.find((date) =>
      date.id === birthday.id
    );
    const schedulableDates = listedBody.dates.filter((date) =>
      date.scheduling === "annual-reminder"
    ).length;
    assert(
      listedBirthday?.precision === "full" &&
        listedBirthday.isYearApproximate && listedBirthday.year === 1984,
      "approximation round-trips independently from full precision",
    );
    const crossed = await importantDateRequest(
      owner,
      foreignPersonId,
      "GET",
    );
    assert(crossed.status === 404, "cross-workspace dates stay concealed");

    const [initialSchedule] = await sql<{
      readonly active_definitions: number;
      readonly local_delivery_valid: boolean;
      readonly pending_occurrences: number;
      readonly unscheduled_definitions: number;
    }[]>`
      select
        count(distinct reminder.id) filter (where reminder.is_active)::int
          active_definitions,
        count(distinct reminder.id) filter (where not reminder.is_active)::int
          unscheduled_definitions,
        (select count(*)::int from crm.reminder_occurrences occurrence
          join crm.reminders owned on owned.id = occurrence.reminder_id
          where owned.person_id = ${personId}
            and occurrence.status = 'pending') pending_occurrences,
        bool_and(
          ((occurrence.deliver_at at time zone 'America/New_York')::time =
            '09:30'::time)
          and occurrence.lead_time_days in (0, 2)
          and (occurrence.deliver_at at time zone 'America/New_York')::date =
            occurrence.occurs_on - occurrence.lead_time_days
        ) filter (where occurrence.id is not null) local_delivery_valid
      from crm.reminders reminder
      left join crm.reminder_occurrences occurrence
        on occurrence.reminder_id = reminder.id
      where reminder.person_id = ${personId}
    `;
    assert(
      initialSchedule?.active_definitions === schedulableDates &&
        // The day itself plus the two-day rule.
        initialSchedule.pending_occurrences === schedulableDates * 2 &&
        initialSchedule.unscheduled_definitions === 0 &&
        initialSchedule.local_delivery_valid,
      `only month/day dates generate annual future state in member scheduling time: ${
        JSON.stringify(initialSchedule)
      }`,
    );
    const [firstMeetingProof] = await sql<{
      readonly date_count: number;
      readonly narrative_count: number;
    }[]>`
      select
        (select count(*)::int from crm.person_dates
          where person_id = ${personId} and kind = 'first_met') date_count,
        (select count(*)::int from crm.person_first_meetings
          where person_id = ${personId}) narrative_count
    `;
    assert(
      firstMeetingProof?.date_count === 1 &&
        firstMeetingProof.narrative_count === 0,
      "first meeting remains person_dates kind first_met, not narrative state",
    );

    const timingPersonResponse = await createPerson(owner, {
      familyName: "Timing",
      givenName: "Reminder",
      isPartial: false,
    });
    const timingPersonId = (await timingPersonResponse.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const [localNow] = await sql<{
      readonly local_day: number;
      readonly local_month: number;
      readonly local_year: number;
    }[]>`
      select
        extract(day from current_timestamp at time zone 'America/New_York')::int
          as local_day,
        extract(month from current_timestamp at time zone 'America/New_York')::int
          as local_month,
        extract(year from current_timestamp at time zone 'America/New_York')::int
          as local_year
    `;
    assert(localNow, "member-local reminder date is available");
    const timingDate = async (
      body: Readonly<Record<string, unknown>>,
    ): Promise<DateRecord> => {
      const response = await importantDateRequest(
        owner,
        timingPersonId,
        "POST",
        body,
      );
      const payload = await response.json() as { readonly date: DateRecord };
      assert(response.status === 201, "timing date fixture creates");
      return payload.date;
    };
    const leadBirthday = await timingDate({
      day: localNow.local_day,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: localNow.local_month,
      precision: "month_day",
    });
    const [leadProof] = await sql<{
      readonly bounded: boolean;
      readonly delivery_future: boolean;
      readonly next_annual: boolean;
    }[]>`
      select
        occurrence.occurs_on <=
          ((occurrence.created_at at time zone 'America/New_York')::date + 1461)
          bounded,
        occurrence.deliver_at >= occurrence.created_at delivery_future,
        occurrence.occurs_on >
          (occurrence.created_at at time zone 'America/New_York')::date
          next_annual
      from crm.reminder_occurrences occurrence
      join crm.reminders reminder on reminder.id = occurrence.reminder_id
      where reminder.person_date_id = ${leadBirthday.id}
        and occurrence.member_id = ${owner.memberId}
        and occurrence.status = 'pending'
        and occurrence.lead_time_days = 2
    `;
    assert(
      leadProof?.delivery_future && leadProof.next_annual && leadProof.bounded,
      `birthday today with two-day lead chooses the next deliverable annual occurrence: ${
        JSON.stringify(leadProof)
      }`,
    );

    await sql`
      update crm.reminder_rules set days_before = 0
      where workspace_id = ${owner.workspaceId} and is_active
    `;
    await sql`
      update crm.workspace_settings set default_reminder_time = '00:00'::time
      where workspace_id = ${owner.workspaceId}
    `;
    const afterSend = await timingDate({
      day: localNow.local_day,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Same-day after send time",
      month: localNow.local_month,
      precision: "month_day",
    });
    const nextYear = localNow.local_year + 1;
    const marchFirstWeekday = new Date(Date.UTC(nextYear, 2, 1)).getUTCDay();
    const dstStartDay = 1 + ((7 - marchFirstWeekday) % 7) + 7;
    const dstBoundary = await timingDate({
      day: dstStartDay,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "DST boundary",
      month: 3,
      precision: "month_day",
    });
    const [futurityProof] = await sql<{
      readonly bounded: boolean;
      readonly count: number;
      readonly dst_local_midnight: boolean;
      readonly future: boolean;
      readonly same_day_advanced: boolean;
    }[]>`
      select
        bool_and(occurrence.occurs_on <=
          ((occurrence.created_at at time zone 'America/New_York')::date + 1461))
          bounded,
        count(*)::int count,
        bool_and(
          (occurrence.deliver_at at time zone 'America/New_York')::time =
            '00:00'::time
        ) filter (where reminder.person_date_id = ${dstBoundary.id})
          dst_local_midnight,
        bool_and(occurrence.deliver_at >= occurrence.created_at) future,
        bool_and(occurrence.occurs_on >
          (occurrence.created_at at time zone 'America/New_York')::date)
          filter (where reminder.person_date_id = ${afterSend.id})
          same_day_advanced
      from crm.reminder_occurrences occurrence
      join crm.reminders reminder on reminder.id = occurrence.reminder_id
      where reminder.person_id = ${timingPersonId}
        and occurrence.member_id = ${owner.memberId}
        and occurrence.status = 'pending'
    `;
    assert(
      // The lead birthday holds its day-of and two-day notices.
      futurityProof?.count === 4 && futurityProof.future &&
        futurityProof.bounded && futurityProof.same_day_advanced &&
        futurityProof.dst_local_midnight,
      `every pending member occurrence is future, bounded, and timezone-stable across lead, same-day, and DST dates: ${
        JSON.stringify(futurityProof)
      }`,
    );

    const birthdayUpdated = await importantDateRequest(
      owner,
      personId,
      "PATCH",
      {
        expectedUpdatedAt: birthday.updatedAt,
        isAgeBased: true,
        isYearApproximate: true,
        kind: "birthday",
        precision: "year",
        year: 1984,
      },
      birthday.id,
    );
    assert(
      birthdayUpdated.status === 200,
      "schedulable date updates to honest year-only precision",
    );
    const [birthdaySchedule] = await sql<{
      readonly active: boolean;
      readonly pending: number;
    }[]>`
      select reminder.is_active active,
        count(occurrence.id) filter (where occurrence.status = 'pending')::int pending
      from crm.reminders reminder
      left join crm.reminder_occurrences occurrence
        on occurrence.reminder_id = reminder.id
      where reminder.person_date_id = ${birthday.id}
      group by reminder.id
    `;
    assert(
      birthdaySchedule?.active === false && birthdaySchedule.pending === 0,
      "year-only updates remove pending state without inventing a month or day",
    );

    const updatedDeath = await importantDateRequest(
      owner,
      personId,
      "PATCH",
      {
        expectedUpdatedAt: deceased.updatedAt,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "deceased",
        precision: "year",
        year: 2021,
      },
      deceased.id,
    );
    assert(updatedDeath.status === 200, "singleton death date updates");
    const staleDeath = await importantDateRequest(
      owner,
      personId,
      "PATCH",
      {
        expectedUpdatedAt: deceased.updatedAt,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "deceased",
        precision: "year",
        year: 2022,
      },
      deceased.id,
    );
    assert(staleDeath.status === 409, "stale optimistic version is rejected");

    const [annualReminder] = await sql<{ readonly id: string }[]>`
      select id::text from crm.reminders
      where person_date_id = ${annualCustom.id}
    `;
    assert(annualReminder, "annual custom date owns a reminder definition");
    await sql`
      update crm.reminder_occurrences
      set status = 'sent', sent_at = now(),
        provider_receipt = 'people-005-history:' || id::text,
        provider_result_state = 'confirmed', provider_effect_at = now(),
        visible_at = now(), updated_at = now()
      where reminder_id = ${annualReminder.id}
    `;
    const deletedAnnual = await importantDateRequest(
      owner,
      personId,
      "DELETE",
      { expectedUpdatedAt: annualCustom.updatedAt },
      annualCustom.id,
    );
    assert(deletedAnnual.status === 200, "custom date deletes");
    const [history] = await sql<{
      readonly date_absent: boolean;
      readonly definition_detached: boolean;
      readonly sent_count: number;
    }[]>`
      select
        not exists(select 1 from crm.person_dates
          where id = ${annualCustom.id}) date_absent,
        exists(select 1 from crm.reminders
          where id = ${annualReminder.id} and person_date_id is null
            and target_kind = 'person' and not is_active
            and deleted_at is not null) definition_detached,
        (select count(*)::int from crm.reminder_occurrences
          where reminder_id = ${annualReminder.id}
            and status = 'sent') sent_count
    `;
    assert(
      // Both the day-of and the two-day notice were delivered.
      history?.date_absent && history.definition_detached &&
        history.sent_count === 2,
      "delete removes pending state while preserving detached delivered history",
    );

    const [auditProof] = await sql<{
      readonly audit_count: number;
      readonly distinct_subjects: number;
    }[]>`
      select count(*)::int audit_count,
        count(distinct subject_id)::int distinct_subjects
      from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-date-updated'
    `;
    const auditRows = await sql<{
      readonly payload: unknown;
      readonly subject_type: string;
    }[]>`
      select payload, subject_type
      from crm.audit_events
      where person_id = ${personId}
        and action = 'people.person-date-updated'
    `;
    const normalizedAuditRows = auditRows.map((row) => ({
      ...row,
      payload: typeof row.payload === "string"
        ? JSON.parse(row.payload) as Record<string, unknown>
        : row.payload as Record<string, unknown>,
    }));
    const exactAuditRows = normalizedAuditRows.every((row) =>
      row.subject_type === "person_date" &&
      ["create", "delete", "update"].includes(`${row.payload.action}`) &&
      Object.hasOwn(row.payload, "from") && Object.hasOwn(row.payload, "to")
    );
    assert(
      auditProof?.audit_count === 10 && auditProof.distinct_subjects === 7 &&
        exactAuditRows,
      `each successful date effect has exactly one typed governance audit: ${
        JSON.stringify({ auditProof, normalizedAuditRows })
      }`,
    );

    const person = await (await getPerson(owner, personId)).json() as {
      readonly person: { readonly updatedAt: string };
    };
    const archived = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/archive`,
      {
        body: JSON.stringify({ expectedUpdatedAt: person.person.updatedAt }),
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
          origin: "http://localhost",
          "X-Workspace-Id": owner.workspaceId,
        },
        method: "POST",
      },
    );
    assert(archived.status === 200, "person archives for lifecycle proof");
    const archivedWrite = await importantDateRequest(
      owner,
      personId,
      "POST",
      {
        isAgeBased: false,
        isYearApproximate: false,
        kind: "custom",
        label: "Must not persist",
        precision: "unknown",
      },
    );
    const archivedList = await importantDateRequest(owner, personId, "GET");
    const archivedListBody = await archivedList.json() as {
      readonly status: string;
    };
    assert(
      archivedWrite.status === 409 && archivedList.status === 200 &&
        archivedListBody.status === "archived",
      "archived lifecycle is revalidated under lock and remains readable",
    );
  },
});

Deno.test({
  name: "PEOPLE-001 PostgreSQL dates resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
