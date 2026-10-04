import { personBoundary } from "../../packages/backend/modules/people/composition.ts";
/**
 * A person's avatar against PostgreSQL and an object store (GAP-045,
 * PEOPLE-007): the upload is the files module's `avatar` kind, the link is
 * people's `person_avatars` row, every reader draws the same descriptor, and
 * an image whose bytes went missing falls back to the initials.
 *
 * The last suites follow an avatar image to its end (REL-056, REL-063): only
 * the avatar route removes one, an image held for review goes with the
 * avatar, a replacement that could not be linked is discarded whatever
 * happened to the person or the member meanwhile, and a merge discards the
 * duplicate's image when the primary keeps its own. An upload refused after
 * its bytes were stored takes its reservation away again (REL-082).
 */

import {
  avatarImages,
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { composeFiles } from "../../packages/backend/modules/files/composition.ts";
import type { ObjectStorage } from "../../packages/backend/modules/files/public.ts";
import { giftAttachmentTarget } from "../../packages/backend/modules/gifts/composition.ts";
import { governanceAuditRecorder } from "../../packages/backend/modules/governance/composition.ts";
import { PostgresPersonAvatarRepository } from "../../packages/backend/modules/people/adapters/postgres/person_avatar_repository.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
import {
  createPersonAvatarManagement,
  personAvatarAuditFrom,
} from "../../packages/backend/modules/people/public.ts";
import {
  activeWorkspaceResolver,
  workspaceActors,
  workspaceTransactionRunner,
} from "../../packages/backend/modules/workspaces/composition.ts";
import type { SharedComposition } from "../../packages/backend/platform/composition.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, ORIGIN, type SignedInFixture } from "../support/api.ts";
import { createPerson } from "../support/fixtures.ts";
import { silentLogger } from "../../packages/backend/shared-kernel/telemetry.ts";

class CapturedObjectStorage implements ObjectStorage {
  readonly bucket = "captured-avatars";
  readonly objects = new Map<string, Uint8Array>();
  readonly provider = "captured";
  failRemove = false;

  get(command: { readonly key: string }): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.objects.get(command.key));
  }
  health(): Promise<"available"> {
    return Promise.resolve("available");
  }
  put(
    command: { readonly bytes: Uint8Array; readonly key: string },
  ): Promise<void> {
    this.objects.set(command.key, command.bytes.slice());
    return Promise.resolve();
  }
  remove(command: { readonly key: string }): Promise<void> {
    if (this.failRemove) {
      return Promise.reject(new Error("object store unavailable"));
    }
    this.objects.delete(command.key);
    return Promise.resolve();
  }
}

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const storage = new CapturedObjectStorage();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
  undefined,
  undefined,
  undefined,
  storage,
);
const api = apiSupport(configured.app, mail, sql);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface AvatarBody {
  readonly avatar?: {
    readonly color: string;
    readonly hasStoredImage?: boolean;
    readonly imageUrl?: string;
  };
  readonly code?: string;
  readonly status?: string;
}

function putAvatar(
  fixture: SignedInFixture,
  personId: string,
  bytes: Uint8Array,
  mimeType = "image/png",
): Promise<Response> {
  return Promise.resolve(configured.app.request(
    `${ORIGIN}/api/v1/people/${personId}/avatar`,
    {
      body: bytes.slice().buffer,
      headers: {
        cookie: fixture.cookie,
        "content-type": mimeType,
        origin: ORIGIN,
        "X-File-Name": encodeURIComponent("ada lovelace.png"),
        "X-Workspace-Id": fixture.workspaceId,
      },
      method: "PUT",
    },
  ));
}

async function profileAvatar(fixture: SignedInFixture, personId: string) {
  const response = await api.request(fixture, `/api/v1/people/${personId}`);
  const body = await response.json() as {
    readonly person: { readonly avatar?: AvatarBody["avatar"] };
  };
  return body.person.avatar;
}

async function directoryAvatar(fixture: SignedInFixture, personId: string) {
  const response = await api.request(fixture, "/api/v1/people?limit=50");
  const body = await response.json() as {
    readonly people: readonly {
      readonly avatar?: AvatarBody["avatar"];
      readonly id: string;
    }[];
  };
  return body.people.find((person) => person.id === personId)?.avatar;
}

