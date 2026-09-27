import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import type {
  PersonAvatarImages,
  PersonAvatarRepository,
  PersonAvatarState,
} from "../ports/avatar.ts";
import type { PersonAvatarAudit } from "../ports/audit.ts";
import type { PeopleTransaction } from "../ports/context.ts";
import { createPersonAvatarManagement } from "./person_avatar.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();
const png = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  filename: "ada.png",
  mimeType: "image/png",
};

type StoreAnswer = Awaited<ReturnType<PersonAvatarImages["store"]>>;

/** One person's avatar row, with the transaction rolling it back on a throw. */
function context(
  options: {
    readonly archived?: boolean;
    /** Archive the person while the image is being stored. */
    readonly archiveWhileStoring?: boolean;
    readonly avatar?: PersonAvatarState;
    readonly exists?: boolean;
    readonly revalidation?: "active" | "revoked";
    readonly store?: StoreAnswer | "throws";
    readonly throwOnAudit?: boolean;
  } = {},
) {
  let avatar: PersonAvatarState = options.avatar ??
    { backgroundColor: "#b3d5fe", source: "default" };
  let archived = options.archived ?? false;
  const stored: string[] = [];
  const discarded: string[] = [];
  const audited: string[] = [];
  const events: string[] = [];
  let next = 0;
  const images: PersonAvatarImages = {
    store: () => {
      events.push("store");
      if (options.archiveWhileStoring) archived = true;
      if (options.store === "throws") {
        return Promise.reject(new Error("object store down"));
      }
      if (options.store) return Promise.resolve(options.store);
      const fileId = fixtures.uuid(500 + ++next);
      stored.push(fileId);
      return Promise.resolve({ fileId, status: "available" });
    },
    discard: (command) => {
      discarded.push(command.fileId);
      return Promise.resolve();
    },
  };
  const repository: PersonAvatarRepository = {
    lock: () => {
      events.push("lock");
      return Promise.resolve(
        options.exists === false
          ? { status: "not-found" }
          : { archived, avatar, status: "ready" },
      );
    },
    save: (command) => {
      avatar = command.fileId
        ? { ...avatar, fileId: command.fileId, source: "file" }
        : {
          ...(avatar.backgroundColor
            ? { backgroundColor: avatar.backgroundColor }
            : {}),
          source: "default",
        };
      return Promise.resolve(avatar);
    },
  };
  const audit: PersonAvatarAudit = {
    record: (command) => {
      if (options.throwOnAudit) throw new Error("audit failed");
      audited.push(command.action);
      return Promise.resolve(fixtures.uuid(900));
    },
  };
  const management = createPersonAvatarManagement({
    actors: {
      revalidate: () => Promise.resolve(options.revalidation ?? "active"),
    },
    audit,
    clock: fixedClock("2026-09-27T10:00:00.000Z"),
    images,
    repository,
    transaction: {
      run: async <T>(work: (transaction: PeopleTransaction) => Promise<T>) => {
        const before = avatar;
        try {
          return await work({ opaque: "transaction" });
        } catch (error) {
          avatar = before;
          throw error;
        }
      },
    },
  });
  return {
    audited,
    avatar: () => avatar,
    discarded,
    events,
    management,
    stored,
  };
}

Deno.test("[PEOPLE-007] an uploaded image becomes the avatar and the colour stays", async () => {
  const subject = context();
  const result = await subject.management.replace(actor, personId, png);
  assertEquals(result, {
    avatar: { backgroundColor: "#b3d5fe", fileId: subject.stored[0]! },
    status: "updated",
  });
  assertEquals(subject.audited, ["updated"]);
  assertEquals(subject.discarded, [], "nothing to discard the first time");
});

Deno.test("[PEOPLE-007] a replacement discards the image it replaced", async () => {
  const previous = fixtures.uuid(400);
  const subject = context({ avatar: { fileId: previous, source: "file" } });
  const result = await subject.management.replace(actor, personId, png);
  assertEquals(result.status, "updated");
  assertEquals(subject.avatar().fileId, subject.stored[0]);
  assertEquals(subject.discarded, [previous], "the old image is removed");
});

