import { describeGiftEvent } from "./audit_events.ts";
import {
  createGiftManagement,
  type GiftManagementDependencies,
  type GiftRepository,
  type StoredDebt,
  type StoredGift,
} from "../public.ts";
import { assertEquals } from "../../../testing/assert.ts";
import {
  fixedClock,
  recordingAudit,
  sequentialIds,
} from "../../../testing/fakes.ts";

const actor = {
  memberId: "10000000-0000-4000-8000-000000000001",
  role: "member" as const,
  userId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000003",
};
const personId = "10000000-0000-4000-8000-000000000004";
const recipientPersonId = "10000000-0000-4000-8000-000000000005";
const fileId = "10000000-0000-4000-8000-000000000006";

function fixture(
  options: {
    readonly attachmentDisappears?: boolean;
    readonly list?: GiftRepository["list"];
  } = {},
) {
  const gifts = new Map<string, StoredGift>();
  const debts = new Map<string, StoredDebt>();
  const attachments: string[] = [];
  const audit = recordingAudit<{
    readonly action: string;
    readonly recordType: string;
  }>();
  let attachmentListingAvailable = true;
  const dependencies: GiftManagementDependencies = {
    actors: { revalidate: () => Promise.resolve("active" as const) },
    attachments: {
      attachToGift: (command) => {
        if (command.fileId !== fileId || options.attachmentDisappears) {
          return Promise.resolve({ status: "not-found" });
        }
        attachments.push(`${command.giftId}:${command.fileId}`);
        return Promise.resolve({ status: "attached" });
      },
      validateForGift: (command) =>
        Promise.resolve({
          status: command.fileId === fileId ? "ready" : "not-found",
        }),
      listForGifts: (command) =>
        Promise.resolve(
          attachmentListingAvailable
            ? {
              links: attachments.flatMap((value) => {
                const [giftId, linkedFileId] = value.split(":");
                return giftId && linkedFileId &&
                    command.giftIds.includes(giftId)
                  ? [{ fileId: linkedFileId, giftId }]
                  : [];
              }),
              status: "ready" as const,
            }
            : { status: "forbidden" as const },
        ),
    },
    audit,
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    currencies: {
      isSupported: ({ code }) => Promise.resolve(code === "EUR"),
      listSupported: () => Promise.resolve(["EUR", "USD"]),
    },
    ids: sequentialIds({ prefix: "10000000-0000-4000-8000-", start: 7 }),
    repository: {
      createDebt: (command) => {
        const debt: StoredDebt = {
          amount: command.amount,
          createdAt: command.occurredAt.toISOString(),
          ...(command.currencyCode
            ? { currencyCode: command.currencyCode }
            : {}),
          direction: command.direction,
          id: command.id,
          personId: command.personId,
          ...(command.reason ? { reason: command.reason } : {}),
          ...(command.settledAt
            ? { settledAt: command.settledAt.toISOString() }
            : {}),
          status: command.status,
          updatedAt: command.occurredAt.toISOString(),
        };
        debts.set(debt.id, debt);
        return Promise.resolve({ debt, status: "created" });
      },
      createGift: (command) => {
        const gift: StoredGift = {
          ...(command.amount ? { amount: command.amount } : {}),
          ...(command.comment ? { comment: command.comment } : {}),
          createdAt: command.occurredAt.toISOString(),
          ...(command.currencyCode
            ? { currencyCode: command.currencyCode }
            : {}),
          ...(command.eventAt ? { eventAt: command.eventAt } : {}),
          id: command.id,
          name: command.name,
          personId: command.personId,
          ...(command.recipientPersonId
            ? { recipientPersonId: command.recipientPersonId }
            : {}),
          status: command.status,
          updatedAt: command.occurredAt.toISOString(),
          ...(command.url ? { url: command.url } : {}),
        };
        gifts.set(gift.id, gift);
        return Promise.resolve({ gift, status: "created" });
      },
      findDebt: (command) => {
        const debt = debts.get(command.id);
        return Promise.resolve(
          debt ? { debt, status: "found" } : { status: "not-found" },
        );
      },
      findGift: (command) => {
        const gift = gifts.get(command.id);
        return Promise.resolve(
          gift ? { gift, status: "found" } : { status: "not-found" },
        );
      },
      list: options.list ?? (() =>
        Promise.resolve({
          debts: [...debts.values()],
          gifts: [...gifts.values()],
          status: "ready",
        })),
      saveDebt: (command) => {
        const current = debts.get(command.id)!;
        const debt = {
          ...current,
          ...(command.settledAt
            ? { settledAt: command.settledAt.toISOString() }
            : {}),
          status: command.status,
          updatedAt: command.occurredAt.toISOString(),
        };
        debts.set(debt.id, debt);
        return Promise.resolve({ debt, status: "saved" });
      },
      saveGift: (command) => {
        const current = gifts.get(command.id)!;
        const gift = {
          ...current,
          status: command.status,
          updatedAt: command.occurredAt.toISOString(),
        };
        gifts.set(gift.id, gift);
        return Promise.resolve({ gift, status: "saved" });
      },
    },
    transaction: {
      run: async (work) => {
        const giftsBefore = new Map(gifts);
        const debtsBefore = new Map(debts);
        try {
          return await work({} as never);
        } catch (error) {
          gifts.clear();
          debts.clear();
          for (const [id, gift] of giftsBefore) gifts.set(id, gift);
          for (const [id, debt] of debtsBefore) debts.set(id, debt);
          throw error;
        }
      },
    },
  };
  return {
    attachments,
    audit,
    management: createGiftManagement(dependencies),
    setAttachmentListingAvailable: (available: boolean) => {
      attachmentListingAvailable = available;
    },
  };
}