async function audits(personId: string): Promise<readonly string[]> {
  const rows = await sql<{ readonly action: string }[]>`
    select action from crm.audit_events
    where person_id = ${personId}::uuid
      and (action like 'people.avatar-%' or action like 'files.file-%')
    order by created_at, action
  `;
  return rows.map((row) => row.action);
}

Deno.test("[PEOPLE-007] an avatar is uploaded, drawn, replaced, and removed through the owning modules", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `avatars-${suffix}@example.test`,
    "Avatars",
  );
  const ada = await createPerson(api, owner, "Ada");

  const before = await profileAvatar(owner, ada);
  assert(
    before !== undefined && before.imageUrl === undefined &&
      /^#[0-9a-f]{6}$/.test(before.color),
    "a person without an avatar is drawn with their initials on a colour",
  );

  const uploaded = await putAvatar(owner, ada, PNG);
  const uploadedBody = await uploaded.json() as AvatarBody;
  assertEquals(uploaded.status, 200, "the avatar is stored");
  const imageUrl = uploadedBody.avatar?.imageUrl;
  assert(imageUrl, "the answer names the image");
  assertEquals(uploadedBody.avatar?.color, before.color, "the colour stays");
  assertEquals((await profileAvatar(owner, ada))?.imageUrl, imageUrl);
  assertEquals((await directoryAvatar(owner, ada))?.imageUrl, imageUrl);

  const [link] = await sql<{
    readonly file_id: string;
    readonly kind: string;
    readonly source: string;
    readonly status: string;
  }[]>`
    select avatar.source, avatar.file_id::text, link.kind, stored.status
    from crm.person_avatars avatar
    join crm.files stored on stored.id = avatar.file_id
    join crm.person_file_links link on link.file_id = stored.id
    where avatar.person_id = ${ada}::uuid
  `;
  assert(
    link?.source === "file" && link.kind === "avatar" &&
      link.status === "available",
    "people links a files-owned avatar-kind file",
  );

  const image = await api.request(owner, imageUrl);
  assertEquals(image.status, 200, "the image is served privately");
  assertEquals(image.headers.get("content-type"), "image/png");
  assertEquals(image.headers.get("cache-control"), "private, no-store");
  assertEquals([...new Uint8Array(await image.arrayBuffer())], [...PNG]);

  const listed = await api.request(owner, `/api/v1/people/${ada}/files`);
  const listedBody = await listed.json() as { readonly files: unknown[] };
  assertEquals(listedBody.files.length, 0, "an avatar is not a listed file");

  const replaced = await putAvatar(
    owner,
    ada,
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    "image/jpeg",
  );
  const replacedBody = await replaced.json() as AvatarBody;
  assertEquals(replaced.status, 200, "the avatar is replaced");
  assert(replacedBody.avatar?.imageUrl !== imageUrl, "with a new image");
  const [old] = await sql<{ readonly status: string }[]>`
    select status from crm.files where id = ${link.file_id}::uuid
  `;
  assertEquals(old?.status, "deleted", "the replaced image is removed");

  const removed = await api.request(
    owner,
    `/api/v1/people/${ada}/avatar`,
    "DELETE",
  );
  const removedBody = await removed.json() as AvatarBody;
  assertEquals(removed.status, 200, "the avatar is removed");
  assertEquals(removedBody.avatar, {
    color: before.color,
    hasStoredImage: false,
  });
  assertEquals((await profileAvatar(owner, ada))?.imageUrl, undefined);
  const actions = await audits(ada);
  assertEquals(
    actions.filter((action) => action === "people.avatar-updated").length,
    2,
    "each replacement is audited by people",
  );
  assertEquals(
    actions.filter((action) => action === "people.avatar-removed").length,
    1,
  );
  assertEquals(
    actions.includes("files.file-read"),
    false,
    "drawing an avatar records no file read",
  );
});