Deno.test("[PEOPLE-007] removing resets the person to their initials", async () => {
  const previous = fixtures.uuid(400);
  const subject = context({
    avatar: { backgroundColor: "#abcdef", fileId: previous, source: "file" },
  });
  const result = await subject.management.remove(actor, personId);
  assertEquals(result, {
    avatar: { backgroundColor: "#abcdef" },
    status: "removed",
  });
  assertEquals(subject.avatar().source, "default");
  assertEquals(subject.discarded, [previous]);
  assertEquals(subject.audited, ["removed"]);

  const again = await subject.management.remove(actor, personId);
  assertEquals(again.status, "removed", "removing twice is idempotent");
  assertEquals(
    subject.audited,
    ["removed"],
    "an unchanged avatar is not audited",
  );
});

Deno.test("[PEOPLE-007] an archived person is read-only before any bytes move", async () => {
  const subject = context({ archived: true });
  assertEquals(
    (await subject.management.replace(actor, personId, png)).status,
    "archived-write-rejected",
  );
  assertEquals(
    (await subject.management.remove(actor, personId)).status,
    "archived-write-rejected",
  );
  assertEquals(subject.events.includes("store"), false, "no image stored");
});

Deno.test("[PEOPLE-007] a person archived while the image uploads keeps their avatar", async () => {
  const subject = context({ archiveWhileStoring: true });
  const replaced = await subject.management.replace(actor, personId, png);
  assertEquals(replaced.status, "archived-write-rejected");
  assertEquals(subject.stored.length, 1, "the image had been stored");
  assertEquals(subject.avatar().source, "default", "the avatar is unchanged");
  assertEquals(subject.discarded, subject.stored, "the stored image goes");
});

Deno.test("[PEOPLE-007] refusals pass through and store nothing linked", async () => {
  for (
    const status of [
      "rejected-media",
      "storage-limit",
      "validation-error",
    ] as const
  ) {
    const subject = context({ store: { status } });
    assertEquals(
      (await subject.management.replace(actor, personId, png)).status,
      status,
    );
    assertEquals(subject.audited, []);
  }
  const quarantined = context({
    store: { fileId: fixtures.uuid(600), status: "quarantined" },
  });
  assertEquals(
    (await quarantined.management.replace(actor, personId, png)).status,
    "quarantined",
  );
  assertEquals(
    quarantined.avatar().source,
    "default",
    "a quarantined image is kept for review and never linked",
  );
  assertEquals(quarantined.discarded, [], "an administrator reviews it");
  const down = context({ store: "throws" });
  assertEquals(
    (await down.management.replace(actor, personId, png)).status,
    "unavailable",
  );
});

Deno.test("[PEOPLE-007] an inactive member and an unknown person are refused", async () => {
  const inactive = context({ revalidation: "revoked" });
  assertEquals(
    (await inactive.management.replace(actor, personId, png)).status,
    "forbidden",
  );
  assertEquals(
    (await inactive.management.remove(actor, personId)).status,
    "forbidden",
  );
  const missing = context({ exists: false });
  assertEquals(
    (await missing.management.replace(actor, personId, png)).status,
    "not-found",
  );
  assertEquals(
    (await missing.management.remove(actor, personId)).status,
    "not-found",
  );
});

Deno.test("[PEOPLE-007] a link that fails rolls back and discards the new image", async () => {
  const previous = fixtures.uuid(400);
  const subject = context({
    avatar: { fileId: previous, source: "file" },
    throwOnAudit: true,
  });
  assertEquals(
    (await subject.management.replace(actor, personId, png)).status,
    "unavailable",
  );
  assertEquals(subject.avatar().fileId, previous, "the old avatar stays");
  assertEquals(subject.discarded, subject.stored, "only the new image goes");
  assertEquals(
    (await subject.management.remove(actor, personId)).status,
    "unavailable",
  );
  assertEquals(subject.avatar().fileId, previous);
});