Deno.test("GIFTS-001 conceals an attachment removed between validation and linking", async () => {
  const { management } = fixture({ attachmentDisappears: true });

  assertEquals(
    await management.createGift(actor, personId, {
      attachmentFileId: fileId,
      name: "Race-safe gift",
      status: "planned",
    }),
    { status: "not-found" },
  );
  assertEquals(await management.list(actor, personId), {
    debts: [],
    gifts: [],
    status: "ready",
    supportedCurrencyCodes: ["EUR", "USD"],
  });
});

Deno.test("GIFTS-001 rolls back a transition when final attachment hydration is forbidden", async () => {
  const { management, setAttachmentListingAvailable } = fixture();
  const created = await management.createGift(actor, personId, {
    attachmentFileId: fileId,
    name: "Protected attachment",
    status: "planned",
  });
  if (created.status !== "created") throw new Error("gift expected");

  setAttachmentListingAvailable(false);
  assertEquals(
    await management.changeGiftStatus(
      actor,
      personId,
      created.gift.id,
      "given",
    ),
    { status: "forbidden" },
  );
  setAttachmentListingAvailable(true);
  const records = await management.list(actor, personId);
  if (records.status !== "ready") throw new Error("gift list expected");
  assertEquals(records.gifts[0], created.gift);
});

Deno.test("GIFTS-001 manages gift ideas, attachments, and debts with guarded transitions", async () => {
  const { attachments, audit, management } = fixture();

  const idea = await management.createGift(actor, personId, {
    name: "  Train tickets  ",
    status: "idea",
  });
  assertEquals(idea.status, "created");
  if (idea.status !== "created") return;
  assertEquals(idea.gift.amount, undefined);
  assertEquals(idea.gift.recipientPersonId, undefined);

  const attached = await management.createGift(actor, personId, {
    attachmentFileId: fileId,
    name: "Photo book",
    recipientPersonId,
    status: "planned",
  });
  assertEquals(attached.status, "created");
  if (attached.status === "created") {
    assertEquals(attached.gift.attachmentFileId, fileId);
    assertEquals(
      await management.changeGiftStatus(
        actor,
        personId,
        attached.gift.id,
        "given",
      ),
      {
        gift: {
          ...attached.gift,
          status: "given",
          updatedAt: "2026-08-23T10:00:00.000Z",
        },
        status: "saved",
      },
    );
  }
  assertEquals(attachments.length, 1);

  assertEquals(
    await management.changeGiftStatus(actor, personId, idea.gift.id, "given"),
    {
      gift: {
        ...idea.gift,
        status: "given",
        updatedAt: "2026-08-23T10:00:00.000Z",
      },
      status: "saved",
    },
  );
  assertEquals(
    await management.changeGiftStatus(actor, personId, idea.gift.id, "idea"),
    { status: "invalid-transition" },
  );

  const debt = await management.createDebt(actor, personId, {
    amount: "24.5000",
    currencyCode: "eur",
    direction: "they_owe",
    reason: "Lunch",
    status: "open",
  });
  assertEquals(debt.status, "created");
  if (debt.status !== "created") return;
  assertEquals(debt.debt.currencyCode, "EUR");
  assertEquals(
    (await management.changeDebtStatus(
      actor,
      personId,
      debt.debt.id,
      "settled",
    )).status,
    "saved",
  );
  assertEquals(
    audit.commands.map((command) => `${command.recordType}:${command.action}`),
    [
      "gift:created",
      "gift:created",
      "gift:changed",
      "gift:changed",
      "debt:created",
      "debt:changed",
    ],
  );
});

