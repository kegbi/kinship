/**
 * SECA-03 (AUD-M3): an invitation cannot be used to relay mail.
 *
 * A workspace may send a bounded number of invitations a day, an address may
 * be invited a bounded number of times a day across every workspace, and only
 * an inviter whose address has been verified for a day may send any. Each
 * refusal is a documented problem that sends nothing and writes no
 * invitation, and the per-recipient refusal reads the same whether or not the
 * address has an account. Every budget is durable: it is the attempt-budget
 * table, so it holds across processes and restarts.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { PostgresOutboundMailBudget } from "../../packages/backend/modules/api-access/adapters/postgres/outbound_mail_budget.ts";
import { AuthenticationSubjectDigester } from "../../packages/backend/modules/api-access/public.ts";
import type { MailBudgetReservation } from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import { apiSupport, ORIGIN, originHeaders } from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 3, prepare: false });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
);
const api = apiSupport(configured.app, mail, sql);

/** The documented limits (`configuration-and-secrets.md`). */
const WORKSPACE_DAILY_QUOTA = 20;
const RECIPIENT_DAILY_CAP = 3;

interface Owner {
  readonly cookie: string;
  readonly workspaceId: string;
}

/** An owner whose address was verified long enough ago to invite. */
async function establishedOwner(email: string, name: string): Promise<Owner> {
  const owner = await api.register(email, name);
  await sql`
    update crm.users set email_verified_at = now() - interval '25 hours'
    where email = ${email}
  `;
  return owner;
}

async function invite(owner: Owner, email: string): Promise<Response> {
  return await configured.app.request(
    `${ORIGIN}/api/v1/workspace-invitations`,
    {
      body: JSON.stringify({ email, role: "member" }),
      headers: {
        ...originHeaders,
        cookie: owner.cookie,
        "X-Workspace-Id": owner.workspaceId,
      },
      method: "POST",
    },
  );
}

async function invitationRows(email: string): Promise<number> {
  const [row] = await sql<{ readonly count: number }[]>`
    select count(*)::int count from crm.workspace_invitations
    where email = ${email}
  `;
  return row?.count ?? 0;
}

Deno.test({
  name:
    "[AUD-M3] SECA-03 an invitation over the workspace's daily quota is refused with a problem and sends no mail",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await establishedOwner(
      "quota-owner@example.test",
      "Security alert: sign in at https://kinship-login.evil.example now",
    );
    for (let index = 0; index < WORKSPACE_DAILY_QUOTA; index += 1) {
      const email = `quota-${index}@example.test`;
      const created = await invite(owner, email);
      assert(
        created.status === 201,
        `invitation ${index + 1} is within the quota, got ${created.status}`,
      );
      await created.body?.cancel();
      assert(mail.latestInvitationToken(email), `invitation ${index} is sent`);
    }

    const over = "quota-over@example.test";
    const refused = await invite(owner, over);
    const body = await refused.json() as {
      readonly code?: string;
      readonly status?: number;
    };
    assert(
      refused.status === 429 && body.status === 429 &&
        body.code === "invitation_limit_reached" &&
        (refused.headers.get("content-type") ?? "").includes(
          "application/problem+json",
        ),
      `the invitation over the quota is a problem, got ${refused.status} ${
        JSON.stringify(body)
      }`,
    );
    assert(
      mail.latestInvitationToken(over) === undefined,
      "the refused invitation sends no mail",
    );
    assert(
      await invitationRows(over) === 0,
      "the refused invitation writes no invitation",
    );

    // The quota is a rolling day: once the earliest invitations are a day
    // old, the workspace may invite again.
    await sql`
      update crm.api_request_logs
      set occurred_at = occurred_at - interval '25 hours',
        created_at = created_at - interval '25 hours'
      where workspace_id = ${owner.workspaceId}::uuid
    `;
    const later = await invite(owner, over);
    assert(later.status === 201, "the next day's invitation is admitted");
    await later.body?.cancel();
    assert(mail.latestInvitationToken(over), "and is sent");
  },
});

Deno.test({
  name:
    "[AUD-M3] SECA-03 a recipient's daily cap holds across workspaces and answers alike whether or not the address has an account",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owners: Owner[] = [];
    for (let index = 0; index <= RECIPIENT_DAILY_CAP; index += 1) {
      owners.push(
        await establishedOwner(
          `cap-owner-${index}@example.test`,
          `Cap circle ${index}`,
        ),
      );
    }
    const fresh = "cap-fresh@example.test";
    const registered = "cap-registered@example.test";
    await api.register(registered, "Registered circle");

    const answers: string[] = [];
    for (const recipient of [fresh, registered]) {
      for (const owner of owners.slice(0, RECIPIENT_DAILY_CAP)) {
        const created = await invite(owner, recipient);
        assert(
          created.status === 201,
          `${recipient} may be invited ${RECIPIENT_DAILY_CAP} times a day, got ${created.status}`,
        );
        await created.body?.cancel();
      }
      const sentBefore = mail.latestInvitationToken(recipient);
      const rowsBefore = await invitationRows(recipient);
      const refused = await invite(owners[RECIPIENT_DAILY_CAP]!, recipient);
      answers.push(`${refused.status} ${await refused.text()}`);
      assert(
        mail.latestInvitationToken(recipient) === sentBefore &&
          await invitationRows(recipient) === rowsBefore,
        `the capped invitation to ${recipient} sends and writes nothing`,
      );
    }
    assert(
      answers[0]?.startsWith("429 ") && answers[0] === answers[1],
      `a fresh and a registered recipient are refused alike, got ${
        JSON.stringify(answers)
      }`,
    );
    assert(
      answers[0]?.includes('"code":"invitation_limit_reached"') === true,
      "the cap answers the documented problem",
    );
  },
});