Deno.test("[PEOPLE-007] an image whose bytes went missing falls back to the initials", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `avatar-missing-${suffix}@example.test`,
    "Missing",
  );
  const ada = await createPerson(api, owner, "Ada");
  const uploaded = await putAvatar(owner, ada, PNG);
  const imageUrl = (await uploaded.json() as AvatarBody).avatar?.imageUrl;
  assert(imageUrl, "the avatar is stored");
  const [stored] = await sql<{ readonly storage_key: string }[]>`
    select stored.storage_key from crm.person_avatars avatar
    join crm.files stored on stored.id = avatar.file_id
    where avatar.person_id = ${ada}::uuid
  `;
  assert(stored, "the object has a key");
  storage.objects.delete(stored.storage_key);

  const missing = await api.request(owner, imageUrl);
  assertEquals(missing.status, 410, "the missing object is reported");
  assertEquals(
    (await missing.json() as { readonly code: string }).code,
    "file_missing",
  );
  const profile = await profileAvatar(owner, ada);
  assert(
    profile !== undefined && profile.imageUrl === undefined,
    "the profile falls back to the initials once the bytes are missing",
  );
  assertEquals(
    (await directoryAvatar(owner, ada))?.imageUrl,
    undefined,
    "so does the directory",
  );
});

Deno.test("[PEOPLE-007] refused images, archived people, other workspaces, and removed members change nothing", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `avatar-refused-${suffix}@example.test`,
    "Refused",
  );
  const foreign = await api.register(
    `avatar-foreign-${suffix}@example.test`,
    "Foreign",
  );
  const ada = await createPerson(api, owner, "Ada");

  const pdf = await putAvatar(
    owner,
    ada,
    new Uint8Array([0x25, 0x50]),
    "application/pdf",
  );
  assertEquals(pdf.status, 415, "only an image may be an avatar");
  const huge = await putAvatar(owner, ada, new Uint8Array(1024 * 1024 + 1));
  assertEquals(huge.status, 413, "an avatar past its limit is refused");
  assertEquals(
    (await huge.json() as AvatarBody).code,
    "avatar_too_large",
    "by the avatar's own refusal, not the global cap",
  );
  const disguised = await putAvatar(
    owner,
    ada,
    new TextEncoder().encode("not an image"),
  );
  assertEquals(disguised.status, 423, "a disguised image is quarantined");
  const [held] = await sql<{ readonly count: string }[]>`
    select count(*)::text as count from crm.files stored
    join crm.person_file_links link on link.file_id = stored.id
    where link.person_id = ${ada}::uuid and link.kind = 'avatar'
      and stored.status = 'quarantined'
  `;
  assertEquals(held?.count, "1", "the quarantined image is kept for review");
  const [unlinked] = await sql<{ readonly count: string }[]>`
    select count(*)::text as count from crm.person_avatars
    where person_id = ${ada}::uuid and source = 'file'
  `;
  assertEquals(unlinked?.count, "0", "and never linked as the avatar");

  const crossPut = await putAvatar(foreign, ada, PNG);
  assertEquals(crossPut.status, 404, "another workspace cannot see the person");
  const crossDelete = await api.request(
    foreign,
    `/api/v1/people/${ada}/avatar`,
    "DELETE",
  );
  assertEquals(crossDelete.status, 404);

  const stored = await putAvatar(owner, ada, PNG);
  const imageUrl = (await stored.json() as AvatarBody).avatar?.imageUrl;
  assert(imageUrl, "the owner stores an avatar");
  const crossRead = await api.request(foreign, imageUrl);
  assertEquals(crossRead.status, 404, "nor read its image");

  const person = await api.request(owner, `/api/v1/people/${ada}`);
  const { person: identity } = await person.json() as {
    readonly person: { readonly updatedAt: string };
  };
  const archived = await api.request(
    owner,
    `/api/v1/people/${ada}/archive`,
    "POST",
    {
      expectedUpdatedAt: identity.updatedAt,
    },
  );
  assertEquals(archived.status, 200, "the person is archived");
  assertEquals(
    (await putAvatar(owner, ada, PNG)).status,
    409,
    "archived is read-only",
  );
  assertEquals(
    (await api.request(owner, `/api/v1/people/${ada}/avatar`, "DELETE")).status,
    409,
  );
  assertEquals(
    (await profileAvatar(owner, ada))?.imageUrl,
    imageUrl,
    "an archived person keeps their avatar",
  );

  await revokeMembership(sql, owner.memberId);
  const revoked = await putAvatar(owner, ada, PNG);
  assert(
    revoked.status === 401 || revoked.status === 403,
    `a removed member cannot change an avatar (${revoked.status})`,
  );
});