Deno.test("GIFTS-001 rejects a missing attachment without saving the gift", async () => {
  const { management } = fixture();
  assertEquals(
    await management.createGift(actor, personId, {
      attachmentFileId: "10000000-0000-4000-8000-000000000099",
      name: "Missing photo",
      status: "idea",
    }),
    { status: "not-found" },
  );
  assertEquals(await management.list(actor, personId), {
    debts: [],
    gifts: [],
    status: "ready",
    supportedCurrencyCodes: ["EUR", "USD"],
  });
});

Deno.test("GIFTS-001 validates money, currency, event time, and terminal transitions", async () => {
  const { management } = fixture();
  assertEquals(
    await management.createGift(actor, personId, { name: " ", status: "idea" }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createGift(actor, personId, {
      amount: "-1",
      currencyCode: "EUR",
      name: "Bad",
      status: "idea",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createGift(actor, personId, {
      amount: "1",
      name: "No currency",
      status: "idea",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createGift(actor, personId, {
      currencyCode: "EU",
      name: "Bad currency",
      status: "idea",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createGift(actor, personId, {
      amount: "1",
      currencyCode: "USD",
      name: "Inactive currency",
      status: "idea",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createGift(actor, personId, {
      eventAt: "not-a-date",
      name: "Bad date",
      status: "idea",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createDebt(actor, personId, {
      amount: "bad",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "open",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createDebt(actor, personId, {
      amount: "2",
      currencyCode: "USD",
      direction: "i_owe",
      status: "open",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.createDebt(actor, personId, {
      amount: "2",
      direction: "i_owe",
      status: "open",
    } as never),
    { status: "validation-error" },
  );

  const gift = await management.createGift(actor, personId, {
    name: "Book",
    status: "archived",
  });
  if (gift.status !== "created") throw new Error("gift expected");
  assertEquals(
    await management.changeGiftStatus(
      actor,
      personId,
      gift.gift.id,
      "archived",
    ),
    { gift: gift.gift, status: "unchanged" },
  );
  assertEquals(
    await management.changeGiftStatus(actor, personId, gift.gift.id, "planned"),
    { status: "invalid-transition" },
  );
  const debt = await management.createDebt(actor, personId, {
    amount: "2",
    currencyCode: "EUR",
    direction: "i_owe",
    status: "cancelled",
  });
  if (debt.status !== "created") throw new Error("debt expected");
  assertEquals(
    await management.changeDebtStatus(
      actor,
      personId,
      debt.debt.id,
      "cancelled",
    ),
    { debt: debt.debt, status: "unchanged" },
  );
  assertEquals(
    await management.changeDebtStatus(actor, personId, debt.debt.id, "open"),
    { status: "invalid-transition" },
  );
});

Deno.test("GIFTS-001 contains transaction failures as unavailable", async () => {
  const { management } = fixture();
  const unavailable = createGiftManagement({
    ...({} as GiftManagementDependencies),
    actors: { revalidate: () => Promise.resolve("active" as const) },
    attachments: {} as never,
    audit: {} as never,
    clock: { now: () => new Date() },
    currencies: {} as never,
    ids: { next: () => crypto.randomUUID() },
    repository: {} as never,
    transaction: { run: () => Promise.reject(new Error("offline")) },
  });
  assertEquals(await unavailable.list(actor, personId), {
    status: "unavailable",
  });
  assertEquals(
    await unavailable.createGift(actor, personId, {
      name: "Book",
      status: "idea",
    }),
    { status: "unavailable" },
  );
  assertEquals(
    await unavailable.createDebt(actor, personId, {
      amount: "2",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "open",
    }),
    { status: "unavailable" },
  );
  const id = crypto.randomUUID();
  assertEquals(
    await unavailable.changeGiftStatus(actor, personId, id, "given"),
    { status: "unavailable" },
  );
  assertEquals(
    await unavailable.changeDebtStatus(actor, personId, id, "settled"),
    { status: "unavailable" },
  );
  assertEquals((await management.list(actor, personId)).status, "ready");
});

Deno.test("GIFTS-006 the gift event pins the row governance writes", () => {
  const event = describeGiftEvent({
    action: "changed",
    actor,
    occurredAt: new Date("2026-09-16T08:30:00.000Z"),
    record: {
      createdAt: "2026-09-01T00:00:00.000Z",
      id: "10000000-0000-4000-8000-000000000007",
      name: "Field guide",
      personId,
      status: "given",
      updatedAt: "2026-09-16T08:30:00.000Z",
    },
    recordType: "gift",
    transaction: { opaque: "gift-describe" },
  });
  assertEquals(event, {
    action: "gifts.gift-created-or-state-changed",
    actorMemberId: actor.memberId,
    occurredAt: new Date("2026-09-16T08:30:00.000Z"),
    payload: { action: "changed", personId, status: "given" },
    personId,
    subjectId: "10000000-0000-4000-8000-000000000007",
    subjectType: "gift",
    visibleOnDashboard: true,
    workspaceId: actor.workspaceId,
  });
});

Deno.test("[GAP-023] gifts and debts page independently behind bound cursors", async () => {
  const anchor = {
    id: "10000000-0000-4000-8000-0000000000aa",
    updatedAt: "2026-08-23T10:00:00.000000Z",
  };
  const asked: string[] = [];
  const { management } = fixture({
    list: (command) => {
      asked.push(
        `${command.giftAfter?.id ?? "-"} ${
          command.debtAfter?.id ?? "-"
        } ${command.limit}`,
      );
      return Promise.resolve({
        debts: [],
        gifts: [],
        ...(command.debtAfter ? {} : { nextDebt: anchor }),
        ...(command.giftAfter ? {} : { nextGift: anchor }),
        status: "ready",
      });
    },
  });
  const first = await management.list(actor, personId);
  if (
    first.status !== "ready" || !first.nextGiftCursor || !first.nextDebtCursor
  ) throw new Error("both collections should publish a continuation");
  const gifts = await management.list(actor, personId, {
    giftCursor: first.nextGiftCursor,
    limit: 500,
  });
  assertEquals(
    gifts.status === "ready" &&
      [gifts.nextGiftCursor === undefined, gifts.nextDebtCursor !== undefined],
    [true, true],
  );
  const debts = await management.list(actor, personId, {
    debtCursor: first.nextDebtCursor,
    limit: 3,
  });
  assertEquals(debts.status, "ready");
  for (
    const [who, subject, input] of [
      [actor, personId, { giftCursor: first.nextDebtCursor }],
      [actor, personId, { debtCursor: first.nextGiftCursor }],
      [actor, personId, { giftCursor: "forged" }],
      [actor, recipientPersonId, { giftCursor: first.nextGiftCursor }],
      [
        { ...actor, workspaceId: "10000000-0000-4000-8000-0000000000ff" },
        personId,
        { debtCursor: first.nextDebtCursor },
      ],
    ] as const
  ) {
    assertEquals(await management.list(who, subject, input), {
      status: "validation-error",
    });
  }
  assertEquals(asked, [
    "- - 20",
    `${anchor.id} - 50`,
    `- ${anchor.id} 3`,
  ]);
});