Deno.test({
  name:
    "[AUD-M3] SECA-03 an inviter whose address was verified less than a day ago cannot invite",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const email = "new-owner@example.test";
    const owner = await api.register(email, "Brand new circle");
    const recipient = "too-early@example.test";
    const refused = await invite(owner, recipient);
    const body = await refused.json() as { readonly code?: string };
    assert(
      refused.status === 403 && body.code === "inviter_not_established",
      `a just-verified inviter is refused, got ${refused.status} ${
        JSON.stringify(body)
      }`,
    );
    assert(
      mail.latestInvitationToken(recipient) === undefined &&
        await invitationRows(recipient) === 0,
      "the refusal sends and writes nothing",
    );
    const [budget] = await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.api_request_logs
      where workspace_id = ${owner.workspaceId}::uuid
    `;
    assert(budget?.count === 0, "the refusal spends none of the quota");

    await sql`
      update crm.users set email_verified_at = now() - interval '23 hours'
      where email = ${email}
    `;
    const early = await invite(owner, recipient);
    assert(early.status === 403, "23 hours is not yet a day");
    await early.body?.cancel();
    await sql`
      update crm.users set email_verified_at = now() - interval '25 hours'
      where email = ${email}
    `;
    const admitted = await invite(owner, recipient);
    assert(admitted.status === 201, "a day-old verification may invite");
    await admitted.body?.cancel();
    assert(mail.latestInvitationToken(recipient), "and the invitation is sent");
  },
});

Deno.test({
  name:
    "[AUD-M3] concurrent mail-budget reservations never pass a ceiling, for one recipient or one workspace",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const ceiling = 4;
    const connection = connectDatabase(databaseUrl);
    try {
      const budget = new PostgresOutboundMailBudget(
        connection.db,
        new AuthenticationSubjectDigester({
          activeVersion: 1,
          keys: new Map([[1, new Uint8Array(32).fill(0x6d)]]),
        }),
      );
      const owner = await establishedOwner(
        "race-owner@example.test",
        "Race circle",
      );
      const [member] = await sql<
        { readonly memberId: string; readonly userId: string }[]
      >`
        select m.id "memberId", m.user_id "userId"
        from crm.workspace_members m
        where m.workspace_id = ${owner.workspaceId}::uuid
      `;
      assert(member, "the owner is a member");
      const occurredAt = new Date();
      const race = async (
        reservations: readonly MailBudgetReservation[],
        path: string,
      ) => {
        const rows = async () => {
          const [row] = await sql<{ readonly count: number }[]>`
            select count(*)::int count from crm.api_request_logs
            where path = ${path}
          `;
          return row?.count ?? 0;
        };
        const before = await rows();
        const results = await Promise.all(
          reservations.map((reservation) => budget.reserve(reservation)),
        );
        return {
          admitted: results.filter((result) => result === "admitted").length,
          rows: await rows() - before,
        };
      };

      const recipient = await race(
        Array.from({ length: 2 * ceiling }, () => ({
          occurredAt,
          recipient: "Race-Recipient@example.test",
          recipientCeiling: ceiling,
          scope: "registration" as const,
          windowMilliseconds: 86_400_000,
        })),
        "mail-budget/registration",
      );
      assert(
        recipient.admitted === ceiling && recipient.rows === ceiling,
        `one recipient's ceiling holds under a race: ${
          JSON.stringify(recipient)
        }`,
      );

      const workspace = await race(
        Array.from({ length: 2 * ceiling }, (_, index) => ({
          occurredAt,
          recipient: `race-${index}@example.test`,
          recipientCeiling: 2 * ceiling,
          scope: "invitation" as const,
          sender: {
            ceiling,
            memberId: member.memberId,
            userId: member.userId,
            workspaceId: owner.workspaceId,
          },
          windowMilliseconds: 86_400_000,
        })),
        "mail-budget/invitation",
      );
      assert(
        workspace.admitted === ceiling && workspace.rows === ceiling,
        `one workspace's quota holds under a race: ${
          JSON.stringify(workspace)
        }`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name: "AUD-M3 invitation relay PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([sql.end({ timeout: 1 }), configured.close()]);
  },
});