/** The stored state of one file, and whether its bytes are still kept. */
async function fileState(fileId: string) {
  const [row] = await sql<{
    readonly kind: string | null;
    readonly person_id: string | null;
    readonly status: string;
    readonly storage_key: string | null;
  }[]>`
    select stored.status, stored.storage_key, link.kind,
      link.person_id::text
    from crm.files stored
    left join crm.person_file_links link on link.file_id = stored.id
    where stored.id = ${fileId}::uuid
  `;
  assert(row, `${fileId} exists`);
  return row;
}

/** Every avatar-kind file linked to the person that is not removed. */
async function keptAvatarFiles(personId: string): Promise<readonly string[]> {
  const rows = await sql<{ readonly file_id: string }[]>`
    select stored.id::text as file_id from crm.person_file_links link
    join crm.files stored on stored.id = link.file_id
    where link.person_id = ${personId}::uuid and link.kind = 'avatar'
      and stored.deleted_at is null
    order by stored.created_at
  `;
  return rows.map((row) => row.file_id);
}

/** The file an avatar's descriptor names. */
function fileOf(imageUrl: string | undefined): string {
  const fileId = imageUrl?.match(/files\/([^/]+)\/content$/)?.[1];
  assert(fileId, `an image URL names a file (${imageUrl})`);
  return fileId;
}

async function storedAvatar(
  fixture: SignedInFixture,
  personId: string,
): Promise<string> {
  const response = await putAvatar(fixture, personId, PNG);
  assertEquals(response.status, 200, "the avatar is stored");
  return fileOf((await response.json() as AvatarBody).avatar?.imageUrl);
}

Deno.test("[FILES-001] the generic file removal refuses an avatar image as not found", async () => {
  const owner = await api.register(
    `avatar-generic-${crypto.randomUUID()}@example.test`,
    "Generic",
  );
  const ada = await createPerson(api, owner, "Ada");
  const fileId = await storedAvatar(owner, ada);

  const removed = await api.request(
    owner,
    `/api/v1/people/${ada}/files/${fileId}`,
    "DELETE",
  );
  assertEquals(removed.status, 404, "an avatar is not one of the listed files");
  assertEquals(
    (await removed.json() as { readonly code: string }).code,
    "person_file_not_found",
  );
  const state = await fileState(fileId);
  assertEquals(state.status, "available", "the image is untouched");
  assert(
    state.storage_key !== null && storage.objects.has(state.storage_key),
    "with its bytes",
  );
  assertEquals(
    fileOf((await profileAvatar(owner, ada))?.imageUrl),
    fileId,
    "and still drawn",
  );
  assertEquals(
    (await audits(ada)).includes("files.file-removed"),
    false,
    "nothing was removed",
  );
});

Deno.test("[PEOPLE-007] removing the avatar removes a quarantined avatar and the images held for review", async () => {
  const owner = await api.register(
    `avatar-quarantine-${crypto.randomUUID()}@example.test`,
    "Quarantine",
  );
  const ada = await createPerson(api, owner, "Ada");
  const held = await putAvatar(
    owner,
    ada,
    new TextEncoder().encode("not an image"),
  );
  assertEquals(held.status, 423, "the disguised image is held for review");
  const [heldId] = await keptAvatarFiles(ada);
  assert(heldId, "the held image is kept");
  const heldAvatar = await profileAvatar(owner, ada);
  assert(
    heldAvatar?.hasStoredImage === true && heldAvatar.imageUrl === undefined,
    "the person's page says an image is held though none is drawn (REL-080)",
  );
  const linked = await storedAvatar(owner, ada);
  // A later verification of the stored bytes can quarantine a linked image.
  await sql`
    update crm.files set status = 'quarantined' where id = ${linked}::uuid
  `;
  assertEquals(
    (await profileAvatar(owner, ada))?.imageUrl,
    undefined,
    "a quarantined avatar is not drawn",
  );
  assertEquals(
    (await profileAvatar(owner, ada))?.hasStoredImage,
    true,
    "the quarantined avatar is still stored for Remove avatar to take away",
  );

  const removed = await api.request(
    owner,
    `/api/v1/people/${ada}/avatar`,
    "DELETE",
  );
  assertEquals(removed.status, 200, "the avatar is removed");
  for (const fileId of [linked, heldId]) {
    const state = await fileState(fileId);
    assertEquals(state.status, "deleted", `${fileId} is removed`);
    assertEquals(state.kind, null, "and unlinked");
  }
  assertEquals(await keptAvatarFiles(ada), [], "no avatar image is left");
  assertEquals(
    (await profileAvatar(owner, ada))?.hasStoredImage,
    false,
    "and the person's page says so",
  );
  const actions = await audits(ada);
  assertEquals(
    actions.filter((action) => action === "people.avatar-removed").length,
    1,
    "the removal is audited like any avatar removal",
  );
});

Deno.test("[PEOPLE-007] a replacement that cannot be linked is discarded whatever happened meanwhile, within its own workspace", async () => {
  const owner = await api.register(
    `avatar-race-${crypto.randomUUID()}@example.test`,
    "Race",
  );
  const foreign = await api.register(
    `avatar-race-foreign-${crypto.randomUUID()}@example.test`,
    "Foreign",
  );
  const ada = await createPerson(api, owner, "Ada");
  const grace = await createPerson(api, owner, "Grace");
  const previous = await storedAvatar(owner, ada);

  const connection = connectDatabase(databaseUrl);
  try {
    const shared: SharedComposition = {
      actors: workspaceActors(),
      audit: governanceAuditRecorder(),
      clock: { now: () => new Date() },
      database: connection.db,
      ids: { create: () => crypto.randomUUID() },
      peopleTransaction: peopleTransactionRunner(connection.db),
      transaction: workspaceTransactionRunner(connection.db),
      workspaceEntry: activeWorkspaceResolver(),
    };
    const files = composeFiles(shared, {
      importPeople: personBoundary(),
      giftTarget: giftAttachmentTarget(),
      objectStore: storage,
    });
    const images = avatarImages(files.files);
    const stored: string[] = [];
    /** People's avatar use case, with `meanwhile` run once the image is stored. */
    const avatars = (meanwhile: () => Promise<void>) =>
      createPersonAvatarManagement({
        actors: shared.actors,
        audit: personAvatarAuditFrom(shared.audit),
        clock: shared.clock,
        images: {
          ...images,
          store: async (command) => {
            const result = await images.store(command);
            if ("fileId" in result) stored.push(result.fileId);
            await meanwhile();
            return result;
          },
        },
        logger: silentLogger(),
        repository: new PostgresPersonAvatarRepository(),
        transaction: shared.peopleTransaction,
      });
    const actor = {
      memberId: owner.memberId,
      role: owner.role,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
    };
    const image = { bytes: PNG, filename: "ada.png", mimeType: "image/png" };

    // Another workspace can never discard this workspace's image.
    await images.discard({
      actor: {
        memberId: foreign.memberId,
        role: foreign.role,
        userId: foreign.userId,
        workspaceId: foreign.workspaceId,
      },
      fileId: previous,
      personId: ada,
    });
    assertEquals((await fileState(previous)).status, "available");
    // Nor can a discard reach an image through somebody else.
    await images.discard({ actor, fileId: previous, personId: grace });
    assertEquals((await fileState(previous)).status, "available");

    const archived = await avatars(async () => {
      await sql`update crm.people set archived_at = now() where id = ${ada}::uuid`;
    }).replace(actor, ada, image);
    assertEquals(archived.status, "archived-write-rejected");
    const [archivedImage] = stored;
    assert(archivedImage, "the replacement had been stored");
    const afterArchive = await fileState(archivedImage);
    assertEquals(afterArchive.status, "deleted", "the unlinked image goes");
    assertEquals(afterArchive.kind, null);
    assertEquals(
      await keptAvatarFiles(ada),
      [previous],
      "only the linked avatar is left",
    );
    await sql`update crm.people set archived_at = null where id = ${ada}::uuid`;

    const revoked = await avatars(async () => {
      await revokeMembership(sql, owner.memberId);
    }).replace(actor, ada, image);
    assertEquals(revoked.status, "forbidden");
    const revokedImage = stored[1];
    assert(revokedImage, "the second replacement had been stored");
    assertEquals((await fileState(revokedImage)).status, "deleted");
    assertEquals(await keptAvatarFiles(ada), [previous]);
    const objects = await sql<{ readonly storage_key: string | null }[]>`
      select storage_key from crm.files
      where id in (${archivedImage}::uuid, ${revokedImage}::uuid)
    `;
    assert(
      objects.every((row) => row.storage_key === null),
      "neither keeps a stored object",
    );
  } finally {
    await connection.destroy();
  }
});

Deno.test("[REL-082] an upload refused once its bytes are stored leaves no processing row and no object", async () => {
  const owner = await api.register(
    `avatar-reserved-${crypto.randomUUID()}@example.test`,
    "Reserved",
  );
  const ada = await createPerson(api, owner, "Ada");
  const connection = connectDatabase(databaseUrl);
  try {
    const shared: SharedComposition = {
      actors: workspaceActors(),
      audit: governanceAuditRecorder(),
      clock: { now: () => new Date() },
      database: connection.db,
      ids: { create: () => crypto.randomUUID() },
      peopleTransaction: peopleTransactionRunner(connection.db),
      transaction: workspaceTransactionRunner(connection.db),
      workspaceEntry: activeWorkspaceResolver(),
    };
    /** Runs between the reservation and the finalise, once the bytes are put. */
    let meanwhile = () => Promise.resolve();
    const keys: string[] = [];
    const files = composeFiles(shared, {
      importPeople: personBoundary(),
      giftTarget: giftAttachmentTarget(),
      objectStore: {
        bucket: storage.bucket,
        get: (command) => storage.get(command),
        health: () => storage.health(),
        provider: storage.provider,
        put: async (command) => {
          await storage.put(command);
          keys.push(command.key);
          await meanwhile();
        },
        remove: (command) => storage.remove(command),
      },
    }).files;
    const actor = {
      memberId: owner.memberId,
      role: owner.role,
      userId: owner.userId,
      workspaceId: owner.workspaceId,
    };
    const image = { bytes: PNG, filename: "ada.png", mimeType: "image/png" };
    const processing = async () => {
      const [row] = await sql<[{ readonly count: number }]>`
        select count(*)::int as count from crm.files
        where workspace_id = ${owner.workspaceId}::uuid
          and status = 'processing'
      `;
      return row?.count;
    };

    meanwhile = async () => {
      await sql`update crm.people set archived_at = now() where id = ${ada}::uuid`;
    };
    const archived = await files.uploadAvatar(actor, ada, image);
    assertEquals(archived.status, "not-found", "an archived person is refused");
    assertEquals(await processing(), 0, "no reservation is left processing");
    assertEquals(storage.objects.has(keys[0]!), false, "nor its object");

    await sql`update crm.people set archived_at = null where id = ${ada}::uuid`;
    meanwhile = () => revokeMembership(sql, owner.memberId);
    const revoked = await files.upload(actor, ada, {
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      filename: "letter.pdf",
      kind: "document",
      mimeType: "application/pdf",
      title: "Letter",
    });
    assertEquals(revoked.status, "forbidden", "a removed member is refused");
    assertEquals(await processing(), 0, "a document's reservation goes too");
    assertEquals(storage.objects.has(keys[1]!), false, "with its object");
    const rows = await sql<
      { readonly linked: boolean; readonly storage_key: string | null }[]
    >`
      select storage_key, exists (
        select 1 from crm.person_file_links link where link.file_id = stored.id
      ) as linked
      from crm.files stored
      where workspace_id = ${owner.workspaceId}::uuid
    `;
    assertEquals(
      rows.map((row) => `${row.linked}:${row.storage_key}`),
      ["false:null", "false:null"],
      "both are recorded deleted, unlinked and without a key",
    );
  } finally {
    await connection.destroy();
  }
});

/** Merges the duplicate into the primary as the confirmation does. */
async function merge(
  fixture: SignedInFixture,
  primaryId: string,
  duplicateId: string,
): Promise<Response> {
  const preview = await api.request(
    fixture,
    `/api/v1/people/${primaryId}/merge-preview?duplicateId=${duplicateId}`,
  );
  assertEquals(preview.status, 200, "the merge is previewed");
  const body = await preview.json() as {
    readonly conflictsDigest: string;
    readonly duplicate: { readonly updatedAt: string };
    readonly primary: { readonly updatedAt: string };
  };
  return await api.request(
    fixture,
    `/api/v1/people/${primaryId}/merge`,
    "POST",
    {
      confirmed: true,
      conflictsDigest: body.conflictsDigest,
      duplicateId,
      duplicateRevision: body.duplicate.updatedAt,
      primaryRevision: body.primary.updatedAt,
    },
  );
}

Deno.test("[PEOPLE-008] a merge whose primary keeps its own avatar discards the duplicate's image", async () => {
  const owner = await api.register(
    `avatar-merge-${crypto.randomUUID()}@example.test`,
    "Merge",
  );
  const primary = await createPerson(api, owner, {
    duplicateOverride: true,
    givenName: "Ada",
    isPartial: false,
  });
  const duplicate = await createPerson(api, owner, {
    duplicateOverride: true,
    givenName: "Ada",
    isPartial: false,
  });
  const kept = await storedAvatar(owner, primary);
  const unused = await storedAvatar(owner, duplicate);

  const merged = await merge(owner, primary, duplicate);
  assertEquals(merged.status, 200, await merged.clone().text());
  const state = await fileState(unused);
  assertEquals(state.status, "deleted", "the duplicate's image is removed");
  assertEquals(state.storage_key, null, "with its bytes");
  assertEquals(await keptAvatarFiles(primary), [kept]);
  assertEquals(fileOf((await profileAvatar(owner, primary))?.imageUrl), kept);

  // Over the initials, the duplicate's image becomes the primary's instead.
  const bare = await createPerson(api, owner, {
    duplicateOverride: true,
    givenName: "Grace",
    isPartial: false,
  });
  const pictured = await createPerson(api, owner, {
    duplicateOverride: true,
    givenName: "Grace",
    isPartial: false,
  });
  const taken = await storedAvatar(owner, pictured);
  assertEquals((await merge(owner, bare, pictured)).status, 200);
  assertEquals((await fileState(taken)).status, "available");
  assertEquals(await keptAvatarFiles(bare), [taken]);
});

Deno.test("[PEOPLE-008] a merge still succeeds when the duplicate's image cannot be discarded", async () => {
  const owner = await api.register(
    `avatar-merge-fail-${crypto.randomUUID()}@example.test`,
    "Merge",
  );
  const primary = await createPerson(api, owner, {
    duplicateOverride: true,
    givenName: "Ada",
    isPartial: false,
  });
  const duplicate = await createPerson(api, owner, {
    duplicateOverride: true,
    givenName: "Ada",
    isPartial: false,
  });
  const kept = await storedAvatar(owner, primary);
  const unused = await storedAvatar(owner, duplicate);

  storage.failRemove = true;
  try {
    const merged = await merge(owner, primary, duplicate);
    assertEquals(merged.status, 200, "the merge is committed");
  } finally {
    storage.failRemove = false;
  }
  const [gone] = await sql<{ readonly deleted_at: string | null }[]>`
    select deleted_at::text from crm.people where id = ${duplicate}::uuid
  `;
  assert(gone?.deleted_at, "the duplicate is merged away");
  assertEquals(
    (await fileState(unused)).status,
    "available",
    "the image that could not be discarded is left as it was",
  );
  assertEquals(fileOf((await profileAvatar(owner, primary))?.imageUrl), kept);
});
